import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createNyuRealtimeService, normalizeNyuEtas } from "../lib/nyu-realtime.js";
import { toGtfsTime } from "../scripts/fetch-nyu-gtfs.js";

// Two consecutive sailings from Brooklyn Army Terminal, as build-data.js emits them, plus an NYC
// Ferry departure that must never be touched by NYU predictions.
const DEPARTURES = [
  { tripId: "nyu:nyu-1-13139-0930", routeId: "nyu:45769", stopId: "nyu:13139", departureTime: "09:30:00" },
  { tripId: "nyu:nyu-1-13139-1030", routeId: "nyu:45769", stopId: "nyu:13139", departureTime: "10:30:00" },
  { tripId: "ER-1", routeId: "ER", stopId: "17", departureTime: "09:30:00" }
];
const NINE_THIRTY_EDT = Date.UTC(2026, 7, 10, 13, 30, 0) / 1000;

// Passio reports one arrival prediction per inbound boat, alongside its own clock.
function payload({ arrival = "2026-08-10 09:22:52", arrivalUtc = "2026-08-10 13:22:52", now = "2026-08-10 09:17:17", solid = {}, omitSolidEta = false } = {}) {
  const entry = omitSolidEta
    ? { busName: "Ferry 03", eta: "arrived" }
    : { busName: "Ferry 03", solidEta: { stopId: "13139", arrival, arrivalUtc, scheduledDeparture: "2026-08-10 06:00:00", scheduledDepartureUtc: "2026-08-10 10:00:00", ...solid } };
  return { time: now, ETAs: { 13139: [entry] } };
}

test("Passio's block-level scheduledDeparture never becomes a delay", () => {
  // Regression: Passio tags a 09:22 arrival with the block's 06:00 scheduledDeparture and
  // tripIndex 0. Differencing those reports a boat running 3h22m late while it is on time.
  const [update] = normalizeNyuEtas(payload(), { departures: DEPARTURES });
  assert.equal(update.delaySeconds, 0);
  assert.equal(update.tripId, "nyu:nyu-1-13139-0930", "the arrival belongs to the next sailing due, not the block's first");
  assert.equal(update.predictedEpochSeconds, NINE_THIRTY_EDT);
  assert.equal(update.canceled, false);
});

test("a boat waiting at the dock never pulls its departure earlier", () => {
  // Docking at 09:22 for a 09:30 sailing is a boat waiting on its timetable, not an early departure.
  const [update] = normalizeNyuEtas(payload({ arrival: "2026-08-10 09:22:52" }), { departures: DEPARTURES });
  assert.equal(update.delaySeconds, 0);
  assert.equal(update.predictedEpochSeconds, NINE_THIRTY_EDT);
});

test("a boat docking after the published time delays that sailing", () => {
  const [update] = normalizeNyuEtas(
    payload({ arrival: "2026-08-10 09:37:00", arrivalUtc: "2026-08-10 13:37:00" }),
    { departures: DEPARTURES }
  );
  assert.equal(update.tripId, "nyu:nyu-1-13139-0930");
  assert.equal(update.delaySeconds, 420);
  assert.equal(update.predictedEpochSeconds, NINE_THIRTY_EDT + 420);
});

test("a recorded actual arrival outranks the prediction", () => {
  const [update] = normalizeNyuEtas(
    payload({ solid: { arrivalActual: "2026-08-10 09:40:00", arrivalActualUtc: "2026-08-10 13:40:00" } }),
    { departures: DEPARTURES }
  );
  assert.equal(update.delaySeconds, 600);
});

test("the sailing is chosen by the clock, so a passed departure is never revived", () => {
  // 10:20 now: the 09:30 has gone regardless of what this boat is doing, so the inbound boat is
  // resolved against the 10:30 and reports no delay.
  const [update] = normalizeNyuEtas(
    payload({ now: "2026-08-10 10:20:00", arrival: "2026-08-10 10:25:00", arrivalUtc: "2026-08-10 14:25:00" }),
    { departures: DEPARTURES }
  );
  assert.equal(update.tripId, "nyu:nyu-1-13139-1030");
  assert.equal(update.delaySeconds, 0);
});

test("when the first of two inbound boats can make the sailing, the sailing is not late", () => {
  const twoBoats = payload();
  twoBoats.ETAs["13139"].push({
    busName: "Ferry 05",
    solidEta: { stopId: "13139", arrival: "2026-08-10 09:50:00", arrivalUtc: "2026-08-10 13:50:00" }
  });
  const updates = normalizeNyuEtas(twoBoats, { departures: DEPARTURES });
  assert.equal(updates.length, 1, "both boats resolve to the same sailing");
  assert.equal(updates[0].delaySeconds, 0);
});

test("predictions that cannot be tied to a sailing are dropped, not guessed at", () => {
  // An "arrived" row carries no solidEta and so no arrival estimate.
  assert.deepEqual(normalizeNyuEtas(payload({ omitSolidEta: true }), { departures: DEPARTURES }), []);
  // After the last sailing of the day there is nothing left to be late for.
  assert.deepEqual(
    normalizeNyuEtas(payload({ now: "2026-08-10 21:00:00", arrival: "2026-08-10 21:05:00" }), { departures: DEPARTURES }),
    []
  );
  assert.deepEqual(normalizeNyuEtas({}, { departures: DEPARTURES }), []);
  // A stop the built feed does not serve.
  assert.deepEqual(normalizeNyuEtas(payload(), { departures: [] }), []);
});

test("no NYU update is ever emitted against another operator's trip", () => {
  const updates = normalizeNyuEtas(payload({ arrival: "2026-08-10 09:37:00" }), { departures: DEPARTURES });
  assert.ok(updates.length > 0);
  for (const update of updates) {
    assert.match(update.tripId, /^nyu:/);
    assert.match(update.stopId, /^nyu:/);
  }
});

test("Passio clock labels convert to GTFS times across noon and midnight", () => {
  assert.equal(toGtfsTime("6:00 AM"), "06:00:00");
  assert.equal(toGtfsTime("12:00 PM"), "12:00:00");
  assert.equal(toGtfsTime("12:30 AM"), "00:30:00");
  assert.equal(toGtfsTime("8:15 PM"), "20:15:00");
  assert.throws(() => toGtfsTime("noon"), /Unrecognized Passio timepoint/);
});

async function serviceFixture(meta, fetchImpl, now) {
  const directory = await mkdtemp(path.join(tmpdir(), "nyu-realtime-"));
  const dataPath = path.join(directory, "display-data.json");
  await writeFile(dataPath, JSON.stringify({ meta, departures: DEPARTURES }), "utf8");
  return {
    directory,
    service: createNyuRealtimeService({ dataPath, cachePath: path.join(directory, "cache.json"), fetchImpl, ...(now ? { now } : {}) })
  };
}

test("a landing with no NYU dock reports success with nothing to show", async () => {
  const { service } = await serviceFixture({ nyu: { enabled: false, stopIds: [] } }, () => {
    throw new Error("must not reach the network for a landing without an NYU dock");
  });
  const result = await service.getCurrent();
  assert.equal(result.available, true);
  assert.equal(result.stale, false);
  assert.deepEqual(result.updates, []);
});

test("live estimates are fetched, clamped, and cached to disk", async () => {
  const { directory, service } = await serviceFixture({ nyu: { enabled: true, stopIds: ["13139"] } }, async () => ({
    ok: true,
    json: async () => payload()
  }));
  const result = await service.getCurrent();
  assert.equal(result.available, true);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].delaySeconds, 0);
  const cached = JSON.parse(await readFile(path.join(directory, "cache.json"), "utf8"));
  assert.equal(cached.updates[0].tripId, "nyu:nyu-1-13139-0930");
});

test("a Passio outage falls back to the last snapshot rather than blanking the board", async () => {
  let failing = false, clock = Date.parse("2026-08-10T13:00:00Z");
  const { service } = await serviceFixture(
    { nyu: { enabled: true, stopIds: ["13139"] } },
    async () => {
      if (failing) throw new Error("passio unreachable");
      return { ok: true, json: async () => payload({ arrival: "2026-08-10 09:37:00", arrivalUtc: "2026-08-10 13:37:00" }) };
    },
    () => clock
  );
  assert.equal((await service.getCurrent()).updates[0].delaySeconds, 420);

  failing = true;
  clock += 60_000; // past the 15s freshness window, so the next call must re-fetch and fail
  const result = await service.getCurrent();
  assert.equal(result.available, true, "the last good estimates are still worth showing");
  assert.equal(result.stale, true);
  assert.equal(result.updates[0].delaySeconds, 420);
  assert.match(result.error, /passio unreachable/);
});

test("with no cache and no network the service reports itself unavailable", async () => {
  const { service } = await serviceFixture({ nyu: { enabled: true, stopIds: ["13139"] } }, async () => {
    throw new Error("passio unreachable");
  });
  const result = await service.getCurrent();
  assert.equal(result.available, false);
  assert.equal(result.stale, true);
  assert.deepEqual(result.updates, []);
  assert.match(result.error, /passio unreachable/);
});
