// Regenerates gtfs/gi/ from the Trust for Governors Island's published ferry timetables.
//
// The Trust runs its own boats to Governors Island — seasonal weekend boats from Red Hook and
// Brooklyn Bridge Park to Yankee Pier, and the year-round Manhattan boat from the Battery Maritime
// Building to Soissons Landing — separate from the NYC Ferry South Brooklyn route that also calls
// at the island. It publishes no GTFS at all: the only source is the schedule tables on SOURCE_URL,
// so every time below is transcribed by hand from that page.
//
// Run with: node scripts/build-gi-gtfs.js
//
// !! This is a TRANSCRIPTION, not a download. Nothing can diff it against the operator for you.
// !! The Brooklyn service is seasonal and the operator states the season explicitly, so unlike the IKEA feed
// !! this one hard-codes SEASON_START/SEASON_END rather than rolling forward. When the season ends
// !! the feed lapses and the rows stop appearing, which is the intended failure: re-read SOURCE_URL
// !! and update the dates and times rather than extending the calendar.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { addMinutes, toCsv, writeGtfsFiles } from "./gtfs-utils.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, "gtfs/gi");

// The Trust moved its site from govisland.org to govisland.com; the old host no longer answers at
// all, so anyone re-checking this transcription against the address that used to be here would get
// a connection reset rather than a page.
export const SOURCE_URL = "https://www.govisland.com/plan-your-visit/ferry";
export const SOURCE_CHECKED_ON = "2026-08-15";

const AGENCY_ID = "TGI";
const AGENCY_NAME = "The Trust for Governors Island";
const SERVICE_ID = "gi-weekend";

// The Manhattan line runs on its own calendars, which is why it does not reuse SERVICE_ID above.
// The Brooklyn boats are seasonal weekends; this one runs every day of the year, on a weekday
// timetable and a weekend timetable, each with a late pair that runs on one weeknight only.
const MANHATTAN_SERVICES = {
  weekday: "gi-mh-weekday",
  friday: "gi-mh-friday",
  weekend: "gi-mh-weekend",
  saturday: "gi-mh-saturday"
};

// The operator states no season for the Manhattan line — it is the year-round service to the
// island, unlike the Brooklyn boats — so there is no published end date to quote. The window below
// is a bound this feed chooses, not a fact from SOURCE_URL: it exists because GTFS calendars
// require one and because a timetable nobody has re-read in two years should stop rather than keep
// asserting itself. Re-read SOURCE_URL and move it forward.
export const MANHATTAN_START = "20260101";
export const MANHATTAN_END = "20271231";

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
//
// The island has two piers and they are not interchangeable. The Brooklyn boats and NYC Ferry's
// South Brooklyn route use Yankee Pier on the east side; the Manhattan boat uses Soissons Landing
// on the north, facing the Battery Maritime Building it came from. A rider told "Governors Island"
// with no pier named can be a fifteen-minute walk from their boat, so the stop names carry the
// pier and the board's two island landings are configured one per pier.
const STOPS = [
  { stop_id: "redhook", stop_name: "Red Hook / Atlantic Basin", stop_lat: "40.680957", stop_lon: "-74.013358" },
  { stop_id: "pier6", stop_name: "Brooklyn Bridge Park / Pier 6", stop_lat: "40.692315", stop_lon: "-74.002073" },
  { stop_id: "govisland", stop_name: "Governors Island / Yankee Pier", stop_lat: "40.686640", stop_lon: "-74.016482" },
  { stop_id: "soissons", stop_name: "Governors Island / Soissons Landing", stop_lat: "40.689300", stop_lon: "-74.016900" },
  // The Manhattan end. Coordinates are Seastreak's published position for the same building, which
  // also berths there — see gtfs/seastreak/stops.txt stop 170.
  { stop_id: "bmb", stop_name: "Battery Maritime Building / Slip 7", stop_lat: "40.700894", stop_lon: "-74.011612" }
];

// Every departure time on the page, transcribed. The operator publishes departures only — there is
// no arrival column anywhere — so the arrival at the far end is derived, see CROSSING_MINUTES.
//
// The 9:45 and 10:45 from Red Hook and the 10:15 from Pier 6 are marked FREE on the page. That is
// fare information and the board has no fare concept, so it is recorded here and not modelled.
//
// noPickupFromShore is the end of each line's day: the boat leaves the shore on the same hourly
// beat, but carries nobody outbound because it is going over to collect the last visitors rather
// than to deliver any. Modelled as pickup_type 1 at the shore, which is exactly what it is, and
// shown on the board as an out-of-service departure — crew need to know the boat leaves, and a
// passenger needs to know they cannot be on it.
//
// !! NOT from SOURCE_URL. Unlike every other time in this file, these four are not published
// !! anywhere: they were reported by staff who work the service. Nothing can check them for you,
// !! not even a careful re-read of the operator's page, so leave this note where it is.
const RED_HOOK = {
  routeId: "GI-RH",
  shortName: "RH",
  longName: "Governors Island - Red Hook",
  shoreStop: "redhook",
  shoreName: "Red Hook / Atlantic Basin",
  fromShore: ["09:45", "10:45", "11:45", "12:45", "13:45", "14:45", "15:45"],
  noPickupFromShore: ["16:45", "17:45"],
  fromIsland: ["10:30", "11:30", "12:30", "13:30", "14:30", "15:30", "16:30", "17:30"]
};
const PIER_6 = {
  routeId: "GI-BBP",
  shortName: "BBP",
  longName: "Governors Island - Brooklyn Bridge Park",
  shoreStop: "pier6",
  shoreName: "Brooklyn Bridge Park / Pier 6",
  fromShore: ["10:15", "11:15", "12:15", "13:15", "14:15", "15:15", "16:15"],
  noPickupFromShore: ["17:15", "18:15"],
  fromIsland: ["11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]
};
const LINES = [RED_HOOK, PIER_6];

// The Manhattan line: Battery Maritime Building to Soissons Landing, every day of the year.
//
// Transcribed from the same page as the Brooklyn lines above, from the weekday and weekend
// timetables it publishes. Two things about it are worth stating because they look like mistakes:
//
//   - It is not a clean headway. The weekday boats run every 30 minutes and then step to :15/:45
//     after 15:00; the weekend boats run every 15 minutes through the middle of the day and drop
//     back to 30 in the evening, with a gap at 15:30 outbound. These are transcribed as published,
//     not regularised — a boat the board invents is worse than one it omits.
//   - The last pair on each timetable runs one weeknight only, Friday on the weekday table and
//     Saturday on the weekend one, so each gets its own service id rather than a footnote.
//
// !! The weekend 12:30 and 12:45 off the island are absent from the published list, which runs
// !! 12:15 then 13:00. That reads like a crew break and it is transcribed as published, but it is
// !! the one place where a page-reading error and a real gap look identical. Confirm it.
const MANHATTAN = {
  routeId: "GI-MAN",
  shortName: "MAN",
  longName: "Governors Island - Battery Maritime Building",
  shoreStop: "bmb",
  shoreName: "Battery Maritime Building",
  islandStop: "soissons",
  islandName: "Governors Island / Soissons Landing",
  weekday: {
    service: MANHATTAN_SERVICES.weekday,
    fromShore: ["07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
      "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:15", "15:45", "16:15", "16:45",
      "17:15", "17:45", "18:15", "18:45", "19:15", "19:45", "20:15"],
    fromIsland: ["07:15", "07:45", "08:15", "08:45", "09:15", "09:45", "10:15", "10:45", "11:15", "11:45",
      "12:15", "12:45", "13:15", "13:45", "14:15", "15:00", "15:30", "16:00", "16:30", "17:00",
      "17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00"]
  },
  // "Extended Friday service" on the weekday table.
  friday: {
    service: MANHATTAN_SERVICES.friday,
    fromShore: ["20:45", "21:15"],
    fromIsland: ["22:30", "23:00"]
  },
  weekend: {
    service: MANHATTAN_SERVICES.weekend,
    fromShore: ["07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "10:15", "10:30", "10:45",
      "11:00", "11:15", "11:30", "11:45", "12:00", "12:15", "12:30", "12:45", "13:00", "13:15",
      "13:30", "13:45", "14:00", "14:15", "14:30", "14:45", "15:00", "15:15", "15:45", "16:00",
      "16:15", "16:30", "16:45", "17:00", "17:15", "17:30", "17:45", "18:00", "18:15", "18:45",
      "19:15", "19:45", "20:15"],
    fromIsland: ["07:15", "07:45", "08:15", "08:45", "09:15", "09:45", "10:00", "10:30", "10:45", "11:00",
      "11:15", "11:30", "11:45", "12:00", "12:15", "13:00", "13:15", "13:30", "13:45", "14:00",
      "14:15", "14:30", "14:45", "15:00", "15:15", "15:30", "15:45", "16:00", "16:15", "16:30",
      "16:45", "17:00", "17:15", "17:30", "17:45", "18:00", "18:30", "19:00", "19:30", "20:00",
      "20:30", "21:00", "21:30", "22:00"]
  },
  // "Extended Saturday service" on the weekend table.
  saturday: {
    service: MANHATTAN_SERVICES.saturday,
    fromShore: ["20:45", "21:15"],
    fromIsland: ["22:30", "23:00"]
  }
};

// Derived like CROSSING_MINUTES below, and on the same reasoning: the shore leaves on :00/:30 and
// the island on :15/:45, so a boat has fifteen minutes to cross and turn. The operator describes
// the trip as about seven minutes, which fits inside that, and the pier-to-pier distance is under
// half a mile. Nothing on the board depends on it — see the note on CROSSING_MINUTES.
const MANHATTAN_CROSSING_MINUTES = 7;

// Derived, not published. Each line runs a single boat on a strict hourly cycle, which bounds the
// crossing: Red Hook departs at :45 and the island at :30, so the 10:30 off the island has to be
// back alongside before the 10:45 leaves — about eight minutes' running and a short turn. Pier 6
// departs at :15 against the island's :00, giving the same shape with roughly ten minutes. Both
// agree with the distances involved, which are under a mile and a half.
//
// Nothing on the board depends on these being exact: a trip's final stop is an arrival, and an
// arrival is never shown as a departure. They exist so the trips are well-formed GTFS.
const CROSSING_MINUTES = { redhook: 8, pier6: 10 };

function hhmmss(value) {
  return `${value}:00`;
}

export function buildTimetable() {
  const tripRows = [], stopTimeRows = [];
  // noPickup marks the boarding stop of a trip nobody may board — the first stop, since every trip
  // here is a single crossing. The far end stays open: it is an arrival, and an arrival is where
  // the passengers this boat went to fetch actually get on for the return.
  const push = (tripId, routeId, headsign, directionId, stops, noPickup = false, serviceId = SERVICE_ID) => {
    tripRows.push({ route_id: routeId, service_id: serviceId, trip_id: tripId, trip_headsign: headsign, direction_id: directionId });
    stops.forEach(([stopId, time], index) => {
      stopTimeRows.push({
        trip_id: tripId, arrival_time: hhmmss(time), departure_time: hhmmss(time),
        stop_id: stopId, stop_sequence: String(index + 1),
        pickup_type: noPickup && index === 0 ? "1" : "0", drop_off_type: "0"
      });
    });
  };

  // The island end of the Brooklyn boats names its pier, because the island now has two landings
  // and a row reading only "Governors Island" no longer says which one the boat ties up at.
  const YANKEE_PIER_NAME = "Governors Island / Yankee Pier";
  for (const line of LINES) {
    const crossing = CROSSING_MINUTES[line.shoreStop];
    line.fromShore.forEach((time, index) => {
      push(`${line.routeId}-to-${String(index + 1).padStart(2, "0")}`, line.routeId, YANKEE_PIER_NAME, "0",
        [[line.shoreStop, time], ["govisland", addMinutes(time, crossing)]]);
    });
    (line.noPickupFromShore || []).forEach((time, index) => {
      push(`${line.routeId}-tonp-${String(index + 1).padStart(2, "0")}`, line.routeId, YANKEE_PIER_NAME, "0",
        [[line.shoreStop, time], ["govisland", addMinutes(time, crossing)]], true);
    });
    line.fromIsland.forEach((time, index) => {
      push(`${line.routeId}-from-${String(index + 1).padStart(2, "0")}`, line.routeId, line.shoreName, "1",
        [["govisland", time], [line.shoreStop, addMinutes(time, crossing)]]);
    });
  }

  // The Manhattan line. Same shape as above, but each timetable carries its own service id and the
  // island end is Soissons rather than Yankee Pier. Trip ids name the timetable they came from, so
  // a row on the board can be traced back to the published table it was transcribed out of.
  for (const key of ["weekday", "friday", "weekend", "saturday"]) {
    const table = MANHATTAN[key];
    table.fromShore.forEach((time, index) => {
      push(`${MANHATTAN.routeId}-${key}-to-${String(index + 1).padStart(2, "0")}`, MANHATTAN.routeId, MANHATTAN.islandName, "0",
        [[MANHATTAN.shoreStop, time], [MANHATTAN.islandStop, addMinutes(time, MANHATTAN_CROSSING_MINUTES)]], false, table.service);
    });
    table.fromIsland.forEach((time, index) => {
      push(`${MANHATTAN.routeId}-${key}-from-${String(index + 1).padStart(2, "0")}`, MANHATTAN.routeId, MANHATTAN.shoreName, "1",
        [[MANHATTAN.islandStop, time], [MANHATTAN.shoreStop, addMinutes(time, MANHATTAN_CROSSING_MINUTES)]], false, table.service);
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
      [...LINES, MANHATTAN].map((line) => ({ route_id: line.routeId, agency_id: AGENCY_ID, route_short_name: line.shortName, route_long_name: line.longName, route_type: "4", route_color: "00BBE3", route_text_color: "FFFFFF" }))),
    "stops.txt": toCsv(["stop_id", "stop_name", "stop_lat", "stop_lon"], STOPS),
    "calendar.txt": toCsv(["service_id", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "start_date", "end_date"],
      [
        { service_id: SERVICE_ID, sunday: "1", monday: "0", tuesday: "0", wednesday: "0", thursday: "0", friday: "0", saturday: "1", start_date: SEASON_START, end_date: SEASON_END },
        { service_id: MANHATTAN_SERVICES.weekday, sunday: "0", monday: "1", tuesday: "1", wednesday: "1", thursday: "1", friday: "1", saturday: "0", start_date: MANHATTAN_START, end_date: MANHATTAN_END },
        { service_id: MANHATTAN_SERVICES.friday, sunday: "0", monday: "0", tuesday: "0", wednesday: "0", thursday: "0", friday: "1", saturday: "0", start_date: MANHATTAN_START, end_date: MANHATTAN_END },
        { service_id: MANHATTAN_SERVICES.weekend, sunday: "1", monday: "0", tuesday: "0", wednesday: "0", thursday: "0", friday: "0", saturday: "1", start_date: MANHATTAN_START, end_date: MANHATTAN_END },
        { service_id: MANHATTAN_SERVICES.saturday, sunday: "0", monday: "0", tuesday: "0", wednesday: "0", thursday: "0", friday: "0", saturday: "1", start_date: MANHATTAN_START, end_date: MANHATTAN_END }
      ]),
    // The weekday holidays that run the weekend timetable anyway. Brooklyn only: the page says
    // "Saturdays, Sundays, and holidays" of those boats and says nothing of the sort about the
    // Manhattan line, so a holiday there is left running its ordinary weekday timetable rather
    // than switched to the weekend one on a guess.
    "calendar_dates.txt": toCsv(["service_id", "date", "exception_type"],
      HOLIDAYS.map((date) => ({ service_id: SERVICE_ID, date, exception_type: "1" }))),
    "trips.txt": toCsv(["route_id", "service_id", "trip_id", "trip_headsign", "direction_id"], tripRows),
    "stop_times.txt": toCsv(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type", "drop_off_type"], stopTimeRows),
    "feed_info.txt": toCsv(["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date", "feed_version"],
      // The feed now spans both lines, so it is bounded by the earliest start and the latest end
      // of the calendars inside it rather than by the Brooklyn season alone.
      [{ feed_publisher_name: AGENCY_NAME, feed_publisher_url: SOURCE_URL, feed_lang: "en",
        feed_start_date: [SEASON_START, MANHATTAN_START].sort()[0],
        feed_end_date: [SEASON_END, MANHATTAN_END].sort().at(-1),
        feed_version: `transcribed-${SOURCE_CHECKED_ON}` }])
  };

  await writeGtfsFiles(OUTPUT_DIR, files);
  console.log(`Wrote gtfs/gi/ from ${SOURCE_URL} as checked on ${SOURCE_CHECKED_ON}.`);
  for (const line of LINES) {
    console.log(`  ${line.routeId}: ${line.fromShore.length} from ${line.shoreName} (+${(line.noPickupFromShore || []).length} no-pickup), ${line.fromIsland.length} from Governors Island`);
  }
  console.log(`  season ${SEASON_START}-${SEASON_END}, weekends plus ${HOLIDAYS.length} weekday holidays`);
  for (const key of ["weekday", "friday", "weekend", "saturday"]) {
    const table = MANHATTAN[key];
    console.log(`  ${MANHATTAN.routeId} ${key}: ${table.fromShore.length} from ${MANHATTAN.shoreName}, ${table.fromIsland.length} from Soissons Landing`);
  }
  console.log(`  Manhattan line year-round ${MANHATTAN_START}-${MANHATTAN_END}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
