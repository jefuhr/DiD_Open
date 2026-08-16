import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_OVERRIDE_MESSAGE_LENGTH = 2_000;

// Which landings a notice can be posted for is a question config/landings.json already answers, so
// it is asked rather than restated here. It used to be a pair of constants reading 2 through 26,
// which was true when they were written and silently false the moment Pier C, Whitehall, Soissons
// Landing, Liberty Island and Ellis Island were added — every one of those landings answered 400 to
// its own board's polling, so a notice posted there could never appear. A bound that has to be
// remembered is a bound that will be forgotten; this one comes from the same file the landings do.
export function normalizeLandingId(value, landingIds) {
  const allowed = landingIds instanceof Set ? landingIds : new Set(landingIds || []);
  if (!allowed.size) throw new Error("The set of landing ids is required to validate a landingId.");
  const landingId = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isInteger(landingId) || !allowed.has(landingId)) {
    throw new RangeError(`landingId must be one of the landings this board serves: ${[...allowed].sort((a, b) => a - b).join(", ")}.`);
  }
  return landingId;
}

export function normalizeOverrideMessage(value) {
  if (typeof value !== "string") throw new TypeError("message must be a string.");
  const message = value.trim();
  if (message.length > MAX_OVERRIDE_MESSAGE_LENGTH) {
    throw new RangeError(`message must be ${MAX_OVERRIDE_MESSAGE_LENGTH} characters or fewer.`);
  }
  return message;
}

export function normalizeOverrideTimestamp(value, fallback = () => new Date().toISOString()) {
  if (value === undefined || value === null || value === "") return fallback();
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError("updatedAt must be a valid ISO date string when provided.");
  }
  return new Date(value).toISOString();
}

function emptyResult(landingId) {
  return { landingId, active: false, message: "", updatedAt: null };
}

async function readState(statePath) {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    return parsed && parsed.overrides && typeof parsed.overrides === "object" && !Array.isArray(parsed.overrides)
      ? { version: 1, overrides: parsed.overrides }
      : { version: 1, overrides: {} };
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, overrides: {} };
    throw error;
  }
}

async function writeState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

export function createManualOverrideService({ statePath, landingIds, now = () => Date.now() }) {
  if (!statePath) throw new Error("A manual override state path is required.");
  const allowed = new Set(landingIds || []);
  if (!allowed.size) throw new Error("The landings this board serves are required.");

  let statePromise = readState(statePath);
  let operation = Promise.resolve();

  async function get(landingIdValue) {
    const landingId = normalizeLandingId(landingIdValue, allowed);
    await operation;
    const state = await statePromise;
    const saved = state.overrides[String(landingId)];
    if (!saved || typeof saved.message !== "string" || !saved.message.trim()) return emptyResult(landingId);
    return {
      landingId,
      active: true,
      message: saved.message,
      updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : null
    };
  }

  async function set(landingIdValue, messageValue, options = {}) {
    const landingId = normalizeLandingId(landingIdValue, allowed);
    const message = normalizeOverrideMessage(messageValue);
    const updatedAt = message
      ? normalizeOverrideTimestamp(options.updatedAt, () => new Date(now()).toISOString())
      : null;

    const update = operation.then(async () => {
      const state = await statePromise;
      const overrides = { ...state.overrides };
      if (message) {
        overrides[String(landingId)] = {
          message,
          updatedAt
        };
      } else {
        delete overrides[String(landingId)];
      }
      const nextState = { version: 1, overrides };
      await writeState(statePath, nextState);
      statePromise = Promise.resolve(nextState);
      return message
        ? { landingId, active: true, ...overrides[String(landingId)] }
        : emptyResult(landingId);
    });

    operation = update.then(() => undefined, () => undefined);
    return update;
  }

  return { get, set };
}
