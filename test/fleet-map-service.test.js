import test from "node:test";
import assert from "node:assert/strict";
import { buildServiceTripIndex, describeBoats } from "../lib/fleet-map.js";

const holiday = "nyc:sukkot:2026";
const routes = new Map([
  ["ER", { id: "ER", shortName: "ER", name: "East River" }],
  ["SB", { id: "SB", shortName: "SB", name: "South Brooklyn" }]
]);
const stops = "stop_id,stop_name,stop_lat,stop_lon\na,Pier 11,40.70,-74.01\nb,Midtown,40.74,-73.97\nc,Bay Ridge,40.63,-74.03";
const calls = terminal => [
  { stopId: "a", sequence: 1, arrivalSeconds: 32400, departureSeconds: 32460 },
  { stopId: terminal, sequence: 2, arrivalSeconds: 34200, departureSeconds: 34200 }
];
function data() {
  return {
    meta: { timezone: "America/New_York", holidaySchedule: { dates: ["2026-09-28"] } },
    calendars: [{ serviceId: "fall", startDate: "2026-09-01", endDate: "2026-10-31", weekdays: Array(7).fill(true) }],
    exceptions: [{ serviceId: holiday, date: "2026-09-28", added: true }],
    departures: [
      { tripId: "fall-original", liveTripId: "77", serviceId: "fall", routeId: "ER" },
      { tripId: "holiday-column", liveTripId: "77", serviceId: holiday, routeId: "SB", scheduleOnly: true },
      { tripId: "partial-column", liveTripId: "88", serviceId: holiday, routeId: "SB", scheduleOnly: true }
    ],
    tripSchedules: {
      "fall-original": { stops: calls("b") },
      "nyc:sukkot:verified:77": { liveTripId: "77", serviceId: holiday, routeId: "SB", stops: calls("c") },
      "holiday-column": { liveTripId: "77", serviceId: holiday, routeId: "SB", stops: calls("c") },
      "partial-column": { timetableOnly: true, stops: [calls("c")[0]] }
    }
  };
}
function describe(source, when, tripId = "77") {
  const asOf = Date.parse(when);
  const serviceTrips = buildServiceTripIndex({ byLanding: new Map([[16, source]]), stops });
  return describeBoats([{ id: "vessel", boatName: "Opportunity", tripId, stopSequence: 2,
    latitude: 40.7, longitude: -74, updatedAtEpochSeconds: asOf / 1000 }], {
    serviceTrips, routes, asOf,
    // This is the old bundled trip with the reused number. It must never win over date resolution.
    trips: new Map([[tripId, { routeId: "ER", destination: "WRONG OLD TRIP", stops: [] }]])
  })[0];
}

test("map resolves a reused live trip ID to Sukkot stops on the holiday and fall stops afterwards", () => {
  const source = data();
  const sukkot = describe(source, "2026-09-28T13:20:00Z");
  assert.equal(sukkot.routeId, "SB");
  assert.equal(sukkot.destination, "Bay Ridge");
  assert.equal(sukkot.stop.name, "Bay Ridge");
  assert.equal(sukkot.stop.latitude, 40.63);
  const fall = describe(source, "2026-09-29T13:20:00Z");
  assert.equal(fall.routeId, "ER");
  assert.equal(fall.destination, "Midtown");
  assert.equal(fall.stop.name, "Midtown");
});

test("map preserves the vessel position without inventing a trip for partial or inactive schedules", () => {
  for (const [date, tripId] of [["2026-09-28T13:20:00Z", "88"], ["2026-11-01T13:20:00Z", "77"]]) {
    const boat = describe(data(), date, tripId);
    assert.equal(boat.name, "Opportunity");
    assert.equal(boat.latitude, 40.7);
    assert.equal(boat.routeId, null);
    assert.equal(boat.destination, null);
    assert.equal(boat.stop, null);
  }
});

test("a previous service day's after-midnight trip keeps its identity across the holiday boundary", () => {
  const source = data();
  source.tripSchedules["fall-original"].stops = calls("b").map(stop => ({
    ...stop, arrivalSeconds: stop.arrivalSeconds + 57600, departureSeconds: stop.departureSeconds + 57600
  }));
  const boat = describe(source, "2026-09-28T05:20:00Z");
  assert.equal(boat.routeId, "ER");
  assert.equal(boat.destination, "Midtown");
});

test("repeated landing and departure aliases deduplicate a verified physical trip", () => {
  const source = data();
  const index = buildServiceTripIndex({ byLanding: new Map([[16, source], [17, source]]), stops });
  assert.equal(index.trips.get("77").length, 2);
  assert.equal(index.trips.has("88"), false);
});
