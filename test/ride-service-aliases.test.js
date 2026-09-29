import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRideService, serviceEpoch } from "../lib/ride.js";
import { buildDisplayData } from "../lib/schedule-builder.js";

const fleet = [{ id: "opportunity", name: "Opportunity", number: "H-204" }];
const dates = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"];
const calls = [{ stopId: "a", sequence: 1, arrivalSeconds: 36000, departureSeconds: 36120 },
  { stopId: "b", sequence: 2, arrivalSeconds: 37200, departureSeconds: 37260 }];
function data() {
  const holidayTrip = { liveTripId: "841", stops: calls,
    turnaround: { stopId: "b", nextTripId: "nyc:sukkot:trip:842", nextLiveTripId: "842", scheduledLayoverSeconds: 300 } };
  return {
    meta: { timezone: "America/New_York" },
    calendars: [{ serviceId: "ordinary", startDate: "2026-09-01", endDate: "2026-11-01", weekdays: Array(7).fill(true) }],
    exceptions: dates.flatMap(date => [{ serviceId: "ordinary", date, added: false }, { serviceId: "holiday", date, added: true }]),
    routes: { ER: { shortName: "ER" }, AS: { shortName: "AS" } },
    stops: { a: { name: "Pier 11", landingId: 16 }, b: { name: "East 34th", landingId: 8 }, old: { name: "Wrong ordinary landing" } },
    departures: [
      { tripId: "841", liveTripId: "1841", routeId: "ER", serviceId: "ordinary", seconds: 28800, stopId: "old" },
      { tripId: "nyc:sukkot:row:a", liveTripId: "841", routeId: "AS", serviceId: "holiday", seconds: 36120, stopId: "a", scheduleOnly: true },
      { tripId: "nyc:sukkot:row:b", liveTripId: "841", routeId: "AS", serviceId: "holiday", seconds: 37260, stopId: "b", scheduleOnly: true },
      { tripId: "nyc:sukkot:row:return", liveTripId: "842", routeId: "AS", serviceId: "holiday", seconds: 37500, stopId: "b", scheduleOnly: true }
    ],
    tripSchedules: {
      "841": { stops: [{ stopId: "old", sequence: 1, arrivalSeconds: 28800, departureSeconds: 28800 }, { stopId: "old", sequence: 2, arrivalSeconds: 30000, departureSeconds: 30000 }] },
      "nyc:sukkot:row:a": holidayTrip,
      "nyc:sukkot:row:b": holidayTrip,
      "nyc:sukkot:trip:842": { liveTripId: "842", stops: [{ stopId: "b", sequence: 1, arrivalSeconds: 37500, departureSeconds: 37500 }, { stopId: "a", sequence: 2, arrivalSeconds: 39000, departureSeconds: 39000 }] },
      "nyc:sukkot:row:return": { liveTripId: "842", stops: [{ stopId: "b", sequence: 1, arrivalSeconds: 37500, departureSeconds: 37500 }, { stopId: "a", sequence: 2, arrivalSeconds: 39000, departureSeconds: 39000 }] }
    }
  };
}
function position(date, tripId = "841", at = Date.parse(`${date}T14:10:00Z`)) {
  return { entity: [{ vehicle: { trip: { tripId, startDate: date.replaceAll("-", "") }, vehicle: { id: "H204" },
    timestamp: at / 1000, currentStopSequence: 2, currentStatus: 2, position: { latitude: 40.7, longitude: -74 } } }] };
}
async function service(t, payload = data()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ferry-ride-alias-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { fleet, byLanding: new Map([[16, payload]]), historyPath: path.join(directory, "history.json") };
  return { ride: await createRideService(options), options };
}

test("all five Sukkot dates resolve a numeric feed ID to verified holiday calls, not an old fall trip", async t => {
  const { ride } = await service(t);
  for (const date of dates) {
    const now = Date.parse(`${date}T14:10:00Z`);
    const update = { entity: [{ tripUpdate: { trip: { tripId: "841", startDate: date.replaceAll("-", "") },
      vehicle: { id: "H204" }, timestamp: now / 1000,
      stopTimeUpdate: [{ stopId: "b", stopSequence: 2, arrival: { delay: 120 }, departure: { delay: 300 } }] } }] };
    await ride.observe({ feed: update, vehicleFeed: position(date), now });
    const snapshot = ride.describe("opportunity", now);
    assert.equal(snapshot.trips.length, 1, "Repeated displayed columns for one feed trip must stay one assignment");
    assert.equal(snapshot.trips[0].tripId, "841");
    assert.equal(snapshot.trips[0].route, "AS");
    assert.equal(snapshot.trips[0].serviceDate, date);
    assert.deepEqual(snapshot.trips[0].stops.map(stop => stop.stopId), ["a", "b"]);
    assert.equal(snapshot.nextStop.estimatedArrivalSeconds, 37320);
    assert.equal(snapshot.nextStop.estimatedDepartureSeconds, 37560);
  }
});

test("ordinary mapped IDs recover their own service after Sukkot and persist correctly", async t => {
  const { ride, options } = await service(t);
  const now = Date.parse("2026-10-05T14:10:00Z");
  await ride.observe({ vehicleFeed: position("2026-10-05", "1841", now), now });
  const restored = await createRideService(options);
  const trip = restored.describe("opportunity", now).trips[0];
  assert.equal(trip.tripId, "1841");
  assert.equal(trip.route, "ER");
  assert.equal(trip.stops[0].arrivalSeconds, 28800);
});

test("mapped holiday overnight calls infer yesterday's service date without startDate", async t => {
  const payload = data();
  for (const key of ["nyc:sukkot:row:a", "nyc:sukkot:row:b"]) payload.tripSchedules[key] = {
    liveTripId: "841", stops: [{ stopId: "a", sequence: 1, departureSeconds: 87000 }, { stopId: "b", sequence: 2, arrivalSeconds: 88200 }]
  };
  const { ride } = await service(t, payload);
  const now = Date.parse("2026-10-03T04:20:00Z"), source = position("2026-10-03", "841", now);
  delete source.entity[0].vehicle.trip.startDate;
  await ride.observe({ vehicleFeed: source, now });
  const trip = ride.describe("opportunity", now).trips[0];
  assert.equal(trip.serviceDate, "2026-10-02");
  assert.equal(trip.stops[1].arrivalAt, serviceEpoch("2026-10-02", 88200));
});

test("mapped terminal layovers require confirmation of the next feed trip on the same vessel", async t => {
  const { ride } = await service(t);
  const date = dates[0], now = Date.parse(`${date}T14:10:00Z`);
  await ride.observe({ vehicleFeed: position(date), now });
  assert.equal(ride.describe("opportunity", now).trips[0].stops.at(-1).layoverSeconds, undefined);
  const both = position(date);
  both.entity.push(...position(date, "842").entity);
  await ride.observe({ vehicleFeed: both, now });
  assert.equal(ride.describe("opportunity", now).trips[0].stops.at(-1).layoverSeconds, 300);
});

test("unverified or ambiguous holiday schedules never borrow another trip's calls", async t => {
  const payload = data();
  payload.departures.push({ tripId: "unverified", routeId: "AS", serviceId: "holiday", scheduleOnly: true });
  payload.tripSchedules.unverified = { timetableOnly: true, stops: [{ stopId: "a", sequence: 1, departureSeconds: 36000 }] };
  payload.tripSchedules["nyc:sukkot:row:b"] = { liveTripId: "841", stops: [{ stopId: "old", sequence: 1, departureSeconds: 36000 }] };
  const { ride } = await service(t, payload);
  const date = dates[0], now = Date.parse(`${date}T14:10:00Z`), source = position(date);
  source.entity.push(...position(date, "unverified").entity);
  await ride.observe({ vehicleFeed: source, now });
  const trips = ride.describe("opportunity", now).trips;
  assert.equal(trips.length, 2, "Keep actual feed-confirmed assignments even when their schedule is unavailable");
  assert.ok(trips.every(trip => trip.stops.length === 0));
  assert.ok(trips.every(trip => trip.route === "Ferry"));
});

test("verified schedule metadata supports a confirmed trip with no boarding row", async t => {
  const payload = data();
  payload.tripSchedules["nyc:sukkot:trip:900"] = { liveTripId: "900", serviceId: "holiday", routeId: "AS", boatAssignment: 3,
    stops: [{ stopId: "a", sequence: 1, arrivalSeconds: 36000, departureSeconds: 36120, pickupType: 1 },
      { stopId: "b", sequence: 2, arrivalSeconds: 37200, departureSeconds: 37260, pickupType: 1, dropOffType: 0 }] };
  const { ride } = await service(t, payload);
  const date = dates[0], now = Date.parse(`${date}T14:10:00Z`);
  await ride.observe({ vehicleFeed: position(date, "900"), now });
  const trip = ride.describe("opportunity", now).trips[0];
  assert.equal(trip.route, "AS");
  assert.equal(trip.boatAssignment, 3);
  assert.equal(trip.stops[0].pickupType, 1);
  assert.equal(trip.stops[1].dropOffType, 0);
});

test("PDF-restored dwell keeps arrival estimates on the feed clock and stale times on the published clock", async t => {
  const payload = structuredClone(data());
  for (const key of ["nyc:sukkot:row:a", "nyc:sukkot:row:b"]) {
    payload.tripSchedules[key].stops[1].arrivalSeconds = 36900;
    payload.tripSchedules[key].stops[1].feedArrivalSeconds = 37200;
  }
  const { ride } = await service(t, payload);
  const date = dates[0], now = Date.parse(`${date}T14:10:00Z`);
  const stop = { stopId: "b", stopSequence: 2, arrival: { delay: 0 }, departure: { delay: 0 } };
  const update = { entity: [{ tripUpdate: { trip: { tripId: "841", startDate: date.replaceAll("-", "") },
    vehicle: { id: "H204" }, timestamp: now / 1000, stopTimeUpdate: [stop] } }] };
  await ride.observe({ feed: update, vehicleFeed: position(date), now });
  let result = ride.describe("opportunity", now).trips[0].stops[1];
  assert.equal(result.arrivalSeconds, 36900, "Keep the published arrival and five-minute dwell");
  assert.equal(result.estimatedArrivalSeconds, 37200, "Zero delay refers to GTFS's original arrival clock");
  assert.equal(result.estimatedDepartureSeconds, 37260);
  stop.arrival.time = serviceEpoch(date, 37440) / 1000;
  await ride.observe({ feed: update, vehicleFeed: position(date), now });
  assert.equal(ride.describe("opportunity", now).trips[0].stops[1].estimatedArrivalSeconds, 37440,
    "An absolute time takes precedence over a simultaneous delay field");
  delete stop.arrival.time;
  stop.arrival.delay = -60;
  await ride.observe({ feed: update, vehicleFeed: position(date), now });
  assert.equal(ride.describe("opportunity", now).trips[0].stops[1].estimatedArrivalSeconds, 37140);
  result = ride.describe("opportunity", now + 181000).trips[0].stops[1];
  assert.equal(result.estimatedArrivalSeconds, null);
  assert.equal(result.arrivalAt, serviceEpoch(date, 36900), "A stale feed falls back to the corrected published arrival");
});

test("actual Sukkot service resolves every verified trip in four major landing payloads", async t => {
  const byLanding = new Map(await Promise.all([8, 16, 18, 26].map(async landingNumber =>
    [landingNumber, await buildDisplayData({ landingNumber, busesEnabled: true })])));
  const expected = new Map();
  for (const payload of byLanding.values()) for (const schedule of Object.values(payload.tripSchedules)) {
    if (schedule.serviceId === "nyc:sukkot:2026" && schedule.liveTripId && !schedule.timetableOnly) expected.set(schedule.liveTripId, schedule);
  }
  assert.ok(expected.size > 250, "Exercise the actual verified ferry and shuttle trip set");
  const { options } = await service(t);
  const ride = await createRideService({ ...options, byLanding });
  const date = dates[0], now = Date.parse(`${date}T14:10:00Z`);
  const vehicleFeed = { entity: [...expected.keys()].flatMap(id => position(date, id).entity) };
  await ride.observe({ vehicleFeed, now });
  const trips = ride.describe("opportunity", now).trips;
  assert.equal(trips.length, expected.size);
  for (const trip of trips) {
    const schedule = expected.get(trip.tripId);
    assert.equal(trip.routeId, schedule.routeId, trip.tripId);
    assert.equal(trip.boatAssignment, schedule.boatAssignment ?? null, trip.tripId);
    assert.deepEqual(trip.stops.map(({ stopId, sequence, arrivalSeconds, departureSeconds, pickupType, dropOffType }) =>
      ({ stopId, sequence, arrivalSeconds, departureSeconds, pickupType, dropOffType })),
    schedule.stops.map(({ stopId, sequence, arrivalSeconds, departureSeconds, pickupType, dropOffType }) =>
      ({ stopId, sequence, arrivalSeconds, departureSeconds, pickupType, dropOffType })), trip.tripId);
  }
});
