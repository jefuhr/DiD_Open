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
//   BELFORD IS GONE FROM THIS FEED. Seastreak ran its last Belford sailing on 4 September 2026 and
//   NY Waterway took the route over on the 8th; that operator's sheets are transcribed in
//   scripts/build-waterway-belford-gtfs.js. The September sheets print no Belford column at all, so
//   the stop, its two service ids and every trip that called there have been deleted rather than
//   given an end date. Nothing here is dual-run any more.
//
//   Paulus Hook, West 39th St and Sandy Hook Beach went with it. Every Paulus Hook and West 39th
//   call in the August timetable was on a Belford working, and the September sheets drop Sandy Hook
//   from the weekend page as well, so all three stops are out of the feed. West 39th is Pier 79 on
//   this board: landing 26 no longer names Seastreak, because Seastreak no longer calls there.
//
//   BROOKFIELD PLACE IS NOW A HEADLINE PIER. It used to be an intermediate call on the Belford
//   runs; the weekday sheet is now titled "Brookfield Place, East 35th St & BMB-Slip 5" and it
//   boards in its own right. Landing 25 names it for the first time.
//
//   Times in blue run Monday to Wednesday only, and times in purple Thursday and Friday only. That
//   replaces the August sheet's red "not on Fridays" rows, which are gone. Colour does not survive
//   a text extraction, so the two coloured rows in each table are carried here as days: "mon-wed"
//   and days: "thu-fri" — this is the only record that the colour was read at all.
//
//   The page also carries a WEEKDAY SHUTTLE BUS table between the New Jersey terminals — Highlands
//   to Atlantic Highlands at 12:15 and 17:05, about ten minutes. Those are road transfers, not
//   sailings, and are not in this feed. The ⁰ against two Highlands arrivals (12:05 and 17:00) is
//   the footnote saying one of those buses meets that boat, which is why the two tables line up.
//
//   The WEEKEND SCHEDULE is a separate sheet with its own effective date, and it is now a plain
//   three-stop shuttle: Highlands, Battery Maritime and East 35th. Sandy Hook Beach, which had a
//   weekend boat in August, no longer does. Atlantic Highlands, Brookfield, Paulus Hook and West
//   39th get no weekend boat either. It is read by the same Departures/Arrivals rule as the weekday
//   tables, and carries no colour: the blue and purple notes are printed on the weekday sheets only.
//
//   Several rows call at the piers in the opposite order to the printed column headings, and the
//   columns are read by clock rather than by heading order. The ones worth knowing:
//     - New York departures row 8 boards East 35th 15:55, Battery Maritime 16:15 and Brookfield
//       16:25 — Brookfield is printed first but sails last, the boat coming round the Battery.
//     - New York departures row 10 boards Battery Maritime 17:05 before Brookfield 17:20, and
//       arrives Atlantic Highlands 18:00 before Highlands 18:10.
//     - New Jersey departures row 14 boards Atlantic Highlands 18:15 before Highlands 18:30.
//     - The first two weekend New Jersey departures reach East 35th before Battery Maritime; the
//       last three reach Battery Maritime first, exactly as printed.
//
//   One sailing is printed in both weekday tables and is one boat: Highlands 06:20, Brookfield
//   06:55, Battery Maritime 07:10, Atlantic Highlands 07:55. The New Jersey table shows its first
//   half and the New York table its second, so Brookfield boards once — on the New York row — and
//   is a drop-off on the New Jersey one. That is the Departures/Arrivals rule doing the job it
//   exists for, and it is why Brookfield appears at 06:55 in both tables below without clashing.
//
// !! Seastreak's Massachusetts routes (New Bedford, Nantucket, Martha's Vineyard) were in the
// !! download this replaces and are not here: no landing on this board is within two hundred
// !! miles of them.

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, "gtfs/seastreak");

// !! The August PDF this feed used to be read from is superseded. These sheets were transcribed
// !! from the operator's published September timetables, whose own dated PDF URL was not captured
// !! with them; the link below is the route page that always carries the current sheets. If you
// !! have the dated PDF's URL, put it here — a transcription should name the exact thing it read.
export const SOURCE_URL =
  "https://seastreak.com/ferry-routes-and-schedules/between-new-jersey-and-new-york-city/";
export const SOURCE_CHECKED_ON = "2026-09-07";

// Both weekday sheets are headed "Effective September 8, 2026" — the Tuesday after Labor Day, and
// the same day NY Waterway's Belford sheet starts.
const SERVICE_START = "20260908";
// The weekend sheet is headed "Effective September 12, 2026" — the Saturday of that week, so the
// weekday timetable starts four days before the weekend one rather than after it.
const WEEKEND_SERVICE_START = "20260912";
// Seastreak publishes no end date — the PDF says only "SCHEDULE SUBJECT TO CHANGE WITHOUT NOTICE".
// This is deliberately finite so a transcription cannot quietly outlive the timetable it came from,
// and deliberately long enough that it will not lapse before somebody re-reads the source.
const SERVICE_END = "20271231";

const AGENCY_ID = "20226";
const AGENCY_NAME = "Seastreak";
const ROUTE_ID = "211";

// Monday to Friday, and the two coloured subsets the weekday sheets print: blue runs Monday to
// Wednesday, purple Thursday and Friday. Between them the blue and purple rows cover the week
// exactly once, which is how the last boat of the night works — it leaves at one time for the
// first half of the week and a later one for the second, rather than twice on any day.
const SERVICE_WEEKDAY = "ss-weekday";
const SERVICE_MON_WED = "ss-mon-wed";
const SERVICE_THU_FRI = "ss-thu-fri";
// Saturday and Sunday, off the weekend sheet. It prints one set of times with no Saturday/Sunday
// split, so both days get the same service.
const SERVICE_WEEKEND = "ss-weekend";

// What the days: field on each printed row below means. A row with no days: is the plain weekday
// service; the other two are the coloured rows, and an unknown value is a typo rather than a
// default, so it throws.
const WEEKDAY_SERVICES = {
  "mon-fri": SERVICE_WEEKDAY,
  "mon-wed": SERVICE_MON_WED,
  "thu-fri": SERVICE_THU_FRI
};

// Stop ids are Seastreak's own, carried over from the GTFS this feed replaces: config/landings.json
// points at 170, 168 and 9825 by those ids, so changing them would take Seastreak off the board.
//
// Four stops that were here in August are not any more, and none of them is an omission:
// Belford (9819), Paulus Hook (9954) and West 39th St (8306) were called at only by the Belford
// workings NY Waterway now runs, and Sandy Hook Beach was dropped from the weekend sheet. The
// September timetable prints no column for any of them. West 39th leaving is the one with a board
// consequence, since it was Pier 79's Seastreak mapping — see config/landings.json.
const STOPS = {
  highlands:  { id: "176",  name: "Highlands, NJ", desc: "326 Shore Drive", lat: 40.409395, lon: -73.996238, side: "nj" },
  atlantic:   { id: "175",  name: "Atlantic Highlands, NJ", desc: "Bottom of First Avenue at the Atlantic Highlands Municipal Marina", lat: 40.419668, lon: -74.034889, side: "nj" },
  bmb:        { id: "170",  name: "Battery Maritime Building Slip 5", desc: "10 South Street", lat: 40.700894, lon: -74.011612, side: "ny" },
  east35:     { id: "168",  name: "East 35th St., NYC", desc: "East 35th St. and the FDR on the East Side of Manhattan", lat: 40.743873, lon: -73.97069, side: "ny" },
  brookfield: { id: "9825", name: "Brookfield Place, NY", desc: "Battery Park City Vessey Street on the West Side of Manhattan", lat: 40.715161, lon: -74.017695, side: "ny" }
};

// WEEKDAY — NEW JERSEY DEPARTURES, off the "Highlands & Atlantic Highlands" sheet. New Jersey
// boardings, Manhattan arrivals. Printed columns are Highlands, Atlantic Highlands, BMB-Slip 5,
// East 35th St., Brookfield Place; the calls below are ordered by clock, not by that heading order.
const NEW_JERSEY_DEPARTURES = [
  { days: "mon-fri", calls: [["highlands", "05:45"], ["bmb", "06:25"], ["east35", "06:45"]] },
  // Brookfield before Battery Maritime. This boat carries on as the 06:55 New York departure below.
  { days: "mon-fri", calls: [["highlands", "06:20"], ["brookfield", "06:55"], ["bmb", "07:10"]] },
  { days: "mon-fri", calls: [["atlantic", "07:00"], ["bmb", "07:40"], ["east35", "08:00"]] },
  { days: "mon-fri", calls: [["atlantic", "07:30"], ["bmb", "08:10"], ["east35", "08:30"]] },
  { days: "mon-fri", calls: [["highlands", "07:55"], ["bmb", "08:35"], ["east35", "08:50"]] },
  { days: "mon-fri", calls: [["atlantic", "08:10"], ["brookfield", "08:45"], ["bmb", "09:00"], ["east35", "09:15"]] },
  { days: "mon-fri", calls: [["atlantic", "09:10"], ["bmb", "09:50"], ["east35", "10:05"]] },
  { days: "mon-fri", calls: [["atlantic", "10:15"], ["bmb", "10:55"], ["east35", "11:10"]] },
  // East 35th before Battery Maritime, the reverse of the printed columns, from here on the sheet.
  { days: "mon-fri", calls: [["highlands", "12:15"], ["east35", "13:05"], ["bmb", "13:25"]] },
  { days: "mon-fri", calls: [["highlands", "15:00"], ["east35", "15:50"], ["bmb", "16:05"], ["brookfield", "16:20"]] },
  { days: "mon-fri", calls: [["highlands", "15:45"], ["atlantic", "16:00"], ["east35", "17:00"], ["bmb", "17:20"]] },
  { days: "mon-fri", calls: [["highlands", "17:05"], ["east35", "17:55"], ["bmb", "18:10"]] },
  { days: "mon-fri", calls: [["highlands", "17:25"], ["atlantic", "17:40"], ["east35", "18:25"], ["bmb", "18:40"]] },
  // Atlantic Highlands boards before Highlands — the reverse of the printed column order.
  { days: "mon-fri", calls: [["atlantic", "18:15"], ["highlands", "18:30"], ["east35", "19:25"], ["bmb", "19:40"]] },
  { days: "mon-fri", calls: [["highlands", "19:10"], ["east35", "20:15"], ["bmb", "20:35"]] },
  // The last two are the coloured rows: blue Monday to Wednesday, purple Thursday and Friday.
  { days: "mon-wed", calls: [["highlands", "20:30"], ["east35", "21:40"], ["bmb", "21:55"]] },
  { days: "thu-fri", calls: [["highlands", "21:25"], ["east35", "22:25"], ["bmb", "22:40"]] },
];

// WEEKDAY — NEW YORK DEPARTURES, off the "Brookfield Place, East 35th St & BMB-Slip 5" sheet.
// Manhattan boardings, New Jersey arrivals. Printed columns are Brookfield Place, East 35th St.,
// BMB-Slip 5, Highlands, Atlantic Highlands, and again the calls are ordered by clock.
const NEW_YORK_DEPARTURES = [
  { days: "mon-fri", calls: [["bmb", "06:25"], ["east35", "06:45"], ["highlands", "07:40"]] },
  // The second half of the 06:20 out of Highlands above: this is where that boat sells its seats.
  { days: "mon-fri", calls: [["brookfield", "06:55"], ["bmb", "07:10"], ["atlantic", "07:55"]] },
  { days: "mon-fri", calls: [["bmb", "07:40"], ["east35", "08:00"], ["atlantic", "09:00"]] },
  { days: "mon-fri", calls: [["bmb", "08:10"], ["east35", "08:30"], ["atlantic", "09:15"]] },
  // Highlands 12:05 carries the ⁰ footnote: the 12:15 shuttle bus to Atlantic Highlands meets it.
  { days: "mon-fri", calls: [["bmb", "11:00"], ["east35", "11:15"], ["highlands", "12:05"]] },
  { days: "mon-fri", calls: [["east35", "13:10"], ["bmb", "13:30"], ["atlantic", "14:10"], ["highlands", "14:25"]] },
  { days: "mon-fri", calls: [["east35", "14:40"], ["bmb", "15:00"], ["highlands", "15:40"], ["atlantic", "15:55"]] },
  // Brookfield is printed first but sails last, and Highlands 17:00 carries the ⁰ footnote too.
  { days: "mon-fri", calls: [["east35", "15:55"], ["bmb", "16:15"], ["brookfield", "16:25"], ["highlands", "17:00"]] },
  { days: "mon-fri", calls: [["east35", "16:25"], ["bmb", "16:40"], ["highlands", "17:20"], ["atlantic", "17:35"]] },
  // Battery Maritime before Brookfield, and Atlantic Highlands before Highlands at the far end.
  { days: "mon-fri", calls: [["bmb", "17:05"], ["brookfield", "17:20"], ["atlantic", "18:00"], ["highlands", "18:10"]] },
  { days: "mon-fri", calls: [["east35", "17:10"], ["bmb", "17:30"], ["atlantic", "18:10"], ["highlands", "18:20"]] },
  { days: "mon-fri", calls: [["east35", "18:00"], ["bmb", "18:20"], ["highlands", "19:00"], ["atlantic", "19:20"]] },
  { days: "mon-fri", calls: [["east35", "18:30"], ["bmb", "18:45"], ["highlands", "19:30"], ["atlantic", "19:40"]] },
  { days: "mon-fri", calls: [["east35", "19:30"], ["bmb", "19:45"], ["atlantic", "20:25"], ["highlands", "20:35"]] },
  { days: "mon-fri", calls: [["east35", "20:20"], ["bmb", "20:40"], ["atlantic", "21:20"], ["highlands", "21:30"]] },
  // The coloured rows again: blue Monday to Wednesday, purple Thursday and Friday.
  { days: "mon-wed", calls: [["east35", "21:45"], ["bmb", "22:00"], ["atlantic", "22:40"], ["highlands", "22:55"]] },
  { days: "thu-fri", calls: [["east35", "22:30"], ["bmb", "22:45"], ["highlands", "23:25"], ["atlantic", "23:35"]] },
];

// WEEKEND — NEW JERSEY DEPARTURES. Highlands boards; the two Manhattan piers are arrivals. The
// weekend sheet is titled for its three stops and calls at no others: no Atlantic Highlands, no
// Brookfield, and — unlike the August timetable — no Sandy Hook Beach.
const WEEKEND_NEW_JERSEY_DEPARTURES = [
  // The first two reach East 35th before Battery Maritime, the reverse of the printed columns.
  { calls: [["highlands", "09:30"], ["east35", "10:15"], ["bmb", "10:45"]] },
  { calls: [["highlands", "12:00"], ["east35", "12:45"], ["bmb", "13:00"]] },
  // The last three run the other way round, exactly as printed.
  { calls: [["highlands", "15:00"], ["bmb", "15:40"], ["east35", "15:55"]] },
  { calls: [["highlands", "18:00"], ["bmb", "18:40"], ["east35", "18:55"]] },
  { calls: [["highlands", "20:15"], ["bmb", "20:50"], ["east35", "21:05"]] },
];

// WEEKEND — NEW YORK DEPARTURES. The two Manhattan piers board; Highlands arrives. Every row runs
// in the printed column order.
const WEEKEND_NEW_YORK_DEPARTURES = [
  { calls: [["east35", "10:30"], ["bmb", "11:00"], ["highlands", "11:45"]] },
  { calls: [["east35", "12:50"], ["bmb", "13:05"], ["highlands", "13:45"]] },
  { calls: [["east35", "16:45"], ["bmb", "17:00"], ["highlands", "17:40"]] },
  { calls: [["east35", "19:15"], ["bmb", "19:30"], ["highlands", "20:10"]] },
  { calls: [["east35", "21:45"], ["bmb", "22:00"], ["highlands", "22:40"]] },
];

function toCsv(headers, rows) {
  const escape = (value) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n") + "\n";
}

// One printed row is one trip. The boarding side is whichever side the table is headed for; the
// other side's calls are arrivals, so they are drop-off only and never advertise a departure.
function tripRows(table, { boardingSide, directionId, idPrefix, service }) {
  const trips = [], stopTimes = [];
  table.forEach((row, index) => {
    const tripId = `${idPrefix}-${String(index + 1).padStart(2, "0")}`;
    const calls = row.calls.map(([key, time]) => ({ stop: STOPS[key], time: `${time}:00` }));
    const finalStop = calls.at(-1).stop;
    // The weekend tables pass their service in; a weekday row carries its own colour.
    const weekdayService = WEEKDAY_SERVICES[row.days];
    if (!service && !weekdayService) throw new Error(`${tripId} has no days: the calendar knows`);
    trips.push({
      route_id: ROUTE_ID,
      service_id: service ?? weekdayService,
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
       // The blue rows: the first half of the week only.
       { service_id: SERVICE_MON_WED, monday: 1, tuesday: 1, wednesday: 1, thursday: 0, friday: 0, saturday: 0, sunday: 0, start_date: SERVICE_START, end_date: SERVICE_END },
       // The purple rows: the second half, and between them the week is covered exactly once.
       { service_id: SERVICE_THU_FRI, monday: 0, tuesday: 0, wednesday: 0, thursday: 1, friday: 1, saturday: 0, sunday: 0, start_date: SERVICE_START, end_date: SERVICE_END },
       // The weekend sheet starts four days after the weekday one. Its own timetable starts when it
       // says it starts, so the first weekend under this feed is 12 September.
       { service_id: SERVICE_WEEKEND, monday: 0, tuesday: 0, wednesday: 0, thursday: 0, friday: 0, saturday: 1, sunday: 1, start_date: WEEKEND_SERVICE_START, end_date: SERVICE_END }]),
    // No exception dates: the timetable is a plain weekday pattern with no published holiday
    // variations. The file is still written because the build expects every feed to have one, and
    // an absent file reads as a feed that was assembled wrong rather than one with nothing to say.
    "calendar_dates.txt": toCsv(["service_id", "date", "exception_type"], []),
    "trips.txt": toCsv(["route_id", "service_id", "trip_id", "trip_headsign", "direction_id"], trips),
    "stop_times.txt": toCsv(["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence", "pickup_type", "drop_off_type"], stopTimes),
    "feed_info.txt": toCsv(["feed_publisher_name", "feed_publisher_url", "feed_lang", "feed_start_date", "feed_end_date", "feed_version"],
      // The earlier of the two effective dates, whichever way round they fall — in August the
      // weekend sheet started first, in September the weekday one does.
      [{ feed_publisher_name: AGENCY_NAME, feed_publisher_url: "https://seastreak.com", feed_lang: "en",
         feed_start_date: SERVICE_START < WEEKEND_SERVICE_START ? SERVICE_START : WEEKEND_SERVICE_START,
         feed_end_date: SERVICE_END, feed_version: `transcribed-${SOURCE_CHECKED_ON}` }])
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const [name, contents] of Object.entries(files)) await writeFile(path.join(OUTPUT_DIR, name), contents, "utf8");
  // The directory used to hold a downloaded feed, which had files this one does not write:
  // calendar_dates.txt full of exception dates for service ids that no longer exist, and a
  // shapes.txt for trips that no longer exist. Left behind they are not merely dead weight — a
  // reader diffing this feed would find two files nothing in it refers to and have to work out
  // which half was current. The build owns the whole directory.
  for (const stale of await readdir(OUTPUT_DIR)) {
    if (!Object.hasOwn(files, stale)) await rm(path.join(OUTPUT_DIR, stale), { force: true });
  }

  const count = (id) => trips.filter((trip) => trip.service_id === id).length;
  console.log(`Wrote gtfs/seastreak/ from ${SOURCE_URL} as checked on ${SOURCE_CHECKED_ON}.`);
  console.log(`  weekday: ${NEW_JERSEY_DEPARTURES.length} New Jersey departures, ${NEW_YORK_DEPARTURES.length} New York departures`);
  console.log(`  weekend: ${WEEKEND_NEW_JERSEY_DEPARTURES.length} New Jersey departures, ${WEEKEND_NEW_YORK_DEPARTURES.length} New York departures`);
  console.log(`  ${trips.length} trips, ${stopTimes.length} calls at ${Object.keys(STOPS).length} piers`);
  console.log(`  ${count(SERVICE_MON_WED)} of them run Monday-Wednesday (blue), ${count(SERVICE_THU_FRI)} Thursday-Friday (purple)`);
  console.log(`  weekdays from ${SERVICE_START}, weekends from ${WEEKEND_SERVICE_START}, both to ${SERVICE_END}`);
  console.log(`  ${count(SERVICE_WEEKEND)} of the trips are Saturday/Sunday`);
  console.log("  Belford, Paulus Hook, West 39th St and Sandy Hook Beach are no longer served");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
