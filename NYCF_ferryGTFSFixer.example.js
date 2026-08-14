// NYCF_ferryGTFSFixer.example.js
//
// Every function the boat prediction touches, in one file, in pipeline order.
// Companion to NYCF_ferryGTFSFixer.md. Run it:
//
//     node NYCF_ferryGTFSFixer.example.js
//
// It has no dependencies and touches no network: the protobuf decode and the two HTTP
// fetches are included for completeness but are never called by the demo at the bottom.
//
// Differences from the shipped code, and only these:
//   - the four client functions in section 5 take `data` / `realtime` as arguments;
//     public/app.js reads them from module-level state and from the DOM.
//   - departureCell returns a plain object instead of an HTML string, so the badge
//     decisions are inspectable without a browser.
//   - fetchFeed imports gtfs-realtime-bindings lazily so this file runs uninstalled.
// The prediction logic itself is line-for-line what lib/realtime.js, lib/nyu-realtime.js
// and public/app.js run.

// ---------------------------------------------------------------------------
// 1. Static schedule (scripts/build-data.js)
//    Produces the display-data.json that every later stage measures against.
// ---------------------------------------------------------------------------

/** Minimal RFC-4180 CSV reader: quoted fields, doubled quotes, CRLF, BOM on the header. */
export function parseCsv(input) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row); }
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header.replace(/^﻿/, ""), values[index] ?? ""])));
}

/**
 * GTFS times are seconds since noon-minus-12h of the *service* day, so hours run past 24:
 * "25:10:00" is 1:10 am on the next calendar day, still belonging to the previous service day.
 * Keeping them as seconds-of-service-day (not epoch) is what makes the whole pipeline
 * DST-proof: nothing here ever adds 86400 to a wall clock.
 */
export function timeToSeconds(value) {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(value || "");
  if (!match) throw new Error(`Invalid GTFS time: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/** GTFS dates are YYYYMMDD; everything downstream compares ISO date strings lexicographically. */
export function isoDate(value) {
  return /^\d{8}$/.test(value || "") ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;
}

/**
 * The two schedule structures the predictor needs, built from stop_times.txt.
 *
 * `departures` — one row per (trip, landing stop) the rider can board.
 * `tripSchedules` — every stop of every one of those trips, including the ones this landing
 *   does not serve. That second structure is what lets a delay observed three stops upstream
 *   be converted into a delay at this landing: without it there is no scheduled time to
 *   difference an upstream absolute prediction against.
 */
export function buildScheduleShapes(stopTimesRows, { landingStopIds = [], tripMeta = {} } = {}) {
  const timesByTrip = new Map();
  for (const row of stopTimesRows) {
    const list = timesByTrip.get(row.trip_id) || [];
    list.push(row);
    timesByTrip.set(row.trip_id, list);
  }
  for (const list of timesByTrip.values()) list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));

  const selected = new Set(landingStopIds.map(String));
  const departures = [];
  for (const [tripId, times] of timesByTrip) {
    const meta = tripMeta[tripId] || {};
    // `times.length - 1`: the last stop of a trip is an arrival, never a boardable departure.
    for (let index = 0; index < times.length - 1; index += 1) {
      const current = times[index];
      if (!selected.has(String(current.stop_id)) || current.pickup_type === "1") continue;
      const departureTime = current.departure_time || current.arrival_time;
      if (!departureTime) continue;
      departures.push({
        tripId, routeId: meta.routeId ?? "", serviceId: meta.serviceId ?? "", directionId: meta.directionId ?? "",
        stopId: String(current.stop_id), departureTime, seconds: timeToSeconds(departureTime),
        destination: meta.destination ?? "", variant: meta.variant ?? null,
        servesGovernorsIsland: false, mode: "ferry", operator: meta.operator ?? "NYC Ferry"
      });
    }
  }
  departures.sort((a, b) => a.seconds - b.seconds || String(a.routeId).localeCompare(String(b.routeId)));

  const usedTripIds = new Set(departures.map((item) => item.tripId));
  const tripSchedules = Object.fromEntries([...usedTripIds].map((tripId) => [tripId, {
    stops: (timesByTrip.get(tripId) || []).map((stopTime) => ({
      stopId: String(stopTime.stop_id),
      sequence: Number(stopTime.stop_sequence),
      arrivalSeconds: stopTime.arrival_time ? timeToSeconds(stopTime.arrival_time) : null,
      departureSeconds: stopTime.departure_time ? timeToSeconds(stopTime.departure_time) : null
    }))
  }]));

  return { departures, tripSchedules };
}

// ---------------------------------------------------------------------------
// 2. NYC Ferry GTFS-Realtime normalization (lib/realtime.js)
//    Where a raw feed becomes a rider-facing delay.
// ---------------------------------------------------------------------------

export const TRIP_UPDATES_URL = "https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/tripupdate";
export const VEHICLE_POSITIONS_URL = "https://nycferry.connexionz.net/rtt/public/utility/gtfsrealtime.aspx/vehicleposition";

/**
 * protobuf.js hands back 64-bit fields as Long objects, not numbers. Every numeric read in
 * this file goes through here so a Long, a numeric string and a plain number behave alike,
 * and anything unusable becomes null rather than NaN.
 */
export function number(value) {
  if (value == null) return null;
  if (typeof value?.toNumber === "function") return value.toNumber();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * An epoch instant → seconds since local midnight in the agency's zone.
 *
 * The feed speaks epoch seconds; the schedule speaks seconds-of-service-day. Converting
 * through Intl in `timeZone` rather than through the process clock means the answer is right
 * on a machine set to UTC, and right on both sides of a DST change.
 */
export function localSecondsOfDay(timestampSeconds, timeZone) {
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

/**
 * How late this event is, in seconds, relative to its scheduled time.
 *
 * `Object.hasOwn(event, "delay")` is deliberate and load-bearing. A decoded protobuf message
 * inherits `delay: 0` from its prototype, so a plain `event.delay` read cannot tell "the
 * producer said on time" from "the producer sent no delay at all" — and reading the inherited
 * zero would silently stamp ON TIME on a boat nobody has heard from. Only an own property is
 * a real assertion; otherwise fall through to the absolute timestamp.
 *
 * `scheduledSeconds % 86400` folds a past-midnight GTFS time (25:10:00) back onto a wall
 * clock so it can be differenced against a wall-clock reading, and the ±12h correction
 * resolves the day-boundary ambiguity that creates: a raw difference near ±86400 is a
 * midnight wrap, not a half-day delay.
 */
export function eventDelaySeconds(event, scheduledSeconds, timeZone) {
  if (!event) return null;
  if (Object.hasOwn(event, "delay")) return number(event.delay);
  const predictedTimestamp = number(event.time);
  if (predictedTimestamp == null || scheduledSeconds == null) return null;
  let delay = localSecondsOfDay(predictedTimestamp, timeZone) - (Number(scheduledSeconds) % 86400);
  if (delay > 43200) delay -= 86400;
  if (delay < -43200) delay += 86400;
  return delay;
}

/**
 * Departure beats arrival, and a field only counts if the producer actually populated it.
 *
 * A rider wants to know when the boat leaves. An arrival is only ever consulted when there is
 * no departure event at all, and even then it can only push a departure later (section 2's
 * clamp), never pull it earlier — a ferry that ties up at 09:02 for a 09:30 sailing is a boat
 * waiting on its timetable.
 */
export function timingEvent(stopUpdate) {
  const departure = stopUpdate?.departure;
  if (departure && (Object.hasOwn(departure, "delay") || number(departure.time) != null)) return departure;
  const arrival = stopUpdate?.arrival;
  if (arrival && (Object.hasOwn(arrival, "delay") || number(arrival.time) != null)) return arrival;
  return null;
}

/**
 * THE RULE, in one line. NYC Ferry boats may arrive early; they do not leave early.
 *
 * GTFS-Realtime allows negative delay because the spec serves systems whose vehicles can run
 * ahead of schedule. NYC Ferry is not one of them, and no generic consumer can infer that from
 * the feed, so the operating rule is enforced here rather than assumed upstream.
 *
 *     rider_departure = max(static_departure, realtime_prediction)
 */
export function riderDepartureDelaySeconds(value) {
  const delay = number(value);
  return delay == null ? null : Math.max(0, delay);
}

/**
 * The whole trip-update feed → one clamped update per (trip, landing stop).
 *
 * Two indexes are built first:
 *   `schedule`      "tripId|stopId" → scheduled seconds, from the landing's departures *and*
 *                   from tripSchedules, so upstream stops are convertible too.
 *   `landingStopsByTrip`  which of this landing's stops each trip actually serves. A landing
 *                   can map to more than one GTFS stop, and the answer must not depend on
 *                   whether the producer happened to include that stop in this message.
 *
 * Then, per landing stop, the delay is resolved down a three-rung ladder:
 *   1. the stop's own delay,
 *   2. the trip-level `delay` (whole boat running late),
 *   3. the first stop anywhere on the trip with a usable delay (feed order — nearest first).
 * Each rung is a weaker claim than the one above it, and all three are clamped identically:
 * a fallback may delay a departure, never advance one.
 */
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
    // Prefer the schedule's answer to the feed's: the trips this landing boards are known
    // locally, so a producer omitting the landing's stop cannot make the trip disappear.
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
        // Kept raw and unclamped: diagnostics only. Nothing rider-facing reads it.
        predictedEpochSeconds: landingUpdate?.predictedEpochSeconds ?? null,
        // ScheduleRelationship 3 = CANCELED. Cancellation is orthogonal to the clamp and is
        // always honored: a canceled trip is removed, not shown as very late.
        canceled: number(tripUpdate.trip?.scheduleRelationship) === 3
      });
    }
  }
  return updates;
}

// ---------------------------------------------------------------------------
// 3. Boat names (lib/realtime.js, content/vessels.json)
//    Turning a vehicle descriptor into "Waves of Wonder".
// ---------------------------------------------------------------------------

/** Strip accents, case and punctuation so "H-101", "H101" and "h 101" compare equal. */
export function normalizeIdentity(value) {
  return String(value || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The forms one identifier can legitimately take across the feeds.
 *
 * The same hull appears as `H-101` in the roster, `H101` in a vehicle label and `HB0101` in
 * an AVL id. The regex folds the optional B and any zero padding to a canonical `h101`, so
 * all three collapse to one identity instead of three near-misses.
 */
export function identityForms(value) {
  const normalized = normalizeIdentity(value);
  if (!normalized) return [];
  const forms = new Set([normalized]);
  const vesselCode = /^hb?0*(\d+)$/.exec(normalized);
  if (vesselCode) forms.add(`h${Number(vesselCode[1])}`);
  return [...forms];
}

/**
 * Best fleet match for a vehicle descriptor, scored by how trustworthy the matched field is:
 * hull number (90) > vessel name (80) > internal slug (70). Containment counts, because
 * labels arrive decorated ("NYCF H101"), and the highest score wins so a hull-number hit is
 * never displaced by an incidental name substring.
 */
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

/**
 * trip id → boat, from either feed.
 *
 * `entity.vehicle || entity.tripUpdate` is not a typo: NYC Ferry's producer attaches a vehicle
 * descriptor to trip updates as well, and for a boat sitting at its terminal that is often the
 * only place the assignment appears — the vehicle-positions feed may not carry it yet. Reading
 * both is what puts a boat name on the next departure instead of the one after it.
 *
 * An unmatched descriptor still yields its raw label rather than nothing: a rider gains more
 * from "H109" than from a blank space.
 */
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

/** Last source wins per trip id. The caller orders the sources by freshness, not by feed. */
export function mergeVehicleAssignments(...sources) {
  const assignments = new Map();
  for (const source of sources) {
    for (const assignment of source || []) assignments.set(String(assignment.tripId), assignment);
  }
  return [...assignments.values()];
}

// ---------------------------------------------------------------------------
// 4. Fetch, cache, serve (lib/realtime.js, server.js)
// ---------------------------------------------------------------------------

/**
 * One protobuf feed, with three guards: a 7s abort so a hung producer cannot stall the poll
 * loop, a non-2xx throw so an HTML error page is never decoded as protobuf, and a 5 MB cap so
 * a runaway response cannot exhaust a kiosk's memory.
 *
 * The import is lazy here only so this example runs without node_modules; lib/realtime.js
 * imports gtfs-realtime-bindings at the top of the file.
 */
export async function fetchFeed({ fetchImpl = globalThis.fetch, url, timeoutMs = 7000 }) {
  const { default: GtfsRealtimeBindings } = await import("gtfs-realtime-bindings");
  const { transit_realtime: transitRealtime } = GtfsRealtimeBindings;
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

/**
 * The polling service behind /api/realtime.
 *
 * Three properties matter more than the code:
 *   TTL — a 15s snapshot serves every caller, so N kiosks and N tabs are still one request.
 *   Single-flight — `inflight` collapses concurrent misses into one upstream fetch.
 *   Never-worse-than-stale — a failed refresh returns the last good snapshot with
 *     `stale: true`, and only a cold cache reports `available: false`. `stale` is not
 *     cosmetic: the client stops trusting delays entirely and shows published times.
 *
 * Writes go through a temp file and rename() so a kiosk losing power mid-write cannot leave a
 * truncated snapshot that poisons the next boot.
 *
 * Note the two merge orders. With a live vehicle feed, positions are merged last and win.
 * With the vehicle feed down, the cached positions are merged *first* so today's fresh
 * trip-update assignments overwrite yesterday's remembered ones.
 */
export function createRealtimeService({
  dataPath, fleetPath, cachePath,
  readJson, writeSnapshot,
  fetchImpl = globalThis.fetch,
  url = TRIP_UPDATES_URL, vehicleUrl = VEHICLE_POSITIONS_URL,
  ttlMs = 15_000, now = () => Date.now()
}) {
  let memory = null, loaded = false, inflight = null;
  async function loadCache() {
    if (loaded) return memory;
    loaded = true;
    try { memory = await readJson(cachePath); } catch { memory = null; }
    return memory;
  }
  async function refresh() {
    const [display, fleetContent] = await Promise.all([readJson(dataPath), readJson(fleetPath)]);
    const [feed, vehicleFeed] = await Promise.all([
      fetchFeed({ fetchImpl, url, timeoutMs: 7000 }),
      // The vehicle feed is optional: losing boat names must not cost the board its delays.
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
    await writeSnapshot(cachePath, snapshot);
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

/**
 * /api/realtime, as server.js assembles it.
 *
 * NYU's updates are already namespaced with the `nyu:` ids the display was built with, so they
 * concatenate into one array the client resolves through a single lookup. Either operator can
 * fail without taking the other's estimates down, and either being stale marks the payload
 * stale — which only ever falls back to published times.
 */
export function mergeRealtimePayload(ferry, nyu) {
  return {
    ...ferry,
    available: ferry.available || nyu.available,
    stale: Boolean(ferry.stale || nyu.stale),
    updates: [...(ferry.updates || []), ...(nyu.updates || [])],
    nyu: { available: nyu.available, stale: nyu.stale, fetchedAt: nyu.fetchedAt, error: nyu.error }
  };
}

// ---------------------------------------------------------------------------
// 5. The board (public/app.js)
//    Second, independent enforcement of the clamp.
// ---------------------------------------------------------------------------

/** Wall clock in the agency's zone: the service-date key and seconds since local midnight. */
export function zonedParts(date = new Date(), timeZone = "America/New_York") {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    seconds: (Number(values.hour) % 24) * 3600 + Number(values.minute) * 60 + Number(values.second)
  };
}

/** Calendar arithmetic through UTC, so a DST day is still exactly one day. */
export function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

/** calendar.txt windows for the weekday, then calendar_dates.txt exceptions layered on top. */
export function activeServices(data, dateKey) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  const active = new Set();
  for (const item of data.calendars || []) {
    if (dateKey >= item.startDate && dateKey <= item.endDate && item.weekdays[weekday]) active.add(item.serviceId);
  }
  for (const item of data.exceptions || []) {
    if (item.date !== dateKey) continue;
    if (item.added) active.add(item.serviceId); else active.delete(item.serviceId);
  }
  return active;
}

/** Scheduled time plus clamped delay → the clock face a rider reads. */
export function adjustedTime(raw, delaySeconds = 0) {
  const [hours, minutes, seconds] = raw.split(":").map(Number);
  const total = hours * 3600 + minutes * 60 + seconds + delaySeconds;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(2020, 0, 1, Math.floor(total / 3600) % 24, Math.floor((total % 3600) / 60))));
}

/** The countdown. 90 seconds is the Boarding threshold, and it is measured from the clamped delta. */
export function relativeTime(deltaSeconds) {
  if (deltaSeconds <= 90) return "Boarding";
  if (deltaSeconds < 3600) return `${Math.ceil(deltaSeconds / 60)} min`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)} hr ${Math.ceil((deltaSeconds % 3600) / 60)} min`;
  return "Tomorrow";
}

/**
 * Everything the board shows, grouped by route direction.
 *
 * The parts that are about prediction rather than layout:
 *
 *   offset -1..0    Two service days are walked. A 00:30 sailing is 24:30 on the *previous*
 *                   service day, and would be invisible after midnight if only today were
 *                   considered. `calendarDate` then drops rows that land on another date.
 *   hasLiveTiming   A stale payload is not partially trusted. If the snapshot is stale, or the
 *                   update carries no delay, the delay is 0 and the row shows its published
 *                   time — degrading to the timetable, never to a guess.
 *   Math.max(0,…)   The clamp again, on the client. lib/realtime.js already clamped, but this
 *                   value can also arrive from localStorage or an older server, and each
 *                   boundary that can supply a delay enforces the rule itself.
 *   delta           offset*86400 + scheduled + delay - now. One signed number driving order,
 *                   countdown, Boarding and removal, so those four can never disagree.
 *   delta < -60     A 60s grace after the (delayed) departure, then the row goes.
 *   lastDepartures  LAST is computed over the whole service day *before* that filter, so it
 *                   marks the day's final sailing rather than the last one still on screen.
 */
export function routeDirectionGroups(data, realtime, now = new Date()) {
  const current = zonedParts(now, data.meta.timezone);
  const departureWindowSeconds = (Number(data.meta.departureWindowMinutes) || 180) * 60;
  const updates = new Map((realtime.updates || []).map((item) => [`${item.tripId}|${item.stopId}`, item]));
  const vehicles = new Map((realtime.vehicles || []).map((item) => [String(item.tripId), item]));
  const groups = new Map();
  const lastDepartures = new Map();
  const lastGovernorsIslandDepartures = new Map();

  for (let offset = -1; offset <= 0; offset += 1) {
    const serviceDate = addDays(current.dateKey, offset);
    const active = activeServices(data, serviceDate);
    for (const departure of data.departures || []) {
      if (!active.has(departure.serviceId)) continue;
      const calendarDate = addDays(serviceDate, Math.floor(departure.seconds / 86400));
      if (calendarDate !== current.dateKey) continue;
      const update = updates.get(`${departure.tripId}|${departure.stopId}`);
      if (update?.canceled) continue;
      const liveDelay = Number(update?.delaySeconds);
      const hasLiveTiming = !realtime.stale && update?.delaySeconds != null && Number.isFinite(liveDelay);
      // NYC Ferry boats may arrive ahead of schedule, but never depart early.
      // Keep the published departure as the rider-facing floor even for old cached updates.
      const delay = hasLiveTiming ? Math.max(0, liveDelay) : 0;
      const delta = offset * 86400 + departure.seconds + delay - current.seconds;
      const slotKey = `${departure.routeId}|${departure.variant || ""}|${departure.directionId}`;
      const scheduledMoment = offset * 86400 + departure.seconds;
      const previousLast = lastDepartures.get(slotKey);
      if (!previousLast || scheduledMoment > previousLast.scheduledMoment) {
        lastDepartures.set(slotKey, { tripId: String(departure.tripId), scheduledMoment });
      }
      if (departure.routeId === "SB" && departure.servesGovernorsIsland) {
        const previousIslandLast = lastGovernorsIslandDepartures.get(slotKey);
        if (!previousIslandLast || scheduledMoment > previousIslandLast.scheduledMoment) {
          lastGovernorsIslandDepartures.set(slotKey, { tripId: String(departure.tripId), scheduledMoment });
        }
      }
      if (delta < -60) continue;
      const key = `${departure.routeId}|${departure.variant || ""}|${departure.directionId}|${departure.destination}`;
      const group = groups.get(key) || {
        key, routeId: departure.routeId, directionId: departure.directionId,
        destination: departure.destination, variant: departure.variant || null, departures: []
      };
      group.departures.push({
        ...departure,
        delay,
        delta,
        hasLiveTiming,
        boatName: vehicles.get(String(departure.tripId))?.boatName || null
      });
      groups.set(key, group);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      departures: group.departures
        .sort((left, right) => left.delta - right.delta)
        .map((departure) => ({
          ...departure,
          isLastOfDay: lastDepartures.get(`${departure.routeId}|${departure.variant || ""}|${departure.directionId}`)?.tripId === String(departure.tripId),
          isLastGovernorsIsland: departure.servesGovernorsIsland &&
            lastGovernorsIslandDepartures.get(`${departure.routeId}|${departure.variant || ""}|${departure.directionId}`)?.tripId === String(departure.tripId)
        }))
    }))
    // A route qualifies on its *next* departure only; once shown, every column is filled even
    // with trips outside the window, so a row is never half empty.
    .filter((group) => group.departures[0]?.delta <= departureWindowSeconds)
    .map((group) => ({ ...group, departures: group.departures.slice(0, Number(data.meta.departuresShown) || 3) }))
    .sort((left, right) => {
      const routeOrder = left.routeId.localeCompare(right.routeId);
      if (routeOrder) return routeOrder;
      const variantOrder = { A: 0, B: 1, LOCAL: 2 };
      const variantDifference = (variantOrder[left.variant] ?? 3) - (variantOrder[right.variant] ?? 3);
      if (variantDifference) return variantDifference;
      const directionOrder = String(left.directionId).localeCompare(String(right.directionId));
      return directionOrder || left.destination.localeCompare(right.destination);
    });
}

/**
 * One departure column. public/app.js returns HTML; this returns the same decisions as data.
 *
 * The badge ladder is the prediction made legible, and each rung means something different:
 *   +N min     fresh timing, ≥60s late. Rounded to at least 1 so it never reads "+0 min".
 *   ON TIME    fresh timing, <60s late — a positive statement that a boat was heard from.
 *   SCHEDULED  no fresh timing. Published time, no claim about the boat.
 *   LAST       final sailing of the service day, and it outranks the other three.
 */
export function departureCell(item, realtime) {
  const delaySeconds = Number(item.delay);
  const hasFreshTiming = !realtime.stale && item.hasLiveTiming && Number.isFinite(delaySeconds);
  const delayLabel = hasFreshTiming && delaySeconds >= 60 ? `+${Math.max(1, Math.round(delaySeconds / 60))} min` : "";
  const onTimeLabel = hasFreshTiming && delaySeconds < 60 ? "ON TIME" : "";
  const isLast = item.isLastOfDay || item.isLastGovernorsIsland;
  const lastLabel = isLast ? "LAST" : "";
  const scheduledLabel = !isLast && !delayLabel && !onTimeLabel ? "SCHEDULED" : "";
  return {
    time: adjustedTime(item.departureTime, item.delay),
    boatName: item.boatName || "",
    relative: relativeTime(item.delta),
    badges: [lastLabel, delayLabel || onTimeLabel || scheduledLabel].filter(Boolean)
  };
}

// ---------------------------------------------------------------------------
// 6. NYU Langone via Passio GO (lib/nyu-realtime.js)
//    A predicted arrival, from a producer with no GTFS at all.
// ---------------------------------------------------------------------------

export const PASSIO_HOST = "https://passio3.com/www";
export const NYU_SYSTEM_ID = "1007";
export const NYU_ROUTE_ID = "45769";
const PREFIX = "nyu:";
// Passio ignores the value but requires the parameter; it identifies a client, not a credential.
const DEVICE_ID = "99999999";

/**
 * Passio stamps are "YYYY-MM-DD HH:MM:SS" in local time, with parallel *Utc fields.
 * `pseudoEpoch` reads the wall clock as if it were UTC — legitimate only because it is ever
 * differenced against another reading parsed the same way, so the fictional offset cancels.
 */
export function parseStamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    secondsOfDay: hour * 3600 + minute * 60 + second,
    pseudoEpoch: Math.floor(Date.UTC(year, month - 1, day, hour, minute, second) / 1000)
  };
}

/** GTFS "HH:MM:SS" → seconds of day, tolerating the 24+ hour form. */
export function secondsOfDay(gtfsTime) {
  const match = /^(\d{1,3}):(\d{2}):(\d{2})$/.exec(String(gtfsTime || ""));
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

/**
 * One Passio ETA payload → the same update shape lib/realtime.js emits, `nyu:`-prefixed.
 *
 * `solidEta.scheduledDeparture` cannot identify the sailing a prediction belongs to: it reports
 * the *block's* first departure, so a boat predicted to dock at 09:22 comes back tagged
 * `06:00` with `tripIndex: 0`, and differencing the two invents a three-hour delay on a ferry
 * running perfectly. Only the predicted arrival is trustworthy, so the sailing is resolved from
 * the static timetable instead: an inbound boat works the next departure not yet due, and it is
 * late only if it docks after that departure's published time.
 *
 * A sailing whose time has already passed is never revived — Passio cannot say whether an
 * earlier boat already worked it, and showing a departed sailing as merely "late" is worse on a
 * platform than showing the published time.
 *
 * `now` comes from Passio's own clock, so a drifting kiosk clock cannot shift which sailing a
 * prediction attaches to. NYU sails 05:30–20:15 with nothing crossing midnight, so seconds-of-day
 * comparison needs no wrap handling.
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
      // A recorded arrival outranks a prediction; both are arrivals, so both are only ever a
      // floor on when the boat can leave again.
      const arrival = parseStamp(solid.arrivalActual || solid.arrival);
      const arrivalUtc = parseStamp(solid.arrivalActualUtc || solid.arrivalUtc);
      if (!arrival) continue;
      const now = nowSecondsOfDay ?? parseStamp(payload?.time)?.secondsOfDay ?? arrival.secondsOfDay;

      const target = schedule.find((departure) => secondsOfDay(departure.departureTime) >= now);
      if (!target) continue;
      const scheduledSeconds = secondsOfDay(target.departureTime);
      // rider_departure = max(static_departure, realtime_prediction). Clamped at the source, so
      // no consumer of /api/realtime can observe a negative NYU delay in the first place.
      const delaySeconds = Math.max(0, arrival.secondsOfDay - scheduledSeconds);
      // Two inbound boats both resolve to the next sailing; the one arriving first works it.
      const existing = best.get(target.tripId);
      if (existing && existing.delaySeconds <= delaySeconds) continue;
      best.set(target.tripId, {
        tripId: target.tripId,
        stopId: target.stopId,
        delaySeconds,
        predictedEpochSeconds: arrivalUtc
          ? arrivalUtc.pseudoEpoch - arrival.secondsOfDay + scheduledSeconds + delaySeconds
          : null,
        // Passio models a boat going out of service, never a canceled sailing, so no
        // cancellation is ever asserted from this feed.
        canceled: false
      });
    }
  }
  return [...best.values()];
}

/** One stop's ETA JSON. Same 7s abort and non-2xx throw as the protobuf path. */
export async function fetchEta({ fetchImpl = globalThis.fetch, stopId, timeoutMs = 7000 }) {
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

/**
 * Same TTL / single-flight / stale-fallback contract as createRealtimeService.
 *
 * The one asymmetry: a landing with no NYU dock is the normal case and is a *success with
 * nothing to report*, not an error — otherwise 22 of 25 landings would permanently mark
 * /api/realtime degraded and suppress NYC Ferry's own live estimates.
 */
export function createNyuRealtimeService({
  dataPath, cachePath, readJson, writeSnapshot,
  fetchImpl = globalThis.fetch, ttlMs = 15_000, now = () => Date.now()
}) {
  let memory = null, loaded = false, inflight = null;
  const empty = { available: false, stale: true, fetchedAt: null, updates: [] };

  async function loadCache() {
    if (loaded) return memory;
    loaded = true;
    try { memory = await readJson(cachePath); } catch { memory = null; }
    return memory;
  }
  async function refresh() {
    const display = await readJson(dataPath);
    const stopIds = display.meta?.nyu?.enabled ? (display.meta.nyu.stopIds || []) : [];
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
    await writeSnapshot(cachePath, snapshot);
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

// ---------------------------------------------------------------------------
// 7. Demo — the pipeline end to end, on fixtures, with no network.
// ---------------------------------------------------------------------------

/** A decoded protobuf event: `delay: 0` on the prototype, `time` as an own property. */
function protobufEvent(fields) {
  return Object.assign(Object.create({ delay: 0 }), fields);
}

const TIMEZONE = "America/New_York";
const FLEET = [
  { id: "waves-of-wonder", name: "Waves of Wonder", number: "H-101" },
  { id: "dream-boat", name: "Dream Boat", number: "H-119" }
];

// Landing 8, East 34th Street (GTFS stop 17), on a Tuesday, at 18:00:00 local.
const NOW = new Date("2026-07-14T22:00:00Z");
const DISPLAY_DATA = {
  meta: {
    timezone: TIMEZONE, agencyName: "NYC Ferry", departureWindowMinutes: 500,
    departuresShown: 3, routesShown: 4,
    landing: { displayName: "East 34th Street", stopIds: ["17"] }
  },
  calendars: [{ serviceId: "1", weekdays: [false, true, true, true, true, true, false], startDate: "2026-01-01", endDate: "2026-12-31" }],
  exceptions: [],
  routes: { ER: { id: "ER", shortName: "ER", name: "East River", operator: "NYC Ferry" } },
  departures: [
    { tripId: "801", routeId: "ER", serviceId: "1", directionId: "1", stopId: "17", departureTime: "18:05:00", seconds: 65100, destination: "Long Island City", variant: "LOCAL", servesGovernorsIsland: false, operator: "NYC Ferry" },
    { tripId: "802", routeId: "ER", serviceId: "1", directionId: "1", stopId: "17", departureTime: "18:20:00", seconds: 66000, destination: "Long Island City", variant: "LOCAL", servesGovernorsIsland: false, operator: "NYC Ferry" },
    { tripId: "803", routeId: "ER", serviceId: "1", directionId: "1", stopId: "17", departureTime: "18:35:00", seconds: 66900, destination: "Long Island City", variant: "LOCAL", servesGovernorsIsland: false, operator: "NYC Ferry" },
    { tripId: "804", routeId: "ER", serviceId: "1", directionId: "1", stopId: "17", departureTime: "18:50:00", seconds: 67800, destination: "Long Island City", variant: "LOCAL", servesGovernorsIsland: false, operator: "NYC Ferry" }
  ],
  tripSchedules: {
    // Trip 803 calls at Wall St/Pier 11 (87) before this landing — the upstream stop that
    // makes rung 3 of the ladder convertible.
    "803": { stops: [
      { stopId: "87", sequence: 1, arrivalSeconds: 66000, departureSeconds: 66000 },
      { stopId: "17", sequence: 2, arrivalSeconds: 66900, departureSeconds: 66900 }
    ] }
  }
};

const TRIP_UPDATE_FEED = {
  entity: [
    // 801 — the producer says the boat is 4 minutes early. The clamp holds the published time.
    { tripUpdate: { trip: { tripId: "801" }, vehicle: { id: "H101", label: "H101" }, timestamp: 1784412000,
      stopTimeUpdate: [{ stopId: "17", departure: { delay: -240 } }] } },
    // 802 — no `delay` field at all, only an absolute prediction: 18:27:00 local for an 18:20
    // sailing. Derived through the timezone, not the process clock.
    { tripUpdate: { trip: { tripId: "802" }, vehicle: { id: "51", label: "H119" }, timestamp: 1784412000,
      stopTimeUpdate: [{ stopId: "17", departure: protobufEvent({ time: Date.parse("2026-07-14T22:27:00Z") / 1000 }) }] } },
    // 803 — nothing at this landing; only the upstream stop 87, running 6 minutes late.
    // Rung 3 carries that delay down to stop 17.
    { tripUpdate: { trip: { tripId: "803" },
      stopTimeUpdate: [{ stopId: "87", departure: { delay: 360 } }] } },
    // 804 — canceled.
    { tripUpdate: { trip: { tripId: "804", scheduleRelationship: 3 },
      stopTimeUpdate: [{ stopId: "17", departure: { delay: 0 } }] } }
  ]
};

const VEHICLE_FEED = {
  entity: [
    { vehicle: { trip: { tripId: "801" }, vehicle: { id: "HB0101", label: "NYCF HB0101" }, timestamp: 1784412060 } }
  ]
};

const NYU_PAYLOAD = {
  time: "2026-07-14 09:05:00",
  ETAs: {
    // Passio predicts a 09:22 dock. scheduledDeparture says 06:00 — the block's first sailing,
    // deliberately ignored. The next sailing not yet due is 09:30, so the boat is on time.
    "13138": [{ solidEta: { arrival: "2026-07-14 09:22:00", arrivalUtc: "2026-07-14 13:22:00", scheduledDeparture: "2026-07-14 06:00:00", tripIndex: 0 } }]
  }
};
const NYU_DEPARTURES = [
  { tripId: "nyu:t1", routeId: "nyu:45769", stopId: "nyu:13138", departureTime: "09:00:00" },
  { tripId: "nyu:t2", routeId: "nyu:45769", stopId: "nyu:13138", departureTime: "09:30:00" },
  { tripId: "nyu:t3", routeId: "nyu:45769", stopId: "nyu:13138", departureTime: "10:00:00" }
];

function main() {
  const line = (title) => console.log(`\n${title}\n${"-".repeat(title.length)}`);

  line("1. normalizeTripUpdates — the delay ladder, clamped");
  const updates = normalizeTripUpdates(TRIP_UPDATE_FEED, DISPLAY_DATA.meta.landing.stopIds, {
    departures: DISPLAY_DATA.departures,
    tripSchedules: DISPLAY_DATA.tripSchedules,
    timeZone: TIMEZONE
  });
  for (const update of updates) {
    console.log(`  trip ${update.tripId} stop ${update.stopId}  delay ${String(update.delaySeconds).padStart(4)}s  canceled=${update.canceled}`);
  }
  console.log("  801: producer said -240s (early) → 0s. The published time is a floor.");
  console.log("  802: no delay field; 18:27 local vs an 18:20 sailing → 420s.");
  console.log("  803: no update at this landing; +360s inherited from stop 87 upstream.");
  console.log("  804: canceled — removed from the board, not shown as late.");

  line("2. Vehicle assignments — descriptor to boat name");
  const fromTripUpdates = normalizeVehicleAssignments(TRIP_UPDATE_FEED, FLEET);
  const fromPositions = normalizeVehicleAssignments(VEHICLE_FEED, FLEET);
  const vehicles = mergeVehicleAssignments(fromTripUpdates, fromPositions);
  for (const vehicle of vehicles) {
    console.log(`  trip ${vehicle.tripId} → ${vehicle.boatName} (${vehicle.vesselNumber})`);
  }
  console.log(`  identityForms("HB0101") = ${JSON.stringify(identityForms("HB0101"))}`);
  console.log(`  identityForms("H-101")  = ${JSON.stringify(identityForms("H-101"))}`);
  console.log("  801's descriptor reads label \"NYCF HB0101\", id \"HB0101\". The label folds to");
  console.log("  nothing useful; the id folds to h101 and scores 90 against the roster's H-101.");
  console.log("  Trip 802's boat is known only from the trip-update feed — a boat at its");
  console.log("  terminal often has no vehicle-position record yet.");

  line("3. The board — 18:00:00 local, live");
  const realtime = { available: true, stale: false, updates, vehicles };
  const groups = routeDirectionGroups(DISPLAY_DATA, realtime, NOW);
  for (const group of groups) {
    console.log(`  ${group.routeId} ${group.variant || ""} → ${group.destination}`);
    for (const item of group.departures) {
      const cell = departureCell(item, realtime);
      console.log(`    ${item.departureTime} → ${cell.time.padEnd(8)} ${cell.relative.padEnd(8)} ${cell.boatName.padEnd(16)} ${cell.badges.join(" ")}`);
    }
  }
  console.log("  18:35 carries LAST because 18:50 is canceled: LAST is computed over the");
  console.log("  sailings that survive cancellation, so it names the last boat that will run.");

  line("4. The same board with a stale snapshot");
  const staleRealtime = { ...realtime, stale: true };
  for (const group of routeDirectionGroups(DISPLAY_DATA, staleRealtime, NOW)) {
    for (const item of group.departures) {
      const cell = departureCell(item, staleRealtime);
      console.log(`    ${item.departureTime} → ${cell.time.padEnd(8)} ${cell.relative.padEnd(8)} ${cell.badges.join(" ")}`);
    }
  }
  console.log("  Every delay is dropped and the published times return — the board degrades to");
  console.log("  the timetable, never to a guess. 804 stays canceled: the cancellation check");
  console.log("  runs before the staleness check, so a removed sailing is not resurrected by a");
  console.log("  feed outage. That is why 18:35 still carries LAST here as well.");

  line("5. NYU via Passio — an arrival is not a departure");
  for (const update of normalizeNyuEtas(NYU_PAYLOAD, { departures: NYU_DEPARTURES })) {
    console.log(`  ${update.tripId} at ${update.stopId}  delay ${update.delaySeconds}s`);
  }
  console.log("  Docking at 09:22 for a 09:30 sailing is a boat waiting on its timetable:");
  console.log("  0s late, and the 09:30 departure stays at 09:30.");

  line("6. The clamp, case by case (gtfsferry.md's required matrix)");
  const cases = [
    ["departure 09:55 for a 10:00 sailing", { stopId: "1", departure: protobufEvent({ time: Date.parse("2026-07-14T13:55:00Z") / 1000 }) }],
    ["delay -300s", { stopId: "1", departure: { delay: -300 } }],
    ["arrival 09:55, no departure", { stopId: "1", arrival: protobufEvent({ time: Date.parse("2026-07-14T13:55:00Z") / 1000 }) }],
    ["departure 10:07", { stopId: "1", departure: protobufEvent({ time: Date.parse("2026-07-14T14:07:00Z") / 1000 }) }],
    ["delay +420s", { stopId: "1", departure: { delay: 420 } }]
  ];
  for (const [label, stopTimeUpdate] of cases) {
    const [result] = normalizeTripUpdates(
      { entity: [{ tripUpdate: { trip: { tripId: "t" }, stopTimeUpdate: [stopTimeUpdate] } }] },
      ["1"],
      { departures: [{ tripId: "t", stopId: "1", seconds: 36000 }], timeZone: TIMEZONE }
    );
    console.log(`  ${label.padEnd(38)} → 10:00 + ${String(result.delaySeconds).padStart(3)}s = ${adjustedTime("10:00:00", result.delaySeconds)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
