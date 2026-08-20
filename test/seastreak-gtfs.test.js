import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseCsv } from "../scripts/build-data.js";

const dir = new URL("../gtfs/seastreak/", import.meta.url);
const read = async (name) => parseCsv(await readFile(new URL(name, dir), "utf8"));

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

// The board points at these three by id in config/landings.json. Renumbering them in a feed rebuild
// would take Seastreak off the board at Whitehall, East 35th and Pier 79 without failing anything.
test("the three piers the board watches keep their ids", async () => {
  const { stops } = await feed();
  const ids = new Set(stops.map((stop) => stop.stop_id));
  for (const id of ["170", "168", "8306"]) assert.ok(ids.has(id), `stop ${id} is missing from the feed`);
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

// The PDF prints some sailings in red with the note that they do not run on Fridays. Colour does not
// survive a text extraction, so this is the assertion that the colour was read at all.
test("the Monday-to-Thursday sailings are a real, smaller subset of the week", async () => {
  const { calendar, trips } = await feed();
  const services = Object.fromEntries(calendar.map((row) => [row.service_id, row]));
  assert.equal(services["ss-weekday"].friday, "1");
  assert.equal(services["ss-mon-thu"].friday, "0");
  for (const day of ["monday", "tuesday", "wednesday", "thursday"]) {
    assert.equal(services["ss-mon-thu"][day], "1");
  }
  for (const row of Object.values(services)) {
    assert.equal(row.saturday, "0", "the published weekday timetable has no weekend service");
    assert.equal(row.sunday, "0");
  }
  const monThu = trips.filter((trip) => trip.service_id === "ss-mon-thu");
  assert.ok(monThu.length > 0 && monThu.length < trips.length,
    "expected some but not all sailings to be Monday-to-Thursday");
});
