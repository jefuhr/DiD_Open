import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { timelineDepartures, zonedParts, scheduleRange, confirmedCrewCoverage } from "../public/assets/schedule.js";
import { createScheduleStore } from "../public/assets/schedule-store.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/schedule-contract.json", import.meta.url)));
test("timetable-only departures cannot inherit live delays, cancellations, or vessel predictions", () => {
  const data = structuredClone(fixture.schedule);
  const trip = data.departures[0];
  trip.scheduleOnly = true;
  const realtime = { stale: false, available: true,
    updates: [{ tripId: trip.tripId, stopId: trip.stopId, delaySeconds: 600, canceled: true }],
    vehicles: [{ tripId: trip.tripId, boat: "ER1", boatName: "Not a holiday assignment" }] };
  const row = timelineDepartures({ data, realtime, now: new Date(fixture.cases[0].now) })
    .find(({ departure }) => departure.tripId === trip.tripId).departure;
  assert.equal(row.delay, 0);
  assert.equal(row.hasLiveTiming, false);
  assert.equal(row.boatName, null);
  assert.equal(row.predictedBoatName, null);
});

test("portable crew confirmation follows day type, exclusions, and season boundaries", () => {
  const data = structuredClone(fixture.schedule);
  data.meta.crewScheduleStatus = { status: "unconfirmed",
    confirmedWeekdays: { startDate: "2026-09-14", endDate: "2026-11-01", excludedDates: ["2026-09-28"] },
    confirmedWeekends: { startDate: "2026-09-19", endDate: "2026-11-01", excludedDates: [] } };
  data.departures[0].endsShift = "confirmed";
  for (const [date, expected] of [["2026-09-13", false], ["2026-09-14", true], ["2026-09-19", true],
    ["2026-09-20", true], ["2026-09-28", false], ["2026-11-02", false]]) {
    assert.equal(Boolean(confirmedCrewCoverage(data, date)), expected, date);
    const row = timelineDepartures({ data, realtime: { stale: true }, now: new Date(`${date}T12:50:00Z`) })
      .find(({ departure }) => departure.tripId === data.departures[0].tripId).departure;
    assert.equal(row.endsShift, expected ? "confirmed" : null, date);
  }
});

test("dated additions establish coverage even without a regular calendar", () => {
  assert.deepEqual(scheduleRange({ calendars: [], exceptions: [
    { date: "2026-12-25", added: true }, { date: "2027-01-01", added: false }
  ] }), { first: "2026-12-25", last: "2026-12-25" });
});
for (const scenario of fixture.cases) {
  test(`portable schedule contract: ${scenario.id}`, () => {
    const actual = timelineDepartures({ data: fixture.schedule, ...scenario, now: new Date(scenario.now) })
      .map(({ departure }) => Object.fromEntries(Object.keys(scenario.expected[0] || {}).map(key => [key, departure[key]])));
    assert.deepEqual(actual, scenario.expected);
  });
}
for (const scenario of fixture.timezones) {
  test(`local service clock: ${scenario.now}`, () => {
    assert.deepEqual(zonedParts(new Date(scenario.now), "America/New_York"), { dateKey: scenario.dateKey, seconds: scenario.seconds });
  });
}
test("saved schedules are isolated by landing and remain calculable offline", () => {
  const values = new Map();
  const storage = { json: key => JSON.parse(values.get(key) || "null"), setItem: (key, value) => values.set(key, value) };
  const store = createScheduleStore({ storage, prefix: "test" });
  store.write(fixture.schedule);
  assert.equal(store.read(2), null);
  const data = store.read(16);
  assert.deepEqual(data, fixture.schedule);
  const morning = timelineDepartures({ data, ...fixture.cases[0], now: new Date(fixture.cases[0].now) });
  const later = timelineDepartures({ data, ...fixture.cases[1], now: new Date(fixture.cases[1].now) });
  assert.ok(later.length < morning.length);
});
