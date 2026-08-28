import test from "node:test";
import assert from "node:assert/strict";

import { activeServices, clampLimit, createConnectionIndex, nextDepartures, tripConnections, vesselsByBoat } from "../lib/connections.js";

// lib/connections.js is a port of scheduling rules that already exist in public/app.js, so these
// tests are about the rules themselves rather than about the endpoint. Everything else in the trip
// view fails loudly; this is the part that fails by quietly offering a boat that is not running.

const WEEKDAY = { serviceId: "wk", weekdays: [false, true, true, true, true, true, false], startDate: "2026-01-01", endDate: "2027-12-31" };
const WEEKEND = { serviceId: "we", weekdays: [true, false, false, false, false, false, true], startDate: "2026-01-01", endDate: "2027-12-31" };

const departure = (overrides = {}) => ({
  tripId: "t1", routeId: "ER", serviceId: "wk", directionId: "1", stopId: "87",
  departureTime: "12:00:00", seconds: 43200, destination: "Astoria",
  outOfService: false, crewShuttle: false, arrival: false, ...overrides
});

function index(departures, extra = {}) {
  return createConnectionIndex(new Map([[16, {
    meta: { timezone: "America/New_York" },
    calendars: [WEEKDAY, WEEKEND],
    // Labor Day: the weekend pattern is added and the weekday one pulled. Both halves matter.
    exceptions: [
      { serviceId: "we", date: "2026-09-07", added: true },
      { serviceId: "wk", date: "2026-09-07", added: false }
    ],
    routes: { ER: { shortName: "ER", color: "#00839C", textColor: "#FFFFFF", operator: "NYC Ferry" } },
    stops: { 87: { name: "Wall St/Pier 11", landingId: 16, hub: true }, 18: { name: "Greenpoint", landingId: 12 }, bus1: { name: "Beach 108 St", landingId: null } },
    tripSchedules: {
      t1: { stops: [
        { stopId: "87", sequence: 1, departureSeconds: 43200, arrivalSeconds: 43200 },
        { stopId: "18", sequence: 2, departureSeconds: 44100, arrivalSeconds: 44100 }
      ] },
      solo: { stops: [{ stopId: "87", sequence: 1, departureSeconds: 43200, arrivalSeconds: 43200 }] }
    },
    departures,
    ...extra
  }]]));
}

// A weekday board must not offer weekend boats and vice versa, and a holiday runs the weekend
// pattern even though the date is a Monday. Get this wrong and the trip view invents service.
test("only the services running that day are offered", () => {
  const view = index([
    departure({ tripId: "weekdayBoat", serviceId: "wk" }),
    departure({ tripId: "weekendBoat", serviceId: "we" })
  ]);

  const onWeekday = nextDepartures({ index: view, stopId: "87", now: new Date("2026-08-27T15:00:00Z"), limit: 4 });
  assert.deepEqual(onWeekday.map((item) => item.tripId), ["weekdayBoat"], "Thursday runs the weekday boat only");

  const onSaturday = nextDepartures({ index: view, stopId: "87", now: new Date("2026-08-29T15:00:00Z"), limit: 4 });
  assert.deepEqual(onSaturday.map((item) => item.tripId), ["weekendBoat"], "Saturday runs the weekend boat only");

  // Labor Day 2026 is a Monday running Sunday service.
  const onLabourDay = nextDepartures({ index: view, stopId: "87", now: new Date("2026-09-07T15:00:00Z"), limit: 4 });
  assert.deepEqual(onLabourDay.map((item) => item.tripId), ["weekendBoat"],
    "the holiday adds the weekend service and removes the weekday one");
});

test("activeServices applies removals after additions", () => {
  const view = index([]);
  assert.deepEqual([...activeServices(view, "2026-08-27")], ["wk"]);
  assert.deepEqual([...activeServices(view, "2026-09-07")], ["we"]);
  // Asked twice, cached, and still right.
  assert.deepEqual([...activeServices(view, "2026-09-07")], ["we"]);
});

// GTFS writes a 1:10am boat as 25:10 on the previous service day. Without the offset loop the first
// hour after midnight is silently empty.
test("a sailing published past midnight belongs to the day it actually sails", () => {
  const view = index([departure({ tripId: "lateBoat", departureTime: "25:10:00", seconds: 90600 })]);
  // 00:30 on Friday: the boat is yesterday's 25:10 and is twenty minutes away.
  const found = nextDepartures({ index: view, stopId: "87", now: new Date("2026-08-28T04:30:00Z"), limit: 4 });
  assert.deepEqual(found.map((item) => item.tripId), ["lateBoat"]);
  assert.equal(found[0].deltaSeconds, 40 * 60);
  // Asked about now, the board's own rule applies: today's sailings only, so the same boat is not
  // also offered twenty-five hours out.
  const evening = nextDepartures({ index: view, stopId: "87", now: new Date("2026-08-28T22:00:00Z"), limit: 4 });
  assert.deepEqual(evening.map((item) => item.tripId), []);
});

test("a boat just gone is still offered; one long gone is not", () => {
  const view = index([departure({ tripId: "boat", seconds: 43200, departureTime: "12:00:00" })]);
  const at30s = nextDepartures({ index: view, stopId: "87", now: new Date("2026-08-27T16:00:30Z"), limit: 4 });
  assert.deepEqual(at30s.map((item) => item.tripId), ["boat"], "30 seconds gone is still catchable");
  const at90s = nextDepartures({ index: view, stopId: "87", now: new Date("2026-08-27T16:01:30Z"), limit: 4 });
  assert.deepEqual(at90s.map((item) => item.tripId), [], "90 seconds gone is not");
});

test("live timing moves a boat later but never earlier", () => {
  const view = index([departure({ tripId: "boat" })]);
  const now = new Date("2026-08-27T15:50:00Z"); // ten minutes before the 12:00
  const late = nextDepartures({
    index: view, stopId: "87", now, limit: 4,
    updates: new Map([["boat|87", { delaySeconds: 300 }]])
  });
  assert.equal(late[0].deltaSeconds, 900, "a five minute delay pushes the countdown out");
  assert.equal(late[0].delaySeconds, 300);
  assert.equal(late[0].hasLiveTiming, true);

  // A feed reporting a boat ahead of schedule must not advertise an early departure.
  const early = nextDepartures({
    index: view, stopId: "87", now, limit: 4,
    updates: new Map([["boat|87", { delaySeconds: -300 }]])
  });
  assert.equal(early[0].deltaSeconds, 600, "running early does not move the published time");

  // A stale feed is not live timing at all.
  const stale = nextDepartures({
    index: view, stopId: "87", now, limit: 4, stale: true,
    updates: new Map([["boat|87", { delaySeconds: 300 }]])
  });
  assert.equal(stale[0].hasLiveTiming, false);
  assert.equal(stale[0].delaySeconds, null);
  assert.equal(stale[0].deltaSeconds, 600);
});

test("a cancelled sailing is not a connection", () => {
  const view = index([departure({ tripId: "boat" })]);
  const found = nextDepartures({
    index: view, stopId: "87", now: new Date("2026-08-27T15:50:00Z"), limit: 4,
    updates: new Map([["boat|87", { canceled: true }]])
  });
  assert.deepEqual(found, []);
});

// A connection is something a passenger can board. A boat going home empty, a crew shuttle and an
// arrival are all on the board for the crew's sake and none of them can be got on.
test("boats nobody can board are never offered as connections", () => {
  const view = index([
    departure({ tripId: "home", outOfService: true }),
    departure({ tripId: "shuttle", crewShuttle: true }),
    departure({ tripId: "arrives", arrival: true }),
    departure({ tripId: "real" })
  ]);
  const found = nextDepartures({ index: view, stopId: "87", now: new Date("2026-08-27T15:50:00Z"), limit: 4 });
  assert.deepEqual(found.map((item) => item.tripId), ["real"]);
});

test("the vessel is carried when the feed knows it, and left null when it does not", () => {
  const view = index([departure({ tripId: "boat" })]);
  const found = nextDepartures({
    index: view, stopId: "87", now: new Date("2026-08-27T15:50:00Z"), limit: 4,
    vehicles: new Map([["boat", { boatName: "Lunchbox" }]])
  });
  assert.equal(found[0].boatName, "Lunchbox");
  const blind = nextDepartures({ index: view, stopId: "87", now: new Date("2026-08-27T15:50:00Z"), limit: 4 });
  assert.equal(blind[0].boatName, null, "a partner with no vehicle feed reports nothing, not a guess");
});

test("limit defaults to three and cannot be driven out of range", () => {
  // Absent is the case that matters: Number(null) is 0, which is an integer, and clamping rather
  // than defaulting there would quietly halve every request that omitted the parameter.
  assert.equal(clampLimit(null), 3);
  assert.equal(clampLimit(undefined), 3);
  assert.equal(clampLimit(""), 3);
  assert.equal(clampLimit("nonsense"), 3);
  assert.equal(clampLimit("1"), 1);
  assert.equal(clampLimit("99"), 5);
  assert.equal(clampLimit("-5"), 1);
});

test("a trip reports every call it makes, in order, whether or not boats leave from them", () => {
  const view = index([departure({ tripId: "boat" })]);
  const result = tripConnections({ index: view, tripId: "t1", now: new Date("2026-08-27T15:50:00Z") });
  assert.deepEqual(result.stops.map((stop) => stop.stopId), ["87", "18"]);
  assert.deepEqual(result.stops.map((stop) => stop.name), ["Wall St/Pier 11", "Greenpoint"]);
  assert.deepEqual(result.stops.map((stop) => stop.landingId), [16, 12]);
  // The key is always present, so an empty stop reads as "nothing leaves here" rather than as a
  // stop the server forgot to answer for.
  for (const stop of result.stops) assert.ok(Array.isArray(stop.connections));
  assert.equal(result.stops[1].connections.length, 0);
});

test("an unknown trip, and a trip with a single call, have no view worth showing", () => {
  const view = index([]);
  assert.equal(tripConnections({ index: view, tripId: "nope" }), null);
  assert.equal(tripConnections({ index: view, tripId: "solo" }), null);
});

// The point of the whole view. A boat leaving Pier 11 at noon reaches Greenpoint at 12:15, and what
// somebody stepping off it can catch is what leaves Greenpoint after 12:15 -- not what is leaving
// Greenpoint at the moment the screen is being read.
test("connections are counted from when the boat gets there, not from now", () => {
  const view = index([
    departure({ tripId: "t1", stopId: "87", seconds: 43200, departureTime: "12:00:00" }),
    // At Greenpoint: one boat before this trip docks at 12:15, two after.
    departure({ tripId: "tooEarly", stopId: "18", seconds: 43800, departureTime: "12:10:00" }),
    departure({ tripId: "first", stopId: "18", seconds: 44400, departureTime: "12:20:00" }),
    departure({ tripId: "second", stopId: "18", seconds: 45000, departureTime: "12:30:00" })
  ]);
  // Read at 11:00, an hour before the boat even leaves.
  const result = tripConnections({ index: view, tripId: "t1", now: new Date("2026-08-27T15:00:00Z") });
  const greenpoint = result.stops.find((stop) => stop.stopId === "18");
  assert.deepEqual(greenpoint.connections.map((item) => item.tripId), ["first", "second"],
    "the 12:10 had gone before this boat arrived at 12:15");
  assert.equal(greenpoint.afterSeconds, 44100, "measured from the 12:15 arrival");
  // And the boat somebody is already on is not offered as a way off it.
  const pier11 = result.stops.find((stop) => stop.stopId === "87");
  assert.equal(pier11.connections.some((item) => item.tripId === "t1"), false);
});

test("a late boat carries its delay into what it can connect to", () => {
  const view = index([
    departure({ tripId: "t1", stopId: "87", seconds: 43200, departureTime: "12:00:00" }),
    departure({ tripId: "tight", stopId: "18", seconds: 44400, departureTime: "12:20:00" }),
    departure({ tripId: "later", stopId: "18", seconds: 46200, departureTime: "12:50:00" })
  ]);
  const now = new Date("2026-08-27T15:00:00Z");
  // Ten minutes down: the 12:20 out of Greenpoint is no longer catchable off a 12:25 arrival.
  const late = tripConnections({
    index: view, tripId: "t1", now,
    updates: new Map([["t1|18", { delaySeconds: 600 }]])
  });
  const greenpoint = late.stops.find((stop) => stop.stopId === "18");
  assert.deepEqual(greenpoint.connections.map((item) => item.tripId), ["later"]);
  assert.equal(greenpoint.afterSeconds, 44700, "the arrival moved with the boat");
});

// The feed only names a vessel for a trip it has already reached, so a boat leaving later has none
// of its own. The board fills that in from the working the schedule gives it and marks the answer
// with a question mark; the trip view now does the same rather than showing a blank.
test("a boat with no vessel of its own is guessed from the working it is on", () => {
  const view = index([departure({ tripId: "later", routeId: "ER", boatAssignment: 3 })]);
  const vehicles = [{ tripId: "earlier", boatName: "Lunchbox", boat: "ER3", updatedAtEpochSeconds: 100 }];
  const found = nextDepartures({
    index: view, stopId: "87", now: new Date("2026-08-27T15:50:00Z"), limit: 4,
    vehicles: new Map(vehicles.map((item) => [String(item.tripId), item])),
    vessels: vesselsByBoat(vehicles)
  });
  assert.equal(found[0].boatName, null, "the feed has not named this trip's vessel");
  assert.equal(found[0].predictedBoatName, "Lunchbox", "so the working it is on answers for it");

  // Once the feed does name it, the guess gives way to the fact.
  const confirmed = nextDepartures({
    index: view, stopId: "87", now: new Date("2026-08-27T15:50:00Z"), limit: 4,
    vehicles: new Map([["later", { boatName: "Dream Boat" }]]),
    vessels: vesselsByBoat(vehicles)
  });
  assert.equal(confirmed[0].boatName, "Dream Boat");
  assert.equal(confirmed[0].predictedBoatName, null, "never both at once");
});

test("the freshest report wins when a boat is working two trips at once", () => {
  const vessels = vesselsByBoat([
    { tripId: "a", boat: "ER3", boatName: "Old Report", updatedAtEpochSeconds: 100 },
    { tripId: "b", boat: "ER3", boatName: "New Report", updatedAtEpochSeconds: 200 }
  ]);
  assert.equal(vessels.get("ER3").boatName, "New Report");
});

// Pier 11 and East 34th are where the routes meet, so stepping off at one of them is a real choice
// between boats rather than a wait for the only onward sailing. They get two more rows than a pier
// where everything goes the same way.
test("a hub pier offers more onward boats than an ordinary one", () => {
  const many = [];
  for (let index = 0; index < 8; index += 1) {
    // Eight boats out of each pier, ten minutes apart, all after this trip calls.
    many.push(departure({ tripId: `hub${index}`, stopId: "87", seconds: 46800 + index * 600, departureTime: "13:00:00" }));
    many.push(departure({ tripId: `local${index}`, stopId: "18", seconds: 46800 + index * 600, departureTime: "13:00:00" }));
  }
  const view = index([departure({ tripId: "t1" }), ...many]);
  const result = tripConnections({ index: view, tripId: "t1", now: new Date("2026-08-27T15:00:00Z") });
  const hub = result.stops.find((stop) => stop.stopId === "87");
  const ordinary = result.stops.find((stop) => stop.stopId === "18");
  assert.equal(hub.hub, true);
  assert.equal(hub.limit, 5, "Pier 11 and East 34th show five");
  assert.equal(ordinary.hub, false);
  assert.equal(ordinary.limit, 3, "everywhere else shows three");
  // Spares ride along so that hiding an operator costs a row of that operator, not a row of the
  // list. The client filters and then cuts to `limit`.
  assert.ok(hub.connections.length > hub.limit, "the server sends headroom above what is shown");
});
