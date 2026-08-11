import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const { transit_realtime: transitRealtime } = GtfsRealtimeBindings;
export const TRIP_UPDATES_URL = "https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/tripupdate";
export const VEHICLE_POSITIONS_URL = "https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/vehicleposition";

function number(value) {
  if (value == null) return null;
  if (typeof value?.toNumber === "function") return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function localSecondsOfDay(timestampSeconds, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).formatToParts(new Date(timestampSeconds * 1000))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return parts.hour * 3600 + parts.minute * 60 + parts.second;
}

function eventDelaySeconds(event, scheduledSeconds, timeZone) {
  if (!event) return null;
  if (Object.hasOwn(event, "delay")) return number(event.delay);
  const predictedTimestamp = number(event.time);
  if (predictedTimestamp == null || scheduledSeconds == null) return null;
  let delay = localSecondsOfDay(predictedTimestamp, timeZone) - (Number(scheduledSeconds) % 86400);
  if (delay > 43200) delay -= 86400;
  if (delay < -43200) delay += 86400;
  return delay;
}

function timingEvent(stopUpdate) {
  const departure = stopUpdate?.departure;
  if (departure && (Object.hasOwn(departure, "delay") || number(departure.time) != null)) return departure;
  const arrival = stopUpdate?.arrival;
  if (arrival && (Object.hasOwn(arrival, "delay") || number(arrival.time) != null)) return arrival;
  return null;
}

function riderDepartureDelaySeconds(value) {
  const delay = number(value);
  return delay == null ? null : Math.max(0, delay);
}

export function normalizeTripUpdates(feed, stopIds, { departures = [], tripSchedules = {}, timeZone = "America/New_York" } = {}) {
  const selected = new Set(stopIds.map(String));
  const schedule = new Map(departures.map((departure) => [
    `${departure.tripId}|${departure.stopId}`,
    departure.seconds
  ]));
  for (const [tripId, tripSchedule] of Object.entries(tripSchedules)) {
    for (const stop of tripSchedule?.stops || []) {
      schedule.set(`${tripId}|${stop.stopId}`, stop.departureSeconds ?? stop.arrivalSeconds);
    }
  }
  const landingStopsByTrip = new Map();
  for (const departure of departures) {
    const tripId = String(departure.tripId);
    const landingStops = landingStopsByTrip.get(tripId) || new Set();
    landingStops.add(String(departure.stopId));
    landingStopsByTrip.set(tripId, landingStops);
  }
  const updates = [];
  for (const entity of feed?.entity || []) {
    const tripUpdate = entity?.tripUpdate;
    const tripId = tripUpdate?.trip?.tripId;
    if (!tripId) continue;
    const normalizedTripId = String(tripId);
    const stopDelays = (tripUpdate.stopTimeUpdate || []).map((stop) => {
      const event = timingEvent(stop);
      const scheduleKey = `${tripId}|${stop.stopId}`;
      return {
        stopId: String(stop.stopId),
        delaySeconds: eventDelaySeconds(event, schedule.get(scheduleKey), timeZone),
        predictedEpochSeconds: number(event?.time)
      };
    });
    const targetStops = landingStopsByTrip.get(normalizedTripId) ||
      new Set(stopDelays.filter((stop) => selected.has(stop.stopId)).map((stop) => stop.stopId));
    if (targetStops.size === 0) continue;
    const tripDelaySeconds = Object.hasOwn(tripUpdate, "delay") ? number(tripUpdate.delay) : null;
    const nearestStopDelay = stopDelays.find((stop) => stop.delaySeconds != null)?.delaySeconds ?? null;
    for (const stopId of targetStops) {
      const landingUpdate = stopDelays.find((stop) => stop.stopId === stopId);
      const predictedDelay = landingUpdate?.delaySeconds ?? tripDelaySeconds ?? nearestStopDelay;
      updates.push({
        tripId: normalizedTripId,
        stopId,
        delaySeconds: riderDepartureDelaySeconds(predictedDelay),
        predictedEpochSeconds: landingUpdate?.predictedEpochSeconds ?? null,
        canceled: number(tripUpdate.trip?.scheduleRelationship) === 3
      });
    }
  }
  return updates;
}

function normalizeIdentity(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function identityForms(value) {
  const normalized = normalizeIdentity(value);
  if (!normalized) return [];
  const forms = new Set([normalized]);
  const vesselCode = /^hb?0*(\d+)$/.exec(normalized);
  if (vesselCode) forms.add(`h${Number(vesselCode[1])}`);
  return [...forms];
}

export function matchFleetVessel(descriptor, fleet = []) {
  const candidates = [descriptor?.label, descriptor?.id, descriptor?.licensePlate].flatMap(identityForms);
  let best = null;
  for (const vessel of fleet) {
    const identities = [
      ...identityForms(vessel.number).map((identity) => [identity, 90]),
      ...identityForms(vessel.name).map((identity) => [identity, 80]),
      ...identityForms(vessel.id).map((identity) => [identity, 70])
    ];
    for (const candidate of candidates) {
      for (const [identity, score] of identities) {
        if (candidate !== identity && !candidate.includes(identity)) continue;
        if (!best || score > best.score) best = { vessel, score };
      }
    }
  }
  return best?.vessel || null;
}

export function normalizeVehicleAssignments(feed, fleet = []) {
  const assignments = new Map();
  for (const entity of feed?.entity || []) {
    const vehicleRecord = entity?.vehicle || entity?.tripUpdate;
    const tripId = vehicleRecord?.trip?.tripId;
    if (!tripId) continue;
    const descriptor = vehicleRecord.vehicle || {};
    const vessel = matchFleetVessel(descriptor, fleet);
    const fallback = descriptor.label || descriptor.id || descriptor.licensePlate || null;
    if (!vessel?.name && !fallback) continue;
    assignments.set(String(tripId), {
      tripId: String(tripId),
      boatName: vessel?.name || String(fallback),
      vesselNumber: vessel?.number || descriptor.id || null,
      updatedAtEpochSeconds: number(vehicleRecord.timestamp)
    });
  }
  return [...assignments.values()];
}

export function mergeVehicleAssignments(...sources) {
  const assignments = new Map();
  for (const source of sources) {
    for (const assignment of source || []) assignments.set(String(assignment.tripId), assignment);
  }
  return [...assignments.values()];
}

async function fetchFeed({ fetchImpl, url, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { Accept: "application/x-protobuf, application/octet-stream", "User-Agent": "NYC-Ferry-DiD-Reborn/1.0" }
    });
    if (!response.ok) throw new Error(`Trip updates returned ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Trip updates exceeded the size limit.");
    return transitRealtime.FeedMessage.decode(bytes);
  } finally {
    clearTimeout(timeout);
  }
}

export function createRealtimeService({ dataPath, loadDisplay = () => readFile(dataPath, "utf8").then(JSON.parse), fleetPath, cachePath, fetchImpl = globalThis.fetch, url = process.env.NYCF_TRIP_UPDATES_URL || TRIP_UPDATES_URL, vehicleUrl = process.env.NYCF_VEHICLE_POSITIONS_URL || VEHICLE_POSITIONS_URL, ttlMs = 15_000, now = () => Date.now() }) {
  let memory = null, loaded = false, inflight = null;
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
    const [display, fleetContent] = await Promise.all([
      loadDisplay(),
      readFile(fleetPath, "utf8").then(JSON.parse)
    ]);
    const [feed, vehicleFeed] = await Promise.all([
      fetchFeed({ fetchImpl, url, timeoutMs: 7000 }),
      fetchFeed({ fetchImpl, url: vehicleUrl, timeoutMs: 7000 }).catch(() => null)
    ]);
    const tripUpdateAssignments = normalizeVehicleAssignments(feed, fleetContent.vessels);
    const vehiclePositionAssignments = vehicleFeed
      ? normalizeVehicleAssignments(vehicleFeed, fleetContent.vessels)
      : (memory?.vehicles || []);
    const snapshot = {
      available: true,
      stale: false,
      fetchedAt: new Date(now()).toISOString(),
      updates: normalizeTripUpdates(feed, display.meta.landing.stopIds, {
        departures: display.departures,
        tripSchedules: display.tripSchedules,
        timeZone: display.meta.timezone
      }),
      vehicles: vehicleFeed
        ? mergeVehicleAssignments(tripUpdateAssignments, vehiclePositionAssignments)
        : mergeVehicleAssignments(vehiclePositionAssignments, tripUpdateAssignments),
      vehiclesStale: !vehicleFeed
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
        return { available: false, stale: true, fetchedAt: null, updates: [], vehicles: [], error: error.message };
      }
    }
  };
}
