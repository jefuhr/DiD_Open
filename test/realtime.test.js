import test from "node:test";
import assert from "node:assert/strict";
import { boatByTrip, mergeVehicleAssignments, normalizeTripUpdates, normalizeVehicleAssignments, withBoatAssignments } from "../lib/realtime.js";

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

test("never exposes a rider departure earlier than the static schedule", () => {
  const feed = { entity: [{ tripUpdate: {
    trip: { tripId: "early-trip" },
    stopTimeUpdate: [{ stopId: "20", departure: { delay: -300 } }]
  } }] };
  assert.deepEqual(normalizeTripUpdates(feed, ["20"]), [{
    tripId: "early-trip",
    stopId: "20",
    delaySeconds: 0,
    predictedEpochSeconds: null,
    canceled: false
  }]);
});

test("clamps an early absolute arrival prediction used as a departure fallback", () => {
  const predictedEpochSeconds = Date.parse("2026-07-17T21:55:00Z") / 1000;
  const feed = { entity: [{ tripUpdate: {
    trip: { tripId: "early-arrival-trip" },
    stopTimeUpdate: [{ stopId: "20", arrival: { time: predictedEpochSeconds } }]
  } }] };
  assert.deepEqual(normalizeTripUpdates(feed, ["20"], {
    departures: [{ tripId: "early-arrival-trip", stopId: "20", seconds: 18 * 3600 }],
    timeZone: "America/New_York"
  }), [{
    tripId: "early-arrival-trip",
    stopId: "20",
    delaySeconds: 0,
    predictedEpochSeconds,
    canceled: false
  }]);
});

test("clamps an early delay inherited from another stop", () => {
  const feed = { entity: [{ tripUpdate: {
    trip: { tripId: "early-fallback-trip" },
    stopTimeUpdate: [{ stopId: "17", departure: { delay: -180 } }]
  } }] };
  assert.deepEqual(normalizeTripUpdates(feed, ["11"], {
    departures: [{ tripId: "early-fallback-trip", stopId: "11", seconds: 18 * 3600 + 24 * 60 }],
    tripSchedules: {
      "early-fallback-trip": { stops: [
        { stopId: "17", sequence: 1, departureSeconds: 18 * 3600, arrivalSeconds: 18 * 3600 },
        { stopId: "11", sequence: 4, departureSeconds: 18 * 3600 + 24 * 60, arrivalSeconds: 18 * 3600 + 24 * 60 }
      ] }
    }
  }), [{
    tripId: "early-fallback-trip",
    stopId: "11",
    delaySeconds: 0,
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

// The feed names a vessel only for trips it has reached, so a sailing later today has none of its
// own. The workbook says which boat runs it, and that boat is out on the water right now under a
// vessel the feed has named - so pairing trip to boat is what lets the board predict the rest.
test("vehicles carry the boat they are working, so later sailings can be predicted", () => {
  const departures = [
    { tripId: "340", routeId: "ER", boatAssignment: 3 },
    { tripId: "416", routeId: "ER", boatAssignment: 3 },
    { tripId: "900", routeId: "SB", boatAssignment: 1 },
    // Partner operators publish no crew assignments, and a crew shuttle is not a boat working.
    { tripId: "wtr:12", routeId: "wtr:HOB", boatAssignment: null },
    { tripId: "crew:weekday:16:12:45", routeId: "CREW", boatAssignment: null }
  ];
  const byTrip = boatByTrip(departures);
  assert.equal(byTrip.get("340"), "ER3");
  assert.equal(byTrip.get("900"), "SB1");
  assert.equal(byTrip.has("wtr:12"), false, "a partner trip names no boat");
  assert.equal(byTrip.has("crew:weekday:16:12:45"), false, "a crew shuttle names no boat");

  const tagged = withBoatAssignments([
    { tripId: "340", boatName: "McShane" },
    { tripId: "wtr:12", boatName: "Molly Pitcher" }
  ], byTrip);
  assert.deepEqual(tagged[0], { tripId: "340", boatName: "McShane", boat: "ER3" });
  // Untouched rather than dropped: the vessel is still worth showing on the trip it is actually on.
  assert.deepEqual(tagged[1], { tripId: "wtr:12", boatName: "Molly Pitcher" });

  // Built from the merged view of every landing, a Pier C row's own id resolves to nothing - which
  // is why the boat has to come from the trips, not from the row being displayed.
  assert.equal(boatByTrip([{ tripId: "pierc:weekday:ER1:15:46", routeId: "ER", boatAssignment: 1 }]).get("pierc:weekday:ER1:15:46"), "ER1");
});
