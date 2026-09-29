// The holiday PDFs are per-landing timetables, not a source of vehicle trip IDs.
// Some printed rows run backwards in time. Keep their departure columns exactly,
// without creating through-trip connections or allowing realtime to match them.
export const HOLIDAY_SERVICE = "nyc:sukkot:2026";
export const CREW_UNCONFIRMED = "Crew shifts / Pier C shuttles: UNCONFIRMED";
const DIRECTIONS = { ER: ["1", "0"], SB: ["0", "1"], RS: ["1", "0"], AS: ["1", "0"], SG: ["0", "1"], GI: ["0", "1"], RES: ["0", "1"], RWS: ["0", "1"] };

export function holidayDepartures({ source, liveMatches = {}, selectedStops, stopsById, agency, busesEnabled }) {
  const departures = [];
  if (!source) return departures;
  for (const [routeId, route] of Object.entries(source.routes)) {
    const bus = routeId === "RES" || routeId === "RWS";
    if (bus && !busesEnabled) continue;
    for (const table of route.tables) {
      for (const [rowIndex, row] of table.rows.entries()) {
        const { times } = row;
        const terminalIndex = routeId === "ER" ? table.stops.length - 1 : times.findLastIndex(Boolean);
        for (const [column, stopId] of table.stops.entries()) {
          if (!times[column] || !selectedStops.has(stopId)) continue;
          // Adjacent repeated Pier 11 columns are explicitly arrival, departure.
          if (table.stops[column + 1] === stopId) continue;
          // The bus's outbound table publishes only its terminal departure.
          const outboundBus = bus && table.direction === 1;
          if (!outboundBus && column === terminalIndex) continue;
          let destinationStop = table.stops[terminalIndex];
          let variant = null;
          if (routeId === "ER") {
            destinationStop = table.direction === 0 ? "17" : "87";
            if (stopId === "4" || stopId === "19") variant = "A";
            else if (stopId === "18" || stopId === "8") variant = "B";
            else variant = times[table.direction === 0 ? 3 : 1] ? "A" : "B";
          }
          const departureTime = times[column];
          const [h, m, s] = departureTime.split(":").map(Number);
          const tripId = `nyc:sukkot:${routeId}:${table.direction}:${rowIndex}:${column}`;
          const match = liveMatches[tripId];
          const verified = match?.routeId === routeId && match.stopId === stopId
            && match.departureTime === departureTime;
          departures.push({
            tripId, liveTripId: verified ? match.tripId : null,
            routeId, serviceId: HOLIDAY_SERVICE, directionId: DIRECTIONS[routeId][table.direction],
            stopId, departureTime, seconds: h * 3600 + m * 60 + s,
            destination: outboundBus ? (routeId === "RES" ? "Rockaway East" : "Rockaway West")
              : stopsById.get(destinationStop)?.stop_name || destinationStop,
            variant, nextStop: null, servesGovernorsIsland: routeId === "SB" && destinationStop === "111",
            boatAssignment: verified && Number.isInteger(match.boatAssignment) ? match.boatAssignment : null,
            mode: bus ? "bus" : "ferry", operator: agency,
            endsShift: null, outOfService: false, crewShuttle: false, crewBoats: null,
            departureTimeEnd: null, secondsEnd: null, endsDay: false,
            scheduledArrivalSeconds: column > 0 && table.stops[column - 1] === stopId && times[column - 1]
              ? times[column - 1].split(":").map(Number).reduce((total, value) => total * 60 + value, 0) : null,
            scheduleOnly: true, timetableOnly: true,
            sourceUrl: route.url
          });
        }
      }
    }
  }
  return departures;
}
