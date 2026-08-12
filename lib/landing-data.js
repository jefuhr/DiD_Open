// Every landing this server can answer for, not just the one config/display.json selects.
//
// A kiosk runs beside one dock, so the build writes that landing's display-data.json and the
// server streamed the file straight back. A deployed staff or mobile server is the opposite case:
// one process answers for the whole system, and pinning it to config/display.json broke two
// things. Landings other than the configured one had no data to serve at all, and — far less
// visibly — /api/realtime stayed scoped to that one landing, because both realtime services read
// the same single-landing file to learn which stops and trips to normalize.
//
// The realtime half is the one that bites. NYU Langone docks only at landings 8 and 24, so a
// server configured for landing 26 read `meta.nyu.enabled: false`, concluded there was nothing to
// track, and never called Passio at all — the live estimates existed but could never reach a
// rider. Liberty Landing (landing 25 only) fails the same way. So the merged view below, not just
// the per-landing map, is what makes "load all landings" true.
//
// Everything here is built once at startup: the inputs are the bundled GTFS feed and the config
// files, which only change on redeploy. That is the same restart-after-config-change contract the
// build already has.

import { buildDisplayData } from "../scripts/build-data.js";

export function landingChoices(landings) {
  return Object.entries(landings)
    .filter(([, item]) => !item.unused)
    // Both names travel: displayName is what the menu reads ("Battery Park City / Brookfield
    // Place"), name is the short form the nearest-landing button has room for.
    .map(([id, item]) => ({ id: Number(id), name: item.name || item.displayName || `Landing ${id}`, displayName: item.displayName || item.name || `Landing ${id}` }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

/**
 * Where a landing is, for the client that measures distance to it.
 *
 * Taken from what the build already resolved rather than re-read from config: a real landing's
 * position comes out of the feed's stops.txt, and only the virtual one (Pier C) is configured by
 * hand. A landing whose feed row somehow carries no usable position is returned without one, and
 * the client skips it — being absent from the nearest-landing search is better than being wrong.
 */
function withPosition(choice, data) {
  const latitude = Number(data?.meta?.landing?.latitude);
  const longitude = Number(data?.meta?.landing?.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { ...choice, latitude, longitude } : choice;
}

/**
 * Collapses every landing's display data into the single view the realtime services consume.
 *
 * Stops are unique to a landing, so unioning departures introduces no duplicates: a trip calling
 * at six landings contributes six rows, one per stop, which is exactly what normalizeTripUpdates
 * needs to emit an update for each. tripSchedules is keyed by trip id and is identical wherever
 * it appears, so assigning over it is a deduplicating merge rather than a lossy one.
 */
export function mergeDisplayData(all) {
  const departures = [];
  const tripSchedules = {};
  const landingStopIds = new Set();
  const nyuStopIds = new Set();
  let timezone = "America/New_York";
  let nyuEnabled = false;
  for (const data of all) {
    departures.push(...data.departures);
    Object.assign(tripSchedules, data.tripSchedules);
    for (const stopId of data.meta.landing?.stopIds || []) landingStopIds.add(stopId);
    if (data.meta.nyu?.enabled) {
      nyuEnabled = true;
      for (const stopId of data.meta.nyu.stopIds || []) nyuStopIds.add(stopId);
    }
    if (data.meta.timezone) timezone = data.meta.timezone;
  }
  return {
    meta: {
      timezone,
      landing: { stopIds: [...landingStopIds] },
      nyu: { enabled: nyuEnabled, stopIds: [...nyuStopIds] }
    },
    departures,
    tripSchedules
  };
}

/**
 * The stop ids whose realtime updates belong to one landing.
 *
 * Read off that landing's own departures rather than rebuilt from config, so it covers every
 * operator without knowing their id prefixes: NYC Ferry's bare "24" and NYU's "nyu:13138" both
 * arrive already namespaced the way the updates are.
 */
export function stopIdsForLanding(data) {
  return new Set(data.departures.map((departure) => String(departure.stopId)));
}

/**
 * Builds every active landing. One landing failing is isolated rather than fatal: a bad stop id in
 * config/landings.json should cost that landing, not the whole board. The caller decides what to
 * do about the configured landing specifically, which is the only one a kiosk cannot do without.
 */
export async function loadAllLandingData({ root, choices, build = buildDisplayData, logger = console }) {
  const byLanding = new Map();
  const failures = new Map();
  for (const choice of choices) {
    try {
      byLanding.set(choice.id, await build({ root, landingNumber: choice.id }));
    } catch (error) {
      failures.set(choice.id, error.message);
      logger.warn?.(`[landings] landing ${choice.id} (${choice.displayName}) could not be built and will not be served: ${error.message}`);
    }
  }
  return {
    byLanding,
    failures,
    available: choices.filter((choice) => byLanding.has(choice.id)).map((choice) => withPosition(choice, byLanding.get(choice.id))),
    merged: mergeDisplayData([...byLanding.values()])
  };
}
