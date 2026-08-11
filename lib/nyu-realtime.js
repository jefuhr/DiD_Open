// Live departure estimates for the NYU Langone ferry, read from its Passio GO backend.
//
// NYU has no GTFS-Realtime feed. Passio exposes per-stop arrival predictions as JSON, which this
// module normalizes into exactly the update shape lib/realtime.js produces for NYC Ferry
// ({ tripId, stopId, delaySeconds, predictedEpochSeconds, canceled }), with gtfs/nyu ids already
// prefixed. That lets public/app.js consume both operators through one code path.
//
// The no-early-departure rule in gtfsferry.md applies here exactly as it does to NYC Ferry, and
// this feed makes the distinction unusually visible: Passio predicts when a boat *arrives* at a
// terminal, which for a ferry that waits at the dock is routinely long before it is scheduled to
// leave. Ferry 03 tying up at 09:02 for a 09:30 departure is a boat waiting on its timetable, not
// a departure that moved 28 minutes earlier, so the arrival may never pull the departure forward.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const PASSIO_HOST = "https://passio3.com/www";
export const NYU_SYSTEM_ID = "1007";
export const NYU_ROUTE_ID = "45769";
const PREFIX = "nyu:";
// Passio ignores the value but requires the parameter; it identifies a client, not a credential.
const DEVICE_ID = "99999999";

// Passio timestamps are "YYYY-MM-DD HH:MM:SS", in local time except for the parallel *Utc fields.
function parseStamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    secondsOfDay: hour * 3600 + minute * 60 + second,
    // Treating the wall-clock reading as if it were UTC; only ever used against another reading
    // parsed the same way, so the fictional offset cancels out.
    pseudoEpoch: Math.floor(Date.UTC(year, month - 1, day, hour, minute, second) / 1000)
  };
}

function secondsOfDay(gtfsTime) {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(String(gtfsTime || ""));
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

/**
 * Turns one Passio ETA payload into rider-facing departure updates.
 *
 * Passio's `solidEta.scheduledDeparture` cannot be used to identify the sailing a prediction
 * belongs to. It reports the *block's* first departure — a boat predicted to dock at 09:22 comes
 * back tagged `scheduledDeparture: 06:00` with `tripIndex: 0` — so differencing the two invents a
 * three-hour delay on a ferry that is running perfectly on time. Only the predicted arrival is
 * trustworthy, so the sailing is resolved from the timetable instead: an inbound boat operates the
 * next departure that has not yet come due, and it is late only if it docks after that departure's
 * published time.
 *
 * A sailing whose published time has already passed is never revived. Passio cannot say whether an
 * earlier boat already worked it, and showing a departed sailing as merely "late" is a worse error
 * on a platform than showing the published time — the same bias gtfsferry.md takes elsewhere.
 *
 * Times are compared as local seconds-of-day, which is the unit GTFS `departure_time` already uses.
 * NYU sails 05:30–20:15 with no trip crossing midnight, so no day-wrap handling is required.
 */
export function normalizeNyuEtas(payload, { departures = [], nowSecondsOfDay = null } = {}) {
  const byStop = new Map();
  for (const departure of departures) {
    if (!String(departure.routeId || "").startsWith(PREFIX)) continue;
    const list = byStop.get(departure.stopId) || [];
    list.push(departure);
    byStop.set(departure.stopId, list);
  }
  for (const list of byStop.values()) list.sort((left, right) => secondsOfDay(left.departureTime) - secondsOfDay(right.departureTime));

  const best = new Map();
  for (const [stopId, predictions] of Object.entries(payload?.ETAs || {})) {
    const schedule = byStop.get(`${PREFIX}${stopId}`) || [];
    if (!schedule.length) continue;
    for (const prediction of predictions || []) {
      const solid = prediction?.solidEta;
      if (!solid) continue;
      // An actual recorded arrival outranks a prediction; both are arrivals at the terminal, so
      // both are only ever a floor on when the boat can leave again.
      const arrival = parseStamp(solid.arrivalActual || solid.arrival);
      const arrivalUtc = parseStamp(solid.arrivalActualUtc || solid.arrivalUtc);
      if (!arrival) continue;
      // Passio's own clock, so a drifting server clock cannot shift the comparison.
      const now = nowSecondsOfDay ?? parseStamp(payload?.time)?.secondsOfDay ?? arrival.secondsOfDay;

      const target = schedule.find((departure) => secondsOfDay(departure.departureTime) >= now);
      if (!target) continue;
      const scheduledSeconds = secondsOfDay(target.departureTime);
      // gtfsferry.md: rider_departure = max(static_departure, realtime_prediction). Clamping here
      // means no consumer of /api/realtime can observe a negative NYU delay in the first place.
      const delaySeconds = Math.max(0, arrival.secondsOfDay - scheduledSeconds);
      // Two inbound boats both resolve to the next sailing; the one arriving first works it.
      const existing = best.get(target.tripId);
      if (existing && existing.delaySeconds <= delaySeconds) continue;
      best.set(target.tripId, {
        tripId: target.tripId,
        stopId: target.stopId,
        delaySeconds,
        // Absolute instant for the scheduled departure, recovered by shifting the arrival's own
        // UTC/local pair; null when Passio omitted the UTC half.
        predictedEpochSeconds: arrivalUtc
          ? arrivalUtc.pseudoEpoch - arrival.secondsOfDay + scheduledSeconds + delaySeconds
          : null,
        // Passio models a boat going out of service, never a cancelled sailing, so no cancellation
        // is ever asserted from this feed.
        canceled: false
      });
    }
  }
  return [...best.values()];
}

async function fetchEta({ fetchImpl, stopId, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const query = new URLSearchParams({ eta: "3", deviceId: DEVICE_ID, stopIds: stopId, routeId: NYU_ROUTE_ID });
    const response = await fetchImpl(`${PASSIO_HOST}/mapGetData.php?${query}`, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "NYC-Ferry-DiD-Reborn/1.0" }
    });
    if (!response.ok) throw new Error(`NYU ETA for stop ${stopId} returned ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export function createNyuRealtimeService({
  dataPath, loadDisplay = () => readFile(dataPath, "utf8").then(JSON.parse),
  cachePath, fetchImpl = globalThis.fetch, ttlMs = 15_000, now = () => Date.now()
}) {
  let memory = null, loaded = false, inflight = null;
  const empty = { available: false, stale: true, fetchedAt: null, updates: [] };

  async function loadCache() {
    if (loaded) return memory;
    loaded = true;
    try { memory = JSON.parse(await readFile(cachePath, "utf8")); } catch { memory = null; }
    return memory;
  }
  async function save(snapshot) {
    await mkdir(path.dirname(cachePath), { recursive: true });
    const temporary = `${cachePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, "utf8");
    await rename(temporary, cachePath);
  }
  async function refresh() {
    const display = await loadDisplay();
    const stopIds = display.meta?.nyu?.enabled ? (display.meta.nyu.stopIds || []) : [];
    // A landing with no NYU dock is the normal case, and is a success with nothing to report
    // rather than an error — it must not make /api/realtime look degraded.
    if (!stopIds.length) {
      const snapshot = { available: true, stale: false, fetchedAt: new Date(now()).toISOString(), updates: [] };
      memory = snapshot;
      return snapshot;
    }
    const payloads = await Promise.all(stopIds.map((stopId) => fetchEta({ fetchImpl, stopId, timeoutMs: 7000 })));
    const snapshot = {
      available: true,
      stale: false,
      fetchedAt: new Date(now()).toISOString(),
      updates: payloads.flatMap((payload) => normalizeNyuEtas(payload, { departures: display.departures }))
    };
    memory = snapshot;
    await save(snapshot);
    return snapshot;
  }
  return {
    async getCurrent() {
      const cached = await loadCache();
      const age = cached?.fetchedAt ? now() - Date.parse(cached.fetchedAt) : Infinity;
      if (cached && age >= 0 && age < ttlMs) return { ...cached, stale: false };
      if (!inflight) inflight = refresh().finally(() => { inflight = null; });
      try { return await inflight; }
      catch (error) {
        if (cached) return { ...cached, available: true, stale: true, error: error.message };
        return { ...empty, error: error.message };
      }
    }
  };
}
