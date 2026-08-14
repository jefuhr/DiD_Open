// What a boat does when it is not carrying passengers: the gaps where it goes out of service, the
// run to the home port, and the crew shuttles that swap a crew without the boat stopping at all.
//
// None of this is in the GTFS feed, and none of it is in the schedule workbook either — both
// describe revenue trips and nothing else. The workbook's only contribution is which boat runs
// which trip, and that is what makes the whole thing possible: once the trips are grouped by boat,
// a boat going out of service shows up as a hole in its own day.
//
// NYC Ferry only. Partner operators publish no crew schedule, so there is nothing to group by.

// GTFS times run past midnight (25:10:00 is 1:10am the same service day), so neither of these can
// go through Date. Deliberately not imported from build-data.js: that module imports this one, and
// a cycle between them is not worth saving four lines.
function timeToSeconds(value) {
  const match = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(value || "");
  if (!match) throw new Error(`Invalid GTFS time: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function hhmmSeconds(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  return (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60;
}

function secondsToTime(seconds) {
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// Crews name a boat by route and number — "East River 5" is ER5. Numbers restart on every route,
// so the route is part of the identity and ER5 and AS5 are different boats.
export function boatLabel(routeId, boatNumber) {
  return `${routeId}${boatNumber}`;
}

// Every trip a boat runs, in order, per service. Keyed by service as well as by boat because the
// same boat works a different day at a weekend than on a weekday and both calendars live in one
// feed — collapsing them would invent gaps that no single day contains.
export function boatRuns({ trips, timesByTrip, boatAssignments }) {
  const runs = new Map();
  for (const trip of trips) {
    const boat = boatAssignments[String(trip.trip_short_name || "").trim()];
    if (!Number.isInteger(boat)) continue;
    const times = timesByTrip.get(trip.trip_id);
    if (!times || times.length < 2) continue;
    const start = times[0].departure_time || times[0].arrival_time;
    const end = times.at(-1).arrival_time || times.at(-1).departure_time;
    if (!start || !end) continue;
    const key = `${trip.route_id}|${boat}|${trip.service_id}`;
    const list = runs.get(key) || [];
    list.push({
      tripId: trip.trip_id, routeId: trip.route_id, boat, serviceId: trip.service_id,
      startSeconds: timeToSeconds(start), endSeconds: timeToSeconds(end),
      // Both ends, because "did the boat go anywhere between these two trips" is answered by
      // comparing where one finished with where the next one started.
      startStopId: times[0].stop_id, endStopId: times.at(-1).stop_id
    });
    runs.set(key, list);
  }
  for (const list of runs.values()) list.sort((left, right) => left.startSeconds - right.startSeconds);
  return runs;
}

// Where a boat stops working, and how sure we are about it.
//
// A boat that finishes for the day is obvious: nothing follows. A boat that finishes a shift
// mid-day is not marked anywhere, but it leaves a hole — the run of trips simply stops and picks up
// hours later with a fresh crew. In the bundled schedule ordinary layovers run to 44 minutes and
// the next gap up is 90, so a threshold in between separates the two cleanly. That valley is a
// property of this schedule, not a law, which is why both numbers are configuration.
//
// The distinction between the two thresholds is what the boat does with the time. Several hours
// means the boat leaves and the home-port run is real. An hour and a half at Rockaway means the
// crew is on a break and the boat is probably just tied up where it is — worth telling an agent
// that no one should board, not worth asserting the boat has gone anywhere. Those are marked
// unsure, and the board prints a question mark rather than pretending.
export function serviceBreaks({
  runs, gapMinutes = 60, certainAfterMinutes = 180, crewSwaps = new Map(), dayTypeOf = () => null,
  shifts = {}, stopName = () => null
}) {
  const gapSeconds = Math.max(1, gapMinutes) * 60;
  const certainSeconds = Math.max(gapSeconds, certainAfterMinutes * 60);
  const certainty = new Map();
  const tieUps = [];
  for (const list of runs.values()) {
    if (!list.length) continue;
    const kind = dayTypeOf(list[0].serviceId);
    const boat = boatLabel(list[0].routeId, list[0].boat);
    const known = shifts?.[kind]?.[boat];

    // The end of the day is not a matter of opinion: nothing follows the boat's last run. Taking it
    // from the feed rather than from the notes means a boat whose final shift note was unusable
    // still gets its home-port run, and a note that stops short cannot make the day look shorter
    // than it is.
    const finalRun = list.at(-1);
    certainty.set(finalRun.tripId, "certain");
    tieUps.push({ ...finalRun, endsDay: true });

    // Mid-day is where it gets interesting, and where the crew schedule earns its keep. Its shift
    // boundaries say where a shift ends as well as when, cover a boat relieved mid-route that
    // leaves no gap to notice, and are published rather than inferred — so where they exist,
    // nothing here is a guess and nothing is unsure.
    if (known?.length) {
      for (const [index, entry] of known.entries()) {
        const endSeconds = hhmmSeconds(entry.endTime);
        if (endSeconds >= finalRun.endSeconds) continue;
        const next = known[index + 1];
        // A crew carried out to the boat is the one case where a shift end is not a drop off: the
        // relief steps aboard from the shuttle and the boat sails on with nobody put ashore. Every
        // other entry on the sheet is a real end of shift, however short the gap after it looks.
        //
        // This used to suppress any same-place changeover under an hour, on the reasoning that a
        // boat sailing again six minutes later cannot have finished. But the sheet is the record of
        // when a crew stops working, and a crew stopping is exactly what the drop-off badge is
        // about — the boat carrying on with a fresh crew does not change that the trip just ended
        // takes nobody back. That heuristic silently swallowed AS3's 14:11 and seven others.
        if (next && shuttleCovers({ crewSwaps, boat, kind, endSeconds, startSeconds: hhmmSeconds(next.startTime) })) continue;
        const run = list.find((item) => Math.abs(item.endSeconds - endSeconds) <= 60 &&
          (!entry.endPlace || stopName(item.endStopId) === entry.endPlace));
        if (!run) continue;
        certainty.set(run.tripId, "certain");
        // The sheet is the authority on crews; the feed is the authority on where the boat is. A
        // boat that sails again shortly afterwards from the pier it just tied up at plainly did not
        // run to the home port, so it gets the drop-off badge without a home-port row asserting a
        // move the schedule beside it contradicts.
        const following = list[list.indexOf(run) + 1];
        const staysAlongside = following &&
          following.startSeconds - run.endSeconds < gapSeconds &&
          following.startStopId === run.endStopId;
        if (!staysAlongside) tieUps.push({ ...run, endsDay: false });
      }
      continue;
    }

    // No published shift for this boat, so fall back to reading the gaps.
    for (const [index, run] of list.entries()) {
      const next = list[index + 1];
      if (!next) continue;
      const gap = next.startSeconds - run.endSeconds;
      if (gap < gapSeconds) continue;
      if (isCrewSwap({ crewSwaps, run, kind })) continue;
      const level = gap >= certainSeconds ? "certain" : "unsure";
      certainty.set(run.tripId, level);
      if (level === "certain") tieUps.push({ ...run, endsDay: false });
    }
  }
  return { certainty, tieUps };
}

// Scoped to the same kind of day, because a boat's weekend shuttle says nothing about its weekday,
// and to a tight window, because a crew rides the shuttle shortly after stepping off — not six
// hours into a gap that the shuttle plainly did not cause.
export const SWAP_WINDOW_BEFORE = 30 * 60;
export const SWAP_WINDOW_AFTER = 90 * 60;

function isCrewSwap({ crewSwaps, run, kind }) {
  if (!kind) return false;
  const swaps = crewSwaps.get(`${boatLabel(run.routeId, run.boat)}|${kind}`);
  if (!swaps) return false;
  return swaps.some((swap) => swap.stopId === run.endStopId &&
    swap.seconds >= run.endSeconds - SWAP_WINDOW_BEFORE && swap.seconds <= run.endSeconds + SWAP_WINDOW_AFTER);
}

// The home-port run, shown at the landing where the boat ties up. Its time is the boat's scheduled
// arrival plus whatever dwell the config allows: the feed says when a boat gets in and nothing at
// all about when it lets go, so a dwell of 0 means "shown at the minute it arrives" rather than a
// number invented here.
export function homePortRows({ tieUps, selectedStops, homePort, dwellMinutes = 0, operator }) {
  const rows = [];
  for (const entry of tieUps) {
    if (!selectedStops.has(entry.endStopId)) continue;
    const seconds = entry.endSeconds + Math.max(0, dwellMinutes) * 60;
    rows.push({
      tripId: `oos:${entry.tripId}`, routeId: entry.routeId, serviceId: entry.serviceId,
      // Direction is meaningless for a boat going home and would only split one route's home-port
      // runs into two cards on the board, so they all share a direction and group together.
      directionId: "0", stopId: entry.endStopId,
      departureTime: secondsToTime(seconds), seconds,
      departureTimeEnd: null, secondsEnd: null,
      destination: homePort, variant: null, nextStop: null, servesGovernorsIsland: false,
      boatAssignment: entry.boat, mode: "ferry", operator,
      outOfService: true, crewShuttle: false, crewBoats: null, endsShift: null,
      // Distinguishes "done for the day" from "back in a few hours", which is the difference
      // between an agent sending someone away and telling them to wait.
      endsDay: Boolean(entry.endsDay)
    });
  }
  return rows;
}

// The synthetic services a crew shuttle runs on. The feed's own weekday service cannot be reused:
// on a holiday the feed still runs weekdays, but the crews change on the weekend pattern, so the
// two need calendars that can disagree. Holidays are added to the weekend service and removed from
// the weekday one, which is exactly what a GTFS calendar exception is for.
export const CREW_WEEKDAY_SERVICE = "crew-weekday";
export const CREW_WEEKEND_SERVICE = "crew-weekend";

export function crewCalendars({ startDate, endDate, holidays = [] }) {
  const calendars = [
    // weekdays[] is indexed the way JS counts days: Sunday first.
    { serviceId: CREW_WEEKDAY_SERVICE, weekdays: [false, true, true, true, true, true, false], startDate, endDate },
    { serviceId: CREW_WEEKEND_SERVICE, weekdays: [true, false, false, false, false, false, true], startDate, endDate }
  ];
  const exceptions = [];
  for (const date of holidays) {
    exceptions.push({ serviceId: CREW_WEEKEND_SERVICE, date, added: true });
    exceptions.push({ serviceId: CREW_WEEKDAY_SERVICE, date, added: false });
  }
  return { calendars, exceptions };
}

// A crew shuttle belongs to no passenger route, so it gets one of its own: borrowing a route's
// colour would imply the boat is running that service.
export const CREW_ROUTE_ID = "CREW";
export const CREW_ROUTE = {
  id: CREW_ROUTE_ID, shortName: "CREW", name: "Crew shuttle",
  color: "#4A5B68", textColor: "#FFFFFF", mode: "ferry"
};

// One configured entry is one departure carrying the crews coming off every boat it names — not one
// departure per boat. A boat named here is swapping crew, not finishing, so nothing in this
// function marks it out of service.
//
// The listed time is when the shuttle is ready, not when it goes: it waits for the boats it is
// collecting from to sail. So the row carries a range, ending at the last of those boats' next
// departures from this landing. An agent reading "2:35 – 3:05" knows to look for it in that window
// rather than at a minute it will not leave on.
export function crewShuttleRows({
  shuttles = {}, landingNumber, landings, selectedStops, homePort, operator, boatDepartures = new Map()
}) {
  const rows = [];
  for (const [kind, entries] of Object.entries(shuttles)) {
    if (!Array.isArray(entries)) continue;
    const serviceId = kind === "weekend" ? CREW_WEEKEND_SERVICE : CREW_WEEKDAY_SERVICE;
    for (const entry of entries) {
      if (Number(entry.landing) !== Number(landingNumber)) continue;
      const stopId = (landings[String(entry.landing)]?.stopIds || [])[0];
      if (!stopId || !selectedStops.has(stopId)) continue;
      const departureTime = /^\d{1,2}:\d{2}$/.test(entry.time || "") ? `${entry.time}:00` : entry.time;
      const seconds = timeToSeconds(departureTime);
      const boats = [...(entry.boats || [])];
      // The shuttle cannot leave before the last crew is aboard, so the window closes at the latest
      // of the boats' next sailings. A boat that does not call here again just does not extend it.
      const sailings = boats
        .map((boat) => nextDeparture({ boatDepartures, boat, kind, stopId, afterSeconds: seconds }))
        .filter((value) => Number.isFinite(value));
      const secondsEnd = sailings.length ? Math.max(...sailings) : null;
      rows.push({
        tripId: `crew:${kind}:${entry.landing}:${entry.time}`, routeId: CREW_ROUTE_ID,
        serviceId, directionId: "0", stopId,
        departureTime, seconds,
        departureTimeEnd: secondsEnd === null ? null : secondsToTime(secondsEnd), secondsEnd,
        destination: homePort, variant: null, nextStop: null, servesGovernorsIsland: false,
        boatAssignment: null, mode: "ferry", operator,
        outOfService: false, crewShuttle: true, crewBoats: boats, endsShift: null, endsDay: false
      });
    }
  }
  return rows;
}

// The other end of the same shuttle, shown on the home port's own board: every crew shuttle leaves
// Pier C before it can collect anyone, so the landing that sees them all is the one they sail from.
//
// Only the outbound leg is listed. At the collecting landing the row carries a range because the
// shuttle waits there for boats to sail, but the far end of that range is when it heads back to
// Pier C — a return, not a departure from here — so this side keeps the first time and drops it.
//
// That time is the configured one, which is when the shuttle is due at the *other* end. The
// operator does not publish when it lets go of Pier C, exactly as with a shift start, so the row is
// marked approximate rather than inventing a departure time nobody scheduled.
export function homePortCrewShuttles({ shuttles = {}, landings, homePort, operator }) {
  const rows = [];
  for (const [kind, entries] of Object.entries(shuttles)) {
    if (!Array.isArray(entries)) continue;
    const serviceId = kind === "weekend" ? CREW_WEEKEND_SERVICE : CREW_WEEKDAY_SERVICE;
    for (const entry of entries) {
      const landing = landings[String(entry.landing)];
      if (!landing) continue;
      const departureTime = /^\d{1,2}:\d{2}$/.test(entry.time || "") ? `${entry.time}:00` : entry.time;
      const seconds = timeToSeconds(departureTime);
      rows.push({
        tripId: `pierc-crew:${kind}:${entry.landing}:${entry.time}`, routeId: CREW_ROUTE_ID,
        serviceId, directionId: "0", stopId: HOME_PORT_STOP_ID,
        departureTime, seconds,
        departureTimeEnd: null, secondsEnd: null,
        destination: landing.name || landing.displayName || `Landing ${entry.landing}`,
        variant: null, nextStop: null, servesGovernorsIsland: false,
        boatAssignment: null, mode: "ferry", operator, via: [],
        outOfService: false, crewShuttle: true, crewBoats: [...(entry.boats || [])],
        endsShift: null, endsDay: false,
        approximate: true, fromHomePort: true, homePortName: homePort
      });
    }
  }
  return rows;
}

function nextDeparture({ boatDepartures, boat, kind, stopId, afterSeconds }) {
  const times = boatDepartures.get(`${boat}|${kind}|${stopId}`);
  if (!times) return null;
  return times.find((value) => value >= afterSeconds) ?? null;
}

// Every departure each boat makes from each stop, grouped the way a crew shuttle needs to ask the
// question: "when does ER3 next leave here on a weekend?".
export function boatDeparturesByDay({ trips, timesByTrip, boatAssignments, dayTypeOf }) {
  const byKey = new Map();
  for (const trip of trips) {
    const boat = boatAssignments[String(trip.trip_short_name || "").trim()];
    if (!Number.isInteger(boat)) continue;
    const kind = dayTypeOf(trip.service_id);
    if (!kind) continue;
    const times = timesByTrip.get(trip.trip_id) || [];
    for (const stopTime of times.slice(0, -1)) {
      const value = stopTime.departure_time || stopTime.arrival_time;
      if (!value) continue;
      const key = `${boatLabel(trip.route_id, boat)}|${kind}|${stopTime.stop_id}`;
      const list = byKey.get(key) || [];
      list.push(timeToSeconds(value));
      byKey.set(key, list);
    }
  }
  for (const list of byKey.values()) list.sort((left, right) => left - right);
  return byKey;
}

// Where each configured shuttle sits, keyed by boat, so a gap in a boat's day can be checked
// against it.
export function crewSwapIndex({ shuttles = {}, landings }) {
  const index = new Map();
  for (const [kind, entries] of Object.entries(shuttles)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const stopId = (landings[String(entry.landing)]?.stopIds || [])[0];
      if (!stopId) continue;
      const seconds = timeToSeconds(/^\d{1,2}:\d{2}$/.test(entry.time || "") ? `${entry.time}:00` : entry.time);
      for (const boat of entry.boats || []) {
        const key = `${boat}|${kind}`;
        const list = index.get(key) || [];
        list.push({ stopId, seconds });
        index.set(key, list);
      }
    }
  }
  return index;
}

// A crew shuttle is ready at its listed time and then waits for the boat to sail, so it can be
// listed well before the crew it is collecting has finished — half an hour is normal. It cannot be
// listed after the relief crew is already working, which is what closes the window.
//
// Matched by boat and day rather than by place: the workbook writes place names ("Wall St/Pier 11")
// and the shuttle config names landings, which are different vocabularies, and a boat swaps crew
// once a day, so its own name and the changeover it brackets are specific enough.
export const SHUTTLE_READY_BEFORE = 60 * 60;

function shuttleCovers({ crewSwaps, boat, kind, endSeconds, startSeconds }) {
  const swaps = crewSwaps.get(`${boat}|${kind}`);
  if (!swaps) return false;
  return swaps.some((swap) => swap.seconds >= endSeconds - SHUTTLE_READY_BEFORE && swap.seconds <= startSeconds);
}

// The other side of a home-port run: the boat leaving Pier C to start a shift.
//
// Every shift boundary on the crew sheet is a real movement — a first departure the boat had to
// come out of the home port for, and a last drop after which it goes back — with one exception: a
// crew shuttle, which carries the relief out to the boat so it never leaves the water. So the
// shuttle config decides which changeovers are suppressed, and everything else is a Pier C
// departure.
//
// This deliberately does not infer the handover from the shape of the gap. A boat relieved at Pier
// 11 with six minutes between shifts plainly did not sail home in the meantime, but "the gap is
// short" is not the same fact as "a shuttle ran", and only the second one is recorded anywhere.
// Where the sheet shows a changeover with no shuttle against it, the sheet is what the board
// follows.
//
// The time is the shift's first pickup, which is when the boat is due at the *other* end — the
// operator does not publish when it lets go of Pier C, and it varies. So the row carries the first
// pickup and is marked approximate rather than inventing a departure time nobody scheduled.
export function homePortDepartures({
  shifts = {}, dayTypeOf, servicesOfDay, homePort, operator, runs = new Map(), crewSwaps = new Map()
}) {
  // The trip the boat is about to run. Naming it lets the board show which vessel is currently on
  // that working, which is the closest thing to a prediction available — and it is only ever a
  // prediction, because the boat on a working changes at a moment's notice.
  const firstTripOf = (boat, kind, startSeconds) => {
    for (const list of runs.values()) {
      if (!list.length) continue;
      if (boatLabel(list[0].routeId, list[0].boat) !== boat) continue;
      if (dayTypeOf(list[0].serviceId) !== kind) continue;
      const run = list.find((item) => Math.abs(item.startSeconds - startSeconds) <= 60);
      if (run) return run.tripId;
    }
    return null;
  };
  const rows = [];
  for (const [kind, boats] of Object.entries(shifts)) {
    const serviceId = servicesOfDay(kind);
    if (!serviceId) continue;
    for (const [boat, list] of Object.entries(boats)) {
      for (const [index, entry] of list.entries()) {
        const previous = list[index - 1];
        if (previous && shuttleCovers({
          crewSwaps, boat, kind,
          endSeconds: hhmmSeconds(previous.endTime), startSeconds: hhmmSeconds(entry.startTime)
        })) continue;
        if (!entry.startPlace) continue;
        const seconds = hhmmSeconds(entry.startTime);
        rows.push({
          tripId: `pierc:${kind}:${boat}:${entry.startTime}`,
          routeId: String(boat).replace(/\d+$/, ""), serviceId,
          directionId: "0", stopId: HOME_PORT_STOP_ID,
          departureTime: secondsToTime(seconds), seconds,
          departureTimeEnd: null, secondsEnd: null,
          destination: entry.startPlace, variant: null, nextStop: null, servesGovernorsIsland: false,
          boatAssignment: Number(String(boat).replace(/^\D+/, "")) || null,
          mode: "ferry", operator, via: [],
          outOfService: false, crewShuttle: false, crewBoats: null, endsShift: null, endsDay: false,
          // The board prints a star: this is when the boat is due at its first landing, not a
          // published Pier C departure, and the operator says the real one is not constant.
          approximate: true, fromHomePort: true, homePortName: homePort,
          predictTripId: firstTripOf(boat, kind, seconds)
        });
      }
    }
  }
  return rows.sort((left, right) => left.seconds - right.seconds || left.destination.localeCompare(right.destination));
}

// Pier C is not in the GTFS — no operator publishes it — so the landing that shows it is virtual
// and its one stop id exists only here.
export const HOME_PORT_STOP_ID = "home-port";
