// Regenerates gtfs/seastreak/ from Seastreak's published timetable PDF: the weekday schedule on
// its first page and the weekend schedule on its second.
//
// Seastreak does publish a GTFS, and gtfs/seastreak/ used to be that download. It was wrong in a
// way that showed: it carried a 2020 feed_start_date, times that no longer matched the printed
// schedule, and — because each sailing appears in both of the operator's printed tables — it
// offered the same boat as two separate boardings at the same pier at the same minute. There were
// eighteen such duplicates at the three Manhattan piers this board actually watches.
//
// So this feed is now a TRANSCRIPTION of SOURCE_URL, like gtfs/gi/, gtfs/ikea/ and gtfs/liberty/.
//
// Run with: node scripts/build-seastreak-gtfs.js
//
// !! This is a TRANSCRIPTION, not a download. Nothing can diff it against the operator for you.
// !! When Seastreak publishes a new PDF, re-read it and update the tables below and the dates.
//
// Reading the source, and why the two tables are not simply concatenated:
//
//   The PDF prints one table of NEW JERSEY DEPARTURES and one of NEW YORK DEPARTURES. Its column
//   groups are headed "Departures" on the boarding side and "Arrivals" on the far side, and that is
//   taken literally here: on a New Jersey departure the Manhattan calls are arrivals (drop-off
//   only), and on a New York departure the New Jersey calls are arrivals.
//
//   That is what stops one boat being advertised as two. Many sailings appear in both tables — the
//   6:20 at Battery Maritime is the same boat in each — and treating both as boardings is what put
//   eighteen duplicate departures on the board.
//
//   It is tempting to justify the rule by saying the NY table prints every Manhattan boarding the
//   NJ table implies. It does not, and an assertion here proved it: the morning Belford boats run
//   Battery Maritime, Brookfield, Paulus Hook and West 39th in sequence with no return working, so
//   they appear in the NJ table only. They are arrival runs distributing along Manhattan, and the
//   timetable never offers a seat from one Manhattan pier to another on them. Modelling those calls
//   as boardings would invent a service Seastreak does not sell.
//
//   Times in red do not run on Fridays. Colour does not survive a text extraction, so the red rows
//   were read out of the PDF's content stream and are carried here as monThuOnly.
//
//   The page also carries a WEEKDAY SHUTTLE BUS table between the three New Jersey terminals. Those
//   are road transfers, not sailings, and are not in this feed. The footnote markers on some
//   arrival times (*, **, ⁰) mark where one of those buses meets the boat.
//
//   The PDF's second page is a WEEKEND SCHEDULE, and it is a different route rather than the
//   weekday one thinned out: Highlands, Sandy Hook Beach, Battery Maritime and East 35th only.
//   Belford, Atlantic Highlands, Brookfield, Paulus Hook and West 39th get no weekend boat at all.
//   It is read by the same Departures/Arrivals rule as the weekday tables, and carries no red: the
//   Friday note is printed on the weekday page only, and the weekend page's content stream has no
//   red fill operator in it.
//
//   Two weekend rows call at the piers in the opposite order to the printed column headings — the
//   last New Jersey departure boards Sandy Hook at 19:15 before Highlands at 19:30, and the last
//   New York departure boards Battery Maritime at 20:15 before East 35th at 20:45. The columns are
//   read by clock rather than by heading order, so those two are transcribed as they sail.
//
// !! Seastreak's Massachusetts routes (New Bedford, Nantucket, Martha's Vineyard) were in the
// !! download this replaces and are not here: no landing on this board is within two hundred
// !! miles of them.

import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toCsv, writeGtfsFiles } from "./gtfs-utils.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, "gtfs/seastreak");

export const SOURCE_URL =
  "https://media.seastreak.com/wp-content/uploads/2026/08/07172537/Schedule-Effective-August-8-2026.pdf";
export const SOURCE_CHECKED_ON = "2026-08-22";

// The file is named "August 8" and the schedule inside it says "Effective August 10, 2026". The
// printed date wins: it is the one the operator put on the timetable itself.
const SERVICE_START = "20260810";
// The weekend page is headed "Effective August 8, 2026" — the Saturday before the weekday one
// starts, and the date the file itself is named for.
const WEEKEND_SERVICE_START = "20260808";
// Seastreak publishes no end date — the PDF says only "SCHEDULE SUBJECT TO CHANGE WITHOUT NOTICE".
// This is deliberately finite so a transcription cannot quietly outlive the timetable it came from,
// and deliberately long enough that it will not lapse before somebody re-reads the source.
const SERVICE_END = "20271231";

const AGENCY_ID = "20226";
const AGENCY_NAME = "Seastreak";
const ROUTE_ID = "211";

// Monday to Friday, and the Monday-to-Thursday subset the PDF prints in red.
const SERVICE_WEEKDAY = "ss-weekday";
const SERVICE_MON_THU = "ss-mon-thu";
// Saturday and Sunday, off the PDF's second page. The weekend timetable prints one set of times
// with no Saturday/Sunday split, so both days get the same service.
const SERVICE_WEEKEND = "ss-weekend";

// Stop ids are Seastreak's own, carried over from the GTFS this feed replaces: config/landings.json
// points at 170, 168 and 8306 by those ids, so changing them would take Seastreak off the board.
const STOPS = {
  belford:    { id: "9819", name: "Belford, NJ", desc: "10 Harbor Way", lat: 40.433209, lon: -74.078817, side: "nj" },
  highlands:  { id: "176",  name: "Highlands, NJ", desc: "326 Shore Drive", lat: 40.409395, lon: -73.996238, side: "nj" },
  atlantic:   { id: "175",  name: "Atlantic Highlands, NJ", desc: "Bottom of First Avenue at the Atlantic Highlands Municipal Marina", lat: 40.419668, lon: -74.034889, side: "nj" },
  // The only stop here that was not already in the feed. Seastreak gives its address as
  // 35 Hartshorne Drive, Sandy Hook — the Fort Hancock landing inside Gateway National Recreation
  // Area. The position below is that landing to within a few hundred metres rather than a surveyed
  // berth, which is the best the operator publishes; nothing on this board reads it, because the
  // nearest-landing search uses config/landings.json and no landing is at Sandy Hook.
  sandyhook:  { id: "sandy-hook-beach", name: "Sandy Hook Beach, NJ", desc: "35 Hartshorne Drive, Sandy Hook", lat: 40.46362, lon: -74.00092, side: "nj" },
  bmb:        { id: "170",  name: "Battery Maritime Building Slip 5", desc: "10 South Street", lat: 40.700894, lon: -74.011612, side: "ny" },
  east35:     { id: "168",  name: "East 35th St., NYC", desc: "East 35th St. and the FDR on the East Side of Manhattan", lat: 40.743873, lon: -73.97069, side: "ny" },
  brookfield: { id: "9825", name: "Brookfield Place, NY", desc: "Battery Park City Vessey Street on the West Side of Manhattan", lat: 40.715161, lon: -74.017695, side: "ny" },
  // Jersey City, but the timetable groups it with the Manhattan piers under "Manhattan, New
  // York/Jersey City", and it is a boarding on the New York departures table like the rest of them.
  paulus:     { id: "9954", name: "Paulus Hook, NJ", desc: "Paulus Hook, NJ", lat: 40.713728, lon: -74.032346, side: "ny" },
  west39:     { id: "8306", name: "West 39th St., NYC", desc: "West 39th St.", lat: 40.760279, lon: -74.003587, side: "ny" }
};

// NEW JERSEY DEPARTURES — New Jersey boardings, Manhattan/Jersey City arrivals.
const NEW_JERSEY_DEPARTURES = [
  { monThuOnly: true , calls: [["belford", "05:40"], ["bmb", "06:20"], ["brookfield", "06:30"], ["paulus", "06:40"]] },
  { monThuOnly: false, calls: [["highlands", "05:50"], ["bmb", "06:30"], ["east35", "06:50"]] },
  { monThuOnly: false, calls: [["belford", "06:15"], ["brookfield", "07:00"], ["bmb", "07:10"]] },
  { monThuOnly: false, calls: [["highlands", "06:40"], ["atlantic", "07:00"], ["bmb", "07:40"], ["east35", "08:00"]] },
  { monThuOnly: true , calls: [["belford", "07:25"], ["bmb", "08:05"], ["brookfield", "08:15"], ["paulus", "08:25"], ["west39", "08:40"]] },
  { monThuOnly: false, calls: [["atlantic", "07:30"], ["bmb", "08:10"], ["east35", "08:30"]] },
  { monThuOnly: false, calls: [["highlands", "08:00"], ["bmb", "08:45"], ["east35", "09:00"]] },
  { monThuOnly: false, calls: [["belford", "08:05"], ["bmb", "08:50"], ["brookfield", "09:00"], ["paulus", "09:10"], ["west39", "09:20"]] },
  { monThuOnly: false, calls: [["atlantic", "09:10"], ["bmb", "09:50"], ["east35", "10:05"]] },
  { monThuOnly: true , calls: [["atlantic", "10:15"], ["bmb", "11:00"], ["east35", "11:15"]] },
  { monThuOnly: false, calls: [["highlands", "12:00"], ["east35", "13:00"], ["bmb", "13:20"]] },
  { monThuOnly: true , calls: [["highlands", "15:00"], ["east35", "15:50"], ["bmb", "16:05"]] },
  { monThuOnly: true , calls: [["belford", "15:45"], ["west39", "16:35"], ["paulus", "16:50"], ["brookfield", "17:00"], ["bmb", "17:15"]] },
  { monThuOnly: false, calls: [["highlands", "15:45"], ["atlantic", "16:00"], ["sandyhook", "16:10"], ["east35", "17:00"], ["bmb", "17:20"]] },
  { monThuOnly: true , calls: [["atlantic", "16:55"], ["highlands", "17:05"], ["east35", "17:55"], ["bmb", "18:10"]] },
  { monThuOnly: false, calls: [["belford", "17:15"], ["west39", "18:05"], ["paulus", "18:15"], ["brookfield", "18:25"], ["bmb", "18:35"]] },
  { monThuOnly: false, calls: [["highlands", "17:25"], ["atlantic", "17:40"], ["east35", "18:25"], ["bmb", "18:40"]] },
  { monThuOnly: true , calls: [["belford", "18:20"], ["paulus", "19:05"], ["brookfield", "19:15"], ["bmb", "19:30"]] },
  { monThuOnly: false, calls: [["atlantic", "18:15"], ["highlands", "18:30"], ["east35", "19:25"], ["bmb", "19:40"]] },
  { monThuOnly: false, calls: [["highlands", "19:00"], ["atlantic", "19:20"], ["east35", "20:15"], ["bmb", "20:35"]] },
  { monThuOnly: false, calls: [["highlands", "20:30"], ["east35", "21:40"], ["bmb", "21:55"]] },
  { monThuOnly: false, calls: [["atlantic", "21:25"], ["east35", "22:25"], ["bmb", "22:40"]] },
];

// NEW YORK DEPARTURES — Manhattan/Jersey City boardings, New Jersey arrivals.
const NEW_YORK_DEPARTURES = [
  { monThuOnly: true , calls: [["bmb", "06:20"], ["brookfield", "06:30"], ["paulus", "06:40"], ["belford", "07:20"]] },
  { monThuOnly: false, calls: [["bmb", "06:30"], ["east35", "06:55"], ["highlands", "07:45"]] },
  { monThuOnly: false, calls: [["brookfield", "07:00"], ["bmb", "07:10"], ["belford", "07:55"]] },
  { monThuOnly: false, calls: [["bmb", "07:40"], ["east35", "08:00"], ["sandyhook", "08:40"], ["atlantic", "09:00"]] },
  { monThuOnly: false, calls: [["east35", "10:45"], ["bmb", "11:00"], ["sandyhook", "11:35"], ["highlands", "11:55"]] },
  { monThuOnly: false, calls: [["east35", "13:05"], ["bmb", "13:25"], ["atlantic", "14:05"], ["highlands", "14:15"]] },
  { monThuOnly: false, calls: [["east35", "14:40"], ["bmb", "15:00"], ["highlands", "15:40"], ["atlantic", "15:55"]] },
  { monThuOnly: true , calls: [["west39", "14:25"], ["paulus", "14:40"], ["brookfield", "14:50"], ["bmb", "15:05"], ["belford", "15:45"]] },
  { monThuOnly: true , calls: [["east35", "15:55"], ["bmb", "16:15"], ["atlantic", "16:55"], ["highlands", "17:05"]] },
  { monThuOnly: false, calls: [["west39", "16:00"], ["brookfield", "16:15"], ["bmb", "16:30"], ["belford", "17:15"]] },
  { monThuOnly: false, calls: [["east35", "16:25"], ["bmb", "16:40"], ["highlands", "17:20"], ["atlantic", "17:35"]] },
  { monThuOnly: true , calls: [["west39", "16:40"], ["paulus", "16:55"], ["brookfield", "17:05"], ["bmb", "17:20"], ["belford", "18:05"]] },
  { monThuOnly: false, calls: [["east35", "17:10"], ["bmb", "17:30"], ["atlantic", "18:10"], ["highlands", "18:20"]] },
  { monThuOnly: true , calls: [["east35", "18:00"], ["bmb", "18:20"], ["highlands", "19:00"], ["atlantic", "19:20"]] },
  { monThuOnly: false, calls: [["west39", "18:05"], ["paulus", "18:15"], ["brookfield", "18:25"], ["bmb", "18:35"], ["belford", "19:20"]] },
  { monThuOnly: false, calls: [["east35", "18:30"], ["bmb", "18:45"], ["highlands", "19:30"], ["atlantic", "19:40"]] },
  { monThuOnly: true , calls: [["paulus", "19:05"], ["brookfield", "19:20"], ["bmb", "19:35"], ["belford", "20:15"]] },
  { monThuOnly: false, calls: [["east35", "19:30"], ["bmb", "19:45"], ["atlantic", "20:25"], ["highlands", "20:35"]] },
  { monThuOnly: false, calls: [["east35", "20:20"], ["bmb", "20:40"], ["atlantic", "21:20"]] },
  { monThuOnly: false, calls: [["east35", "21:45"], ["bmb", "22:00"], ["atlantic", "22:40"], ["highlands", "22:55"]] },
  { monThuOnly: false, calls: [["east35", "22:30"], ["bmb", "22:45"], ["atlantic", "23:25"], ["highlands", "23:35"]] },
];

// WEEKEND — NEW JERSEY DEPARTURES. Highlands and Sandy Hook Beach board; the two Manhattan piers
// are arrivals. No weekend boat calls at Belford, Atlantic Highlands, Brookfield, Paulus Hook or
// West 39th, so none of them appears below.
const WEEKEND_NEW_JERSEY_DEPARTURES = [
  { calls: [["highlands", "07:15"], ["bmb", "07:55"], ["east35", "08:10"]] },
  { calls: [["highlands", "09:30"], ["east35", "10:15"], ["bmb", "10:45"]] },
  { calls: [["highlands", "12:00"], ["east35", "12:45"], ["bmb", "13:05"]] },
  { calls: [["highlands", "15:00"], ["sandyhook", "15:15"], ["east35", "15:55"], ["bmb", "16:10"]] },
  { calls: [["highlands", "17:00"], ["sandyhook", "17:15"], ["east35", "18:10"], ["bmb", "18:25"]] },
  // Sandy Hook first, then Highlands — the reverse of the printed column order.
  { calls: [["sandyhook", "19:15"], ["highlands", "19:30"], ["bmb", "20:10"], ["east35", "20:30"]] },
];

// WEEKEND — NEW YORK DEPARTURES. The two Manhattan piers board; New Jersey arrives.
const WEEKEND_NEW_YORK_DEPARTURES = [
  { calls: [["east35", "08:20"], ["bmb", "08:35"], ["sandyhook", "09:10"], ["highlands", "09:20"]] },
  { calls: [["east35", "10:30"], ["bmb", "11:00"], ["sandyhook", "11:35"], ["highlands", "12:05"]] },
  { calls: [["east35", "12:55"], ["bmb", "13:10"], ["sandyhook", "13:45"], ["highlands", "13:50"]] },
  { calls: [["east35", "16:00"], ["bmb", "16:15"], ["highlands", "16:55"]] },
  { calls: [["east35", "18:15"], ["bmb", "18:30"], ["highlands", "19:25"]] },
  // Battery Maritime first, then East 35th — the reverse of the printed column order.
  { calls: [["bmb", "20:15"], ["east35", "20:45"], ["highlands", "21:30"]] },
];

// One printed row is one trip. The boarding side is whichever side the table is headed for; the
// other side's calls are arrivals, so they are drop-off only and never advertise a departure.
function tripRows(table, { boardingSide, directionId, idPrefix, service }) {
  const trips = [], stopTimes = [];
  table.forEach((row, index) => {
    const tripId = `${idPrefix}-${String(index + 1).padStart(2, "0")}`;
    const calls = row.calls.map(([key, time]) => ({ stop: STOPS[key], time: `${time}:00` }));
    const finalStop = calls.at(-1).stop;
    trips.push({
      route_id: ROUTE_ID,
      service_id: service ?? (row.monThuOnly ? SERVICE_MON_THU : SERVICE_WEEKDAY),
      trip_id: tripId,
      trip_headsign: finalStop.name,
      direction_id: directionId
    });
    calls.forEach((call, sequence) => {
      const boarding = call.stop.side === boardingSide;
      stopTimes.push({
        trip_id: tripId,
        arrival_time: call.time,
        departure_time: call.time,
        stop_id: call.stop.id,
        stop_sequence: sequence + 1,
        // A boarding call on the last row of a trip would be a boat you could get on and never off.
        pickup_type: boarding && sequence < calls.length - 1 ? 0 : 1,
        drop_off_type: boarding ? 1 : 0
      });
    });
  });
  return { trips, stopTimes };
}

// What the shape of this feed is actually asserted on. Times must run forwards inside a trip — the
// tables are read column-by-column and ordered by clock, so a stop out of order means a misread
// column — and no two trips may offer a boarding at the same pier at the same minute on the same
// days, which is the duplicate this rewrite exists to remove.
function assertFeedIsSane(trips, stopTimes) {
  const byTrip = new Map();
  for (const row of stopTimes) {
    if (!byTrip.has(row.trip_id)) byTrip.set(row.trip_id, []);
    byTrip.get(row.trip_id).push(row);
  }
  const service = new Map(trips.map((trip) => [trip.trip_id, trip.service_id]));
  const problems = [];
  const boardings = new Map();
  for (const [tripId, calls] of byTrip) {
    if (calls.length < 2) problems.push(`${tripId} has fewer than two calls`);
    for (let index = 1; index < calls.length; index += 1) {
      if (calls[index].departure_time <= calls[index - 1].departure_time) {
        problems.push(`${tripId} does not run forwards at ${calls[index].departure_time}`);
      }
    }
    for (const call of calls) {
      if (call.pickup_type !== 0) continue;
      const key = `${call.stop_id}@${call.departure_time}/${service.get(tripId)}`;
      if (boardings.has(key)) problems.push(`${key} is a boarding on both ${boardings.get(key)} and ${tripId}`);
      boardings.set(key, tripId);
    }
  }
  if (problems.length) throw new Error(`Seastreak feed is not sane:\n  ${problems.join("\n  ")}`);
}

async function main() {
  const inbound = tripRows(NEW_JERSEY_DEPARTURES, { boardingSide: "nj", directionId: 0, idPrefix: "ss-nj" });
  const outbound = tripRows(NEW_YORK_DEPARTURES, { boardingSide: "ny", directionId: 1, idPrefix: "ss-ny" });
  const weekendInbound = tripRows(WEEKEND_NEW_JERSEY_DEPARTURES, { boardingSide: "nj", directionId: 0, idPrefix: "ss-we-nj", service: SERVICE_WEEKEND });
  const weekendOutbound = tripRows(WEEKEND_NEW_YORK_DEPARTURES, { boardingSide: "ny", directionId: 1, idPrefix: "ss-we-ny", service: SERVICE_WEEKEND });
  const trips = [...inbound.trips, ...outbound.trips, ...weekendInbound.trips, ...weekendOutbound.trips];
  const stopTimes = [...inbound.stopTimes, ...outbound.stopTimes, ...weekendInbound.stopTimes, ...weekendOutbound.stopTimes];
  assertFeedIsSane(trips, stopTimes);

  const files = {
    "agency.txt": toCsv(["agency_id", "agency_name", "agency_url", "agency_timezone", "agency_lang", "agency_phone"],
      [{ agency_id: AGENCY_ID, agency_name: AGENCY_NAME, agency_url: "https://seastreak.com",
         agency_timezone: "America/New_York", agency_lang: "en", agency_phone: "1-800-262-8743" }]),
    "routes.txt": toCsv(["route_id", "agency_id", "route_short_name", "route_long_name", "route_desc", "route_type", "route_url", "route_color", "route_text_color"],
      [{ route_id: ROUTE_ID, agency_id: AGENCY_ID, route_short_name: "Seastreak",
         route_long_name: "New York City / New Jersey", route_desc: "Between New Jersey and New York City",
         route_type: 4, route_url: "https://seastreak.com/ferry-routes-and-schedules/between-new-jersey-and-new-york-city/",
         route_color: "013067", route_text_color: "FFFFFF" }]),
    "stops.txt": toCsv(["stop_id", "stop_name", "stop_desc", "stop_lat", "stop_lon", "location_type", "wheelchair_boarding"],
      Object.values(STOPS).map((stop) => ({
        stop_id: stop.id, stop_name: stop.name, stop_desc: stop.desc,
        stop_lat: stop.lat, stop_lon: stop.lon, location_type: 0, wheelchair_boarding: 1
      }))),
    "calendar.txt": toCsv(["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"],
      [{ service_id: SERVICE_WEEKDAY, monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 0, sunday: 0, start_date: SERVICE_START, end_date: SERVICE_END },
       // The red rows. Same week, minus the Friday.
       { service_id: SERVICE_MON_THU, monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 0, saturday: 0, sunday: 0, start_date: SERVICE_START, end_date: SERVICE_END },
       // The weekend page carries the earlier effective date of the two, and it is the one the
       // file is named for. Its own timetable starts when it says it starts.
       { service_id: SERVICE_WEEKEND, monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 1, sunday: 1, start_date: WEEKEND_SERVICE_START, end_date: SERVICE_END }]),
    // No exception dates: the timetable is a plain weekday pattern with no published holiday
    // variations. The file is still written because the build expects every feed to have one, and
    // an absent file reads as a feed that was assembled wrong rather than one with nothing to say.
    "calendar_dates.txt": toCsv(["service_id", "date", "exception_type"], []),
    "trips.txt": toCsv(["route_id", "service_id", "trip_id", "trip_headsign", "direction_id"], trips),
    "stop_times.txt": toCsv(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type", "drop_off_type"], stopTimes),
    "feed_info.txt": toCsv(["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date", "feed_version"],
      [{ feed_publisher_name: AGENCY_NAME, feed_publisher_url: "https://seastreak.com", feed_lang: "en",
         feed_start_date: WEEKEND_SERVICE_START, feed_end_date: SERVICE_END, feed_version: `transcribed-${SOURCE_CHECKED_ON}` }])
  };

  await writeGtfsFiles(OUTPUT_DIR, files);
  // The directory used to hold a downloaded feed, which had files this one does not write:
  // calendar_dates.txt full of exception dates for service ids that no longer exist, and a
  // shapes.txt for trips that no longer exist. Left behind they are not merely dead weight — a
  // reader diffing this feed would find two files nothing in it refers to and have to work out
  // which half was current. The build owns the whole directory.
  for (const stale of await readdir(OUTPUT_DIR)) {
    if (!Object.hasOwn(files, stale)) await rm(path.join(OUTPUT_DIR, stale), { force: true });
  }

  const monThu = trips.filter((trip) => trip.service_id === SERVICE_MON_THU).length;
  console.log(`Wrote gtfs/seastreak/ from ${SOURCE_URL} as checked on ${SOURCE_CHECKED_ON}.`);
  const weekend = trips.filter((trip) => trip.service_id === SERVICE_WEEKEND).length;
  console.log(`  weekday: ${NEW_JERSEY_DEPARTURES.length} New Jersey departures, ${NEW_YORK_DEPARTURES.length} New York departures`);
  console.log(`  weekend: ${WEEKEND_NEW_JERSEY_DEPARTURES.length} New Jersey departures, ${WEEKEND_NEW_YORK_DEPARTURES.length} New York departures`);
  console.log(`  ${trips.length} trips, ${stopTimes.length} calls, ${monThu} of them Monday-Thursday only`);
  console.log(`  weekdays from ${SERVICE_START}, weekends from ${WEEKEND_SERVICE_START}, both to ${SERVICE_END}`);
  console.log(`  ${weekend} of the trips are Saturday/Sunday`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
