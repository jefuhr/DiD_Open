import test from "node:test";
import assert from "node:assert/strict";
import { mergeVehicleAssignments, normalizeTripUpdates, normalizeVehicleAssignments } from "../lib/realtime.js";

test("normalizes only updates for the configured landing", () => {
  const feed = { entity: [{ tripUpdate: { trip: { tripId: "trip-1" }, delay: 120, stopTimeUpdate: [
    { stopId: "87", departure: { delay: 180, time: 1234 } },
    { stopId: "17", departure: { delay: 60 } }
  ] } }] };
  assert.deepEqual(normalizeTripUpdates(feed, ["87"]), [{
    tripId: "trip-1", stopId: "87", delaySeconds: 180,
    predictedEpochSeconds: 1234, canceled: false
  }]);
});

test("derives a landing delay from a predicted time when protobuf delay is absent", () => {
  const predictedEpochSeconds = Date.parse("2026-07-17T22:01:21Z") / 1000;
  const predictedDeparture = Object.assign(Object.create({ delay: 0 }), {
    time: predictedEpochSeconds
  });
  const feed = { entity: [{ tripUpdate: {
    trip: { tripId: "trip-857" },
    stopTimeUpdate: [{ stopId: "11", departure: predictedDeparture }]
  } }] };
  assert.deepEqual(normalizeTripUpdates(feed, ["11"], {
    departures: [{ tripId: "trip-857", stopId: "11", seconds: 17 * 3600 + 58 * 60 }],
    timeZone: "America/New_York"
  }), [{
    tripId: "trip-857",
    stopId: "11",
    delaySeconds: 201,
    predictedEpochSeconds,
    canceled: false
  }]);
});

test("uses the nearest predicted stop for an active trip without a landing update", () => {
  const predictedEpochSeconds = Date.parse("2026-07-17T22:03:00Z") / 1000;
  const predictedDeparture = Object.assign(Object.create({ delay: 0 }), {
    time: predictedEpochSeconds
  });
  const feed = { entity: [{ tripUpdate: {
    trip: { tripId: "active-trip" },
    stopTimeUpdate: [{ stopId: "17", stopSequence: 1, departure: predictedDeparture }]
  } }] };
  assert.deepEqual(normalizeTripUpdates(feed, ["11"], {
    departures: [{ tripId: "active-trip", stopId: "11", seconds: 18 * 3600 + 24 * 60 }],
    tripSchedules: {
      "active-trip": { stops: [
        { stopId: "17", sequence: 1, departureSeconds: 18 * 3600, arrivalSeconds: 18 * 3600 },
        { stopId: "11", sequence: 4, departureSeconds: 18 * 3600 + 24 * 60, arrivalSeconds: 18 * 3600 + 24 * 60 }
      ] }
    },
    timeZone: "America/New_York"
  }), [{
    tripId: "active-trip",
    stopId: "11",
    delaySeconds: 180,
    predictedEpochSeconds: null,
    canceled: false
  }]);
});

test("matches a live vehicle assignment to its boat name", () => {
  const feed = { entity: [{ vehicle: {
    trip: { tripId: "trip-1" },
    vehicle: { id: "H101", label: "H101" },
    timestamp: 1234
  } }] };
  const fleet = [{ id: "waves-of-wonder", name: "Waves of Wonder", number: "H-101" }];
  assert.deepEqual(normalizeVehicleAssignments(feed, fleet), [{
    tripId: "trip-1", boatName: "Waves of Wonder", vesselNumber: "H-101", updatedAtEpochSeconds: 1234
  }]);
});

test("reads vessel assignments embedded in trip updates", () => {
  const feed = { entity: [{ tripUpdate: {
    trip: { tripId: "terminal-trip" },
    vehicle: { id: "51", label: "H119" },
    timestamp: 5678,
    stopTimeUpdate: [{ stopId: "17", arrival: { time: 6000 } }]
  } }] };
  const fleet = [{ id: "dream-boat", name: "Dream Boat", number: "H-119" }];
  assert.deepEqual(normalizeVehicleAssignments(feed, fleet), [{
    tripId: "terminal-trip", boatName: "Dream Boat", vesselNumber: "H-119", updatedAtEpochSeconds: 5678
  }]);
});

test("merges trip-update and vehicle-position assignments", () => {
  const tripAssignments = [
    { tripId: "terminal-trip", boatName: "Dream Boat", vesselNumber: "H-119", updatedAtEpochSeconds: 100 },
    { tripId: "shared-trip", boatName: "Older Name", vesselNumber: "H-101", updatedAtEpochSeconds: 100 }
  ];
  const positionAssignments = [
    { tripId: "shared-trip", boatName: "Waves of Wonder", vesselNumber: "H-101", updatedAtEpochSeconds: 200 }
  ];
  assert.deepEqual(mergeVehicleAssignments(tripAssignments, positionAssignments), [
    tripAssignments[0], positionAssignments[0]
  ]);
});
