import { readFile } from "node:fs/promises";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { createCachedSnapshotService } from "./cached-snapshot.js";
import { withTimeout } from "./request.js";

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
    // A home-port run is timed by a trip that is not its own — its id is minted by the build and no
    // feed entity carries it — so it registers its stop against the revenue trip behind it. That
    // stop is the one that trip *ends* at, which is never a stop it departs from, so nothing else
    // in this loop would have asked for it and no boat going home ever inherited its own lateness.
    // Rows with no trip behind them, crew shuttles above all, have no liveTripId and are unchanged.
    const tripId = String(departure.liveTripId || departure.tripId);
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

// VehicleStopStatus, which protobuf gives as a number and a hand-written test fixture gives as the
// name. Both are accepted rather than picked between; nothing downstream should have to know which
// of the two it is looking at.
const STOP_STATUS = {
  0: "incoming", INCOMING_AT: "incoming",
  1: "stopped", STOPPED_AT: "stopped",
  2: "in-transit", IN_TRANSIT_TO: "in-transit"
};

/**
 * Where each boat is, from the same vehicle-position feed the vessel names are read out of.
 *
 * Kept apart from normalizeVehicleAssignments deliberately. That one answers "which vessel is
 * working this trip", which every departure row on the board wants; this one answers "and where is
 * it right now", which only the map wants. Fusing them would put a latitude on every row of a
 * payload that is fetched every fifteen seconds by every board and rendered by none of them.
 *
 * An entity with no position is skipped: it is a boat the feed knows of but cannot place, which is
 * nothing a map can draw.
 */
export function normalizeVehiclePositions(feed, fleet = []) {
  const positions = [];
  for (const entity of feed?.entity || []) {
    const vehicle = entity?.vehicle;
    const latitude = number(vehicle?.position?.latitude);
    const longitude = number(vehicle?.position?.longitude);
    if (latitude == null || longitude == null) continue;
    const descriptor = vehicle.vehicle || {};
    const vessel = matchFleetVessel(descriptor, fleet);
    const fallback = descriptor.label || descriptor.id || descriptor.licensePlate || null;
    positions.push({
      id: String(entity.id ?? descriptor.id ?? positions.length),
      tripId: vehicle.trip?.tripId == null ? null : String(vehicle.trip.tripId),
      latitude,
      longitude,
      // Read through Object.hasOwn rather than off the message, for the same reason the trip delay
      // above is: protobuf serves an unset optional field from the prototype as its zero, and this
      // vendor never sets bearing. Taken at face value that is not "no heading", it is every boat
      // in the harbor pointing due north.
      bearing: Object.hasOwn(vehicle.position, "bearing") ? number(vehicle.position.bearing) : null,
      speed: Object.hasOwn(vehicle.position, "speed") ? number(vehicle.position.speed) : null,
      // current_status defaults to IN_TRANSIT_TO in the spec itself, so reading it through the
      // prototype says what the feed means. current_stop_sequence has no such default, and a zero
      // read off an unset field would point at a stop no trip has.
      status: STOP_STATUS[vehicle.currentStatus] ?? null,
      stopSequence: Object.hasOwn(vehicle, "currentStopSequence") ? number(vehicle.currentStopSequence) : null,
      // The name on the hull if the fleet list knows this vessel, and the feed's own label — "H204"
      // — if it does not. A boat with neither is still worth drawing.
      boatName: vessel?.name || (fallback == null ? null : String(fallback)),
      vesselNumber: vessel?.number || descriptor.id || null,
      updatedAtEpochSeconds: number(vehicle.timestamp)
    });
  }
  return positions;
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

// Which boat works each trip, from the schedule workbook's assignments.
//
// The feed names a vessel per trip, and only for trips it has actually reached: a sailing three
// hours out has no vehicle and so no name. But the workbook says which *boat* runs it — "ER3" — and
// the same boat is out on the water right now under some vessel. Pairing the two says which vessel
// is on which boat, and that is what lets a later departure name the vessel it expects.
//
// Built from the merged view of every landing, so a trip is resolvable even when it never calls at
// the landing being displayed. Pier C depends on that entirely: none of its rows carry a feed trip.
export function boatByTrip(departures = []) {
  const byTrip = new Map();
  for (const departure of departures) {
    if (!Number.isInteger(departure.boatAssignment)) continue;
    byTrip.set(String(departure.tripId), `${departure.routeId}${departure.boatAssignment}`);
  }
  return byTrip;
}

export function withBoatAssignments(vehicles = [], byTrip = new Map()) {
  return vehicles.map((vehicle) => {
    const boat = byTrip.get(String(vehicle.tripId));
    return boat ? { ...vehicle, boat } : vehicle;
  });
}

export function mergeVehicleAssignments(...sources) {
  const assignments = new Map();
  for (const source of sources) {
    for (const assignment of source || []) assignments.set(String(assignment.tripId), assignment);
  }
  return [...assignments.values()];
}

async function fetchFeed({ fetchImpl, url, timeoutMs }) {
  return withTimeout(timeoutMs, async (signal) => {
    const response = await fetchImpl(url, {
      signal,
      headers: { Accept: "application/x-protobuf, application/octet-stream", "User-Agent": "NYC-Ferry-DiD-Reborn/1.0" }
    });
    if (!response.ok) throw new Error(`Trip updates returned ${response.status}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("Trip updates exceeded the size limit.");
    return transitRealtime.FeedMessage.decode(bytes);
  });
}

export function createRealtimeService({ dataPath, loadDisplay = () => readFile(dataPath, "utf8").then(JSON.parse), fleetPath, cachePath, fetchImpl = globalThis.fetch, url = process.env.NYCF_TRIP_UPDATES_URL || TRIP_UPDATES_URL, vehicleUrl = process.env.NYCF_VEHICLE_POSITIONS_URL || VEHICLE_POSITIONS_URL, ttlMs = 15_000, now = () => Date.now() }) {
  return createCachedSnapshotService({
    cachePath, ttlMs, now,
    empty: { available: false, stale: true, fetchedAt: null, updates: [], vehicles: [], positions: [] },
    async refresh(memory) {
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
      return {
        available: true,
        stale: false,
        fetchedAt: new Date(now()).toISOString(),
        updates: normalizeTripUpdates(feed, display.meta.landing.stopIds, {
          departures: display.departures,
          tripSchedules: display.tripSchedules,
          timeZone: display.meta.timezone
        }),
        vehicles: withBoatAssignments(vehicleFeed
          ? mergeVehicleAssignments(tripUpdateAssignments, vehiclePositionAssignments)
          : mergeVehicleAssignments(vehiclePositionAssignments, tripUpdateAssignments),
          boatByTrip(display.departures)),
        // Only the vehicle-position feed carries a position, so a fetch that lost it keeps the last
        // one it had — the same fallback the vessel names take one line above, and marked stale by
        // the same flag.
        positions: vehicleFeed ? normalizeVehiclePositions(vehicleFeed, fleetContent.vessels) : (memory?.positions || []),
        vehiclesStale: !vehicleFeed
      };
    }
  });
}
