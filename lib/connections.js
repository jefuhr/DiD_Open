// What else leaves from the stops a trip calls at.
//
// The board answers "when does my boat go". The question after that one is "and when they get off,
// what can they catch?", which no single landing's payload can answer: a payload is scoped to its
// own stops, so the client holding it has no idea what leaves from the far end. The server does —
// every landing is built and resident at boot — so the answer is assembled here.
//
// !! THIS FILE IS A PORT. The scheduling rules below already exist, in public/app.js, inside
// !! routeDirectionGroups() and activeServices(). They are duplicated rather than shared because
// !! they cannot be shared: test/display-contract.test.js runs the client through vm.runInContext,
// !! which compiles it as a classic script, and a top-level import in app.js is a syntax error that
// !! takes every test in that file down at once.
// !!
// !! So the two copies have to be kept honest by a test instead. test/display-contract.test.js has
// !! one that mounts the real client against a real payload and asserts both implementations pick
// !! the same boats at the same instants. Everything else in this feature fails loudly; this is the
// !! one part that fails by quietly showing a Saturday boat on a Tuesday.

const DEFAULT_LIMIT = 3;
const MIN_LIMIT = 1;
const MAX_LIMIT = 5;
// A boat a minute gone is still the one somebody is running for. Same grace as public/app.js:585.
const DEPARTED_GRACE_SECONDS = 60;
// How far past a boat's arrival a departure can be and still be worth calling a connection.
const CONNECTION_LOOKAHEAD_SECONDS = 12 * 60 * 60;

// Wall-clock date and seconds-into-the-day in the board's own timezone. Port of public/app.js:393.
// Deliberately not Date arithmetic: the service day is a local-calendar idea and the box's own
// timezone is not guaranteed to be the harbour's.
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

// Port of public/app.js:406. UTC arithmetic on a date-only key, so a daylight-saving change cannot
// move a service day by an hour and land it on the wrong date.
export function addDays(dateKey, amount) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

// One index over every landing the server built, assembled once at boot.
//
// Departures are held BY REFERENCE. The process already keeps every landing's payload resident and
// a second copy of all of them would be megabytes for nothing.
export function createConnectionIndex(byLanding) {
  const byStop = new Map();
  const stops = new Map();
  const routes = new Map();
  const tripStops = new Map();
  // Which service each trip runs on. Taken from every departure, including the non-passenger rows
  // excluded below, because a deadhead is still a tappable row and still needs its service day.
  const tripService = new Map();
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
      if (!tripStops.has(tripId)) tripStops.set(tripId, schedule.stops || []);
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
  return { byStop, stops, routes, tripStops, tripService, calendars, exceptions, timezone, serviceCache: new Map() };
}

// Which services run on a given calendar date. Port of public/app.js:423.
//
// The exceptions pass has to run after the weekday pass and in that order: calendar_dates.txt is how
// a holiday both adds the weekend service and removes the weekday one, and reversing them leaves a
// Labor Day board running a Monday.
export function activeServices(index, dateKey) {
  const cached = index.serviceCache.get(dateKey);
  if (cached) return cached;
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  const active = new Set();
  for (const item of index.calendars) {
    if (dateKey >= item.startDate && dateKey <= item.endDate && item.weekdays[weekday]) active.add(item.serviceId);
  }
  for (const item of index.exceptions) {
    if (item.date !== dateKey) continue;
    if (item.added) active.add(item.serviceId); else active.delete(item.serviceId);
  }
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

// The next few boardable departures from one stop. Port of the core of public/app.js:555-585 with
// the route grouping, the LAST badge and the lookahead window left out — none of them mean anything
// for a stop the board is not currently showing.
export function nextDepartures({ index, stopId, now = new Date(), after = null, excludeTripId = null, limit = DEFAULT_LIMIT, updates = new Map(), vehicles = new Map(), vessels = new Map(), stale = false }) {
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
    for (const departure of index.byStop.get(stopId) || []) {
      if (!active.has(departure.serviceId)) continue;
      if (!after && addDays(serviceDate, Math.floor(departure.seconds / 86400)) !== anchorDay) continue;
      // The boat somebody is already on is not a connection off it.
      if (excludeTripId != null && String(departure.tripId) === String(excludeTripId)) continue;
      const update = updates.get(`${departure.tripId}|${departure.stopId}`);
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
        boatName: vehicles.get(String(departure.tripId))?.boatName || null,
        // The board's own guess, and it is shown with a question mark on it for a reason: the feed
        // only names a vessel for a trip it has already reached, so a boat leaving in twenty
        // minutes has none of its own. What it does have is a working, and the boat on that working
        // is out on the water right now under a vessel the feed has named. Boats change at short
        // notice, which is what the question mark says.
        predictedBoatName: vehicles.get(String(departure.tripId))?.boatName
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
  let dayOffset = 0;
  for (let offset = -1; offset <= 0; offset += 1) {
    const serviceDate = addDays(current.dateKey, offset);
    if (serviceId != null && !activeServices(index, serviceDate).has(serviceId)) continue;
    const first = calls[0].departureSeconds ?? calls[0].arrivalSeconds ?? 0;
    if (addDays(serviceDate, Math.floor(first / 86400)) === current.dateKey) { dayOffset = offset; break; }
  }

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
      const update = updates.get(`${String(tripId)}|${call.stopId}`);
      const liveDelay = Number(update?.delaySeconds);
      const delay = !stale && update?.delaySeconds != null && Number.isFinite(liveDelay) ? Math.max(0, liveDelay) : 0;
      const after = scheduled == null
        ? null
        : { dateKey: current.dateKey, seconds: dayOffset * 86400 + scheduled + delay };
      return {
        stopId: call.stopId,
        // Null rather than absent where no pier serves the stop — the Rockaway shuttle's kerbside
        // bus stops are real calls on real trips, and saying so is better than dropping them.
        landingId: stop.landingId ?? null,
        name: stop.name || call.stopId,
        sequence: call.sequence,
        arrivalSeconds: call.arrivalSeconds,
        departureSeconds: call.departureSeconds,
        // The seconds this stop's connections are measured from, so the client can say "after the
        // boat gets in" rather than leaving the times to be read as if they were from now.
        afterSeconds: after?.seconds ?? null,
        connections: nextDepartures({
          index, stopId: call.stopId, now, after, excludeTripId: tripId, limit, updates, vehicles, vessels, stale
        })
      };
    })
  };
}
