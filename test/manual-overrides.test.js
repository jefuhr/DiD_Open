import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  createManualOverrideService,
  MAX_OVERRIDE_MESSAGE_LENGTH
} from "../lib/manual-overrides.js";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nycf-override-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "manual-overrides.json");
}

test("manual notices persist independently for each landing", async (t) => {
  const statePath = await fixture(t);
  const now = Date.parse("2026-08-06T16:30:00Z");
  const service = createManualOverrideService({ statePath, now: () => now });

  const astoria = await service.set(2, "Boarding is temporarily suspended.");
  await service.set("21", "Use the alternate boarding area.");

  assert.deepEqual(astoria, {
    landingId: 2,
    active: true,
    message: "Boarding is temporarily suspended.",
    updatedAt: "2026-08-06T16:30:00.000Z"
  });

  const restarted = createManualOverrideService({ statePath });
  assert.equal((await restarted.get(2)).message, "Boarding is temporarily suspended.");
  assert.equal((await restarted.get(21)).message, "Use the alternate boarding area.");
});

test("a blank message clears only the selected landing", async (t) => {
  const statePath = await fixture(t);
  const service = createManualOverrideService({ statePath });
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
  const service = createManualOverrideService({ statePath });

  await assert.rejects(service.set(1, "Invalid"), /2 through 24/);
  await assert.rejects(service.set(25, "Invalid"), /2 through 24/);
  await assert.rejects(service.set(2, null), /message must be a string/);
  await assert.rejects(service.set(2, "x".repeat(MAX_OVERRIDE_MESSAGE_LENGTH + 1)), /characters or fewer/);
});
