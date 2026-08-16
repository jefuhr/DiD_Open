import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createCounterService, OTHER_ROUTE, routeKey, STATIC_ROUTE } from "../lib/counters.js";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nycf-counters-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "counters.json");
}

test("requests are counted by route, landing and status", async (t) => {
  const statePath = await fixture(t);
  const service = createCounterService({ statePath });

  service.record({ route: "/api/display-data", landingId: 18, status: 200 });
  service.record({ route: "/api/display-data", landingId: 18, status: 200 });
  service.record({ route: "/api/display-data", landingId: 2, status: 200 });
  service.record({ route: "/api/realtime", status: 503 });

  const counts = await service.snapshot();
  assert.equal(counts.routes["/api/display-data"], 3);
  assert.equal(counts.routes["/api/realtime"], 1);
  assert.deepEqual(counts.landings, { 18: 2, 2: 1 });
  assert.deepEqual(counts.statuses, { 200: 3, 503: 1 });
});

// A landing count answers "how often was this board opened", so it has to come off the payload a
// board fetches once per view. The polled routes carry landingId too, and counting those would
// quietly turn the metric into how long a screen was left switched on.
test("polling a landing does not count as viewing it", async (t) => {
  const statePath = await fixture(t);
  const service = createCounterService({ statePath });

  service.record({ route: "/api/display-data", landingId: 18, status: 200 });
  for (let poll = 0; poll < 240; poll += 1) service.record({ route: "/api/realtime", status: 200 });
  for (let poll = 0; poll < 720; poll += 1) service.record({ route: "/api/override", status: 200 });

  const counts = await service.snapshot();
  assert.deepEqual(counts.landings, { 18: 1 });
  assert.equal(counts.routes["/api/realtime"], 240);
  assert.equal(counts.routes["/api/override"], 720);
});

// The one way a fixed-key counter can grow without bound is by minting a key per path it is asked
// for, which is exactly what a scanner walking a wordlist would do.
test("unknown paths share one key rather than minting their own", async (t) => {
  const statePath = await fixture(t);
  const service = createCounterService({ statePath });

  for (let attempt = 0; attempt < 500; attempt += 1) {
    service.record({ route: `/wp-admin/${attempt}.php`, status: 404 });
  }
  service.record({ route: "/assets/fonts/lato-regular-latin.woff2", status: 200 });

  const counts = await service.snapshot();
  assert.equal(counts.routes[OTHER_ROUTE], 500);
  assert.equal(counts.routes[STATIC_ROUTE], 1);
  assert.equal(Object.keys(counts.routes).length, 2);
});

test("a served file and a missing one are told apart", () => {
  assert.equal(routeKey("/api/realtime", 200), "/api/realtime");
  assert.equal(routeKey("/styles.css", 200), STATIC_ROUTE);
  assert.equal(routeKey("/styles.css", 404), OTHER_ROUTE);
  assert.equal(routeKey("/../../etc/passwd", 403), OTHER_ROUTE);
});

test("totals survive a restart and keep their original start date", async (t) => {
  const statePath = await fixture(t);
  const started = Date.parse("2026-08-16T09:00:00Z");
  const service = createCounterService({ statePath, now: () => started });

  service.record({ route: "/api/alerts", status: 200 });
  service.event("realtime-stale");
  await service.flush();

  const restarted = createCounterService({ statePath, now: () => started + 86_400_000 });
  restarted.record({ route: "/api/alerts", status: 200 });

  const counts = await restarted.snapshot();
  assert.equal(counts.routes["/api/alerts"], 2);
  assert.equal(counts.events["realtime-stale"], 1);
  assert.equal(counts.since, "2026-08-16T09:00:00.000Z");
});

test("a corrupt state file starts the totals over instead of taking the server down", async (t) => {
  const statePath = await fixture(t);
  await writeFile(statePath, "{ this is not json", "utf8");

  const service = createCounterService({ statePath });
  service.record({ route: "/healthz", status: 200 });

  const counts = await service.snapshot();
  assert.deepEqual(counts.routes, { "/healthz": 1 });
  assert.ok(counts.since);
});

test("hand-edited counts that are not counts are dropped", async (t) => {
  const statePath = await fixture(t);
  await writeFile(statePath, JSON.stringify({
    version: 1,
    since: "2026-08-16T09:00:00.000Z",
    routes: { "/api/alerts": 4, "/api/realtime": "lots", "/healthz": -1, "/api/landings": 1.5 }
  }), "utf8");

  const counts = await createCounterService({ statePath }).snapshot();
  assert.deepEqual(counts.routes, { "/api/alerts": 4 });
});

// Flushing is on a timer, so a board that takes no traffic between two ticks should not rewrite an
// identical file every five minutes for as long as it runs.
test("an unchanged snapshot is not rewritten", async (t) => {
  const statePath = await fixture(t);
  const service = createCounterService({ statePath });

  service.record({ route: "/healthz", status: 200 });
  await service.flush();
  const first = await readFile(statePath, "utf8");

  await service.flush();
  assert.equal(await readFile(statePath, "utf8"), first);
});

test("stopping flushes what is still only in memory", async (t) => {
  const statePath = await fixture(t);
  const service = createCounterService({ statePath, flushIntervalMs: 60_000 });
  service.start();
  service.record({ route: "/api/landings", status: 200 });
  await service.stop();

  const saved = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(saved.routes["/api/landings"], 1);
});

// Counting must never be the reason a request fails, so the record path takes anything the server
// can hand it without throwing.
test("recording never throws on odd input", () => {
  const service = createCounterService({ statePath: "/nonexistent/counters.json" });
  assert.doesNotThrow(() => service.record());
  assert.doesNotThrow(() => service.record({ route: undefined, landingId: NaN, status: undefined }));
  assert.doesNotThrow(() => service.event(null));
});
