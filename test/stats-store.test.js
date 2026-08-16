import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStatsStore, hourKey, latencyBucket } from "../lib/stats-store.js";

const HOUR = 3_600_000;

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nycf-stats-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function store(directory, now) {
  return createStatsStore({ databasePath: path.join(directory, "stats.db"), now });
}

test("counts roll up into the hour they happened in", async (t) => {
  const directory = await fixture(t);
  const at = Date.parse("2026-08-16T09:20:00Z");
  const service = store(directory, () => at);
  t.after(() => service.close());

  service.record({ counts: { route: { "/api/display-data": 3 }, landing: { 18: 2 } } }, at);
  service.record({ counts: { route: { "/api/display-data": 1 }, landing: { 18: 1 } } }, at + 10 * 60_000);
  service.record({ counts: { route: { "/api/display-data": 5 } } }, at + HOUR);

  assert.deepEqual(service.totals("route"), { "/api/display-data": 9 });
  assert.deepEqual(service.totals("landing"), { 18: 3 });

  const series = service.series("route", { hours: 2 });
  assert.equal(series.length, 2);
  assert.equal(series.at(-1).count, 4, "the 09:00 hour holds both of its writes");
});

// A restart mid-hour must add to the hour, not replace it — the caller hands over deltas precisely
// so that a process that dies at 09:40 does not erase what happened at 09:10.
test("a second process adds to an hour rather than overwriting it", async (t) => {
  const directory = await fixture(t);
  const at = Date.parse("2026-08-16T09:20:00Z");

  const first = store(directory, () => at);
  first.record({ counts: { route: { "/api/alerts": 4 } } }, at);
  first.close();

  const second = store(directory, () => at);
  t.after(() => second.close());
  second.record({ counts: { route: { "/api/alerts": 3 } } }, at);

  assert.deepEqual(second.totals("route"), { "/api/alerts": 7 });
});

test("a series reports quiet hours as zero rather than as gaps", async (t) => {
  const directory = await fixture(t);
  const at = Date.parse("2026-08-16T12:00:00Z");
  const service = store(directory, () => at);
  t.after(() => service.close());

  service.record({ counts: { route: { "/stats": 2 } } }, at - 3 * HOUR);
  const series = service.series("route", { hours: 4 });

  assert.deepEqual(series.map((point) => point.count), [2, 0, 0, 0]);
  assert.equal(series.at(-1).hour, "2026-08-16T12:00:00.000Z");
});

test("percentiles come off the histogram, with the open-ended bucket ranked last", async (t) => {
  const directory = await fixture(t);
  const at = Date.parse("2026-08-16T09:00:00Z");
  const service = store(directory, () => at);
  t.after(() => service.close());

  // 90 fast requests and 10 very slow ones: the median is fast, the 95th is not.
  service.record({ latency: { "/api/realtime": { 5: 90, "-1": 10 } } }, at);
  const { "/api/realtime": timing } = service.latencies({ hours: 1 });

  assert.equal(timing.count, 100);
  assert.equal(timing.p50, 5);
  assert.ok(timing.p95 >= 5, "the slow tail must not rank below the fast bucket");
});

test("latency buckets round up to the next edge", () => {
  assert.equal(latencyBucket(0), 5);
  assert.equal(latencyBucket(5), 5);
  assert.equal(latencyBucket(6), 10);
  assert.equal(latencyBucket(2_500), 2_500);
  assert.equal(latencyBucket(9_000), Infinity);
});

test("hours are keyed in UTC so a daylight-saving change cannot merge two of them", () => {
  assert.equal(hourKey(Date.parse("2026-11-01T05:30:00Z")), "2026-11-01T05");
  assert.equal(hourKey(Date.parse("2026-11-01T06:30:00Z")), "2026-11-01T06");
});

// The whole point of the migration: the totals that existed before the history did must survive the
// deploy that gave them a time axis.
test("the counters that existed before are imported once, keeping their start date", async (t) => {
  const directory = await fixture(t);
  const counterPath = path.join(directory, "counters.json");
  await writeFile(counterPath, JSON.stringify({
    version: 1,
    since: "2026-08-16T05:15:40.946Z",
    routes: { "/api/realtime": 2472, "/api/override": 3350 },
    landings: { 16: 38, 31: 5 },
    statuses: { 200: 7987, 400: 391 },
    events: {}
  }), "utf8");

  const at = Date.parse("2026-08-17T00:00:00Z");
  const service = store(directory, () => at);
  t.after(() => service.close());

  const first = await service.importLegacyCounters(counterPath);
  assert.equal(first.imported, true);
  assert.equal(service.since(), "2026-08-16T05:15:40.946Z");
  assert.deepEqual(service.totals("landing"), { 16: 38, 31: 5 });
  assert.equal(service.totals("route")["/api/override"], 3350);

  // Importing again on the next restart would double every lifetime number on the page.
  const second = await service.importLegacyCounters(counterPath);
  assert.equal(second.imported, false);
  assert.equal(service.totals("route")["/api/override"], 3350);
});

test("a missing counters file is not an error, and is not retried forever", async (t) => {
  const directory = await fixture(t);
  const service = store(directory);
  t.after(() => service.close());

  const result = await service.importLegacyCounters(path.join(directory, "nothing.json"));
  assert.equal(result.imported, false);
  assert.ok(service.meta("importedLegacyCounters"));
});

test("history older than the retention window is pruned", async (t) => {
  const directory = await fixture(t);
  const at = Date.parse("2026-08-16T09:00:00Z");
  const service = createStatsStore({ databasePath: path.join(directory, "stats.db"), now: () => at, retentionDays: 30 });
  t.after(() => service.close());

  service.record({ counts: { route: { "/stats": 1 } } }, at - 40 * 86_400_000);
  service.record({ counts: { route: { "/stats": 1 } } }, at);
  service.record({ latency: { "/stats": { 5: 1 } } }, at - 40 * 86_400_000);

  const pruned = service.prune(at);
  assert.equal(pruned.removed, 2);
  assert.deepEqual(service.totals("route"), { "/stats": 1 });
});
