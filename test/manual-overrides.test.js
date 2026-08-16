import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createManualOverrideService,
  MAX_OVERRIDE_MESSAGE_LENGTH
} from "../lib/manual-overrides.js";

// The landings this board serves. 27 through 31 — Pier C, Whitehall, Soissons Landing, Liberty
// Island and Ellis Island — are the ones a hardcoded 2-through-26 bound used to reject.
const LANDING_IDS = Array.from({ length: 30 }, (_, index) => index + 2);

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nycf-override-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "manual-overrides.json");
}

test("manual notices persist independently for each landing", async (t) => {
  const statePath = await fixture(t);
  const now = Date.parse("2026-08-06T16:30:00Z");
  const service = createManualOverrideService({ statePath, landingIds: LANDING_IDS, now: () => now });

  const astoria = await service.set(2, "Boarding is temporarily suspended.");
  await service.set("21", "Use the alternate boarding area.");

  assert.deepEqual(astoria, {
    landingId: 2,
    active: true,
    message: "Boarding is temporarily suspended.",
    updatedAt: "2026-08-06T16:30:00.000Z"
  });

  const restarted = createManualOverrideService({ statePath, landingIds: LANDING_IDS });
  assert.equal((await restarted.get(2)).message, "Boarding is temporarily suspended.");
  assert.equal((await restarted.get(21)).message, "Use the alternate boarding area.");
});

test("a blank message clears only the selected landing", async (t) => {
  const statePath = await fixture(t);
  const service = createManualOverrideService({ statePath, landingIds: LANDING_IDS });
  await Promise.all([
    service.set(4, "Bay Ridge notice"),
    service.set(16, "Pier 11 notice")
  ]);

  assert.deepEqual(await service.set(4, "   "), {
    landingId: 4,
    active: false,
    message: "",
    updatedAt: null
  });
  assert.equal((await service.get(4)).active, false);
  assert.equal((await service.get(16)).message, "Pier 11 notice");
});

test("manual notice input is constrained to supported landing IDs and message sizes", async (t) => {
  const statePath = await fixture(t);
  const service = createManualOverrideService({ statePath, landingIds: LANDING_IDS });

  await assert.rejects(service.set(1, "Invalid"), /landings this board serves/);
  await assert.rejects(service.set(32, "Invalid"), /landings this board serves/);
  await assert.rejects(service.set(2, null), /message must be a string/);
  await assert.rejects(service.set(2, "x".repeat(MAX_OVERRIDE_MESSAGE_LENGTH + 1)), /characters or fewer/);
});

// The landings added after the original 2-through-26 bound was written. Every one of them answered
// 400 to its own board polling /api/override, so a notice posted there could never appear.
test("notices work for the landings added after the original bound", async (t) => {
  const statePath = await fixture(t);
  const service = createManualOverrideService({ statePath, landingIds: LANDING_IDS });

  for (const landingId of [27, 28, 29, 30, 31]) {
    await service.set(landingId, `Notice for landing ${landingId}.`);
    assert.equal((await service.get(landingId)).message, `Notice for landing ${landingId}.`);
  }
});

// A board that serves fewer landings must still refuse the ones it does not, or the bound is
// decorative.
test("a landing this board does not serve is still refused", async (t) => {
  const statePath = await fixture(t);
  const service = createManualOverrideService({ statePath, landingIds: [2, 3, 4] });

  await assert.rejects(service.set(18, "Not this board"), /landings this board serves/);
  assert.equal((await service.get(3)).active, false);
});

test("a service with no landings at all refuses to be built", () => {
  assert.throws(() => createManualOverrideService({ statePath: "/tmp/x.json", landingIds: [] }), /landings this board serves are required/);
});
