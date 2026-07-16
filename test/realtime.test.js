import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTripUpdates, normalizeVehicleAssignments } from "../lib/realtime.js";

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
