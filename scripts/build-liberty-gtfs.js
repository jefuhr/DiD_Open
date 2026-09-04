// Regenerates gtfs/liberty/ from Liberty Landing Ferry's published timetable.
//
// The operator's machine-readable feed is abandoned. The only GTFS ever published
// (transit.land f-libertylandingferry~ny~us, via Trillium) was last modified 30 Aug 2019 and its
// calendar lapsed on 2020-08-01, while the ferry itself kept running: it rebranded to "Liberty
// Landing City Ferry" under Statue City Cruises/Hornblower and moved to libertylandingcityferry.com,
// leaving the old domain in that feed's agency.txt dead.
//
// The service also changed. The 2019 feed is half-hourly and runs to 20:45; the timetable published
// today is hourly and ends at 19:45. Reusing the old feed with its dates rolled forward would put
// 16 sailings a weekday on the board that do not exist. So the timetable below is transcribed from
// the operator's published tables instead, and the stale feed is not reused.
//
// Run with: node scripts/build-liberty-gtfs.js
//
// !! This is a TRANSCRIPTION, not a download. There is no machine-readable source to diff against,
// !! so re-check it against SOURCE_URL when SOURCE_CHECKED_ON gets old. FEED_VALID_DAYS
// !! deliberately bounds the generated calendar so the feed expires loudly (build-data.js warns on
// !! a lapsed partner feed) rather than drifting silently out of date on a live board.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { gtfsDate, toCsv, writeGtfsFiles } from "./gtfs-utils.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, "gtfs/liberty");

export const SOURCE_URL = "https://www.libertylandingcityferry.com/";
export const SOURCE_CHECKED_ON = "2026-08-10";
const FEED_VALID_DAYS = 180;

const AGENCY_ID = "1518";
const AGENCY_NAME = "Liberty Landing Ferry";
const ROUTE_ID = "14172";

// Stop ids are carried over from the Trillium feed unchanged: they are what config/landings.json
// maps and what any previously built data refers to. Only 2557122's name is updated — the terminal
// was renamed from World Financial Center to Brookfield Place.
const STOPS = [
  { stop_id: "2557120", stop_name: "Liberty Landing Marina", stop_lat: "40.7096234807607", stop_lon: "-74.0399462444888" },
  { stop_id: "2557121", stop_name: "Warren Street", stop_lat: "40.7110053602919", stop_lon: "-74.0402257743207" },
  { stop_id: "2557122", stop_name: "Brookfield Place Terminal", stop_lat: "40.7149327808189", stop_lon: "-74.0173839686534" }
];

// Every row of the published tables is one round trip, listed by the four times the operator
// prints: "Departs Liberty Landing", "Departs Warren Street", "Departs Brookfield Place",
// "Departs Warren Street". Sailings are hourly, so a row is identified by the hour it leaves
// Liberty Landing at :30 — the rest of the row follows from LEG_MINUTES below.
const SERVICES = [
  { id: "liberty-weekday", days: ["monday", "tuesday", "wednesday", "thursday", "friday"], firstHour: 6, lastHour: 19 },
  { id: "liberty-weekend", days: ["saturday", "sunday"], firstHour: 9, lastHour: 19 }
];
const OUTBOUND_DEPARTURE_MINUTE = 30;

// Running times, carried from the 2019 Trillium feed. They are not guesswork: applied to the
// current tables they reproduce every published time exactly — 6:30 +2 = 6:32, +13 = 6:45 (the
// printed Brookfield departure), +10 = 6:55 (the printed Warren Street departure). The route and
// the boat are unchanged; only frequency and span moved. The two arrivals the operator does not
// print (into Brookfield, and back into Liberty Landing) are the only derived values here.
const LEG_MINUTES = {
  outbound: [{ from: "2557120", to: "2557121", minutes: 2 }, { from: "2557121", to: "2557122", minutes: 13 }],
  inbound: [{ from: "2557122", to: "2557121", minutes: 10 }, { from: "2557121", to: "2557120", minutes: 5 }]
};

function hhmmss(totalMinutes) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}:00`;
}

// One leg chain -> the stop_times rows for a single trip. The operator publishes departure times
// only, so each intermediate stop's arrival and departure are the same minute; the final stop is
// an arrival.
function tripStopTimes(tripId, startMinutes, legs) {
  const rows = [{ trip_id: tripId, arrival_time: hhmmss(startMinutes), departure_time: hhmmss(startMinutes), stop_id: legs[0].from, stop_sequence: "1" }];
  let clock = startMinutes;
  for (const [index, leg] of legs.entries()) {
    clock += leg.minutes;
    rows.push({ trip_id: tripId, arrival_time: hhmmss(clock), departure_time: hhmmss(clock), stop_id: leg.to, stop_sequence: String(index + 2) });
  }
  return rows;
}

export function buildTimetable() {
  const calendarRows = [], tripRows = [], stopTimeRows = [];
  const dayColumns = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const today = new Date();
  const startDate = gtfsDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));
  const endDate = gtfsDate(new Date(today.getTime() + FEED_VALID_DAYS * 86400000));

  for (const service of SERVICES) {
    calendarRows.push({
      service_id: service.id,
      ...Object.fromEntries(dayColumns.map((day) => [day, service.days.includes(day) ? "1" : "0"])),
      start_date: startDate, end_date: endDate
    });
    for (let hour = service.firstHour; hour <= service.lastHour; hour += 1) {
      const outboundStart = hour * 60 + OUTBOUND_DEPARTURE_MINUTE;
      // The inbound sailing leaves Brookfield the moment the outbound one arrives.
      const inboundStart = outboundStart + LEG_MINUTES.outbound.reduce((sum, leg) => sum + leg.minutes, 0);
      for (const [direction, legs, start, headsign] of [
        ["1", LEG_MINUTES.outbound, outboundStart, "Brookfield Place"],
        ["0", LEG_MINUTES.inbound, inboundStart, "Liberty Landing"]
      ]) {
        const tripId = `liberty-${service.id.replace("liberty-", "")}-${direction}-${String(hour).padStart(2, "0")}`;
        tripRows.push({ route_id: ROUTE_ID, service_id: service.id, trip_id: tripId, trip_headsign: headsign, direction_id: direction });
        stopTimeRows.push(...tripStopTimes(tripId, start, legs));
      }
    }
  }
  return { calendarRows, tripRows, stopTimeRows, startDate, endDate, dayColumns };
}

async function main() {
  const { calendarRows, tripRows, stopTimeRows, startDate, endDate, dayColumns } = buildTimetable();
  const files = {
    "agency.txt": toCsv(["agency_id", "agency_name", "agency_url", "agency_lang", "agency_timezone"],
      [{ agency_id: AGENCY_ID, agency_name: AGENCY_NAME, agency_url: SOURCE_URL, agency_lang: "en", agency_timezone: "America/New_York" }]),
    "routes.txt": toCsv(["route_id", "agency_id", "route_short_name", "route_long_name", "route_type", "route_color", "route_text_color"],
      [{ route_id: ROUTE_ID, agency_id: AGENCY_ID, route_short_name: "", route_long_name: "Liberty Landing Ferry", route_type: "4", route_color: "F7D87D", route_text_color: "4F61D9" }]),
    "stops.txt": toCsv(["stop_id", "stop_name", "stop_lat", "stop_lon"], STOPS),
    "calendar.txt": toCsv(["service_id", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "start_date", "end_date"],
      calendarRows.map((row) => ({ ...row }))),
    // The operator says "weekdays except major holidays" but publishes no list of which, so no
    // exceptions are invented here. A holiday shows a sailing that does not run; see README.
    "calendar_dates.txt": toCsv(["service_id", "date", "exception_type"], []),
    "trips.txt": toCsv(["route_id", "service_id", "trip_id", "trip_headsign", "direction_id"], tripRows),
    "stop_times.txt": toCsv(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"], stopTimeRows),
    "feed_info.txt": toCsv(["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date", "feed_version"],
      [{ feed_publisher_name: AGENCY_NAME, feed_publisher_url: SOURCE_URL, feed_lang: "en", feed_start_date: startDate, feed_end_date: endDate, feed_version: `transcribed-${SOURCE_CHECKED_ON}` }])
  };

  await writeGtfsFiles(OUTPUT_DIR, files);
  const perDay = Object.fromEntries(SERVICES.map((s) => [s.id, tripRows.filter((t) => t.service_id === s.id).length]));
  console.log(`Wrote gtfs/liberty/ from ${SOURCE_URL} as checked on ${SOURCE_CHECKED_ON}.`);
  console.log(`  trips: ${JSON.stringify(perDay)}  valid ${startDate}-${endDate}`);
  void dayColumns;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
