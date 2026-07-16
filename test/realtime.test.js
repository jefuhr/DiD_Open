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
