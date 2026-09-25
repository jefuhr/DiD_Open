import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseCsv } from "../scripts/build-data.js";

const dir = new URL("../gtfs/seastreak/", import.meta.url);
const read = async (name) => parseCsv(await readFile(new URL(name, dir), "utf8"));

// Independent, printed-column transcriptions of the user's September 8 sheets.
// The adjacent images let reviewers check every cell and the blue/purple day restrictions.
// Compare the generated feed, not the generator's own arrays: a correct source table is not
// enough if stop order, pickup flags, service assignment or the committed output drifts.
const sourceDir = new URL("../schedules/seastreak-2026-09-08/", import.meta.url);
const sourceStops = {
  "Brookfield Place": { id: "9825", side: "ny" },
  "East 35th St.": { id: "168", side: "ny" },
  "BMB-Slip 5": { id: "170", side: "ny" },
  "Highlands": { id: "176", side: "nj" },
  "Atlantic Highlands": { id: "175", side: "nj" }
};
const sourceServices = {
  "Monday-Friday": "ss-weekday",
  "Monday-Wednesday": "ss-mon-wed",
  "Thursday-Friday": "ss-thu-fri"
};

function sourceTime(value) {
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(value);
  assert.ok(match, `invalid time in source transcription: ${value}`);
  const hours = Number(match[1]) % 12 + (match[3] === "PM" ? 12 : 0);
  return `${String(hours).padStart(2, "0")}:${match[2]}:00`;
}

async function feed() {
  const [stops, trips, stopTimes, calendar, routes] = await Promise.all(
    ["stops.txt", "trips.txt", "stop_times.txt", "calendar.txt", "routes.txt"].map(read));
  const byTrip = new Map();
  for (const row of stopTimes) {
    if (!byTrip.has(row.trip_id)) byTrip.set(row.trip_id, []);
    byTrip.get(row.trip_id).push(row);
  }
  for (const calls of byTrip.values()) calls.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  return { stops, trips, stopTimes, calendar, routes, byTrip,
    service: new Map(trips.map((trip) => [trip.trip_id, trip.service_id])) };
}

for (const [sheet, side, direction] of [["new-york", "ny", "1"], ["new-jersey", "nj", "0"]]) {
  test(`all ${sheet} weekday calls match the supplied September 8 sheet`, async () => {
    const source = parseCsv(await readFile(new URL(`${sheet}.csv`, sourceDir), "utf8"));
    assert.equal(source.length, 17, "17 printed rows, including both coloured rows");
    const { trips, byTrip } = await feed();
    const expected = source.map((row) => ({
      service: sourceServices[row.days],
      calls: Object.entries(row).filter(([column, time]) => column !== "days" && time)
        .map(([column, time]) => ({
          stop: sourceStops[column].id,
          arrival: sourceTime(time),
          departure: sourceTime(time),
          pickup: sourceStops[column].side === side ? "0" : "1",
          dropOff: sourceStops[column].side === side ? "1" : "0"
        }))
        .sort((a, b) => a.departure.localeCompare(b.departure))
    }));
    const actual = trips.filter((trip) => trip.service_id !== "ss-weekend" && trip.direction_id === direction)
      .map((trip) => ({
        service: trip.service_id,
        calls: byTrip.get(trip.trip_id).map((call) => ({
          stop: call.stop_id,
          arrival: call.arrival_time,
          departure: call.departure_time,
          pickup: call.pickup_type,
          dropOff: call.drop_off_type
        }))
      }));
    // Trip ids and CSV row order are not passenger-facing; compare complete sailing patterns.
    const patterns = (rows) => rows.map((row) => JSON.stringify(row)).sort();
    assert.deepEqual(patterns(actual), patterns(expected));
  });
}

test("weekday service starts on the sheets' effective date with the printed day restrictions", async () => {
  const { calendar } = await feed();
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  for (const [service, pattern] of Object.entries({
    "ss-weekday": "1111100", "ss-mon-wed": "1110000", "ss-thu-fri": "0001100"
  })) {
    const row = calendar.find((item) => item.service_id === service);
    assert.ok(row, `${service} is missing`);
    assert.equal(row.start_date, "20260908");
    assert.equal(days.map((day) => row[day]).join(""), pattern, service);
  }
});

// The board points at these three by id in config/landings.json. Renumbering them in a feed rebuild
// would take Seastreak off the board at Whitehall, East 35th and Brookfield without failing
// anything. West 39th (8306) was the third of these until September 2026: it was called at only by
// the Belford workings NY Waterway now runs, so Pier 79 no longer names Seastreak at all.
test("the three piers the board watches keep their ids", async () => {
  const { stops } = await feed();
  const ids = new Set(stops.map((stop) => stop.stop_id));
  for (const id of ["170", "168", "9825"]) assert.ok(ids.has(id), `stop ${id} is missing from the feed`);
  assert.equal(ids.has("8306"), false, "West 39th St left the timetable and must not come back silently");
});

// The bug this feed was rewritten to remove. Each sailing is printed in both of Seastreak's tables —
// once as a New Jersey departure and once as a New York departure — and treating both as boardings
// advertised one boat as two, eighteen times over at the piers this board watches.
test("no two trips offer a boarding at the same pier at the same minute", async () => {
  const { byTrip, service } = await feed();
  const seen = new Map();
  const clashes = [];
  for (const [tripId, calls] of byTrip) {
    for (const call of calls) {
      if (call.pickup_type !== "0") continue;
      const key = `${call.stop_id} at ${call.departure_time} on ${service.get(tripId)}`;
      if (seen.has(key)) clashes.push(`${key}: ${seen.get(key)} and ${tripId}`);
      seen.set(key, tripId);
    }
  }
  assert.deepEqual(clashes, []);
});

// An arrival and a departure at the same minute is a boat turning round and is fine; the assertion
// above allows it because only one of the two is a boarding.
test("a pier can still be an arrival and a departure at the same minute", async () => {
  const { byTrip } = await feed();
  const arrivals = new Set();
  const boardings = new Set();
  for (const calls of byTrip.values()) {
    for (const call of calls) {
      (call.pickup_type === "0" ? boardings : arrivals).add(`${call.stop_id}@${call.departure_time}`);
    }
  }
  assert.ok([...arrivals].some((key) => boardings.has(key)),
    "expected at least one pier where a boat arrives and another departs on the same minute");
});

test("every trip runs forwards and is boardable exactly once at each end", async () => {
  const { byTrip } = await feed();
  for (const [tripId, calls] of byTrip) {
    assert.ok(calls.length >= 2, `${tripId} has fewer than two calls`);
    for (let index = 1; index < calls.length; index += 1) {
      assert.ok(calls[index].departure_time > calls[index - 1].departure_time,
        `${tripId} does not run forwards at ${calls[index].departure_time}`);
    }
    // You cannot alight where you boarded, and you cannot board where the boat finishes.
    assert.equal(calls[0].drop_off_type, "1", `${tripId} lets riders off where it started`);
    assert.equal(calls.at(-1).pickup_type, "1", `${tripId} sells a seat from its own last call`);
  }
});

// The weekday sheets print the last sailing of the night twice: once in blue for Monday to
// Wednesday and once in purple for Thursday and Friday. Colour does not survive a text extraction,
// so this is the assertion that the colour was read at all. It replaces the August timetable's red
// "not on Fridays" rows, which is why ss-mon-thu is asserted gone rather than merely absent.
test("the coloured sailings split the week in two, and cover it exactly once", async () => {
  const { calendar, trips } = await feed();
  const services = Object.fromEntries(calendar.map((row) => [row.service_id, row]));
  assert.equal(services["ss-mon-thu"], undefined, "the red Monday-to-Thursday rows are gone");

  assert.equal(services["ss-weekday"].friday, "1");
  for (const day of ["monday", "tuesday", "wednesday"]) {
    assert.equal(services["ss-mon-wed"][day], "1", `blue runs on ${day}`);
    assert.equal(services["ss-thu-fri"][day], "0", `purple does not run on ${day}`);
  }
  for (const day of ["thursday", "friday"]) {
    assert.equal(services["ss-mon-wed"][day], "0", `blue does not run on ${day}`);
    assert.equal(services["ss-thu-fri"][day], "1", `purple runs on ${day}`);
  }

  // The weekday services are the weekday sheets and nothing else; the weekend sheet has its own.
  for (const id of ["ss-weekday", "ss-mon-wed", "ss-thu-fri"]) {
    assert.equal(services[id].saturday, "0", `${id} is off a weekday sheet and cannot run Saturday`);
    assert.equal(services[id].sunday, "0");
  }

  // One blue and one purple row in each printed table, and neither is the whole timetable.
  for (const id of ["ss-mon-wed", "ss-thu-fri"]) {
    const coloured = trips.filter((trip) => trip.service_id === id);
    assert.equal(coloured.length, 2, `${id} is the last boat each way, and only that`);
    assert.ok(coloured.length < trips.length);
  }
});

// The weekend page was missed on the first transcription of this timetable: the board showed no
// Seastreak boat at all on a Saturday. It is a different route rather than a thinner weekday — as
// of September 2026 a three-stop shuttle, having lost the Sandy Hook Beach call it had in August —
// so this checks both that it is there and that it is that shape, since a weekend table
// accidentally filled in from the weekday one would still be non-empty.
test("the weekend page is transcribed, and calls only where it says it calls", async () => {
  const { calendar, trips, stopTimes } = await feed();
  const weekend = calendar.find((row) => row.service_id === "ss-weekend");
  assert.ok(weekend, "expected a weekend service");
  assert.equal(weekend.saturday, "1");
  assert.equal(weekend.sunday, "1");
  for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday"]) {
    assert.equal(weekend[day], "0", "the weekend timetable cannot run midweek");
  }

  const weekendTrips = new Set(
    trips.filter((trip) => trip.service_id === "ss-weekend").map((trip) => trip.trip_id));
  assert.equal(weekendTrips.size, 10, "five sailings each way on the weekend page");

  const calls = stopTimes.filter((row) => weekendTrips.has(row.trip_id));
  const served = new Set(calls.map((row) => row.stop_id));
  assert.deepEqual([...served].sort(),
    ["168", "170", "176"].sort(),
    "the weekend boat runs Highlands, Battery Maritime and East 35th, and nowhere else");

  // The reason this matters to the board: Battery/Whitehall reads Seastreak stop 170, and before
  // the weekend page was read that landing had nothing to show on a Saturday.
  const batteryBoardings = calls.filter((row) => row.stop_id === "170" && row.pickup_type === "0");
  assert.ok(batteryBoardings.length > 0, "expected weekend boardings at Battery Maritime");
});
