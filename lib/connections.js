// What else leaves from the stops a trip calls at.
//
// The board answers "when does my boat go". The question after that one is "and when they get off,
// what can they catch?", which no single landing's payload can answer: a payload is scoped to its
// own stops, so the client holding it has no idea what leaves from the far end. The server does —
// every landing is built and resident at boot — so the answer is assembled here.
//
import { zonedParts, addDays, tripIdentityForDate, activeServices as scheduleServices } from "../public/assets/schedule.js";
export { zonedParts, addDays };

const DEFAULT_LIMIT = 3;
const MIN_LIMIT = 1;
const MAX_LIMIT = 5;
// A boat a minute gone is still the one somebody is running for. Same grace as the portable schedule rules.
const DEPARTED_GRACE_SECONDS = 60;
// How far past a boat's arrival a departure can be and still be worth calling a connection.
const CONNECTION_LOOKAHEAD_SECONDS = 12 * 60 * 60;

// One index over every landing the server built, assembled once at boot.
//
// Departures are held BY REFERENCE. The process already keeps every landing's payload resident and
// a second copy of all of them would be megabytes for nothing.
export function createConnectionIndex(byLanding) {
  const byStop = new Map();
  const stops = new Map();
  const routes = new Map();
  const tripStops = new Map();
  const turnarounds = new Map();
  // Which service each trip runs on. Taken from every departure, including the non-passenger rows
  // excluded below, because a deadhead is still a tappable row and still needs its service day.
  const tripService = new Map();
  const liveTripIds = new Map();
  const liveTripIdsByDate = new Map();
  const calendars = [];
  const exceptions = [];
  // Every landing repeats the feed's own calendars, so without this the same service is tested
  // thirty times over on every request.
  const seenCalendar = new Set();
  const seenException = new Set();
  let timezone = "America/New_York";

  for (const data of (byLanding?.values?.() || [])) {
    timezone = data?.meta?.timezone || timezone;
    for (const departure of data?.departures || []) {
      if (!tripService.has(String(departure.tripId))) tripService.set(String(departure.tripId), departure.serviceId);
      if (departure.liveTripId) liveTripIds.set(String(departure.tripId), String(departure.liveTripId));
      if (departure.liveTripIdsByDate) liveTripIdsByDate.set(String(departure.tripId), departure.liveTripIdsByDate);
      // Nothing that carries no passengers can be a connection: a home-port run, a crew shuttle and
      // an arrival are all boats you cannot board. Dropped here rather than at render time so the
      // "next two" are two real options rather than two rows, one of which is a ghost.
      if (departure.outOfService || departure.crewShuttle || departure.arrival) continue;
      const list = byStop.get(departure.stopId);
      if (list) list.push(departure); else byStop.set(departure.stopId, [departure]);
    }
    for (const [stopId, stop] of Object.entries(data?.stops || {})) {
      if (!stops.has(stopId)) stops.set(stopId, stop);
    }
    for (const [routeId, route] of Object.entries(data?.routes || {})) {
      if (!routes.has(routeId)) routes.set(routeId, route);
    }
    for (const [tripId, schedule] of Object.entries(data?.tripSchedules || {})) {
      if (schedule.liveTripId) liveTripIds.set(tripId, String(schedule.liveTripId));
      if (schedule.liveTripIdsByDate) liveTripIdsByDate.set(tripId, schedule.liveTripIdsByDate);
      if (!tripStops.has(tripId)) tripStops.set(tripId, schedule.stops || []);
      if (!turnarounds.has(tripId) && schedule.turnaround) turnarounds.set(tripId, schedule.turnaround);
    }
    for (const item of data?.calendars || []) {
      const key = JSON.stringify(item);
      if (seenCalendar.has(key)) continue;
      seenCalendar.add(key);
      calendars.push(item);
    }
    for (const item of data?.exceptions || []) {
      const key = JSON.stringify(item);
      if (seenException.has(key)) continue;
      seenException.add(key);
      exceptions.push(item);
    }
  }

  for (const list of byStop.values()) list.sort((left, right) => left.seconds - right.seconds);
  return { byStop, stops, routes, tripStops, turnarounds, tripService, liveTripIds, liveTripIdsByDate,
    calendars, exceptions, timezone, serviceCache: new Map() };
}

// Memoize the shared calendar rules for the immutable connection index.
//
// The exceptions pass has to run after the weekday pass and in that order: calendar_dates.txt is how
// a holiday both adds the weekend service and removes the weekday one, and reversing them leaves a
// Labor Day board running a Monday.
export function activeServices(index, dateKey) {
  const cached = index.serviceCache.get(dateKey);
  if (cached) return cached;
  const active = scheduleServices(index, dateKey);
  index.serviceCache.set(dateKey, active);
  return active;
}

// Which vessel is working each boat right now, keyed by the crew's own name for it ("ER3").
// Freshest report wins: a boat appears on two trips as it hands over between them. Port of the same
// map in public/app.js.
export function vesselsByBoat(vehicles = []) {
  const vessels = new Map();
  for (const item of vehicles) {
    if (!item.boat || !item.boatName) continue;
    const seen = vessels.get(item.boat);
    if (!seen || (item.updatedAtEpochSeconds || 0) >= (seen.updatedAtEpochSeconds || 0)) vessels.set(item.boat, item);
  }
  return vessels;
}

export function clampLimit(value) {
  // Absent is the common case and must land on the default, not on a number. Guarded explicitly
  // because Number(null) and Number("") are both 0, which is an integer and would silently clamp
  // every request that omitted the parameter down to a single connection.
  if (value == null || value === "") return DEFAULT_LIMIT;
  const number = Number(value);
  // A stale client must not be breakable by a query parameter, so this clamps rather than rejects.
  if (!Number.isInteger(number)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, number));
}

// The next few boardable departures from one stop, using
// the route grouping, the LAST badge and the lookahead window left out — none of them mean anything
// for a stop the board is not currently showing.
export function nextDepartures({ index, stopId, now = new Date(), after = null, excludeTripId = null,
  excludeLiveTripId = null, limit = DEFAULT_LIMIT, updates = new Map(), vehicles = new Map(),
  vessels = new Map(), stale = false }) {
  const current = zonedParts(now, index.timezone);
  // Two different questions share this code. "What is leaving here?" is asked about now, and a boat
  // a minute gone is still one somebody is running for. "What can they catch when they get off?" is
  // asked about a moment the boat has not reached yet, and there is no grace to give: a boat that
  // left before the passenger landed was never a connection.
  const anchorDay = after?.dateKey || current.dateKey;
  const anchorSeconds = after ? after.seconds : current.seconds;
  const grace = after ? 0 : DEPARTED_GRACE_SECONDS;
  const candidates = [];
  // Yesterday as well as today, because GTFS writes a 1:10am sailing as 25:10 on the previous
  // service day. Drop this loop and every board loses its first hour after midnight. Tomorrow is in
  // the loop too, because a boat docking near midnight connects to the next morning.
  // Asked about now, this stays exactly what the board itself shows: today's sailings only, which
  // is the rule public/app.js follows and the rule the equivalence test holds both to. Asked about
  // an arrival, tomorrow comes into range -- a boat docking at 23:50 connects to the morning.
  const lastOffset = after ? 1 : 0;
  for (let offset = -1; offset <= lastOffset; offset += 1) {
    const serviceDate = addDays(anchorDay, offset);
    const active = activeServices(index, serviceDate);
    for (const original of index.byStop.get(stopId) || []) {
      const departure = { ...original, liveTripId: tripIdentityForDate(original, serviceDate),
        predictTripId: tripIdentityForDate(original, serviceDate, "predictTripId") };
      if (!active.has(departure.serviceId)) continue;
      if (!after && addDays(serviceDate, Math.floor(departure.seconds / 86400)) !== anchorDay) continue;
      // The boat somebody is already on is not a connection off it.
      if (excludeTripId != null && String(departure.tripId) === String(excludeTripId)) continue;
      if (excludeLiveTripId != null &&
        String(departure.liveTripId || departure.tripId) === String(excludeLiveTripId)) continue;
      const update = departure.scheduleOnly && !departure.liveTripId ? null
        : updates.get(`${departure.liveTripId || departure.tripId}|${departure.stopId}`);
      if (update?.canceled) continue;
      const liveDelay = Number(update?.delaySeconds);
      const hasLiveTiming = !stale && update?.delaySeconds != null && Number.isFinite(liveDelay);
      // Boats may run ahead of schedule but are never advertised as leaving early.
      const delay = hasLiveTiming ? Math.max(0, liveDelay) : 0;
      // Seconds from midnight on the anchor day, so a 25:10 sailing on yesterday's service and a
      // 01:10 one on today's land on the same axis and sort against each other correctly.
      const delta = offset * 86400 + departure.seconds + delay - anchorSeconds;
      if (delta < -grace) continue;
      // Far enough ahead that it is not a connection any more, it is tomorrow. Long enough that a
      // boat docking at midnight can still be told about the first one out in the morning.
      if (delta > CONNECTION_LOOKAHEAD_SECONDS) continue;
      const route = index.routes.get(departure.routeId) || {};
      candidates.push({
        tripId: departure.tripId,
        routeId: departure.routeId,
        shortName: route.shortName || departure.routeId,
        color: route.color || null,
        textColor: route.textColor || null,
        operator: route.operator || departure.operator || null,
        departureTime: departure.departureTime,
        seconds: departure.seconds,
        deltaSeconds: delta,
        directionId: departure.directionId,
        destination: departure.destination,
        delaySeconds: hasLiveTiming ? delay : null,
        hasLiveTiming,
        boatName: departure.scheduleOnly && !departure.liveTripId ? null
          : vehicles.get(String(departure.liveTripId || departure.tripId))?.boatName || null,
        // The board's own guess, and it is shown with a question mark on it for a reason: the feed
        // only names a vessel for a trip it has already reached, so a boat leaving in twenty
        // minutes has none of its own. What it does have is a working, and the boat on that working
        // is out on the water right now under a vessel the feed has named. Boats change at short
        // notice, which is what the question mark says.
        predictedBoatName: (departure.scheduleOnly && !departure.liveTripId)
          || vehicles.get(String(departure.liveTripId || departure.tripId))?.boatName
          ? null
          : (departure.predictTripId ? vehicles.get(String(departure.predictTripId))?.boatName : null)
            || (Number.isInteger(departure.boatAssignment)
              ? vessels.get(`${departure.routeId}${departure.boatAssignment}`)?.boatName || null
              : null)
      });
    }
  }
  candidates.sort((left, right) => left.deltaSeconds - right.deltaSeconds);
  return candidates.slice(0, limit);
}

// Everything the trip view needs for one trip: its calls in order, each named and tied to a landing
// where one serves it, each with the next few boats out of that stop.
export function tripConnections({ index, tripId, limit = DEFAULT_LIMIT, updates = new Map(), vehicles = new Map(), vessels = new Map(), now = new Date(), stale = false }) {
  const schedule = index.tripStops.get(String(tripId));
  if (!schedule || schedule.length < 2) return null;
  const current = zonedParts(now, index.timezone);
  const calls = [...schedule].sort((left, right) => left.sequence - right.sequence);

  // Which service day this sailing belongs to. Usually today, but a boat working past midnight is
  // running yesterday's service and its calls are published beyond 24:00, so the offset has to be
  // found rather than assumed. Same rule the board itself uses to decide a trip is on today.
  const serviceId = index.tripService.get(String(tripId));
  const turnaround = index.turnarounds.get(String(tripId)) || null;
  let dayOffset = 0;
  for (let offset = -1; offset <= 0; offset += 1) {
    const serviceDate = addDays(current.dateKey, offset);
    if (serviceId != null && !activeServices(index, serviceDate).has(serviceId)) continue;
    const first = calls[0].departureSeconds ?? calls[0].arrivalSeconds ?? 0;
    if (addDays(serviceDate, Math.floor(first / 86400)) === current.dateKey) { dayOffset = offset; break; }
  }
  const date = addDays(current.dateKey, dayOffset);
  const identity = id => index.liveTripIdsByDate?.get(String(id))?.[date]
    || index.liveTripIds?.get(String(id)) || String(id);
  const liveTripId = identity(tripId);

  return {
    tripId: String(tripId),
    generatedAt: new Date().toISOString(),
    serviceDate: addDays(current.dateKey, dayOffset),
    stale: Boolean(stale),
    stops: calls.map((call) => {
      const stop = index.stops.get(call.stopId) || {};
      // When this boat actually gets there. Arrival rather than departure, because the question is
      // what a passenger stepping off can catch, and a late boat carries its delay with it.
      const scheduled = call.arrivalSeconds ?? call.departureSeconds;
      const update = updates.get(`${liveTripId}|${call.stopId}`);
      const arrivalDelay = update?.arrivalDelaySeconds ?? update?.delaySeconds;
      const liveDelay = Number(arrivalDelay);
      const hasLiveTiming = !stale && !update?.canceled && arrivalDelay != null && Number.isFinite(liveDelay);
      const delay = hasLiveTiming ? Math.max(0, liveDelay) : 0;
      const after = scheduled == null
        ? null
        : { dateKey: current.dateKey, seconds: dayOffset * 86400 + scheduled + delay };
      const isTurnaround = turnaround?.stopId === call.stopId && call.sequence === calls.at(-1).sequence;
      const nextUpdate = isTurnaround
        ? updates.get(`${tripIdentityForDate(turnaround, date, "nextLiveTripId") || identity(turnaround.nextTripId)}|${turnaround.stopId}`)
        : null;
      const nextLiveDelay = Number(nextUpdate?.delaySeconds);
      const nextHasLiveTiming = !stale && !nextUpdate?.canceled &&
        nextUpdate?.delaySeconds != null && Number.isFinite(nextLiveDelay);
      const turnaroundHasLiveTiming = isTurnaround && !update?.canceled && !nextUpdate?.canceled &&
        (hasLiveTiming || nextHasLiveTiming);
      // A hub is a pier where several routes meet, so somebody getting off it has a choice worth
      // reading rather than one onward boat. Two more than everywhere else.
      const stopLimit = stop.hub ? Math.min(MAX_LIMIT, limit + 2) : limit;
      return {
        stopId: call.stopId,
        // Null rather than absent where no pier serves the stop — the Rockaway shuttle's kerbside
        // bus stops are real calls on real trips, and saying so is better than dropping them.
        landingId: stop.landingId ?? null,
        name: stop.name || call.stopId,
        sequence: call.sequence,
        arrivalSeconds: call.arrivalSeconds,
        departureSeconds: call.departureSeconds,
        // Only a confirmed terminal turn gets an ETA and layover. Other stop clocks stay scheduled,
        // exactly as they were before this enrichment existed.
        estimatedArrivalSeconds: isTurnaround && hasLiveTiming && scheduled != null
          ? dayOffset * 86400 + scheduled + delay
          : null,
        turnaround: isTurnaround ? {
          scheduledSeconds: turnaround.scheduledLayoverSeconds,
          // A late arrival eats the pause; it cannot make the boat sail before it ties up. The feed
          // normally carries the arriving trip's delay before the departing trip's, so the ordinary
          // case is a known delay on this side and none yet on the other — without the floor that
          // reads as a negative layover rather than as no layover left.
          estimatedSeconds: turnaroundHasLiveTiming
            ? Math.max(0, turnaround.scheduledLayoverSeconds - delay + Math.max(0, nextLiveDelay || 0))
            : null,
          hasLiveTiming: turnaroundHasLiveTiming
        } : null,
        // The seconds this stop's connections are measured from, so the client can say "after the
        // boat gets in" rather than leaving the times to be read as if they were from now.
        afterSeconds: after?.seconds ?? null,
        hub: stop.hub === true,
        // How many of the rows below to show. Sent rather than inferred, because a couple of spares
        // ride along so that hiding an operator costs a row of that operator rather than a row of
        // the list -- the client filters, then cuts to this.
        limit: stopLimit,
        connections: nextDepartures({
          index, stopId: call.stopId, now, after, excludeTripId: tripId,
          excludeLiveTripId: liveTripId,
          limit: stopLimit + 2, updates, vehicles, vessels, stale
        })
      };
    })
  };
}
