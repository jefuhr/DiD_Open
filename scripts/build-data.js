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

export async function buildDisplayData({ root = ROOT, landingNumber: landingOverride } = {}) {
  const [displayRaw, landingsRaw, routesRaw, stopsRaw, tripsRaw, timesRaw, calendarRaw, datesRaw, feedRaw, agencyRaw] = await Promise.all([
    readFile(path.join(root, "config/display.json"), "utf8"), readFile(path.join(root, "config/landings.json"), "utf8"),
    readFile(path.join(root, "gtfs/routes.txt"), "utf8"), readFile(path.join(root, "gtfs/stops.txt"), "utf8"),
    readFile(path.join(root, "gtfs/trips.txt"), "utf8"), readFile(path.join(root, "gtfs/stop_times.txt"), "utf8"),
    readFile(path.join(root, "gtfs/calendar.txt"), "utf8"), readFile(path.join(root, "gtfs/calendar_dates.txt"), "utf8"),
    readFile(path.join(root, "gtfs/feed_info.txt"), "utf8"), readFile(path.join(root, "gtfs/agency.txt"), "utf8")
  ]);
  const display = JSON.parse(displayRaw);
  const landings = JSON.parse(landingsRaw);
  const landingNumber = Number(landingOverride ?? display.landingNumber);
  const landingConfig = landings[String(landingNumber)];
  if (!Number.isInteger(landingNumber) || landingNumber < 2 || landingNumber > 24 || !landingConfig || landingConfig.unused) {
    throw new Error(`Landing number must be an active landing from 2 through 24; received ${landingOverride ?? display.landingNumber}.`);
  }
  const slideSeconds = Number(display.slideSeconds);
  if (!Number.isFinite(slideSeconds) || slideSeconds < 3 || slideSeconds > 300) {
    throw new Error(`config/display.json slideSeconds must be between 3 and 300; received ${display.slideSeconds}.`);
  }
  const departureWindowMinutes = Number(display.departureWindowMinutes);
  if (!Number.isFinite(departureWindowMinutes) || departureWindowMinutes < 1 || departureWindowMinutes > 1440) {
    throw new Error(`config/display.json departureWindowMinutes must be between 1 and 1440; received ${display.departureWindowMinutes}.`);
  }

  const routes = parseCsv(routesRaw), stops = parseCsv(stopsRaw), trips = parseCsv(tripsRaw), stopTimes = parseCsv(timesRaw);
  const routesById = new Map(routes.map((item) => [item.route_id, item]));
  const stopsById = new Map(stops.map((item) => [item.stop_id, item]));
  const tripsById = new Map(trips.map((item) => [item.trip_id, item]));
  const selectedStops = new Set(landingConfig.stopIds);
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
    for (let index = 0; index < times.length - 1; index += 1) {
      const current = times[index];
      if (!selectedStops.has(current.stop_id) || current.pickup_type === "1") continue;
      const departureTime = current.departure_time || current.arrival_time;
      if (!departureTime) continue;
      const finalStop = stopsById.get(times.at(-1).stop_id);
      const destination = destinationInfo(current, trip, finalStop, trip.route_id);
      departures.push({
        tripId, routeId: trip.route_id, serviceId: trip.service_id, directionId: trip.direction_id,
        stopId: current.stop_id, departureTime, seconds: timeToSeconds(departureTime),
        destination: destination.destination, variant: destination.variant,
        nextStop: stopsById.get(times[index + 1].stop_id)?.stop_name || null,
        mode: route.route_type === "3" ? "bus" : "ferry"
      });
    }
  }
  departures.sort((a, b) => a.seconds - b.seconds || a.routeId.localeCompare(b.routeId));
  const usedRouteIds = new Set(departures.map((item) => item.routeId));
  const routeData = Object.fromEntries(routes.filter((item) => usedRouteIds.has(item.route_id)).map((item) => [item.route_id, {
    id: item.route_id, shortName: item.route_short_name || item.route_id, name: item.route_long_name,
    color: color(item.route_color, "#004E72"), textColor: color(item.route_text_color, "#FFFFFF"), mode: item.route_type === "3" ? "bus" : "ferry"
  }]));
  const stopDetails = landingConfig.stopIds.map((id) => stopsById.get(id));
  const feed = parseCsv(feedRaw)[0] || {}, agency = parseCsv(agencyRaw)[0] || {};
  return {
    meta: {
      schemaVersion: 3, generatedAt: new Date().toISOString(), landingNumber, slideSeconds, departureWindowMinutes,
      landing: { name: landingConfig.name, displayName: landingConfig.displayName || landingConfig.name, stopIds: landingConfig.stopIds,
        latitude: Number(stopDetails[0].stop_lat), longitude: Number(stopDetails[0].stop_lon) },
      timezone: agency.agency_timezone || "America/New_York", feedVersion: feed.feed_version,
      feedStartDate: isoDate(feed.feed_start_date), feedEndDate: isoDate(feed.feed_end_date),
      sourceHash: createHash("sha256").update(routesRaw + tripsRaw + timesRaw).digest("hex").slice(0, 16)
    },
    calendars: parseCsv(calendarRaw).map((item) => ({ serviceId: item.service_id, weekdays: [item.sunday,item.monday,item.tuesday,item.wednesday,item.thursday,item.friday,item.saturday].map((v) => v === "1"), startDate: isoDate(item.start_date), endDate: isoDate(item.end_date) })),
    exceptions: parseCsv(datesRaw).map((item) => ({ serviceId: item.service_id, date: isoDate(item.date), added: item.exception_type === "1" })),
    routes: routeData, departures
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
