import SwiftUI
import FerryCore

struct TripView: View {
    @EnvironmentObject private var store: FerryStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let row: ScheduledDeparture
    let data: DisplayData
    @State private var connections: Connections?
    @State private var note = "Checking connections…"
    // Published calls are keyed by the display trip; verified realtime uses a separate ID.
    // The connections endpoint performs its own live-ID mapping from this schedule ID.
    private var sourceID: String {
        data.tripSchedules[row.departure.tripId] != nil ? row.departure.tripId : liveID
    }
    private var liveID: String { row.departure.liveTripId ?? row.departure.tripId }
    private var trip: TripSchedule? { data.tripSchedules[sourceID] }
    private var timetableOnly: Bool { trip?.timetableOnly == true || row.departure.timetableOnly == true }
    private var hasLiveMapping: Bool { row.departure.scheduleOnly != true || row.departure.liveTripId != nil }
    private var calls: [TripCall] { (trip?.stops ?? []).sorted { $0.sequence < $1.sequence } }
    private var usable: Connections? {
        guard let connections, connections.usable(tripID: sourceID, serviceDate: row.serviceDate, now: store.now) else { return nil }
        return connections
    }
    private var live: Bool {
        row.live && ServiceClock.addDays(row.serviceDate, Int(row.departure.seconds / 86400)) == ServiceClock.parts(store.now, timezone: data.meta.timezone).dateKey
    }
    private var freshConnections: Bool { live && usable?.stale == false }
    private var canRide: Bool {
        live && hasLiveMapping
            && !row.departure.routeId.contains(":") && row.departure.mode != "bus"
    }
    // A loop may call at a pier twice. Highlight the call whose own time matches the selected row.
    private var selectedSequence: Int? {
        let candidates = calls.filter { $0.stopId == row.departure.stopId }
        return candidates.min { left, right in
            let leftTime = row.departure.arrival == true ? left.arrivalSeconds : left.departureSeconds
            let rightTime = row.departure.arrival == true ? right.arrivalSeconds : right.departureSeconds
            return abs((leftTime ?? left.arrivalSeconds ?? left.departureSeconds ?? 0) - row.departure.seconds)
                < abs((rightTime ?? right.arrivalSeconds ?? right.departureSeconds ?? 0) - row.departure.seconds)
        }?.sequence
    }
    private struct DisplayedVessel {
        let name: String
        let predicted: Bool
        let saved: Bool
    }
    private var displayedVessel: DisplayedVessel? {
        guard live, hasLiveMapping else { return nil }
        let vehicles = store.realtime.vehicles ?? []
        let saved = store.realtime.stale || store.realtime.vehiclesStale == true || store.realtime.available == false
        if let vehicle = vehicles.first(where: { $0.tripId == liveID && $0.boatName?.isEmpty == false }),
           let name = vehicle.boatName {
            return DisplayedVessel(name: name, predicted: false, saved: saved)
        }
        if let predictedID = row.departure.predictTripId,
           let vehicle = vehicles.first(where: { $0.tripId == predictedID && $0.boatName?.isEmpty == false }),
           let name = vehicle.boatName {
            return DisplayedVessel(name: name, predicted: true, saved: saved)
        }
        if let number = row.departure.boatAssignment {
            let working = "\(row.departure.routeId)\(number)"
            if let name = vehicles.filter({ $0.boat == working && $0.boatName?.isEmpty == false })
                .max(by: { ($0.updatedAtEpochSeconds ?? 0) < ($1.updatedAtEpochSeconds ?? 0) })?.boatName {
                return DisplayedVessel(name: name, predicted: true, saved: saved)
            }
        }
        // A fresh feed clearing the assignment must clear the name in this open sheet too.
        // During an outage the selected row can still provide an explicitly saved assignment.
        guard saved, let name = row.boatName ?? row.predictedBoatName else { return nil }
        return DisplayedVessel(name: name, predicted: row.boatName == nil, saved: true)
    }
    private var vesselName: String? { displayedVessel?.name }

    var body: some View {
        List {
            Section {
                summary
            }.listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
            Section {
                ForEach(calls) { call in
                    stopRow(call)
                        .listRowInsets(EdgeInsets(top: 2, leading: 12, bottom: 6, trailing: 12))
                        .listRowBackground(call.sequence == selectedSequence ? store.theme.accent.opacity(0.09) : Color.clear)
                }
            } header: {
                Text("Stops · scheduled unless marked EST")
            } footer: {
                if usable?.stale == true {
                    Text("Saved connections · times shown as scheduled")
                } else if usable == nil {
                    Text(note)
                }
            }
        }
        .listStyle(.plain)
        .environment(\.defaultMinListRowHeight, 44)
        .navigationTitle("Trip details")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: scenePhase) {
            guard scenePhase == .active else { connections?.stale = true; return }
            guard !timetableOnly else {
                note = "Published stop times. Live arrival estimates and through-trip connections are unavailable."
                return
            }
            guard live else { note = "Connections are shown for today only."; return }
            while !Task.isCancelled {
                await refresh()
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
            }
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .top, spacing: 8) {
                RouteBadge(routeID: row.departure.routeId, variant: row.departure.variant)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.departure.destination).font(.headline)
                    Text("\(row.serviceDate) · \(publishedTime) \(row.departure.fromHomePort == true ? "first pickup" : "scheduled")")
                        .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    assignment
                }
                Spacer(minLength: 0)
            }
            if let movement = movementLabel {
                Text("\(data.meta.landing.displayName): \(movement)")
                    .font(.caption.weight(.semibold)).foregroundStyle(.orange)
            }
            if row.isLastOfDay || row.isLastGovernorsIsland {
                Text(row.isLastOfDay ? "LAST DEPARTURE" : "LAST TO GOVERNORS ISLAND")
                    .font(.caption.weight(.semibold)).foregroundStyle(.red)
            }
            if let via = row.departure.viaTerminals, !via.isEmpty {
                Text(via.map { "VIA " + $0.code }.joined(separator: " · "))
                    .font(.caption.weight(.semibold))
            } else if let via = row.departure.via, !via.isEmpty {
                Text("via " + via.joined(separator: ", ")).font(.caption).foregroundStyle(.secondary)
            }
            if let holiday = data.meta.holidaySchedule, holiday.dates.contains(row.serviceDate) {
                Text(holiday.message).font(.caption).foregroundStyle(.secondary)
            }
            if vesselName != nil || canRide {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 16) { actions }
                    VStack(alignment: .leading, spacing: 0) { actions }
                }
            }
        }
    }

    private var publishedTime: String {
        let start = store.time(row.departure.seconds) + (row.departure.approximate == true ? "*" : "")
        return row.departure.secondsEnd.map { start + "–" + store.time($0) } ?? start
    }

    @ViewBuilder private var assignment: some View {
        let working = row.departure.boatAssignment.map { "\(data.routes[row.departure.routeId]?.shortName ?? row.departure.routeId)\($0)" }
        let vessel = displayedVessel
        let name = vessel?.name
        if working != nil || name != nil || row.departure.crewBoats?.isEmpty == false {
            Text([
                working,
                name.map { $0 + (vessel?.predicted == true ? "?" : "") },
                name == nil ? row.departure.crewBoats?.joined(separator: " ") : nil,
                vessel?.saved == true ? "saved vessel" : nil
            ].compactMap { $0 }.joined(separator: " · "))
            .font(.subheadline.weight(.semibold))
            .accessibilityLabel([
                working.map { "Working \($0)" },
                name.map { vessel?.predicted == true ? "Predicted vessel \($0), unconfirmed" : "Vessel \($0)" },
                name == nil ? row.departure.crewBoats?.joined(separator: ", ") : nil,
                vessel?.saved == true ? "Saved assignment" : nil
            ].compactMap { $0 }.joined(separator: ", "))
        }
    }

    @ViewBuilder private var actions: some View {
        if let vesselName {
            Button {
                store.afterSheet { store.showBoat(name: vesselName) }
            } label: {
                Label("\(vesselName)\(displayedVessel?.predicted == true ? "?" : "") on map", systemImage: "map")
                    .frame(minHeight: 44, alignment: .leading)
            }.buttonStyle(.borderless)
        }
        if canRide {
            Button(action: beginRide) {
                Label("Ride this boat", systemImage: "person.fill")
                    .frame(minHeight: 44, alignment: .leading)
            }.buttonStyle(.borderless).accessibilityIdentifier("tripRide")
        }
    }

    private var movementLabel: String? {
        if row.departure.arrival == true { return "ARRIVAL · DROP OFF ONLY" }
        if row.departure.crewShuttle == true { return "CREW SHUTTLE · NO PICKUP" }
        if row.departure.outOfService == true { return "OUT OF SERVICE · NO PICKUP" }
        if row.departure.fromHomePort == true { return "HOME-PORT DEPARTURE · time at captain’s discretion" }
        if row.departure.endsShift == "unsure" { return "FINAL? · return trip unconfirmed" }
        if row.departure.endsShift?.isEmpty == false { return "FINAL · no return trip" }
        return nil
    }

    private func matchingStop(_ call: TripCall) -> ConnectionStop? {
        usable?.stops.first { $0.sequence == call.sequence && $0.stopId == call.stopId }
    }

    private func stopRow(_ call: TripCall) -> some View {
        let matching = matchingStop(call)
        return VStack(alignment: .leading, spacing: 3) {
            if dynamicTypeSize.isAccessibilitySize {
                stopName(call, matching: matching)
                stopTimes(call, matching: matching)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .center, spacing: 8) {
                        stopName(call, matching: matching)
                        Spacer(minLength: 4)
                        stopTimes(call, matching: matching).fixedSize(horizontal: true, vertical: false)
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        stopName(call, matching: matching)
                        stopTimes(call, matching: matching)
                    }
                }
            }
            if let restriction = boardingRestriction(call) {
                Text(restriction).font(.caption.weight(.semibold)).foregroundStyle(.orange)
            }
            pauseLine(call, matching: matching)
            if let matching {
                connectingDepartures(matching)
            }
        }
    }

    private func boardingRestriction(_ call: TripCall) -> String? {
        if call.pickupType == 1, call.dropOffType == 0 { return "DROP OFF ONLY" }
        if call.dropOffType == 1, call.pickupType == 0 { return "PICKUP ONLY" }
        let restrictions = [call.pickupType == 1 ? "NO PICKUP" : nil, call.dropOffType == 1 ? "NO DROP-OFF" : nil].compactMap { $0 }
        return restrictions.isEmpty ? nil : restrictions.joined(separator: " · ")
    }

    @ViewBuilder private func stopName(_ call: TripCall, matching: ConnectionStop?) -> some View {
        let info = data.stops?[call.stopId]
        let name = info?.name ?? matching?.name ?? call.stopId
        let selected = call.sequence == selectedSequence
        let label = HStack(spacing: 5) {
            if selected { Image(systemName: "arrow.right").font(.caption.bold()).accessibilityHidden(true) }
            Text(name).font(.subheadline.weight(selected ? .bold : .semibold))
                .fixedSize(horizontal: false, vertical: true)
        }.frame(minHeight: 44, alignment: .leading)
        if let landing = info?.landingId ?? matching?.landingId {
            Button { store.afterSheet { store.selectLanding(landing) } } label: { label }
                .buttonStyle(.borderless)
                .accessibilityLabel(name + (selected ? ", selected stop" : ""))
                .accessibilityHint("Open this landing’s departures")
        } else {
            label.foregroundStyle(.primary)
                .accessibilityLabel(name + (selected ? ", selected stop" : ""))
        }
    }

    private func stopTimes(_ call: TripCall, matching: ConnectionStop?) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 12) { timeFields(call, matching: matching) }
                .fixedSize(horizontal: true, vertical: false)
            VStack(alignment: .leading, spacing: 4) { timeFields(call, matching: matching) }
        }
    }

    @ViewBuilder private func timeFields(_ call: TripCall, matching: ConnectionStop?) -> some View {
        if let seconds = call.arrivalSeconds {
            callTime("ARR", seconds: seconds, estimate: freshConnections ? matching?.estimatedArrivalSeconds : nil)
        }
        if let seconds = call.departureSeconds {
            callTime("DEP", seconds: seconds, estimate: nil)
        }
    }

    private func callTime(_ label: String, seconds: Double, estimate: Double?) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(label).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Text(store.time(estimate ?? seconds)).font(.subheadline.weight(.semibold).monospacedDigit())
                if estimate != nil { Text("EST").font(.caption2.weight(.semibold)).foregroundStyle(store.theme.accent) }
            }
            if let estimate, estimate != seconds {
                Text("sched \(store.time(seconds))").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
            }
        }.accessibilityElement(children: .combine)
    }

    @ViewBuilder private func pauseLine(_ call: TripCall, matching: ConnectionStop?) -> some View {
        let dwell = dwellMinutes(call)
        let layover = ScheduleEngine.tripLayover(data: data, tripID: sourceID, call: call,
            connectionTurnaround: matching?.turnaround, live: freshConnections)
        if dwell != nil || layover != nil {
            Text([
                dwell.map { "Dwell \($0) min scheduled" },
                layover.map { pause in
                    if let estimate = pause.estimatedMinutes {
                        return "Layover \(pause.scheduledMinutes) → \(estimate) min EST"
                    }
                    return "Layover \(pause.scheduledMinutes) min scheduled"
                }
            ].compactMap { $0 }.joined(separator: " · "))
            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            .accessibilityLabel([
                dwell.map { "Scheduled dwell \($0) minutes" },
                layover.map { pause in
                    if let estimate = pause.estimatedMinutes {
                        return "Scheduled layover \(pause.scheduledMinutes) minutes, currently estimated \(estimate) minutes"
                    }
                    return "Scheduled layover \(pause.scheduledMinutes) minutes"
                }
            ].compactMap { $0 }.joined(separator: ", "))
        }
    }

    private func dwellMinutes(_ call: TripCall) -> Int? {
        guard data.meta.showDwellTimes == true, let arrival = call.arrivalSeconds,
              let departure = call.departureSeconds, (departure - arrival).isFinite,
              departure >= arrival else { return nil }
        return Int(floor((departure - arrival) / 60 + 0.5))
    }

    @ViewBuilder private func connectingDepartures(_ stop: ConnectionStop) -> some View {
        let visible = stop.connections.filter { store.visible($0) }
        if !visible.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("CONNECT").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(Array(visible.prefix(max(0, stop.limit ?? 3)))) { connection in
                    connectionRow(connection)
                }
            }.padding(.top, 3)
        } else {
            Text(stop.connections.isEmpty ? "No connecting departures listed" : "Connections hidden by departure filters")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func connectionRow(_ connection: Connection) -> some View {
        let estimated = freshConnections && connection.hasLiveTiming == true
        let delay = estimated ? max(0, connection.delaySeconds ?? 0) : 0
        return VStack(alignment: .leading, spacing: 1) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(store.time(connection.seconds + delay)).fontWeight(.semibold).monospacedDigit()
                if estimated { Text("EST").font(.caption2).foregroundStyle(store.theme.accent) }
                Text(connection.shortName ?? connection.routeId).font(.caption.bold()).foregroundStyle(Color(hex: connection.color))
                if !dynamicTypeSize.isAccessibilitySize { Text(connection.destination).fixedSize(horizontal: false, vertical: true) }
            }
            if dynamicTypeSize.isAccessibilitySize { Text(connection.destination) }
            if delay > 0 || connection.boatName != nil || connection.predictedBoatName != nil {
                Text([
                    delay > 0 ? "sched \(store.time(connection.seconds))" : nil,
                    (connection.boatName ?? connection.predictedBoatName).map { $0 + (connection.boatName == nil ? "?" : "") }
                ].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.font(.subheadline).accessibilityElement(children: .combine)
    }

    private func refresh() async {
        guard !timetableOnly else { return }
        guard live else { connections = nil; note = "Connections are shown for today only."; return }
        let id = sourceID, date = row.serviceDate, now = store.now
        do {
            let response = try await store.repository.fetch(Connections.self, endpoint: .init("api/connections", ["tripId": id]), validate: {
                guard $0.usable(tripID: id, serviceDate: date, now: now) else { throw FerryError.invalidResponse }
            })
            guard !Task.isCancelled else { return }
            connections = response.value
            if response.saved { connections?.stale = true }
        } catch {
            guard !Task.isCancelled else { return }
            connections = nil; note = "Connections unavailable. Showing the trip’s published stops."
        }
    }

    private func beginRide() {
        let vehicle = store.realtime.vehicles?.first { $0.tripId == liveID }
        if let id = vehicle?.vesselId, let name = vehicle?.boatName, live, !store.realtime.stale, store.realtime.vehiclesStale != true {
            store.afterSheet { store.startRide(Vessel(id: id, name: name)) }
        } else { store.afterSheet { store.sheet = .vessels(displayedVessel?.name) } }
    }
}
