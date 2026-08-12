// What a boat does when it is not carrying passengers: the run to the home port after its last
// revenue trip, and the crew shuttles that interrupt a boat's day without ending it.
//
// None of this is in the GTFS feed, and none of it is in the schedule workbook either — both
// describe revenue trips and nothing else. The workbook's only contribution is which boat runs
// which trip, which is what makes "this boat's last trip of the day" a question that can be
// answered at all. Everything else comes from config/crew-shuttles.json, maintained by hand.
//
// NYC Ferry only. Partner operators publish no crew schedule, so there is nothing to derive.

// GTFS times run past midnight (25:10:00 is 1:10am the next service day), so neither of these can
// go through Date. Deliberately not imported from build-data.js: that module imports this one, and
// a cycle between them is not worth saving four lines.
function timeToSeconds(value) {
  const match = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(value || "");
  if (!match) throw new Error(`Invalid GTFS time: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function secondsToTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  return `${String(hours).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// Crews name a boat by route and number — "East River 5" is ER5. Numbers restart on every route,
// so the route is part of the identity and ER5 and AS5 are different boats.
export function boatLabel(routeId, boatNumber) {
  return `${routeId}${boatNumber}`;
}

// The last revenue trip each boat runs, per service. Keyed by service as well as by boat because
// the same boat finishes at a different time on a weekday than at a weekend and both calendars
// live in one feed — collapsing them would mark the wrong trip on one of the two days.
export function lastTripPerBoat({ trips, timesByTrip, boatAssignments }) {
  const last = new Map();
  for (const trip of trips) {
    const boat = boatAssignments[String(trip.trip_short_name || "").trim()];
    if (!Number.isInteger(boat)) continue;
    const times = timesByTrip.get(trip.trip_id);
    if (!times || times.length < 2) continue;
    const final = times.at(-1);
    const arrival = final.arrival_time || final.departure_time;
    if (!arrival) continue;
    const seconds = timeToSeconds(arrival);
    const key = `${trip.route_id}|${boat}|${trip.service_id}`;
    const current = last.get(key);
    if (!current || seconds > current.seconds) {
      last.set(key, {
        key, tripId: trip.trip_id, routeId: trip.route_id, boat, serviceId: trip.service_id,
        directionId: trip.direction_id, seconds, stopId: final.stop_id
      });
    }
  }
  return last;
}

// The home-port run itself, shown at the landing where the boat finishes. Its time is the boat's
// scheduled arrival plus whatever dwell the config allows: the feed says when the boat gets in and
// nothing at all about when it lets go, so a dwell of 0 means "shown at the minute it arrives"
// rather than a number invented here.
export function homePortRows({ lastTrips, selectedStops, homePort, dwellMinutes = 0, operator }) {
  const rows = [];
  for (const entry of lastTrips.values()) {
    if (!selectedStops.has(entry.stopId)) continue;
    const seconds = entry.seconds + Math.max(0, dwellMinutes) * 60;
    rows.push({
      tripId: `oos:${entry.tripId}`, routeId: entry.routeId, serviceId: entry.serviceId,
      // Direction is meaningless for a boat going home and would only split one route's home-port
      // runs into two cards on the board, so they all share a direction and group together.
      directionId: "0", stopId: entry.stopId,
      departureTime: secondsToTime(seconds), seconds,
      destination: homePort, variant: null, nextStop: null, servesGovernorsIsland: false,
      boatAssignment: entry.boat, mode: "ferry", operator,
      outOfService: true, crewShuttle: false, crewBoats: null
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

// One configured entry is one departure to the home port carrying the crews coming off every boat
// it names — not one departure per boat. A boat named here is swapping crew, not finishing, so
// nothing in this function marks it out of service.
export function crewShuttleRows({ shuttles = {}, landingNumber, landings, selectedStops, homePort, operator }) {
  const rows = [];
  for (const [kind, entries] of Object.entries(shuttles)) {
    if (!Array.isArray(entries)) continue;
    const serviceId = kind === "weekend" ? CREW_WEEKEND_SERVICE : CREW_WEEKDAY_SERVICE;
    for (const entry of entries) {
      if (Number(entry.landing) !== Number(landingNumber)) continue;
      const stopId = (landings[String(entry.landing)]?.stopIds || [])[0];
      if (!stopId || !selectedStops.has(stopId)) continue;
      const departureTime = /^\d{1,2}:\d{2}$/.test(entry.time || "") ? `${entry.time}:00` : entry.time;
      rows.push({
        tripId: `crew:${kind}:${entry.landing}:${entry.time}`, routeId: CREW_ROUTE_ID,
        serviceId, directionId: "0", stopId,
        departureTime, seconds: timeToSeconds(departureTime),
        destination: homePort, variant: null, nextStop: null, servesGovernorsIsland: false,
        boatAssignment: null, mode: "ferry", operator,
        outOfService: false, crewShuttle: true, crewBoats: [...(entry.boats || [])]
      });
    }
  }
  return rows;
}
