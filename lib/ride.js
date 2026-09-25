import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { matchFleetVessel } from "./realtime.js";
import { createConnectionIndex, activeServices } from "./connections.js";
import { zonedParts, addDays } from "../public/assets/schedule.js";

const FRESH_MS = 180_000;
const numeric = value => value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const ownNumber = (object, key) => object && Object.hasOwn(object, key) ? numeric(object[key]) : null;

export function resolveVessel(descriptor, fleet = []) {
  const known = matchFleetVessel(descriptor, fleet);
  if (known) return { id: known.id, name: known.name, number: known.number };
  // An entity ID is a feed row, not a hull. Only a provider's vehicle ID is a fallback identity.
  if (!descriptor?.id) return null;
  return { id: `nycf:${descriptor.id}`, name: descriptor.label || String(descriptor.id), number: String(descriptor.id) };
}

export function normalizeRideFeed({ feed, vehicleFeed, fleet = [], now = Date.now() }) {
  const assignments = [], timings = [], positions = [];
  for (const [source, payload] of [["trip-update", feed], ["vehicle-position", vehicleFeed]]) {
    for (const entity of payload?.entity || []) {
      const record = source === "trip-update" ? entity.tripUpdate : entity.vehicle;
      if (!record) continue;
      const vessel = resolveVessel(record.vehicle, fleet);
      const tripId = record.trip?.tripId == null ? null : String(record.trip.tripId);
      const startDate = String(record.trip?.startDate || "");
      const serviceDate = /^\d{8}$/.test(startDate) ? `${startDate.slice(0,4)}-${startDate.slice(4,6)}-${startDate.slice(6)}` : null;
      const reportedAt = (numeric(record.timestamp) ?? numeric(payload.header?.timestamp) ?? now / 1000) * 1000;
      const common = { tripId, serviceDate, reportedAt, source };
      if (vessel && tripId) assignments.push({ ...common, vessel, sequence: ownNumber(record, "currentStopSequence") });
      if (source === "trip-update" && tripId) {
        for (const stop of record.stopTimeUpdate || []) timings.push({
          ...common, stopId: stop.stopId == null ? null : String(stop.stopId), sequence: ownNumber(stop, "stopSequence"),
          arrivalTime: ownNumber(stop.arrival, "time"), arrivalDelay: ownNumber(stop.arrival, "delay"),
          departureTime: ownNumber(stop.departure, "time"), departureDelay: ownNumber(stop.departure, "delay"),
          skipped: Number(stop.scheduleRelationship) === 1, noData: Number(stop.scheduleRelationship) === 2,
          canceled: Number(record.trip?.scheduleRelationship) === 3
        });
        // Cancellation can have no stop updates.
        if (Number(record.trip?.scheduleRelationship) === 3) timings.push({ ...common, canceled: true });
      }
      const latitude = numeric(record.position?.latitude), longitude = numeric(record.position?.longitude);
      if (source === "vehicle-position" && vessel && latitude != null && longitude != null && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) positions.push({
        ...common, vessel, vesselId: vessel.id, latitude, longitude, sequence: ownNumber(record, "currentStopSequence"),
        speedKnots: ownNumber(record.position, "speed") == null ? null : Math.round(Number(record.position.speed) * 1.94384 * 10) / 10,
        status: ({ 0: "incoming", 1: "stopped", 2: "in-transit", STOPPED_AT: "stopped", INCOMING_AT: "incoming", IN_TRANSIT_TO: "in-transit" })[record.currentStatus] || "in-transit"
      });
    }
  }
  return { assignments, timings, positions };
}

// GTFS service time is elapsed time from local noon minus twelve hours, also on DST days.
export function serviceEpoch(date, seconds, timezone = "America/New_York") {
  const noon = Date.parse(`${date}T12:00:00Z`);
  const local = zonedParts(new Date(noon), timezone);
  const dateDelta = (Date.parse(`${local.dateKey}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 1000;
  return noon + (43200 - local.seconds - dateDelta - 43200 + seconds) * 1000;
}

export async function createRideService({ fleet, byLanding, historyPath }) {
  const index = createConnectionIndex(byLanding);
  const departures = new Map();
  for (const data of byLanding.values()) for (const row of data.departures || []) {
    if (!departures.has(String(row.tripId))) departures.set(String(row.tripId), row);
  }
  let history = [], lastSnapshot = null, writeError = false, refreshFailed = false;
  const observedVessels = new Map();
  try {
    const saved = JSON.parse(await readFile(historyPath, "utf8"));
    if (saved.version === 1 && Array.isArray(saved.assignments)) history = saved.assignments.filter(item => item?.vessel?.id && /^\d{4}-\d{2}-\d{2}$/.test(item.serviceDate) && Number.isFinite(item.reportedAt));
    for (const vessel of saved.vessels || []) if (vessel?.id && vessel.name) observedVessels.set(vessel.id, vessel);
  } catch { /* A new install has no assignment history. */ }

  function dateFor(record, at) {
    if (record.serviceDate) return record.serviceDate;
    const current = zonedParts(new Date(record.reportedAt || at), index.timezone);
    const calls = index.tripStops.get(record.tripId) || [];
    const first = calls[0]?.departureSeconds ?? calls[0]?.arrivalSeconds;
    const last = calls.at(-1)?.arrivalSeconds ?? calls.at(-1)?.departureSeconds;
    if (first == null || last == null) return current.dateKey;
    return [-1, 0].map(offset => addDays(current.dateKey, offset))
      .filter(date => activeServices(index, date).has(index.tripService.get(record.tripId)))
      .sort((a, b) => distance(a) - distance(b))[0] || current.dateKey;
    function distance(date) {
      const instant = record.reportedAt || at;
      return Math.max(serviceEpoch(date, first, index.timezone) - instant, instant - serviceEpoch(date, last, index.timezone), 0);
    }
  }
  let pending = Promise.resolve();
  function observe(input) {
    pending = pending.catch(() => {}).then(() => record(input)).catch(error => {
      // The departure service isolates observer errors. Keep our own failure state so that its
      // healthy feed cannot make the ride's previous position and arrival estimates look live.
      refreshFailed = true;
      throw error;
    });
    return pending;
  }
  async function record({ now = Date.now(), ...input }) {
    const snapshot = normalizeRideFeed({ ...input, fleet, now });
    for (const item of [...snapshot.assignments, ...snapshot.positions]) observedVessels.set(item.vessel.id, item.vessel);
    const today = zonedParts(new Date(now), index.timezone).dateKey;
    history = history.filter(row => row.serviceDate >= addDays(today, -1) && row.serviceDate <= today);
    for (const assignment of snapshot.assignments.sort((a,b) => a.reportedAt - b.reportedAt)) {
      const serviceDate = dateFor(assignment, now);
      if (serviceDate < addDays(today, -1) || serviceDate > today || assignment.reportedAt > now + 60000) continue;
      const sameTrip = row => row.tripId === assignment.tripId && row.serviceDate === serviceDate;
      const latest = history.filter(sameTrip).sort((a,b) => b.reportedAt - a.reportedAt)[0];
      if (latest && latest.reportedAt > assignment.reportedAt) continue;
      for (const row of history.filter(sameTrip)) row.reassigned = row.vessel.id !== assignment.vessel.id;
      const existing = history.find(row => sameTrip(row) && row.vessel.id === assignment.vessel.id);
      const value = { ...assignment, serviceDate, firstSeen: existing?.firstSeen ?? assignment.reportedAt, reassigned: false };
      if (existing) Object.assign(existing, value); else history.push(value);
    }
    snapshot.timings = snapshot.timings.map(item => ({ ...item, serviceDate: dateFor(item, now) }));
    snapshot.positions = snapshot.positions.map(item => ({ ...item, serviceDate: dateFor(item, now) }));
    // Preserve a last known fix through a position-feed failure, explicitly marked stale.
    if (!input.vehicleFeed && lastSnapshot) snapshot.positions = lastSnapshot.positions;
    lastSnapshot = { ...snapshot, fetchedAt: now, positionsAvailable: Boolean(input.vehicleFeed) };
    refreshFailed = false;
    try {
      await mkdir(path.dirname(historyPath), { recursive: true });
      await writeFile(`${historyPath}.tmp`, JSON.stringify({ version: 1, assignments: history, vessels: [...observedVessels.values()] }) + "\n");
      await rename(`${historyPath}.tmp`, historyPath);
      writeError = false;
    } catch { writeError = true; }
  }

  function vessels() {
    const known = new Map(fleet.map(vessel => [vessel.id, vessel]));
    for (const vessel of observedVessels.values()) if (!known.has(vessel.id)) known.set(vessel.id, vessel);
    for (const row of history) if (!known.has(row.vessel.id)) known.set(row.vessel.id, row.vessel);
    return [...known.values()].sort((a,b) => a.name.localeCompare(b.name));
  }
  function describe(vesselId, now = Date.now(), freshness = {}) {
    const vessel = vessels().find(item => item.id === vesselId);
    if (!vessel) return null;
    const date = zonedParts(new Date(now), index.timezone).dateKey;
    const stale = refreshFailed || Boolean(freshness.stale) || !lastSnapshot || now - lastSnapshot.fetchedAt > FRESH_MS;
    const position = lastSnapshot?.positions.filter(item => item.vesselId === vesselId).sort((a,b) => b.reportedAt - a.reportedAt)[0] || null;
    const positionStale = Boolean(freshness.positionsStale) || stale || !position || !lastSnapshot.positionsAvailable || now - position.reportedAt > FRESH_MS;
    const trips = history.filter(item => item.vessel.id === vesselId && item.serviceDate >= addDays(date, -1) && item.serviceDate <= date).flatMap(item => {
      const calls = index.tripStops.get(item.tripId) || [];
      const departure = departures.get(item.tripId) || {};
      const route = index.routes.get(departure.routeId) || {};
      const epoch = seconds => seconds == null ? null : serviceEpoch(item.serviceDate, seconds, index.timezone);
      const start = calls[0]?.departureSeconds ?? calls[0]?.arrivalSeconds;
      const end = calls.at(-1)?.arrivalSeconds ?? calls.at(-1)?.departureSeconds;
      // Include the previous service day's overnight calls, never relabel yesterday as today.
      if (item.serviceDate !== date && (end == null || zonedParts(new Date(epoch(end)), index.timezone).dateKey !== date)) return [];
      if (item.reassigned && (start == null || item.firstSeen < epoch(start))) return [];
      const updates = stale || item.reassigned ? [] : (lastSnapshot?.timings || []).filter(update => update.tripId === item.tripId && update.serviceDate === item.serviceDate && now - update.reportedAt <= FRESH_MS && update.reportedAt <= now + 60000);
      const canceled = updates.some(update => update.canceled);
      const current = !positionStale && position.tripId === item.tripId && position.serviceDate === item.serviceDate && !item.reassigned;
      const stops = calls.map(call => {
        const update = updates.find(update => update.sequence != null ? update.sequence === call.sequence : update.stopId === call.stopId && calls.filter(stop => stop.stopId === call.stopId).length === 1);
        const estimate = (kind, scheduled) => {
          if (!update || update.noData || update.skipped || canceled) return null;
          const absolute = update[`${kind}Time`], delay = update[`${kind}Delay`];
          if (absolute != null) {
            const seconds = (absolute * 1000 - epoch(0)) / 1000;
            return kind === "departure" && scheduled != null ? Math.max(scheduled, seconds) : seconds;
          }
          return delay != null && scheduled != null ? scheduled + (kind === "departure" ? Math.max(0, delay) : delay) : null;
        };
        const arrival = estimate("arrival", call.arrivalSeconds), dep = estimate("departure", call.departureSeconds);
        const name = index.stops.get(call.stopId) || {};
        return { ...call, name: name.name || call.stopId, landingId: name.landingId ?? null,
          estimatedArrivalSeconds: arrival, estimatedDepartureSeconds: dep,
          arrivalAt: epoch(arrival ?? call.arrivalSeconds), departureAt: epoch(dep == null ? call.departureSeconds : Math.max(call.departureSeconds ?? dep, dep)),
          skipped: Boolean(update?.skipped), current: current && position.sequence === call.sequence,
          past: current && position.sequence != null ? call.sequence < position.sequence : epoch(call.departureSeconds ?? call.arrivalSeconds) < now };
      });
      return [{ tripId: item.tripId, serviceDate: item.serviceDate, routeId: departure.routeId || null,
        route: route.shortName || departure.routeId || "Ferry", destination: stops.at(-1)?.name || "Trip details unavailable",
        state: canceled ? "canceled" : item.reassigned ? "reassigned" : current ? "current" : end != null && epoch(end) < now ? "past" : "upcoming",
        confirmedAt: item.reportedAt, outOfService: Boolean(departure.outOfService),
        startAt: epoch(start), stops }];
    }).sort((a,b) => (a.startAt ?? 0) - (b.startAt ?? 0));
    // A workbook turn alone does not confirm the next vessel. Only connect two confirmed trips.
    for (const trip of trips) {
      const turn = index.turnarounds.get(trip.tripId);
      const next = turn && trips.find(candidate => candidate.tripId === turn.nextTripId && candidate.serviceDate === trip.serviceDate && !["reassigned", "canceled"].includes(candidate.state));
      const terminal = trip.stops.at(-1), origin = next?.stops[0];
      if (!terminal || !origin || trip.state === "reassigned" || terminal.stopId !== origin.stopId) continue;
      if (terminal.arrivalAt == null || origin.departureAt == null || trip.state === "canceled") continue;
      terminal.layoverSeconds = Math.max(0, (origin.departureAt - terminal.arrivalAt) / 1000);
      terminal.layoverEstimated = terminal.estimatedArrivalSeconds != null || origin.estimatedDepartureSeconds != null;
    }
    const current = trips.find(trip => trip.state === "current");
    const nextStop = current?.stops.find(stop => stop.current && !stop.skipped) || null;
    return { vessel, date, timezone: index.timezone, generatedAt: new Date(now).toISOString(),
      fetchedAt: lastSnapshot ? new Date(lastSnapshot.fetchedAt).toISOString() : null,
      stale, positionStale, position, nextStop, trips,
      historyNote: refreshFailed ? "Boat updates could not be refreshed. Showing saved data until the next successful refresh."
        : writeError ? "Assignment history could not be saved. Earlier trips may be missing after a restart."
        : "Confirmed assignments observed during app use. Earlier and future trips may be missing." };
  }
  return { observe, describe, vessels };
}
