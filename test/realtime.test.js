import test from "node:test";
import assert from "node:assert/strict";
import { boatByTrip, mergeVehicleAssignments, normalizeTripUpdates, normalizeVehicleAssignments, normalizeVehiclePositions, withBoatAssignments } from "../lib/realtime.js";

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

// A home-port run's own trip id is minted by the build, so no feed entity ever carries it and the
// row could not inherit its own boat's lateness. It names the revenue trip it comes off instead,
// and that is what puts the trip's terminating stop — one it arrives at and never departs from, so
// nothing else asks for it — into the stops worth reporting.
test("a home-port run inherits the live timing of the trip it comes off", () => {
  const feed = { entity: [{ tripUpdate: {
    trip: { tripId: "final-trip" },
    stopTimeUpdate: [{ stopId: "11", arrival: { delay: 720 } }]
  } }] };
  assert.deepEqual(normalizeTripUpdates(feed, ["11"], {
    departures: [{
      tripId: "oos:final-trip", liveTripId: "final-trip", stopId: "11",
      seconds: 18 * 3600 + 24 * 60
    }],
    tripSchedules: {
      "final-trip": { stops: [
        { stopId: "17", sequence: 1, departureSeconds: 18 * 3600, arrivalSeconds: 18 * 3600 },
        { stopId: "11", sequence: 4, departureSeconds: null, arrivalSeconds: 18 * 3600 + 24 * 60 }
      ] }
    }
  }), [{
    tripId: "final-trip",
    stopId: "11",
    delaySeconds: 720,
    predictedEpochSeconds: null,
    canceled: false
  }]);
});

// The terminus is the one call a feed is likeliest to stop short of, and it is the only call a
// home-port run has. So the trip-level delay has to carry it, exactly as it already carries any
// other stop the feed has not reached.
test("a home-port run falls back to the trip's delay when the feed stops short of the terminus", () => {
  const feed = { entity: [{ tripUpdate: {
    trip: { tripId: "short-feed-trip" }, delay: 480,
    stopTimeUpdate: [{ stopId: "17", departure: { delay: 480 } }]
  } }] };
  assert.deepEqual(normalizeTripUpdates(feed, ["11"], {
    departures: [{
      tripId: "oos:short-feed-trip", liveTripId: "short-feed-trip", stopId: "11",
      seconds: 18 * 3600 + 24 * 60
    }]
  }), [{
    tripId: "short-feed-trip",
    stopId: "11",
    delaySeconds: 480,
    predictedEpochSeconds: null,
    canceled: false
  }]);
});

// A crew shuttle is in no feed and has no boat behind it whose lateness would mean anything, so it
// names no live trip and picks up nothing — not even from a boat tying up at the same pier.
test("a crew shuttle at the same pier is not given the passing trip's delay", () => {
  const feed = { entity: [{ tripUpdate: {
    trip: { tripId: "final-trip" }, delay: 600,
    stopTimeUpdate: [{ stopId: "11", arrival: { delay: 600 } }]
  } }] };
  const updates = normalizeTripUpdates(feed, ["11"], {
    departures: [
      { tripId: "crew:weekday:16:14:35", stopId: "11", seconds: 14 * 3600 + 35 * 60 },
      { tripId: "oos:final-trip", liveTripId: "final-trip", stopId: "11", seconds: 18 * 3600 + 24 * 60 }
    ]
  });
  assert.deepEqual(updates.map((item) => item.tripId), ["final-trip"]);
  assert.equal(updates[0].delaySeconds, 600);
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

test("reads where each boat is, and which vessel it is", () => {
  const feed = { entity: [{
    id: "19",
    vehicle: {
      trip: { tripId: "863" },
      position: { latitude: 40.636817, longitude: -74.060089, speed: 13 },
      currentStopSequence: 4,
      currentStatus: 2,
      timestamp: 1_788_313_309,
      vehicle: { id: "19", label: "H204" }
    }
  }] };
  const fleet = [{ id: "opportunity", name: "Opportunity", number: "H-204" }];
  assert.deepEqual(normalizeVehiclePositions(feed, fleet), [{
    id: "19",
    tripId: "863",
    latitude: 40.636817,
    longitude: -74.060089,
    bearing: null,
    speed: 13,
    status: "in-transit",
    stopSequence: 4,
    boatName: "Opportunity",
    vesselNumber: "H-204",
    updatedAtEpochSeconds: 1_788_313_309
  }]);
});

// Protobuf serves an unset optional field from the prototype as its zero, and this vendor never
// sets bearing. Read at face value that is not "heading unknown", it is the entire fleet steaming
// due north, which is the kind of wrong that looks deliberate on a map.
test("an unset bearing is no heading rather than north", () => {
  const position = Object.assign(Object.create({ bearing: 0, odometer: 0 }), { latitude: 40.7, longitude: -74.01, speed: 4 });
  const vehicle = Object.assign(Object.create({ currentStopSequence: 0 }), {
    trip: { tripId: "1" }, position, currentStatus: "STOPPED_AT", timestamp: 10, vehicle: { id: "7", label: "H119" }
  });
  const [boat] = normalizeVehiclePositions({ entity: [{ id: "7", vehicle }] }, []);
  assert.equal(boat.bearing, null);
  assert.equal(boat.stopSequence, null, "an unset sequence points at no stop rather than at stop zero");
  assert.equal(boat.speed, 4);
  // The enum arrives as a number from protobuf and as its name from anything hand-written.
  assert.equal(boat.status, "stopped");
  // No fleet match, so the feed's own label stands in rather than the boat going unnamed.
  assert.equal(boat.boatName, "H119");
});

test("a vehicle the feed cannot place is not on the map", () => {
  const feed = { entity: [
    { id: "1", vehicle: { trip: { tripId: "a" }, timestamp: 1, vehicle: { id: "1", label: "H101" } } },
    { id: "2", vehicle: { trip: { tripId: "b" }, position: { latitude: 40.7, longitude: -74 }, timestamp: 2, vehicle: { id: "2", label: "H102" } } }
  ] };
  assert.deepEqual(normalizeVehiclePositions(feed, []).map((boat) => boat.id), ["2"]);
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
