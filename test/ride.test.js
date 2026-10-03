import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRideService, resolveVessel, normalizeRideFeed, serviceEpoch } from "../lib/ride.js";
import { createRealtimeService } from "../lib/realtime.js";
import bindings from "gtfs-realtime-bindings";

const fleet = [{ id: "opportunity", name: "Opportunity", number: "H-204" }, { id: "bay-hopper", name: "Bay Hopper", number: "H-120" }];
const now = Date.parse("2026-09-24T14:10:00Z");
const data = { meta: { timezone: "America/New_York" },
  calendars: [{ serviceId: "daily", startDate: "2026-09-01", endDate: "2026-12-31", weekdays: [true,true,true,true,true,true,true] }], exceptions: [],
  routes: { ER: { shortName: "ER", name: "East River" } },
  stops: { a: { name: "Pier 11", landingId: 16 }, b: { name: "DUMBO", landingId: 17 } },
  departures: [{ tripId: "t1", routeId: "ER", serviceId: "daily", seconds: 36000, boatAssignment: 1 }, { tripId: "t2", routeId: "ER", serviceId: "daily", seconds: 39000, boatAssignment: 1 }],
  tripSchedules: { t1: { stops: [{ stopId: "a", sequence: 1, arrivalSeconds: 36000, departureSeconds: 36120 }, { stopId: "b", sequence: 2, arrivalSeconds: 37200, departureSeconds: 37260 }] },
    t2: { stops: [{ stopId: "b", sequence: 1, arrivalSeconds: 39000, departureSeconds: 39000 }, { stopId: "a", sequence: 2, arrivalSeconds: 40000, departureSeconds: 40000 }] } }
};
function feed(vessel = "H204", at = now, tripId = "t1") {
  return { header: { timestamp: at / 1000 }, entity: [{ id: "volatile-id", vehicle: { trip: { tripId, startDate: "20260924" }, vehicle: { id: vessel }, timestamp: at / 1000, currentStopSequence: 2, currentStatus: 2, position: { latitude: 40.7, longitude: -74, speed: 5 } } }] };
}
async function service(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ferry-ride-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { fleet, byLanding: new Map([[16, data]]), historyPath: path.join(directory, "history.json") };
  return { ride: await createRideService(options), options };
}

test("vessel identity uses the hull, never the feed entity or working", () => {
  assert.equal(resolveVessel({ id: "H204" }, fleet).id, "opportunity");
  assert.equal(resolveVessel({ id: "other-boat" }, fleet).id, "nycf:other-boat");
  assert.equal(resolveVessel({}, fleet), null);
});

test("arrival and departure estimates stay separate, including early arrival and repeated stops", () => {
  const source = { entity: [{ tripUpdate: { trip: { tripId: "t1", startDate: "20260924" }, vehicle: { id: "H204" }, timestamp: now / 1000,
    stopTimeUpdate: [ { stopId: "a", stopSequence: 1, arrival: { delay: -60 }, departure: { delay: 180 } },
      { stopId: "a", stopSequence: 3, arrival: { time: now / 1000 + 900 }, scheduleRelationship: 1 } ] } }] };
  const result = normalizeRideFeed({ feed: source, fleet, now });
  assert.equal(result.timings[0].arrivalDelay, -60);
  assert.equal(result.timings[0].departureDelay, 180);
  assert.equal(result.timings[1].sequence, 3);
  assert.equal(result.timings[1].skipped, true);
});

test("confirmed assignments survive refresh/restart without including predicted trips", async t => {
  const { ride, options } = await service(t);
  await ride.observe({ vehicleFeed: feed(), now });
  let result = ride.describe("opportunity", now);
  assert.deepEqual(result.trips.map(trip => trip.tripId), ["t1"]);
  assert.equal(result.position.speedKnots, 9.7);
  assert.equal(result.trips[0].state, "current");
  await ride.observe({ vehicleFeed: { entity: [] }, now: now + 15000 });
  assert.equal(ride.describe("opportunity", now + 15000).trips.length, 1);
  const restored = await createRideService(options);
  result = restored.describe("opportunity", now + 30000);
  assert.equal(result.trips.length, 1);
  assert.equal(result.stale, true);
});

test("dated cruise identities resolve only on their reviewed service date", async t => {
  const { options } = await service(t);
  const dated = structuredClone(data);
  dated.departures[0].liveTripId = 'nyc:unmapped:t1';
  dated.departures[0].liveTripIdsByDate = {'2026-09-24':'current-t1','2026-09-25':'other-t1'};
  const ride = await createRideService({...options,byLanding:new Map([[16,dated]])});
  await ride.observe({vehicleFeed:feed('H204',now,'current-t1'),now});
  const trip = ride.describe('opportunity',now).trips[0];
  assert.equal(trip.routeId,'ER');
  assert.equal(trip.stops.length,2);
  await ride.observe({vehicleFeed:feed('H120',now,'other-t1'),now});
  const wrongDay = ride.describe('bay-hopper',now).trips;
  assert.ok(wrongDay.every(trip=>trip.stops.length===0),'another date must not borrow the reviewed stop list');
});

test("a vessel swap removes the old upcoming assignment and preserves the vessel identity", async t => {
  const { ride } = await service(t);
  await ride.observe({ vehicleFeed: feed("H204", now, "t2"), now });
  await ride.observe({ vehicleFeed: feed("H120", now + 15000, "t2"), now: now + 15000 });
  assert.equal(ride.describe("opportunity", now + 15000).trips.length, 0);
  assert.equal(ride.describe("bay-hopper", now + 15000).trips[0].tripId, "t2");
});

test("fresh arrival estimates are shown at every stop; stale estimates revert to the schedule", async t => {
  const { ride } = await service(t);
  const updates = { entity: [{ tripUpdate: { trip: { tripId: "t1", startDate: "20260924" }, vehicle: { id: "H204" }, timestamp: now / 1000,
    stopTimeUpdate: [{ stopId: "b", stopSequence: 2, arrival: { delay: 120 }, departure: { delay: 300 } }] } }] };
  await ride.observe({ feed: updates, vehicleFeed: feed(), now });
  const stop = ride.describe("opportunity", now).trips[0].stops[1];
  assert.equal(stop.estimatedArrivalSeconds, 37320);
  assert.equal(stop.estimatedDepartureSeconds, 37560);
  assert.equal(ride.describe("opportunity", now + 181000).trips[0].stops[1].estimatedArrivalSeconds, null);
});

test("old history is pruned", async t => {
  const { ride } = await service(t);
  await ride.observe({ vehicleFeed: feed(), now });
  await ride.observe({ vehicleFeed: { entity: [] }, now: now + 3 * 86400000 });
  assert.equal(ride.describe("opportunity", now + 3 * 86400000).trips.length, 0);
});

test("overnight trips keep their service date when the feed omits startDate", async t => {
  const { options } = await service(t);
  const overnight = structuredClone(data);
  overnight.tripSchedules.t1.stops = [{ stopId: "a", sequence: 1, arrivalSeconds: 87000, departureSeconds: 87000 }, { stopId: "b", sequence: 2, arrivalSeconds: 88200, departureSeconds: 88200 }];
  const ride = await createRideService({ ...options, byLanding: new Map([[16,overnight]]) });
  const at = Date.parse("2026-09-25T04:20:00Z");
  const source = feed("H204",at);
  delete source.entity[0].vehicle.trip.startDate;
  await ride.observe({ vehicleFeed: source, now: at });
  const trip = ride.describe("opportunity",at).trips[0];
  assert.equal(trip.serviceDate,"2026-09-24");
  assert.equal(trip.state,"current");
  assert.equal(trip.stops[1].arrivalAt,Date.parse("2026-09-25T04:30:00Z"));
});

test("GTFS service seconds use the noon anchor across both DST transitions", () => {
  assert.equal(serviceEpoch("2026-03-08",43200),Date.parse("2026-03-08T16:00:00Z"));
  assert.equal(serviceEpoch("2026-11-01",43200),Date.parse("2026-11-01T17:00:00Z"));
});

test("an unassigned provider vessel can be pinned and survives a restart", async t => {
  const { ride,options } = await service(t);
  const source = feed("provider-123");
  delete source.entity[0].vehicle.trip;
  await ride.observe({ vehicleFeed: source, now });
  assert.equal(ride.describe("nycf:provider-123",now).position.vesselId,"nycf:provider-123");
  const restored = await createRideService(options);
  assert.equal(restored.describe("nycf:provider-123",now).trips.length,0);
});

test("feed failure immediately removes live ETAs and keeps a stale last position", async t => {
  const { ride } = await service(t);
  await ride.observe({ vehicleFeed: feed(), now });
  const result = ride.describe("opportunity",now + 15000,{stale:true});
  assert.equal(result.stale,true);
  assert.equal(result.positionStale,true);
  await ride.observe({ feed:{entity:[]}, vehicleFeed:null, now:now+15000 });
  assert.equal(ride.describe("opportunity",now+15000).positionStale,true);
  assert.ok(ride.describe("opportunity",now+15000).position);
});

test("repeated stops use sequence and skipped/canceled calls never show an ETA", async t => {
  const { options } = await service(t);
  const loop = structuredClone(data);
  loop.tripSchedules.t1.stops.push({ stopId:"a", sequence:3, arrivalSeconds:38000, departureSeconds:38000 });
  const ride = await createRideService({...options,byLanding:new Map([[16,loop]])});
  const updates = {entity:[{tripUpdate:{trip:{tripId:"t1",startDate:"20260924"},timestamp:now/1000,vehicle:{id:"H204"},stopTimeUpdate:[
    {stopId:"a",stopSequence:1,arrival:{delay:60}},
    {stopId:"b",stopSequence:2,arrival:{delay:90},scheduleRelationship:1},
    {stopId:"a",stopSequence:3,arrival:{delay:180}}
  ]}}]};
  await ride.observe({feed:updates,vehicleFeed:feed(),now});
  let trip=ride.describe("opportunity",now).trips[0];
  assert.equal(trip.stops[0].estimatedArrivalSeconds,36060);
  assert.equal(trip.stops[1].estimatedArrivalSeconds,null);
  assert.equal(trip.stops[2].estimatedArrivalSeconds,38180);
  updates.entity[0].tripUpdate.trip.scheduleRelationship=3;
  await ride.observe({feed:updates,vehicleFeed:feed(),now});
  trip=ride.describe("opportunity",now).trips[0];
  assert.equal(trip.state,"canceled");
  assert(trip.stops.every(stop=>stop.estimatedArrivalSeconds===null));
});

test("a scheduled layover requires both trips to be confirmed for this vessel", async t => {
  const { options } = await service(t);
  const turns = structuredClone(data);
  turns.tripSchedules.t1.turnaround={stopId:"b",nextTripId:"t2",scheduledLayoverSeconds:1800};
  const ride=await createRideService({...options,byLanding:new Map([[16,turns]])});
  await ride.observe({vehicleFeed:feed(),now});
  assert.equal(ride.describe("opportunity",now).trips[0].stops.at(-1).layoverSeconds,undefined);
  const both=feed();
  both.entity.push(...feed("H204",now,"t2").entity);
  await ride.observe({vehicleFeed:both,now});
  assert.equal(ride.describe("opportunity",now).trips[0].stops.at(-1).layoverSeconds,1800);
});

test("an early absolute departure estimate and its cached fallback use the same schedule floor", async t => {
  const { ride } = await service(t);
  const updates={entity:[{tripUpdate:{trip:{tripId:"t1",startDate:"20260924"},timestamp:now/1000,vehicle:{id:"H204"},stopTimeUpdate:[{stopId:"b",stopSequence:2,departure:{time:serviceEpoch("2026-09-24",37000)/1000}}]}}]};
  await ride.observe({feed:updates,vehicleFeed:feed(),now});
  const stop=ride.describe("opportunity",now).trips[0].stops[1];
  assert.equal(stop.estimatedDepartureSeconds,stop.departureSeconds);
  assert.equal(stop.departureAt,serviceEpoch("2026-09-24",stop.estimatedDepartureSeconds));
});

test("a failed ride observer marks its old data stale while the board refreshes, then recovers", async t => {
  const { ride, options } = await service(t);
  const directory = path.dirname(options.historyPath);
  const fleetPath = path.join(directory, "fleet.json");
  await writeFile(fleetPath, JSON.stringify({ vessels: fleet }));
  let at = now, malformed = false;
  const encode = entity => bindings.transit_realtime.FeedMessage.encode(
    bindings.transit_realtime.FeedMessage.fromObject({
      header: { gtfsRealtimeVersion: "2.0", timestamp: at / 1000 }, entity
    })).finish();
  const realtime = createRealtimeService({
    loadDisplay: async () => ({ ...data, meta: { ...data.meta, landing: { stopIds: ["a", "b"] } } }),
    fleetPath, cachePath: path.join(directory, "realtime.json"),
    url: "trips", vehicleUrl: "positions", now: () => at, onRefresh: ride.observe,
    fetchImpl: async url => {
      const entities = url === "positions" ? feed("H204", at).entity : [{
        id: "timing", tripUpdate: {
          trip: { tripId: "t1", startDate: "20260924" }, vehicle: { id: "H204" }, timestamp: at / 1000,
          stopTimeUpdate: [{ stopId: "b", stopSequence: 2, arrival: { delay: 120 } }]
        }
      }];
      // An unusable vendor timestamp fails date resolution in the ride observer. The main
      // departure feed can still be decoded and normalized, and must remain available.
      if (malformed && url === "positions") {
        delete entities[0].vehicle.trip.startDate;
        entities[0].vehicle.timestamp = 10_000_000_000_000;
      }
      return { ok: true, arrayBuffer: async () => encode(entities) };
    }
  });
  await realtime.getCurrent();
  assert.equal(ride.describe("opportunity", at).nextStop.estimatedArrivalSeconds, 37320);
  at += 16000;
  malformed = true;
  const board = await realtime.getCurrent();
  assert.equal(board.available, true);
  assert.equal(board.stale, false);
  const saved = ride.describe("opportunity", at, { stale: board.stale, positionsStale: board.vehiclesStale });
  assert.equal(saved.stale, true);
  assert.equal(saved.positionStale, true);
  assert.equal(saved.trips[0].stops[1].estimatedArrivalSeconds, null);
  assert.match(saved.historyNote, /could not be refreshed/i);
  assert.equal(saved.fetchedAt, new Date(now).toISOString());
  at += 16000;
  malformed = false;
  await realtime.getCurrent();
  const recovered = ride.describe("opportunity", at);
  assert.equal(recovered.stale, false);
  assert.equal(recovered.nextStop.estimatedArrivalSeconds, 37320);
  assert.doesNotMatch(recovered.historyNote, /could not be refreshed/i);
});
