import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CREW_ROUTE, CREW_ROUTE_ID, boatDeparturesByDay, boatRuns, crewCalendars, crewShuttleRows,
  crewSwapIndex, homePortRows, serviceBreaks
} from "./out-of-service.js";

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

// Seastreak publishes HTML-escaped text in its GTFS ("Martha&#8217;s Vineyard &amp; Nantucket"),
// which would otherwise reach the screen verbatim. Also collapses stray whitespace.
export function decodeEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return (value || "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .replace(/\s+/g, " ").trim();
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

// Partner operators that share a dock with an NYC Ferry landing. Each has its own independently
// published GTFS directory, so their small integer route/trip/stop ids overlap with NYC Ferry's
// and with each other (waterway stop "4" is unrelated to NYC Ferry stop "4"). Every id from a
// partner feed is namespaced with that operator's prefix to keep the merged output unambiguous.

// Four NY Waterway routes are tagged route_type=3 (bus) in the Trillium feed even though they are
// ferries: they cross the Hudson, the operator publishes a ferry timetable for each of them on
// nywaterway.com, and every departure time in the feed matches that timetable exactly. Left alone
// they are dropped entirely wherever display.json sets busesEnabled=false, which silently removes
// a third of NY Waterway's service at Pier 11 (Edgewater, Hoboken/14th St and Port Liberte) and
// the Edgewater sailings at Brookfield Place.
//
// The correction lives here rather than in gtfs/waterway/routes.txt so that dropping in a fresh
// feed cannot quietly reintroduce the bug. It reclassifies a route; it does not touch a single
// published time. Everything else typed as a bus in that feed really is one — the town shuttles,
// the numbered Midtown crosstown buses, and the Newburgh–Beacon winter bus that substitutes for
// the ferry — so they stay buses.
const WATERWAY_FERRIES_TYPED_AS_BUS = new Set([
  "19750", // Edgewater - Brookfield Place
  "19751", // Edgewater - Pier 11/Wall St
  "74376", // Port Liberte - Pier 11/Wall St
  "76080"  // Hoboken / 14th St - Pier 11 / Wall St
]);

export const PARTNER_FEEDS = {
  waterway: { prefix: "wtr:", directory: "gtfs/waterway", label: "NY Waterway", defaultColor: "#00558C", enabledKey: "waterwayEnabled", stopIdsKey: "waterwayStopIds", ferryRouteIds: WATERWAY_FERRIES_TYPED_AS_BUS },
  seastreak: { prefix: "sea:", directory: "gtfs/seastreak", label: "Seastreak", defaultColor: "#013067", enabledKey: "seastreakEnabled", stopIdsKey: "seastreakStopIds", destinationFromFinalStop: true },
  // NYU publishes no GTFS at all — gtfs/nyu/ is reconstructed from its Passio GO backend by
  // scripts/fetch-nyu-gtfs.js. Once written it is an ordinary static feed, so it needs no special
  // handling here beyond its own prefix and switches.
  nyu: { prefix: "nyu:", directory: "gtfs/nyu", label: "NYU Langone Ferry", defaultColor: "#57068C", enabledKey: "nyuEnabled", stopIdsKey: "nyuStopIds" },
  liberty: { prefix: "lib:", directory: "gtfs/liberty", label: "Liberty Landing Ferry", defaultColor: "#1B3F94", enabledKey: "libertyEnabled", stopIdsKey: "libertyStopIds" },
  // NY Waterway runs the IKEA Brooklyn weekend boat but leaves it out of the GTFS it publishes,
  // so it gets its own feed and its own switches rather than riding on the waterway entry. It is
  // seasonal and transcribed from an image by scripts/build-ikea-gtfs.js; see that file.
  ikea: { prefix: "ike:", directory: "gtfs/ikea", label: "IKEA Brooklyn Ferry", defaultColor: "#0058A3", enabledKey: "ikeaEnabled", stopIdsKey: "ikeaStopIds" }
};

// Reads one partner feed and returns its departures already namespaced and shaped exactly like
// the NYC Ferry entries, so the caller only has to concatenate.
async function buildPartnerFeed({ root, feed, stopIds, landingNumber, busesEnabled }) {
  const [routesRaw, stopsRaw, tripsRaw, timesRaw, calendarRaw, datesRaw, agencyRaw] = await Promise.all([
    readFile(path.join(root, feed.directory, "routes.txt"), "utf8"), readFile(path.join(root, feed.directory, "stops.txt"), "utf8"),
    readFile(path.join(root, feed.directory, "trips.txt"), "utf8"), readFile(path.join(root, feed.directory, "stop_times.txt"), "utf8"),
    readFile(path.join(root, feed.directory, "calendar.txt"), "utf8"), readFile(path.join(root, feed.directory, "calendar_dates.txt"), "utf8"),
    readFile(path.join(root, feed.directory, "agency.txt"), "utf8")
  ]);
  const routes = parseCsv(routesRaw), stops = parseCsv(stopsRaw), trips = parseCsv(tripsRaw), stopTimes = parseCsv(timesRaw);
  const routesById = new Map(routes.map((item) => [item.route_id, item]));
  const stopsById = new Map(stops.map((item) => [item.stop_id, item]));
  const tripsById = new Map(trips.map((item) => [item.trip_id, item]));
  const selectedStops = new Set(stopIds);
  for (const stopId of selectedStops) if (!stopsById.has(stopId)) throw new Error(`Landing ${landingNumber} references missing ${feed.label} stop ${stopId}.`);
  const agencyName = parseCsv(agencyRaw)[0]?.agency_name || feed.label;
  const prefixed = (value) => `${feed.prefix}${value}`;
  // route_type as the feed means it, not as it says it. See WATERWAY_FERRIES_TYPED_AS_BUS.
  const modeOf = (route) => (route.route_type === "3" && !feed.ferryRouteIds?.has(route.route_id) ? "bus" : "ferry");

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
    if (!busesEnabled && modeOf(route) === "bus") continue;
    for (let index = 0; index < times.length - 1; index += 1) {
      const current = times[index];
      if (!selectedStops.has(current.stop_id) || current.pickup_type === "1") continue;
      const departureTime = current.departure_time || current.arrival_time;
      if (!departureTime) continue;
      const finalStop = stopsById.get(times.at(-1).stop_id);
      // Seastreak's headsigns name a region ("Manhattan", "New Jersey"), which tells a rider
      // standing in Manhattan nothing, so that feed is configured to show the trip's last stop
      // instead. NY Waterway's headsigns already name the terminal, so it keeps the headsign.
      const headsign = current.stop_headsign || trip.trip_headsign;
      const destination = decodeEntities(feed.destinationFromFinalStop
        ? (finalStop?.stop_name || headsign || "Destination unavailable")
        : (headsign || finalStop?.stop_name || "Destination unavailable"));
      departures.push({
        tripId: prefixed(tripId), routeId: prefixed(trip.route_id), serviceId: prefixed(trip.service_id),
        directionId: trip.direction_id, stopId: prefixed(current.stop_id), departureTime, seconds: timeToSeconds(departureTime),
        destination, variant: null,
        nextStop: decodeEntities(stopsById.get(times[index + 1].stop_id)?.stop_name || "") || null,
        servesGovernorsIsland: false,
        // Partner crews aren't in the NYC Ferry schedule workbook.
        boatAssignment: null,
        mode: modeOf(route),
        operator: agencyName,
        // Partner operators publish no crew schedule, so none of this is knowable for them.
        endsShift: null, outOfService: false, crewShuttle: false, crewBoats: null,
        departureTimeEnd: null, secondsEnd: null, endsDay: false
      });
    }
  }

  const usedTripIds = new Set(departures.map((item) => item.tripId));
  const tripSchedules = Object.fromEntries([...usedTripIds].map((prefixedTripId) => [prefixedTripId, {
    stops: (timesByTrip.get(prefixedTripId.slice(feed.prefix.length)) || []).map((stopTime) => ({
      stopId: prefixed(stopTime.stop_id),
      sequence: Number(stopTime.stop_sequence),
      arrivalSeconds: stopTime.arrival_time ? timeToSeconds(stopTime.arrival_time) : null,
      departureSeconds: stopTime.departure_time ? timeToSeconds(stopTime.departure_time) : null
    }))
  }]));

  const usedRouteIds = new Set(departures.map((item) => item.routeId));
  const routeData = Object.fromEntries(routes
    .filter((item) => usedRouteIds.has(prefixed(item.route_id)))
    .map((item) => [prefixed(item.route_id), {
      id: prefixed(item.route_id), shortName: decodeEntities(item.route_short_name) || item.route_id,
      name: decodeEntities(item.route_long_name || item.route_short_name) || item.route_id,
      color: color(item.route_color, feed.defaultColor), textColor: color(item.route_text_color, "#FFFFFF"),
      mode: modeOf(item), operator: agencyName
    }]));

  const calendars = parseCsv(calendarRaw).map((item) => ({
    serviceId: prefixed(item.service_id),
    weekdays: [item.sunday,item.monday,item.tuesday,item.wednesday,item.thursday,item.friday,item.saturday].map((v) => v === "1"),
    startDate: isoDate(item.start_date), endDate: isoDate(item.end_date)
  }));
  const exceptions = parseCsv(datesRaw).map((item) => ({
    serviceId: prefixed(item.service_id), date: isoDate(item.date), added: item.exception_type === "1"
  }));

  // public/app.js only counts a departure whose service is in effect today, so a feed whose whole
  // calendar has lapsed contributes nothing and does so silently — the operator's rows just never
  // appear. Partner feeds are third-party and go stale without warning, so say it out loud at
  // build time rather than leaving someone to debug an empty row. The build still succeeds: an
  // expired feed is a publishing problem upstream, not a reason to refuse to build the board.
  const today = new Date().toISOString().slice(0, 10);
  const latestEnd = calendars.reduce((latest, item) => (item.endDate && item.endDate > latest ? item.endDate : latest), "");
  if (calendars.length && latestEnd && latestEnd < today) {
    console.warn(`WARNING: the ${feed.label} feed in ${feed.directory} expired on ${latestEnd}; no departures will be shown until it is replaced.`);
  }

  return { agencyName, departures, tripSchedules, routes: routeData, calendars, exceptions };
}

export async function buildDisplayData({
  root = ROOT,
  landingNumber: landingOverride,
  departuresShown: departuresShownOverride,
  routesShown: routesShownOverride,
  waterwayEnabled: waterwayEnabledOverride,
  seastreakEnabled: seastreakEnabledOverride,
  nyuEnabled: nyuEnabledOverride,
  libertyEnabled: libertyEnabledOverride,
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
  // Home port and crew shuttles. Optional in the same way and for the same reason: neither the
  // feed nor the workbook describes a boat's movements once it stops carrying passengers, so a
  // board without this file simply shows no out-of-service rows.
  const crewConfig = await readFile(path.join(root, "config/crew-shuttles.json"), "utf8")
    .then((raw) => JSON.parse(raw))
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

  // Where each boat stops working. Only answerable because the workbook says which boat runs which
  // trip: grouped by boat, a shift ending mid-day is a hole in that boat's own run of trips. Routes
  // with no boat number (Governors Island, the Rockaway shuttle buses) contribute nothing.
  const calendarByService = new Map(parseCsv(calendarRaw).map((item) => [item.service_id, item]));
  const runs = boatRuns({ trips, timesByTrip, boatAssignments });
  const dayTypeOf = (serviceId) => {
    const row = calendarByService.get(serviceId);
    if (!row) return null;
    const runsWeekday = ["monday", "tuesday", "wednesday", "thursday", "friday"].some((day) => row[day] === "1");
    const runsWeekend = row.saturday === "1" || row.sunday === "1";
    return runsWeekday && !runsWeekend ? "weekday" : (runsWeekend && !runsWeekday ? "weekend" : null);
  };
  const breaks = serviceBreaks({
    runs, dayTypeOf,
    gapMinutes: Number(crewConfig.outOfService?.gapMinutes) || 60,
    certainAfterMinutes: Number(crewConfig.outOfService?.certainAfterMinutes) || 180,
    crewSwaps: crewSwapIndex({ shuttles: crewConfig.shuttles, landings })
  });

  let departures = [];
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
        operator: agency.agency_name || "NYC Ferry",
        // Flagged on every leg of the trip, not just the last one: an agent at Pier 11 watching the
        // boat leave needs to know it is not coming back, not to be told once it has already gone.
        endsShift: breaks.certainty.get(tripId) || null,
        outOfService: false, crewShuttle: false, crewBoats: null,
        departureTimeEnd: null, secondsEnd: null, endsDay: false
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

  // The moves a boat makes with no passengers aboard: the run to the home port after its last
  // revenue trip, and the crew shuttles that swap a crew mid-day without ending the boat's service.
  // Both are NYC Ferry only, and both are additions to the board rather than edits to it — no
  // published departure time is changed by any of this.
  const operatorName = agency.agency_name || "NYC Ferry";
  const homePort = crewConfig.homePort || "Pier C";
  const outOfServiceDepartures = [
    ...homePortRows({
      tieUps: breaks.tieUps, selectedStops, homePort,
      dwellMinutes: Number(crewConfig.homePortDwellMinutes) || 0, operator: operatorName
    }),
    ...crewShuttleRows({
      shuttles: crewConfig.shuttles, landingNumber, landings, selectedStops, homePort, operator: operatorName,
      boatDepartures: boatDeparturesByDay({ trips, timesByTrip, boatAssignments, dayTypeOf })
    })
  ];
  if (outOfServiceDepartures.length) {
    departures.push(...outOfServiceDepartures);
    departures.sort((a, b) => a.seconds - b.seconds || a.routeId.localeCompare(b.routeId));
    // A crew shuttle cannot reuse the feed's weekday service: on a holiday the feed still runs
    // weekdays while the crews change on the weekend pattern, so the shuttles get their own pair of
    // calendars bounded to the same dates the feed covers.
    const bounds = calendars.filter((item) => item.startDate && item.endDate);
    const crew = crewCalendars({
      startDate: bounds.map((item) => item.startDate).sort()[0] || null,
      endDate: bounds.map((item) => item.endDate).sort().at(-1) || null,
      holidays: crewConfig.holidays?.dates || []
    });
    calendars = calendars.concat(crew.calendars);
    exceptions = exceptions.concat(crew.exceptions);
    if (outOfServiceDepartures.some((item) => item.crewShuttle)) {
      routeData[CREW_ROUTE_ID] = { ...CREW_ROUTE, operator: operatorName };
    }
  }

  // Partner-operator departures (NY Waterway, Seastreak, NYU). Each is controlled by two independent,
  // additive switches: the operator's "...Enabled" key in config/display.json (global on/off for
  // the kiosk) and its "...StopIds" array in config/landings.json (per-landing; only landings with
  // that operator's dock nearby should set it). When either is off for an operator, none of its
  // data is read and the output keeps the same shape NYC-Ferry-only builds always produced.
  const partnerOverrides = { waterway: waterwayEnabledOverride, seastreak: seastreakEnabledOverride, nyu: nyuEnabledOverride, liberty: libertyEnabledOverride };
  const partners = {};
  for (const [name, feed] of Object.entries(PARTNER_FEEDS)) {
    const stopIds = landingConfig[feed.stopIdsKey] || [];
    const enabled = (partnerOverrides[name] ?? display[feed.enabledKey]) === true && stopIds.length > 0;
    partners[name] = { enabled, agencyName: null, stopIds };
    if (!enabled) continue;
    const merged = await buildPartnerFeed({ root, feed, stopIds, landingNumber, busesEnabled });
    partners[name].agencyName = merged.agencyName;
    Object.assign(tripSchedules, merged.tripSchedules);
    Object.assign(routeData, merged.routes);
    calendars = calendars.concat(merged.calendars);
    exceptions = exceptions.concat(merged.exceptions);
    departures.push(...merged.departures);
  }
  // A feed can carry the same sailing twice. NY Waterway's does: the South Amboy route keeps a
  // stale pair of trips alongside the current ones, so 3:35 PM and 4:35 PM to South Amboy each
  // appear on the board twice, one row per trip id. Two rows that agree on service, route, stop,
  // minute and destination are one boat as far as a rider is concerned, and showing them twice
  // makes the board look broken and pushes a real later sailing off the screen.
  //
  // This drops the duplicate row, never a time: a sailing only disappears if an identical one
  // remains. The first occurrence wins, which is stable for a given feed because stop_times.txt
  // is read in file order.
  const seenDepartures = new Set();
  const deduped = departures.filter((item) => {
    const key = [item.serviceId, item.routeId, item.variant || "", item.stopId, item.departureTime, item.destination].join(" ");
    if (seenDepartures.has(key)) return false;
    seenDepartures.add(key);
    return true;
  });
  if (deduped.length !== departures.length) {
    console.warn(`NOTE: dropped ${departures.length - deduped.length} duplicate departure(s) at landing ${landingNumber} — the feed lists the same sailing under more than one trip id.`);
  }
  departures = deduped;
  if (Object.values(partners).some((item) => item.enabled)) {
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
      waterway: partners.waterway, seastreak: partners.seastreak, nyu: partners.nyu, liberty: partners.liberty, ikea: partners.ikea
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
