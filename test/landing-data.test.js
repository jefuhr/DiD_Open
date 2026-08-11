import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDisplayData } from "../scripts/build-data.js";
import { landingChoices, loadAllLandingData, mergeDisplayData, stopIdsForLanding } from "../lib/landing-data.js";

const root = new URL("..", import.meta.url).pathname;
const landings = JSON.parse(await readFile(new URL("../config/landings.json", import.meta.url), "utf8"));

test("every active landing in config is offered, and the unused one is not", () => {
  const choices = landingChoices(landings);
  const active = Object.entries(landings).filter(([, item]) => !item.unused);
  assert.equal(choices.length, active.length);
  assert.ok(choices.length > 1, "a server that offers one landing has not loaded them all");
  assert.ok(!choices.some((choice) => choice.id === 1), "landing 1 is marked unused and must not be offered");
  assert.ok(choices.every((choice) => choice.displayName && Number.isInteger(choice.id)));
});

test("loads every landing, not just the one config/display.json selects", async () => {
  const choices = landingChoices(landings);
  const loaded = await loadAllLandingData({ root, choices });
  assert.equal(loaded.failures.size, 0, `landings failed to build: ${[...loaded.failures].join(", ")}`);
  assert.equal(loaded.byLanding.size, choices.length);
  const configured = JSON.parse(await readFile(new URL("../config/display.json", import.meta.url), "utf8")).landingNumber;
  for (const choice of choices) {
    assert.equal(loaded.byLanding.get(choice.id).meta.landingNumber, choice.id);
  }
  assert.ok(loaded.byLanding.size > 1 && loaded.byLanding.has(configured));
});

test("one unbuildable landing costs that landing and nothing else", async () => {
  const choices = [{ id: 2, displayName: "Astoria" }, { id: 3, displayName: "Atlantic Avenue" }];
  const warnings = [];
  const loaded = await loadAllLandingData({
    root,
    choices,
    logger: { warn: (message) => warnings.push(message) },
    build: async ({ landingNumber }) => {
      if (landingNumber === 2) throw new Error("references missing GTFS stop 999");
      return buildDisplayData({ root, landingNumber });
    }
  });
  assert.deepEqual([...loaded.failures.keys()], [2]);
  assert.deepEqual(loaded.available.map((item) => item.id), [3]);
  assert.ok(loaded.byLanding.has(3), "the healthy landing is still served");
  assert.match(warnings[0], /landing 2 .* could not be built/);
});

// The bug this whole change exists for: both realtime services learn which stops to normalize from
// the display data they are handed, so handing them one landing silently scoped live estimates to
// that landing. NYU is the sharpest case — it docks only at 8 and 24.
test("the merged realtime view reaches operators that dock at no configured landing", async () => {
  const choices = landingChoices(landings);
  const loaded = await loadAllLandingData({ root, choices });
  const configured = JSON.parse(await readFile(new URL("../config/display.json", import.meta.url), "utf8")).landingNumber;

  const single = loaded.byLanding.get(configured);
  assert.equal(single.meta.nyu.enabled, false, "precondition: the configured landing has no NYU dock");

  assert.equal(loaded.merged.meta.nyu.enabled, true, "merged view must find NYU somewhere in the system");
  assert.deepEqual([...loaded.merged.meta.nyu.stopIds].sort(), ["13138", "13139"]);
  assert.ok(loaded.merged.meta.landing.stopIds.length > single.meta.landing.stopIds.length);
  assert.ok(loaded.merged.departures.length > single.departures.length);
});

test("merging landings introduces no duplicate departures and keeps every trip schedule", () => {
  const all = [
    { meta: { timezone: "America/New_York", landing: { stopIds: ["1"] }, nyu: { enabled: false, stopIds: [] } },
      departures: [{ tripId: "t1", stopId: "1" }], tripSchedules: { t1: { stops: [{ stopId: "1" }] } } },
    { meta: { timezone: "America/New_York", landing: { stopIds: ["2"] }, nyu: { enabled: true, stopIds: ["13138"] } },
      departures: [{ tripId: "t1", stopId: "2" }, { tripId: "t2", stopId: "2" }],
      tripSchedules: { t1: { stops: [{ stopId: "1" }] }, t2: { stops: [{ stopId: "2" }] } } }
  ];
  const merged = mergeDisplayData(all);
  assert.deepEqual(merged.meta.landing.stopIds, ["1", "2"]);
  assert.equal(merged.meta.nyu.enabled, true);
  assert.equal(merged.departures.length, 3);
  const keys = merged.departures.map((item) => `${item.tripId}|${item.stopId}`);
  assert.equal(new Set(keys).size, keys.length, "a trip calling at two landings must not collapse or duplicate");
  assert.deepEqual(Object.keys(merged.tripSchedules).sort(), ["t1", "t2"]);
});

test("a landing's realtime stop set covers its partner operators, prefixes and all", async () => {
  const nyuLanding = await buildDisplayData({ root, landingNumber: 8 });
  const stops = stopIdsForLanding(nyuLanding);
  assert.ok(stops.has("nyu:13138"), "NYU updates arrive prefixed and must survive per-landing filtering");
  for (const stopId of nyuLanding.meta.landing.stopIds) assert.ok(stops.has(stopId));
});

test("both realtime services accept a display source instead of a single built file", async () => {
  const [realtime, nyu] = await Promise.all([
    readFile(new URL("../lib/realtime.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/nyu-realtime.js", import.meta.url), "utf8")
  ]);
  for (const source of [realtime, nyu]) {
    assert.match(source, /loadDisplay = \(\) => readFile\(dataPath, "utf8"\)\.then\(JSON\.parse\)/);
  }
  assert.match(realtime, /loadDisplay\(\),\s*\n\s*readFile\(fleetPath/);
  assert.match(nyu, /const display = await loadDisplay\(\);/);
});

test("the server serves every landing and scopes realtime to the one asked for", async () => {
  const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
  assert.match(server, /loadAllLandingData\({ root: ROOT, choices: LANDING_CHOICES }\)/);
  assert.match(server, /createRealtimeService\({ loadDisplay: async \(\) => landingData\.merged/);
  assert.match(server, /createNyuRealtimeService\({ loadDisplay: async \(\) => landingData\.merged/);
  assert.match(server, /url\.pathname === "\/api\/landings"/);
  assert.match(server, /realtimeStopsByLanding\.get\(Number\(url\.searchParams\.get\("landingId"\)\)\)/);
  assert.match(server, /stops \? updates\.filter\(\(update\) => stops\.has\(String\(update\.stopId\)\)\) : updates/);
  // dataPath must not come back as the realtime source: that is the single-landing bug.
  assert.doesNotMatch(server, /createRealtimeService\({ dataPath/);
  assert.doesNotMatch(server, /createNyuRealtimeService\({ dataPath/);
});
