// Regenerates gtfs/gi/ from the Trust for Governors Island's published Brooklyn ferry timetable.
//
// The Trust runs its own boats to Governors Island from Red Hook and Brooklyn Bridge Park, separate
// from the NYC Ferry South Brooklyn route that also calls at the island. It publishes no GTFS at
// all — the only source is the schedule table on SOURCE_URL — so the timetable below is transcribed
// by hand from that page.
//
// Run with: node scripts/build-gi-gtfs.js
//
// !! This is a TRANSCRIPTION, not a download. Nothing can diff it against the operator for you.
// !! The service is seasonal and the operator states the season explicitly, so unlike the IKEA feed
// !! this one hard-codes SEASON_START/SEASON_END rather than rolling forward. When the season ends
// !! the feed lapses and the rows stop appearing, which is the intended failure: re-read SOURCE_URL
// !! and update the dates and times rather than extending the calendar.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, "gtfs/gi");

export const SOURCE_URL = "https://www.govisland.org/visit/ferry";
export const SOURCE_CHECKED_ON = "2026-08-12";

const AGENCY_ID = "TGI";
const AGENCY_NAME = "The Trust for Governors Island";
const SERVICE_ID = "gi-weekend";

// "Saturdays, Sundays, and holidays from May 23-November 1, 2026", quoted from the schedule page.
// Both endpoints corroborate the weekend-only reading: May 23 2026 is a Saturday and November 1 is
// a Sunday.
export const SEASON_START = "20260523";
export const SEASON_END = "20261101";

// The page says "and holidays" without naming them, so these are the federal holidays observed in
// New York City that fall on a weekday inside the season — the only ones that change anything, since
// a holiday landing on a weekend already runs. July 4 2026 is a Saturday and so is not listed.
//
// !! Unverified against the operator: the season dates and times above are quoted, this list is
// !! inferred. Confirm before relying on it for a specific holiday.
export const HOLIDAYS = [
  "20260525", // Memorial Day, Monday
  "20260619", // Juneteenth, Friday
  "20260907", // Labor Day, Monday
  "20261012"  // Indigenous Peoples' Day / Columbus Day, Monday
];

// Ids are local to this feed — build-data.js namespaces every one with the "gi:" prefix, so they
// cannot collide with the NYC Ferry feed's own ids for the same three piers. Coordinates are NYC
// Ferry's published positions for the same landings; nothing on the board reads them, because
// partner stop coordinates are not used for display or for the nearest-landing search.
const STOPS = [
  { stop_id: "redhook", stop_name: "Red Hook / Atlantic Basin", stop_lat: "40.680957", stop_lon: "-74.013358" },
  { stop_id: "pier6", stop_name: "Brooklyn Bridge Park / Pier 6", stop_lat: "40.692315", stop_lon: "-74.002073" },
  { stop_id: "govisland", stop_name: "Governors Island", stop_lat: "40.686640", stop_lon: "-74.016482" }
];

// Every departure time on the page, transcribed. The operator publishes departures only — there is
// no arrival column anywhere — so the arrival at the far end is derived, see CROSSING_MINUTES.
//
// The 9:45 and 10:45 from Red Hook and the 10:15 from Pier 6 are marked FREE on the page. That is
// fare information and the board has no fare concept, so it is recorded here and not modelled.
const RED_HOOK = {
  routeId: "GI-RH",
  shortName: "RH",
  longName: "Governors Island - Red Hook",
  shoreStop: "redhook",
  shoreName: "Red Hook / Atlantic Basin",
  fromShore: ["09:45", "10:45", "11:45", "12:45", "13:45", "14:45", "15:45"],
  fromIsland: ["10:30", "11:30", "12:30", "13:30", "14:30", "15:30", "16:30", "17:30"]
};
const PIER_6 = {
  routeId: "GI-BBP",
  shortName: "BBP",
  longName: "Governors Island - Brooklyn Bridge Park",
  shoreStop: "pier6",
  shoreName: "Brooklyn Bridge Park / Pier 6",
  fromShore: ["10:15", "11:15", "12:15", "13:15", "14:15", "15:15", "16:15"],
  fromIsland: ["11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]
};
const LINES = [RED_HOOK, PIER_6];

// Derived, not published. Each line runs a single boat on a strict hourly cycle, which bounds the
// crossing: Red Hook departs at :45 and the island at :30, so the 10:30 off the island has to be
// back alongside before the 10:45 leaves — about eight minutes' running and a short turn. Pier 6
// departs at :15 against the island's :00, giving the same shape with roughly ten minutes. Both
// agree with the distances involved, which are under a mile and a half.
//
// Nothing on the board depends on these being exact: a trip's final stop is an arrival, and an
// arrival is never shown as a departure. They exist so the trips are well-formed GTFS.
const CROSSING_MINUTES = { redhook: 8, pier6: 10 };

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function toCsv(header, rows) {
  return [header.join(","), ...rows.map((row) => header.map((key) => csvValue(row[key])).join(","))].join("\n").concat("\n");
}
function hhmmss(value) {
  return `${value}:00`;
}
function addMinutes(value, minutes) {
  const [hours, mins] = value.split(":").map(Number);
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function buildTimetable() {
  const tripRows = [], stopTimeRows = [];
  const push = (tripId, routeId, headsign, directionId, stops) => {
    tripRows.push({ route_id: routeId, service_id: SERVICE_ID, trip_id: tripId, trip_headsign: headsign, direction_id: directionId });
    stops.forEach(([stopId, time], index) => {
      stopTimeRows.push({ trip_id: tripId, arrival_time: hhmmss(time), departure_time: hhmmss(time), stop_id: stopId, stop_sequence: String(index + 1) });
    });
  };

  for (const line of LINES) {
    const crossing = CROSSING_MINUTES[line.shoreStop];
    line.fromShore.forEach((time, index) => {
      push(`${line.routeId}-to-${String(index + 1).padStart(2, "0")}`, line.routeId, "Governors Island", "0",
        [[line.shoreStop, time], ["govisland", addMinutes(time, crossing)]]);
    });
    line.fromIsland.forEach((time, index) => {
      push(`${line.routeId}-from-${String(index + 1).padStart(2, "0")}`, line.routeId, line.shoreName, "1",
        [["govisland", time], [line.shoreStop, addMinutes(time, crossing)]]);
    });
  }
  return { tripRows, stopTimeRows };
}

async function main() {
  const { tripRows, stopTimeRows } = buildTimetable();
  const files = {
    "agency.txt": toCsv(["agency_id", "agency_name", "agency_url", "agency_lang", "agency_timezone"],
      [{ agency_id: AGENCY_ID, agency_name: AGENCY_NAME, agency_url: SOURCE_URL, agency_lang: "en", agency_timezone: "America/New_York" }]),
    // The badge shows the Trust's wordmark rather than either short name, so route_color only
    // reaches the badge border. It is the cyan sampled out of assets/gi.png.
    "routes.txt": toCsv(["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"],
      LINES.map((line) => ({ route_id: line.routeId, agency_id: AGENCY_ID, route_short_name: line.shortName, route_long_name: line.longName, route_type: "4", route_color: "00BBE3", route_text_color: "FFFFFF" }))),
    "stops.txt": toCsv(["stop_id", "stop_name", "stop_lat", "stop_lon"], STOPS),
    "calendar.txt": toCsv(["service_id", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "start_date", "end_date"],
      [{ service_id: SERVICE_ID, sunday: "1", monday: "0", tuesday: "0", wednesday: "0", thursday: "0", friday: "0", saturday: "1", start_date: SEASON_START, end_date: SEASON_END }]),
    // The weekday holidays that run the weekend timetable anyway.
    "calendar_dates.txt": toCsv(["service_id", "date", "exception_type"],
      HOLIDAYS.map((date) => ({ service_id: SERVICE_ID, date, exception_type: "1" }))),
    "trips.txt": toCsv(["route_id", "service_id", "trip_id", "trip_headsign", "direction_id"], tripRows),
    "stop_times.txt": toCsv(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], stopTimeRows),
    "feed_info.txt": toCsv(["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date", "feed_version"],
      [{ feed_publisher_name: AGENCY_NAME, feed_publisher_url: SOURCE_URL, feed_lang: "en", feed_start_date: SEASON_START, feed_end_date: SEASON_END, feed_version: `transcribed-${SOURCE_CHECKED_ON}` }])
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const [name, contents] of Object.entries(files)) await writeFile(path.join(OUTPUT_DIR, name), contents, "utf8");
  console.log(`Wrote gtfs/gi/ from ${SOURCE_URL} as checked on ${SOURCE_CHECKED_ON}.`);
  for (const line of LINES) {
    console.log(`  ${line.routeId}: ${line.fromShore.length} from ${line.shoreName}, ${line.fromIsland.length} from Governors Island`);
  }
  console.log(`  season ${SEASON_START}-${SEASON_END}, weekends plus ${HOLIDAYS.length} weekday holidays`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
