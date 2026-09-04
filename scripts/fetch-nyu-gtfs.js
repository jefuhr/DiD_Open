// Regenerates gtfs/nyu/ from NYU's Passio GO system.
//
// Unlike NY Waterway and Seastreak, NYU publishes no GTFS: its ferry lives only behind the
// Passio GO app backend (https://nyu.passiogo.com). Passio's own google_transit.zip export is
// access-denied, so this script reconstructs an equivalent static feed from two JSON endpoints
// and writes it into gtfs/nyu/ for scripts/build-data.js to read like any other partner feed.
// The generated files are committed, so a build never touches the network.
//
// Run with: node scripts/fetch-nyu-gtfs.js
//
// Endpoints (no authentication; deviceId is an arbitrary client-chosen number):
//   POST mapGetData.php?getStops=2   -> stop names, coordinates, route colors
//   GET  mapGetData.php?schedule=4   -> a single service day's departure timepoints for one stop
//
// The schedule endpoint reports one day at a time, and the "timelineDatetime" parameter its own
// web app uses for schedule browsing makes it answer for any date. Probing a full week is what
// tells us which weekdays actually run, so service days are observed rather than assumed.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { gtfsDate, toCsv, writeGtfsFiles } from "./gtfs-utils.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, "gtfs/nyu");
const HOST = "https://passio3.com/www";
const DEVICE_ID = "99999999";
const SYSTEM_ID = "1007";
const ROUTE_ID = "45769";
const AGENCY_NAME = "New York University";
const AGENCY_URL = "https://nyu.passiogo.com";
const TIMEZONE = "America/New_York";

// Passio's stop names are crew shorthand ("E River Term") that means nothing to a rider reading a
// departure board, so each is renamed to the landing a passenger would recognize. The Passio stop
// ids are kept verbatim — they are what config/landings.json maps and what the realtime ETA
// endpoint keys on — so only the display text changes.
const STOP_NAMES = {
  "13138": "East 34th Street",
  "13139": "Brooklyn Army Terminal"
};

// The feed is regenerated rather than long-lived, so the service window is deliberately short;
// build-data.js reads calendar.txt start/end dates to decide whether a service is in effect.
const SERVICE_WEEKS = 26;

// "6:00 AM" / "12:30 PM" -> "06:00:00" / "12:30:00"
export function toGtfsTime(label) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(label).trim());
  if (!match) throw new Error(`Unrecognized Passio timepoint: ${label}`);
  let hours = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hours += 12;
  return `${String(hours).padStart(2, "0")}:${match[2]}:00`;
}

function secondsOf(time) {
  const [hours, minutes, seconds] = time.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

function addSeconds(time, offset) {
  const total = secondsOf(time) + offset;
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

async function passioPost(query, body) {
  const response = await fetch(`${HOST}/mapGetData.php?${query}&deviceId=${DEVICE_ID}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${query} returned ${response.status}.`);
  return response.json();
}

// Departure timepoints for one stop on one date. Passio splits them into "past" and "next"
// relative to the queried moment, so both halves are needed for a whole service day. An empty
// or non-object "routes" payload is how it reports a day with no service at all.
async function fetchStopDay(stopId, isoDate) {
  const query = new URLSearchParams({
    schedule: "4", deviceId: DEVICE_ID, routeId: ROUTE_ID, stopId,
    timelineIsActive: "1", timelineDatetime: `${isoDate} 12:00`
  });
  const response = await fetch(`${HOST}/mapGetData.php?${query}`);
  if (!response.ok) throw new Error(`schedule for stop ${stopId} on ${isoDate} returned ${response.status}.`);
  const payload = await response.json();
  const route = typeof payload.routes === "object" && !Array.isArray(payload.routes) ? payload.routes["0"] : null;
  if (!route) return [];
  const times = [];
  for (const routeStop of route.routeStops || []) {
    // A "flagStop" entry repeats a terminal at a later position in the loop and carries no
    // timepoints of its own; counting it would double every departure.
    if (routeStop.stopId !== stopId || routeStop.flagStop === "1") continue;
    times.push(...(routeStop.timepoints?.past || []), ...(routeStop.timepoints?.next || []));
  }
  return [...new Set(times.map(toGtfsTime))].sort();
}

// Passio publishes departure timepoints only — never an arrival at the far shore. The crossing is
// recovered from the timetable itself: each departure is met by the opposite terminal's next
// departure (the boat turns straight around), so the gap between them is the crossing time. The
// median keeps one odd late-evening pairing from skewing the whole feed.
function crossingSeconds(departuresByStop, stopIds) {
  const gaps = [];
  for (const stopId of stopIds) {
    const opposite = departuresByStop[stopIds.find((id) => id !== stopId)] || [];
    for (const departure of departuresByStop[stopId] || []) {
      const next = opposite.find((time) => secondsOf(time) > secondsOf(departure));
      if (next) gaps.push(secondsOf(next) - secondsOf(departure));
    }
  }
  if (!gaps.length) throw new Error("Could not derive a crossing time from the NYU timetable.");
  gaps.sort((left, right) => left - right);
  return gaps[Math.floor(gaps.length / 2)];
}

async function main() {
  const stopsPayload = await passioPost("getStops=2&withOutdated=1&wBounds=1", { s0: SYSTEM_ID, sA: 1 });
  const routeStops = Object.values(stopsPayload.stops || {}).filter((stop) => stop.routeId === ROUTE_ID);
  if (!routeStops.length) throw new Error(`Passio system ${SYSTEM_ID} returned no stops for route ${ROUTE_ID}.`);
  const stopIds = [...new Set(routeStops.map((stop) => stop.stopId))].sort();
  const routeColor = (stopsPayload.routes?.[ROUTE_ID]?.[1] || "#e6550d").replace("#", "").toUpperCase();

  // Probe one full week starting from a Monday so every weekday is sampled exactly once.
  const probeStart = new Date(Date.UTC(2026, 7, 10));
  const byWeekday = new Map();
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(probeStart.getTime() + offset * 86400000);
    const isoDate = date.toISOString().slice(0, 10);
    const departuresByStop = {};
    for (const stopId of stopIds) departuresByStop[stopId] = await fetchStopDay(stopId, isoDate);
    byWeekday.set(date.getUTCDay(), departuresByStop);
    const total = Object.values(departuresByStop).reduce((sum, list) => sum + list.length, 0);
    console.log(`  ${isoDate} ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][date.getUTCDay()]}: ${total} departures`);
  }

  // Days that publish an identical timetable share one GTFS service id.
  const services = new Map();
  for (const [weekday, departuresByStop] of byWeekday) {
    const signature = JSON.stringify(departuresByStop);
    if (signature === JSON.stringify(Object.fromEntries(stopIds.map((id) => [id, []])))) continue;
    if (!services.has(signature)) services.set(signature, { weekdays: new Set(), departuresByStop });
    services.get(signature).weekdays.add(weekday);
  }
  if (!services.size) throw new Error("NYU published no departures for any day of the probed week.");

  const today = new Date();
  const startDate = gtfsDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));
  const endDate = gtfsDate(new Date(today.getTime() + SERVICE_WEEKS * 7 * 86400000));
  const dayColumns = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  const calendarRows = [], tripRows = [], stopTimeRows = [];
  let serviceIndex = 0;
  for (const { weekdays, departuresByStop } of services.values()) {
    serviceIndex += 1;
    const serviceId = `nyu-service-${serviceIndex}`;
    calendarRows.push({
      service_id: serviceId,
      ...Object.fromEntries(dayColumns.map((name, index) => [name, weekdays.has(index) ? "1" : "0"])),
      start_date: startDate, end_date: endDate
    });
    const crossing = crossingSeconds(departuresByStop, stopIds);
    for (const originId of stopIds) {
      const destinationId = stopIds.find((id) => id !== originId);
      for (const departure of departuresByStop[originId] || []) {
        const tripId = `nyu-${serviceIndex}-${originId}-${departure.replace(/:/g, "").slice(0, 4)}`;
        tripRows.push({
          route_id: ROUTE_ID, service_id: serviceId, trip_id: tripId,
          trip_headsign: STOP_NAMES[destinationId] || destinationId,
          direction_id: stopIds.indexOf(originId) === 0 ? "0" : "1"
        });
        stopTimeRows.push(
          { trip_id: tripId, arrival_time: departure, departure_time: departure, stop_id: originId, stop_sequence: "1" },
          { trip_id: tripId, arrival_time: addSeconds(departure, crossing), departure_time: addSeconds(departure, crossing), stop_id: destinationId, stop_sequence: "2" }
        );
      }
    }
    console.log(`  ${serviceId}: days [${[...weekdays].sort().map((day) => dayColumns[day].slice(0, 3)).join(" ")}], crossing ${crossing / 60} min`);
  }

  const uniqueStops = new Map(routeStops.map((stop) => [stop.stopId, stop]));
  const files = {
    "agency.txt": toCsv(["agency_id", "agency_name", "agency_url", "agency_timezone"],
      [{ agency_id: "NYU", agency_name: AGENCY_NAME, agency_url: AGENCY_URL, agency_timezone: TIMEZONE }]),
    "routes.txt": toCsv(["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"],
      [{ route_id: ROUTE_ID, agency_id: "NYU", route_short_name: "", route_long_name: "NYU Langone Ferry", route_type: "4", route_color: routeColor, route_text_color: "FFFFFF" }]),
    "stops.txt": toCsv(["stop_id", "stop_name", "stop_lat", "stop_lon"],
      stopIds.map((stopId) => ({
        stop_id: stopId, stop_name: STOP_NAMES[stopId] || uniqueStops.get(stopId).name,
        stop_lat: uniqueStops.get(stopId).latitude, stop_lon: uniqueStops.get(stopId).longitude
      }))),
    "calendar.txt": toCsv(["service_id", ...dayColumns, "start_date", "end_date"], calendarRows),
    "calendar_dates.txt": toCsv(["service_id", "date", "exception_type"], []),
    "trips.txt": toCsv(["route_id", "service_id", "trip_id", "trip_headsign", "direction_id"], tripRows),
    "stop_times.txt": toCsv(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], stopTimeRows),
    "feed_info.txt": toCsv(["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date", "feed_version"],
      [{ feed_publisher_name: AGENCY_NAME, feed_publisher_url: AGENCY_URL, feed_lang: "en", feed_start_date: startDate, feed_end_date: endDate, feed_version: `passio-${ROUTE_ID}-${startDate}` }])
  };

  await writeGtfsFiles(OUTPUT_DIR, files);
  console.log(`Wrote ${Object.keys(files).length} files to gtfs/nyu/ (${tripRows.length} trips).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
