// Build all active landings at startup and merge their stops for realtime polling.
// The merged view ensures operators that serve only some landings are still polled.

import { buildDisplayData } from "./schedule-builder.js";

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
  let holidaySchedule = null;
  for (const data of all) {
    departures.push(...data.departures);
    Object.assign(tripSchedules, data.tripSchedules);
    for (const stopId of data.meta.landing?.stopIds || []) landingStopIds.add(stopId);
    if (data.meta.nyu?.enabled) {
      nyuEnabled = true;
      for (const stopId of data.meta.nyu.stopIds || []) nyuStopIds.add(stopId);
    }
    if (data.meta.timezone) timezone = data.meta.timezone;
    if (data.meta.holidaySchedule) holidaySchedule = data.meta.holidaySchedule;
  }
  return {
    meta: {
      timezone,
      holidaySchedule,
      landing: { stopIds: [...landingStopIds] },
      nyu: { enabled: nyuEnabled, stopIds: [...nyuStopIds] }
    },
    departures,
    tripSchedules
  };
}

/**
 * Every operator anyone can be shown, across every landing that built.
 *
 * The board's operator filter is a per-device reading preference, not board config, so hiding NY
 * Waterway has to mean hiding it everywhere rather than only where the agent happened to be
 * standing. That needs the full roster up front: a client that only knew its own landing's
 * operators could neither offer the others nor report how many were hidden.
 *
 * The home agency leads and the partners follow alphabetically — the same order the panel reads in,
 * decided here so every client agrees on it.
 */
export function operatorRoster(byLanding, agency = null) {
  const all = [...byLanding.values()];
  const homeAgency = agency || all.find((data) => data.meta?.agencyName)?.meta.agencyName || "NYC Ferry";
  const names = new Set();
  for (const data of all) {
    for (const route of Object.values(data.routes || {})) {
      names.add(route.operator || data.meta?.agencyName || homeAgency);
    }
  }
  const partners = [...names].filter((name) => name !== homeAgency).sort((left, right) => left.localeCompare(right));
  return names.has(homeAgency) ? [homeAgency, ...partners] : partners;
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
 * do about the configured landing specifically, which has a saved-file fallback.
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
