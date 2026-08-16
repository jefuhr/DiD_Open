// What this server has been asked for, counted rather than logged.
//
// A departure board wants to answer a few operational questions — which landings are actually
// dialled up, whether a route is erroring, whether the realtime feed is being served from a stale
// cache — and every ordinary way of answering them costs more hardware than the board itself. An
// access log grows without bound and needs rotating; a hosted analytics tag is blocked outright by
// this server's own Content-Security-Policy; a self-hosted one wants a database.
//
// So: fixed keys, integer counts, held in a Map. The set of keys is bounded by the routes this
// server has and the landings it was built with, so memory is flat no matter how long it runs and
// however much traffic it takes. Persisted the way the realtime and override caches already are —
// one small file under state/, written whole, atomically — so a restart resumes its totals instead
// of starting the history over.
//
// It counts requests, not people. There is no identifier here, nothing per-visitor, and no record
// of the order anything happened in: a counter cannot reconstruct a journey, which on a public
// kiosk is a feature and on a phone is the point.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// Long enough that a busy board writes seconds apart at worst, short enough that a restart loses
// little. The file is rewritten whole each time, so this is one small write, not a growing one.
export const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

// A request for an unknown path is still a request, and a scanner walking a wordlist would
// otherwise mint a counter key per guess — the one way a fixed-key design can leak memory. Every
// path that is not a route this server answers counts as "other", so the key set stays bounded by
// the code rather than by what someone types.
// A served file — the shell, the stylesheet, a font — is counted as one key rather than one per
// asset, because "the board loaded" is the fact worth having and a per-file breakdown is what the
// browser's own network tab is for.
export const STATIC_ROUTE = "static";
export const OTHER_ROUTE = "other";
export const ROUTES = ["/healthz", "/api/health", "/api/landings", "/api/display-data", "/api/realtime", "/api/alerts", "/api/override", "/api/stats", "/stats", STATIC_ROUTE, OTHER_ROUTE];

// Requests that are not one of this server's routes split by how they ended: a file that was
// served is the board working, and a 404 or a 403 is somebody probing paths that do not exist.
export function routeKey(pathname, status) {
  if (ROUTES.includes(pathname)) return pathname;
  return Number.isInteger(status) && status < 400 ? STATIC_ROUTE : OTHER_ROUTE;
}

function emptyState() {
  return { version: 1, since: null, routes: {}, landings: {}, statuses: {}, events: {} };
}

// Counts arrive from disk, so they are whatever the last process wrote — or whatever a person
// editing state/ by hand left behind. Anything that is not a count is dropped rather than added to.
function countsFrom(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const counts = {};
  for (const [key, value] of Object.entries(source)) {
    if (Number.isInteger(value) && value >= 0) counts[key] = value;
  }
  return counts;
}

async function readState(statePath) {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    return {
      version: 1,
      since: typeof parsed?.since === "string" && Number.isFinite(Date.parse(parsed.since)) ? parsed.since : null,
      routes: countsFrom(parsed?.routes),
      landings: countsFrom(parsed?.landings),
      statuses: countsFrom(parsed?.statuses),
      events: countsFrom(parsed?.events)
    };
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    // A truncated or hand-edited file is not worth taking the server down for: totals are the
    // least important thing here, so start them over and carry on serving departures.
    return emptyState();
  }
}

async function writeState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

export function createCounterService({ statePath, now = () => Date.now(), flushIntervalMs = FLUSH_INTERVAL_MS } = {}) {
  if (!statePath) throw new Error("A counter state path is required.");

  // Requests can arrive before the file has been read, and recording is synchronous so that it can
  // never fail a request. So the live object is never replaced by what came off disk — the saved
  // totals are added into it, and anything counted in the meantime is kept rather than overwritten.
  const counts = emptyState();
  const loaded = readState(statePath).then((saved) => {
    for (const group of ["routes", "landings", "statuses", "events"]) {
      for (const [key, value] of Object.entries(saved[group])) counts[group][key] = (counts[group][key] || 0) + value;
    }
    counts.since = saved.since || counts.since || new Date(now()).toISOString();
    return counts;
  });
  let timer = null;
  let writing = Promise.resolve();
  let dirty = false;

  function bump(group, key) {
    const bucket = counts[group];
    if (!bucket) return;
    bucket[key] = (bucket[key] || 0) + 1;
    dirty = true;
  }

  // Called on the request path, so it does no I/O and never rejects: a counter that can fail a
  // request is worse than no counter at all.
  function record({ route, landingId, status } = {}) {
    bump("routes", routeKey(route, status));
    // Landings come off a query string, so only ones this server actually built get their own key.
    if (Number.isInteger(landingId)) bump("landings", String(landingId));
    if (Number.isInteger(status)) bump("statuses", String(status));
  }

  // For the things that are worth counting but are not requests — a realtime fetch that failed, a
  // payload served stale. Callers pass a name from a fixed set of their own.
  function event(name) {
    if (typeof name === "string" && name) bump("events", name);
  }

  async function flush() {
    await loaded;
    if (!dirty) return counts;
    const snapshot = { ...counts, routes: { ...counts.routes }, landings: { ...counts.landings }, statuses: { ...counts.statuses }, events: { ...counts.events } };
    dirty = false;
    writing = writing.then(() => writeState(statePath, snapshot)).catch((error) => {
      // Losing totals is not worth an unhandled rejection; the next flush rewrites them anyway.
      dirty = true;
      console.error(`Counters could not be written: ${error.message}`);
    });
    await writing;
    return snapshot;
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => void flush(), flushIntervalMs);
    // The board's own timers keep the process alive; this one should never be the reason it stays up.
    timer.unref?.();
  }

  async function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    await flush();
  }

  async function snapshot() {
    await loaded;
    return {
      since: counts.since,
      routes: { ...counts.routes },
      landings: { ...counts.landings },
      statuses: { ...counts.statuses },
      events: { ...counts.events }
    };
  }

  return { record, event, flush, snapshot, start, stop };
}
