import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseCsv(input) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row); }
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header.replace(/^\uFEFF/, ""), values[index] ?? ""])));
}

export function timeToSeconds(value) {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) throw new Error(`Invalid GTFS time: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function isoDate(value) {
  return /^\d{8}$/.test(value || "") ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;
}

function color(value, fallback) {
  return /^[0-9a-f]{6}$/i.test(value || "") ? `#${value.toUpperCase()}` : fallback;
}

function destinationInfo(stopTime, trip, finalStop, routeId) {
  const raw = (stopTime.stop_headsign || trip.trip_headsign || finalStop?.stop_name || "Destination unavailable")
    .replace(/\s+/g, " ").trim();
  const variantMatch = raw.match(/\s*\(E R ([AB])\)$/i);
  return {
    destination: raw.replace(/\s*\(E R [AB]\)$/i, "").trim(),
    variant: routeId === "ER" ? (variantMatch?.[1]?.toUpperCase() || "LOCAL") : null
  };
}

export async function buildDisplayData({
  root = ROOT,
  landingNumber: landingOverride,
  departuresShown: departuresShownOverride,
  routesShown: routesShownOverride,
  waterwayEnabled: waterwayEnabledOverride,
  busesEnabled: busesEnabledOverride
} = {}) {
  const [displayRaw, landingsRaw, routesRaw, stopsRaw, tripsRaw, timesRaw, calendarRaw, datesRaw, feedRaw, agencyRaw] = await Promise.all([
    readFile(path.join(root, "config/display.json"), "utf8"), readFile(path.join(root, "config/landings.json"), "utf8"),
    readFile(path.join(root, "gtfs/routes.txt"), "utf8"), readFile(path.join(root, "gtfs/stops.txt"), "utf8"),
    readFile(path.join(root, "gtfs/trips.txt"), "utf8"), readFile(path.join(root, "gtfs/stop_times.txt"), "utf8"),
    readFile(path.join(root, "gtfs/calendar.txt"), "utf8"), readFile(path.join(root, "gtfs/calendar_dates.txt"), "utf8"),
    readFile(path.join(root, "gtfs/feed_info.txt"), "utf8"), readFile(path.join(root, "gtfs/agency.txt"), "utf8")
  ]);
  // Crew-schedule boat assignments ("East River 5"), keyed by GTFS trip_short_name. Generated
  // from the seasonal workbook by scripts/import-boat-assignments.py. Optional: a feed with no
  // matching schedule on hand still builds, just without assignment labels.
  const boatAssignments = await readFile(path.join(root, "content/boat-assignments.json"), "utf8")
    .then((raw) => JSON.parse(raw).assignments || {})
    .catch(() => ({}));
  const display = JSON.parse(displayRaw);
  const landings = JSON.parse(landingsRaw);
  const landingNumber = Number(landingOverride ?? display.landingNumber);
  const landingConfig = landings[String(landingNumber)];
  // The set of valid landings is whatever config/landings.json declares, so adding a landing
  // only requires editing that file (plus a matching overrides/NN.json for SFTP notices).
  const activeLandingNumbers = Object.entries(landings)
    .filter(([, item]) => !item.unused).map(([key]) => Number(key)).sort((left, right) => left - right);
  if (!Number.isInteger(landingNumber) || !landingConfig || landingConfig.unused) {
    throw new Error(`Landing number must be an active landing from ${activeLandingNumbers[0]} through ${activeLandingNumbers.at(-1)}; received ${landingOverride ?? display.landingNumber}.`);
  }
  const slideSeconds = Number(display.slideSeconds);
  if (!Number.isFinite(slideSeconds) || slideSeconds < 3 || slideSeconds > 300) {
    throw new Error(`config/display.json slideSeconds must be between 3 and 300; received ${display.slideSeconds}.`);
  }
  const departureWindowMinutes = Number(display.departureWindowMinutes);
  if (!Number.isFinite(departureWindowMinutes) || departureWindowMinutes < 1 || departureWindowMinutes > 1440) {
    throw new Error(`config/display.json departureWindowMinutes must be between 1 and 1440; received ${display.departureWindowMinutes}.`);
  }
  const departuresShown = Number(departuresShownOverride ?? display.departuresShown);
  if (!Number.isInteger(departuresShown) || departuresShown < 1 || departuresShown > 5) {
    throw new Error(`config/display.json departuresShown must be a whole number from 1 through 5; received ${departuresShownOverride ?? display.departuresShown}.`);
  }
  const routesShown = Number(routesShownOverride ?? display.routesShown);
  if (!Number.isInteger(routesShown) || routesShown < 1 || routesShown > 5) {
    throw new Error(`config/display.json routesShown must be a whole number from 1 through 5; received ${routesShownOverride ?? display.routesShown}.`);
  }
  // config/display.json "busesEnabled" keeps or drops connecting shuttle-bus routes (GTFS
  // route_type 3) from both feeds: the Rockaway shuttles at landing 18 and the NY Waterway
  // shuttles at Pier 79 and the other waterway landings. Omitting the key means true, so a
  // config that predates this switch keeps every mode it used to show.
  if (display.busesEnabled !== undefined && typeof display.busesEnabled !== "boolean") {
    throw new Error(`config/display.json busesEnabled must be true or false; received ${JSON.stringify(display.busesEnabled)}.`);
  }
  const busesEnabled = (busesEnabledOverride ?? display.busesEnabled ?? true) === true;

  const routes = parseCsv(routesRaw), stops = parseCsv(stopsRaw), trips = parseCsv(tripsRaw), stopTimes = parseCsv(timesRaw);
  const agency = parseCsv(agencyRaw)[0] || {};
  const routesById = new Map(routes.map((item) => [item.route_id, item]));
  const stopsById = new Map(stops.map((item) => [item.stop_id, item]));
  const tripsById = new Map(trips.map((item) => [item.trip_id, item]));
  const selectedStops = new Set(landingConfig.stopIds);
  const governorsIslandStops = new Set(landings["11"]?.stopIds || []);
  for (const stopId of selectedStops) if (!stopsById.has(stopId)) throw new Error(`Landing ${landingNumber} references missing GTFS stop ${stopId}.`);

  const timesByTrip = new Map();
  for (const item of stopTimes) {
    const list = timesByTrip.get(item.trip_id) || [];
    list.push(item); timesByTrip.set(item.trip_id, list);
  }
  for (const list of timesByTrip.values()) list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));

  const departures = [];
  for (const [tripId, times] of timesByTrip) {
    const trip = tripsById.get(tripId), route = routesById.get(trip?.route_id);
    if (!trip || !route) continue;
    if (!busesEnabled && route.route_type === "3") continue;
    for (let index = 0; index < times.length - 1; index += 1) {
      const current = times[index];
      if (!selectedStops.has(current.stop_id) || current.pickup_type === "1") continue;
      const departureTime = current.departure_time || current.arrival_time;
      if (!departureTime) continue;
      const finalStop = stopsById.get(times.at(-1).stop_id);
      const destination = destinationInfo(current, trip, finalStop, trip.route_id);
      const servesGovernorsIsland = trip.route_id === "SB" &&
        times.slice(index).some((stopTime) => governorsIslandStops.has(stopTime.stop_id));
      const assignedBoat = boatAssignments[String(trip.trip_short_name || "").trim()];
      departures.push({
        tripId, routeId: trip.route_id, serviceId: trip.service_id, directionId: trip.direction_id,
        stopId: current.stop_id, departureTime, seconds: timeToSeconds(departureTime),
        destination: destination.destination, variant: destination.variant,
        nextStop: stopsById.get(times[index + 1].stop_id)?.stop_name || null,
        servesGovernorsIsland,
        boatAssignment: Number.isInteger(assignedBoat) ? assignedBoat : null,
        mode: route.route_type === "3" ? "bus" : "ferry",
        operator: agency.agency_name || "NYC Ferry"
      });
    }
  }
  departures.sort((a, b) => a.seconds - b.seconds || a.routeId.localeCompare(b.routeId));
  const usedTripIds = new Set(departures.map((item) => item.tripId));
  const tripSchedules = Object.fromEntries([...usedTripIds].map((tripId) => [tripId, {
    stops: (timesByTrip.get(tripId) || []).map((stopTime) => ({
      stopId: stopTime.stop_id,
      sequence: Number(stopTime.stop_sequence),
      arrivalSeconds: stopTime.arrival_time ? timeToSeconds(stopTime.arrival_time) : null,
      departureSeconds: stopTime.departure_time ? timeToSeconds(stopTime.departure_time) : null
    }))
  }]));
  const usedRouteIds = new Set(departures.map((item) => item.routeId));
  const routeData = Object.fromEntries(routes.filter((item) => usedRouteIds.has(item.route_id)).map((item) => [item.route_id, {
    id: item.route_id, shortName: item.route_short_name || item.route_id, name: item.route_long_name,
    color: color(item.route_color, "#004E72"), textColor: color(item.route_text_color, "#FFFFFF"), mode: item.route_type === "3" ? "bus" : "ferry",
    operator: agency.agency_name || "NYC Ferry"
  }]));
  const stopDetails = landingConfig.stopIds.map((id) => stopsById.get(id));
  const feed = parseCsv(feedRaw)[0] || {};
  let calendars = parseCsv(calendarRaw).map((item) => ({ serviceId: item.service_id, weekdays: [item.sunday,item.monday,item.tuesday,item.wednesday,item.thursday,item.friday,item.saturday].map((v) => v === "1"), startDate: isoDate(item.start_date), endDate: isoDate(item.end_date) }));
  let exceptions = parseCsv(datesRaw).map((item) => ({ serviceId: item.service_id, date: isoDate(item.date), added: item.exception_type === "1" }));

  // NY Waterway departures. Controlled by two independent, additive switches:
  // config/display.json "waterwayEnabled" (global on/off) and config/landings.json
  // "waterwayStopIds" (per-landing; only landings with a physical NY Waterway stop nearby
  // should set this). When either is off, none of this block runs and the output is byte-for-byte
  // the same shape NYC-Ferry-only builds always produced. All NY Waterway identifiers are namespaced
  // with a "wtr:" prefix because the two GTFS feeds are published independently and reuse
  // overlapping small integer stop/route ids (e.g. waterway stop "4" is unrelated to NYC Ferry stop "4").
  const WATERWAY_PREFIX = "wtr:";
  const waterwayStopIds = landingConfig.waterwayStopIds || [];
  const waterwayEnabled = (waterwayEnabledOverride ?? display.waterwayEnabled) === true && waterwayStopIds.length > 0;
  let waterwayAgencyName = null;

  if (waterwayEnabled) {
    const [wRoutesRaw, wStopsRaw, wTripsRaw, wTimesRaw, wCalendarRaw, wDatesRaw, wAgencyRaw] = await Promise.all([
      readFile(path.join(root, "gtfs/waterway/routes.txt"), "utf8"), readFile(path.join(root, "gtfs/waterway/stops.txt"), "utf8"),
      readFile(path.join(root, "gtfs/waterway/trips.txt"), "utf8"), readFile(path.join(root, "gtfs/waterway/stop_times.txt"), "utf8"),
      readFile(path.join(root, "gtfs/waterway/calendar.txt"), "utf8"), readFile(path.join(root, "gtfs/waterway/calendar_dates.txt"), "utf8"),
      readFile(path.join(root, "gtfs/waterway/agency.txt"), "utf8")
    ]);
    const wRoutes = parseCsv(wRoutesRaw), wStops = parseCsv(wStopsRaw), wTrips = parseCsv(wTripsRaw), wStopTimes = parseCsv(wTimesRaw);
    const wRoutesById = new Map(wRoutes.map((item) => [item.route_id, item]));
    const wStopsById = new Map(wStops.map((item) => [item.stop_id, item]));
    const wTripsById = new Map(wTrips.map((item) => [item.trip_id, item]));
    const wSelectedStops = new Set(waterwayStopIds);
    for (const stopId of wSelectedStops) if (!wStopsById.has(stopId)) throw new Error(`Landing ${landingNumber} references missing NY Waterway stop ${stopId}.`);
    const wAgency = parseCsv(wAgencyRaw)[0] || {};
    waterwayAgencyName = wAgency.agency_name || "NY Waterway";

    const wTimesByTrip = new Map();
    for (const item of wStopTimes) {
      const list = wTimesByTrip.get(item.trip_id) || [];
      list.push(item); wTimesByTrip.set(item.trip_id, list);
    }
    for (const list of wTimesByTrip.values()) list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));

    const waterwayDepartures = [];
    for (const [tripId, times] of wTimesByTrip) {
      const trip = wTripsById.get(tripId), route = wRoutesById.get(trip?.route_id);
      if (!trip || !route) continue;
      if (!busesEnabled && route.route_type === "3") continue;
      for (let index = 0; index < times.length - 1; index += 1) {
        const current = times[index];
        if (!wSelectedStops.has(current.stop_id) || current.pickup_type === "1") continue;
        const departureTime = current.departure_time || current.arrival_time;
        if (!departureTime) continue;
        const finalStop = wStopsById.get(times.at(-1).stop_id);
        const destination = (current.stop_headsign || trip.trip_headsign || finalStop?.stop_name || "Destination unavailable").replace(/\s+/g, " ").trim();
        waterwayDepartures.push({
          tripId: `${WATERWAY_PREFIX}${tripId}`, routeId: `${WATERWAY_PREFIX}${trip.route_id}`, serviceId: `${WATERWAY_PREFIX}${trip.service_id}`,
          directionId: trip.direction_id, stopId: `${WATERWAY_PREFIX}${current.stop_id}`, departureTime, seconds: timeToSeconds(departureTime),
          destination, variant: null,
          nextStop: wStopsById.get(times[index + 1].stop_id)?.stop_name || null,
          servesGovernorsIsland: false,
          // NY Waterway crews aren't in the NYC Ferry schedule workbook.
          boatAssignment: null,
          mode: route.route_type === "3" ? "bus" : "ferry",
          operator: waterwayAgencyName
        });
      }
    }

    const wUsedTripIds = new Set(waterwayDepartures.map((item) => item.tripId));
    Object.assign(tripSchedules, Object.fromEntries([...wUsedTripIds].map((prefixedTripId) => {
      const tripId = prefixedTripId.slice(WATERWAY_PREFIX.length);
      return [prefixedTripId, {
        stops: (wTimesByTrip.get(tripId) || []).map((stopTime) => ({
          stopId: `${WATERWAY_PREFIX}${stopTime.stop_id}`,
          sequence: Number(stopTime.stop_sequence),
          arrivalSeconds: stopTime.arrival_time ? timeToSeconds(stopTime.arrival_time) : null,
          departureSeconds: stopTime.departure_time ? timeToSeconds(stopTime.departure_time) : null
        }))
      }];
    })));

    const wUsedRouteIds = new Set(waterwayDepartures.map((item) => item.routeId));
    Object.assign(routeData, Object.fromEntries(wRoutes
      .filter((item) => wUsedRouteIds.has(`${WATERWAY_PREFIX}${item.route_id}`))
      .map((item) => [`${WATERWAY_PREFIX}${item.route_id}`, {
        id: `${WATERWAY_PREFIX}${item.route_id}`, shortName: item.route_short_name || item.route_id, name: item.route_long_name || item.route_short_name || item.route_id,
        color: color(item.route_color, "#00558C"), textColor: color(item.route_text_color, "#FFFFFF"),
        mode: item.route_type === "3" ? "bus" : "ferry", operator: waterwayAgencyName
      }])));

    calendars = calendars.concat(parseCsv(wCalendarRaw).map((item) => ({
      serviceId: `${WATERWAY_PREFIX}${item.service_id}`,
      weekdays: [item.sunday,item.monday,item.tuesday,item.wednesday,item.thursday,item.friday,item.saturday].map((v) => v === "1"),
      startDate: isoDate(item.start_date), endDate: isoDate(item.end_date)
    })));
    exceptions = exceptions.concat(parseCsv(wDatesRaw).map((item) => ({
      serviceId: `${WATERWAY_PREFIX}${item.service_id}`, date: isoDate(item.date), added: item.exception_type === "1"
    })));

    departures.push(...waterwayDepartures);
    departures.sort((a, b) => a.seconds - b.seconds || a.routeId.localeCompare(b.routeId));
  }

  return {
    meta: {
      schemaVersion: 8, generatedAt: new Date().toISOString(), landingNumber, slideSeconds, departureWindowMinutes,
      departuresShown, routesShown, busesEnabled,
      landing: { name: landingConfig.name, displayName: landingConfig.displayName || landingConfig.name, stopIds: landingConfig.stopIds,
        latitude: Number(stopDetails[0].stop_lat), longitude: Number(stopDetails[0].stop_lon) },
      timezone: agency.agency_timezone || "America/New_York", agencyName: agency.agency_name || "NYC Ferry", feedVersion: feed.feed_version,
      feedStartDate: isoDate(feed.feed_start_date), feedEndDate: isoDate(feed.feed_end_date),
      sourceHash: createHash("sha256").update(routesRaw + tripsRaw + timesRaw).digest("hex").slice(0, 16),
      waterway: { enabled: waterwayEnabled, agencyName: waterwayAgencyName, stopIds: waterwayStopIds }
    },
    calendars, exceptions,
    routes: routeData, departures, tripSchedules
  };
}

export async function writeDisplayData(options) {
  const data = await buildDisplayData(options);
  const outputDir = path.join(options?.root || ROOT, "public/data");
  await mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, "display-data.json"), temporary = `${output}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data)}\n`, "utf8");
  await rename(temporary, output);
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = await writeDisplayData();
  console.log(`Built landing ${data.meta.landingNumber}: ${data.meta.landing.displayName} (${data.departures.length} scheduled departures).`);
}
