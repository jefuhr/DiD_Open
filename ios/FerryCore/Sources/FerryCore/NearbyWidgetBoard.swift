import Foundation

/// Compact widget values. The extension uses the same service calendars, assignments,
/// operational movements and pause rules as the app, without retaining SwiftUI objects.
public struct WidgetDeparture: Identifiable, Sendable {
    public let id: String
    public let time: String
    public let route: String
    public let destination: String
    public let detail: String
    public let countdown: String
    public let estimated: Bool
}

public enum NearbyWidgetBoard {
    public static let liveLifetime: TimeInterval = 5 * 60
    public static let locationLifetime: TimeInterval = 6 * 3600
    /// Enough rows for the tallest widget to fill its height; the view measures how many fit.
    public static let maximumRows = 12

    /// Try the most rows first; the view keeps the first candidate that fits. Every
    /// candidate tried costs a layout pass per timeline entry, so callers keep `maximum` near capacity.
    public static func fitCandidates(available: Int, maximum: Int) -> [Int] {
        let limit = max(1, min(available, maximum))
        return Array(stride(from: limit, through: 1, by: -1))
    }

    public static func usableLocation(at: Date, now: Date) -> Bool {
        (0...locationLifetime).contains(now.timeIntervalSince(at))
    }

    /// Ignore missing/invalid coordinates instead of treating them as (0, 0).
    public static func nearest(in landings: [Landing], latitude: Double, longitude: Double) -> Landing? {
        guard valid(latitude, longitude) else { return nil }
        func radians(_ value: Double) -> Double { value * .pi / 180 }
        return landings.compactMap { landing -> (Landing, Double)? in
            guard let lat = landing.latitude, let lon = landing.longitude, valid(lat, lon) else { return nil }
            let a = pow(sin(radians(lat - latitude) / 2), 2)
                + cos(radians(latitude)) * cos(radians(lat)) * pow(sin(radians(lon - longitude) / 2), 2)
            return (landing, a)
        }.min { $0.1 < $1.1 }?.0
    }

    private static func valid(_ lat: Double, _ lon: Double) -> Bool {
        lat.isFinite && lon.isFinite && (-90...90).contains(lat) && (-180...180).contains(lon)
    }

    public static func freshRealtime(_ realtime: Realtime, receivedAt: Date?, now: Date) -> Realtime {
        guard let receivedAt, let fetchedAt = realtime.fetchedAt.flatMap(ServiceClock.instant),
              realtime.available != false, !realtime.stale,
              (0...liveLifetime).contains(now.timeIntervalSince(receivedAt)),
              (0...liveLifetime).contains(now.timeIntervalSince(fetchedAt)) else { return .empty }
        var value = realtime
        // A fresh timing feed does not make an old vessel feed fresh.
        if value.vehiclesStale == true { value.vehicles = [] }
        return value
    }

    public static func departures(data: DisplayData, realtime: Realtime, receivedAt: Date?, now: Date, options: WidgetOptions = .init()) -> [WidgetDeparture] {
        let live = freshRealtime(realtime, receivedAt: receivedAt, now: now)
        var data = data
        data.meta.showDwellTimes = options.showDwells
        data.meta.showLayoverTimes = options.showLayovers
        if options.departureWindowMinutes > 0 { data.meta.departureWindowMinutes = options.departureWindowMinutes }
        let window = Double(data.meta.departureWindowMinutes) * 60
        func visible(_ row: ScheduledDeparture) -> Bool {
            let operatorName = row.departure.operator ?? data.routes[row.departure.routeId]?.operator ?? data.meta.agencyName ?? "NYC Ferry"
            return row.delta <= window && options.filters.allows(row.departure, operatorName: operatorName)
        }
        let rows: [ScheduledDeparture]
        if options.sortByRoute {
            rows = ScheduleEngine.groups(data: data, realtime: live, now: now).flatMap { group in
                let visibleRows = group.departures.filter(visible)
                return options.departuresPerRoute > 0 ? Array(visibleRows.prefix(options.departuresPerRoute)) : visibleRows
            }
        } else {
            rows = ScheduleEngine.timeline(data: data, realtime: live, now: now).filter(visible)
        }
        return rows.prefix(maximumRows).map { row in
            let departure = row.departure
            let route = data.routes[departure.routeId]?.shortName ?? departure.routeId
            var details: [String] = []
            if options.showAssignments, let assignment = departure.boatAssignment { details.append("\(route)\(assignment)") }
            if options.showBoatNames {
                if let boat = row.boatName { details.append(boat) }
                else if let boat = row.predictedBoatName { details.append("Pred. \(boat)") }
            }
            if options.showAssignments, let boats = departure.crewBoats, !boats.isEmpty { details.append(boats.joined(separator: "/")) }
            if departure.crewShuttle == true { details.append("CREW") }
            else if departure.fromHomePort == true { details.append("FROM PIER C") }
            else if departure.destination.caseInsensitiveCompare("Pier C") == .orderedSame { details.append("TO PIER C") }
            else if departure.outOfService == true { details.append("OOS") }
            if departure.arrival == true { details.append("ARR") }
            if let until = departure.secondsEnd { details.append("until \(ServiceClock.time(seconds: until, twelveHour: options.twelveHour))") }
            if departure.approximate == true { details.append("Approx.") }
            if let shift = departure.endsShift, !shift.isEmpty, departure.outOfService != true, departure.crewShuttle != true {
                details.append(shift == "unsure" ? "FINAL?" : "FINAL")
            }
            if row.isLastOfDay { details.append("LAST") }
            let pauses = ScheduleEngine.departurePauses(data: data, row: row, realtime: live)
            if let dwell = pauses.dwellMinutes, dwell > 0 { details.append("Dwell \(dwell)m") }
            if let layover = pauses.layover { details.append("\(layover.hasLiveTiming ? "Est. turn" : "Turn") \(layover.minutes)m") }
            return WidgetDeparture(id: row.id,
                time: ServiceClock.time(seconds: departure.seconds + row.delay, twelveHour: options.twelveHour), route: route,
                destination: departure.destination, detail: details.joined(separator: " · "),
                countdown: row.delta <= 90 ? (departure.arrival == true ? "Arriving" : "Due") : row.relativeTime,
                estimated: row.hasLiveTiming)
        }
    }
}
