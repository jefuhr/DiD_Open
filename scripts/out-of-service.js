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
      startSeconds: timeToSeconds(start), endSeconds: timeToSeconds(end), endStopId: times.at(-1).stop_id
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
  runs, gapMinutes = 60, certainAfterMinutes = 180, crewSwaps = new Map(), dayTypeOf = () => null
}) {
  const gapSeconds = Math.max(1, gapMinutes) * 60;
  const certainSeconds = Math.max(gapSeconds, certainAfterMinutes * 60);
  const certainty = new Map();
  const tieUps = [];
  for (const list of runs.values()) {
    for (const [index, run] of list.entries()) {
      const next = list[index + 1];
      const gap = next ? next.startSeconds - run.endSeconds : Infinity;
      if (gap < gapSeconds) continue;
      // A crew swap looks nothing like this in the bundled schedule — the boat keeps running and
      // leaves no gap at all — but if a shuttle ever does line up with one, the shuttle is the
      // better explanation and the boat is not going anywhere.
      if (isCrewSwap({ crewSwaps, run, kind: dayTypeOf(run.serviceId) })) continue;
      const level = gap >= certainSeconds ? "certain" : "unsure";
      certainty.set(run.tripId, level);
      if (level === "certain") tieUps.push({ ...run, endsDay: !next });
    }
  }
  return { certainty, tieUps };
}

// Scoped to the same kind of day, because a boat's weekend shuttle says nothing about its weekday,
// and to a tight window, because a crew rides the shuttle shortly after stepping off — not six
// hours into a gap that the shuttle plainly did not cause.
const SWAP_WINDOW_BEFORE = 30 * 60;
const SWAP_WINDOW_AFTER = 90 * 60;

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
