import SwiftUI
import MapKit
import FerryCore

struct RideView: View {
    @EnvironmentObject private var store: FerryStore
    @Environment(\.dynamicTypeSize) private var textSize
    @State private var switching = false
    @State private var showingMap = false
    private var live: Bool { store.ride?.stale == false && store.ride?.positionStale == false }

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                // Wide screens keep where the boat is beside the day's trips, each scrolling on its own.
                if proxy.size.width >= 700 && !textSize.isAccessibilitySize {
                    HStack(alignment: .top, spacing: 0) {
                        ScrollView { VStack(alignment: .leading, spacing: 10) { vesselHeader; now(mapOpen: true) }.padding(12) }
                            .frame(width: min(420, proxy.size.width * 0.42))
                        Divider()
                        ScrollView { VStack(alignment: .leading, spacing: 8) { trips }.padding(12) }
                    }
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 10) { vesselHeader; now(mapOpen: false); trips }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .frame(maxWidth: 900).frame(maxWidth: .infinity, alignment: .top)
                    }
                }
            }.background(store.theme.background)
                .refreshable { await store.refreshRide() }
                .navigationTitle("Your boat").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button("Minimize") { store.minimizeRide() }.accessibilityIdentifier("minimizeRide") }
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button("Switch boats", systemImage: "arrow.triangle.swap") { switching = true }
                            Button("Exit boat", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { store.exitRide() }
                        } label: { Label("Ride actions", systemImage: "ellipsis.circle") }.accessibilityIdentifier("rideActions")
                    }
                }
                .sheet(isPresented: $switching) {
                    NavigationStack {
                        VesselPicker(suggestedName: nil) { vessel in switching = false; store.startRide(vessel) }
                            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { switching = false } } }
                    }
                }
        }
    }

    /// The current trip, the next landing and the boat's position, which stays open when there is room.
    @ViewBuilder private func now(mapOpen: Bool) -> some View {
        if let ride = store.ride {
            if let current = ride.trips.first(where: { $0.state == "current" }) {
                (Text(current.route + (current.boatAssignment.map(String.init) ?? "")).bold() + Text(" → \(current.destination)"))
                    .font(.subheadline)
                if current.outOfService == true {
                    Text("Out of service · no passenger boarding").font(.caption.bold()).foregroundStyle(.secondary)
                }
            }
            nextStop(ride)
            if let position = ride.position {
                if mapOpen { miniMap(ride, position: position, height: 220) }
                else {
                    DisclosureGroup(isExpanded: $showingMap) {
                        miniMap(ride, position: position, height: 160)
                    } label: {
                        Label(showingMap ? "Vessel position" : "Show map", systemImage: "map")
                            .font(.subheadline).frame(minHeight: 44)
                    }.accessibilityIdentifier("rideMapDisclosure")
                }
            }
        } else {
            Text(store.rideError ?? "Loading confirmed trips for your saved boat…")
                .font(.subheadline).foregroundStyle(.secondary)
            Button("Try again") { Task { await store.refreshRide() } }.frame(minHeight: 44)
        }
    }
    @ViewBuilder private func miniMap(_ ride: Ride, position: RidePosition, height: CGFloat) -> some View {
        RideMiniMap(position: position, stale: !live)
            .frame(height: height).clipShape(RoundedRectangle(cornerRadius: 10))
            .accessibilityLabel("\(live ? "Current" : "Last reported") vessel position")
        Button("Open full map", systemImage: "map") {
            store.minimizeRide(); store.showBoat(name: ride.vessel.name)
        }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
    }
    @ViewBuilder private var trips: some View {
        if let ride = store.ride {
            HStack(alignment: .firstTextBaseline) {
                Text("Confirmed trips").font(.subheadline.bold())
                Spacer(minLength: 8)
                Text(ride.date).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            if ride.trips.isEmpty {
                Text("Waiting for confirmed assignments. Your boat is saved.")
                    .font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 8)
            }
            ForEach(ride.trips) { trip in
                RideTripCard(trip: trip, stale: ride.stale, timezone: ride.timezone)
            }
            Text(ride.historyNote).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var vesselHeader: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                vesselName
                vesselNumber
                Spacer(minLength: 0)
                freshness
            }
            VStack(alignment: .leading, spacing: 4) {
                vesselName
                HStack { vesselNumber; Spacer(); freshness }
            }
        }
    }
    private var vesselName: some View {
        Text(store.rideSession?.vessel.name ?? "Your boat")
            .font(.title3.bold()).fixedSize(horizontal: false, vertical: true).accessibilityIdentifier("rideVesselName")
    }
    private var vesselNumber: some View {
        Text(store.rideSession?.vessel.number ?? "NYC Ferry").font(.caption).foregroundStyle(.secondary)
    }
    private var freshness: some View {
        StatusPill(text: live ? "LIVE" : store.ride == nil ? "CONNECTING" : "SAVED", color: live ? .green : .secondary)
    }

    @ViewBuilder private func nextStop(_ ride: Ride) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(live ? ride.position?.status == "stopped" ? "AT LANDING" : "NEXT LANDING" : "LAST REPORTED NEXT LANDING")
                    .font(.caption2.bold()).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                if live, let speed = ride.position?.speedKnots {
                    Text(String(format: "%.1f kn", speed)).font(.subheadline.monospacedDigit().weight(.semibold))
                        .accessibilityLabel(String(format: "Speed %.1f knots", speed))
                }
            }
            Text(ride.nextStop?.name ?? "Not yet reported").font(.headline)
            if let stop = ride.nextStop {
                if let service = rideStopService(stop) {
                    Text(service).font(.caption.bold()).foregroundStyle(.secondary)
                }
                RideStopClocks(stop: stop, stale: ride.stale, timezone: ride.timezone, arrivalIdentifier: "rideArrival")
                RideStopDurations(stop: stop, stale: ride.stale)
                if live {
                    let atLanding = ride.position?.status == "stopped"
                    let estimate = atLanding ? stop.estimatedDepartureSeconds : stop.estimatedArrivalSeconds
                    if estimate != nil, let instant = stop.instant(arrival: !atLanding, stale: false) {
                        let minutes = max(0, Int(ceil(instant.timeIntervalSince(store.now) / 60)))
                        Text("\(atLanding ? "Departure" : "Arrival") \(minutes == 0 ? "due now" : "in \(minutes) min")")
                            .font(.caption.weight(.semibold)).foregroundStyle(store.theme.accent)
                    }
                }
            }
            if let reported = ride.position?.reportedAt {
                Text("\(live ? "Position" : "Saved position") \(store.time(Date(timeIntervalSince1970: reported / 1000), timezone: ride.timezone))\(live ? "" : " · speed unavailable")")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }.padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(.background, in: RoundedRectangle(cornerRadius: 10))
    }
}

struct RideMiniMap: View {
    let position: RidePosition
    let stale: Bool
    var body: some View {
        Map(initialPosition: .region(.init(center: .init(latitude: position.latitude, longitude: position.longitude), span: .init(latitudeDelta: 0.02, longitudeDelta: 0.02))), interactionModes: []) {
            Annotation(stale ? "Last reported" : "Your boat", coordinate: .init(latitude: position.latitude, longitude: position.longitude)) {
                Image(systemName: "ferry.fill").padding(8).foregroundStyle(.white).background(stale ? .gray : .blue, in: Circle())
            }
        }.id("\(position.latitude)|\(position.longitude)")
    }
}

struct RideTripCard: View {
    @EnvironmentObject private var store: FerryStore
    let trip: RideTrip
    let stale: Bool
    let timezone: String
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(trip.stops) { stop in
                    if let id = stop.landingId {
                        Button { store.minimizeRide(); store.selectLanding(id) } label: {
                            stopRow(stop, linked: true)
                        }.buttonStyle(.plain)
                            .accessibilityHint("Open departures at \(stop.name)")
                    } else { stopRow(stop, linked: false) }
                    if stop.sequence != trip.stops.last?.sequence { Divider() }
                }
            }.padding(.top, 4)
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text("\(trip.route)\(trip.boatAssignment.map(String.init) ?? "") → \(trip.destination)").font(.subheadline.weight(.semibold))
                Text("\(store.time(trip.startAt.map { Date(timeIntervalSince1970: $0 / 1000) }, timezone: timezone)) · \(trip.state == "reassigned" ? "Assignment changed" : trip.state.capitalized)\(trip.outOfService == true ? " · Out of service" : "")")
                    .font(.caption).foregroundStyle(.secondary)
            }.frame(minHeight: 44, alignment: .leading)
        }.padding(.horizontal, 10).padding(.vertical, 4)
            .background(.background, in: RoundedRectangle(cornerRadius: 10))
            .onAppear { expanded = trip.state == "current" }
    }

    private func stopRow(_ stop: RideStop, linked: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(stop.name).font(.subheadline.weight(stop.current ? .bold : .medium))
                    .foregroundStyle(stop.current ? store.theme.accent : .primary)
                Spacer(minLength: 0)
                if linked { Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary).accessibilityHidden(true) }
            }
            if stop.skipped { Text("SKIPPED").font(.caption.bold()).foregroundStyle(.secondary) }
            else if trip.state == "canceled" { Text("CANCELED").font(.caption.bold()).foregroundStyle(.orange) }
            else {
                if let service = rideStopService(stop, final: stop.sequence == trip.stops.last?.sequence) {
                    Text(service).font(.caption2.bold()).foregroundStyle(.secondary)
                }
                RideStopClocks(stop: stop, stale: stale, timezone: timezone)
                RideStopDurations(stop: stop, stale: stale)
            }
        }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).padding(.vertical, 7).contentShape(Rectangle())
    }
}

/// Both clocks remain visible: a scheduled dwell must not be flattened into one ETA.
private struct RideStopClocks: View {
    @EnvironmentObject private var store: FerryStore
    @Environment(\.dynamicTypeSize) private var textSize
    let stop: RideStop
    let stale: Bool
    let timezone: String
    var arrivalIdentifier: String? = nil

    var body: some View {
        let layout = textSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 3)) : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
        layout {
            if stop.arrivalSeconds != nil || stop.arrivalAt != nil {
                if let arrivalIdentifier { clock(arrival: true).accessibilityIdentifier(arrivalIdentifier) }
                else { clock(arrival: true) }
            }
            if stop.departureSeconds != nil || stop.departureAt != nil { clock(arrival: false) }
        }
    }
    private func clock(arrival: Bool) -> some View {
        let estimated = !stale && (arrival ? stop.estimatedArrivalSeconds : stop.estimatedDepartureSeconds) != nil
        let time = store.time(stop.instant(arrival: arrival, stale: stale), timezone: timezone)
        return (Text("\(arrival ? "ARR" : "DEP") ").font(.caption2) + Text(time).font(.subheadline.weight(.semibold)) + Text(estimated ? " est" : " sched").font(.caption2))
            .monospacedDigit()
            .accessibilityLabel("\(arrival ? "Arrival" : "Departure") \(time), \(estimated ? "estimated" : "scheduled")")
    }
}

private struct RideStopDurations: View {
    @EnvironmentObject private var store: FerryStore
    let stop: RideStop
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if store.preferences.showDwellTimes, let arrival = stop.instant(arrival: true, stale: stale),
               let departure = stop.instant(arrival: false, stale: stale), departure > arrival {
                let estimated = !stale && (stop.estimatedArrivalSeconds != nil || stop.estimatedDepartureSeconds != nil)
                Text("Dwell \(duration(departure.timeIntervalSince(arrival))) · \(estimated ? "estimated" : "scheduled")")
            }
            if store.preferences.showLayoverTimes, let layover = stop.layoverSeconds, !(stale && stop.layoverEstimated == true) {
                Text("Layover \(duration(layover)) · \(stop.layoverEstimated == true ? "estimated" : "scheduled")")
            }
        }.font(.caption2).foregroundStyle(.secondary)
    }
    private func duration(_ seconds: TimeInterval) -> String {
        let whole = max(0, Int(seconds.rounded()))
        let minutes = whole / 60, remainder = whole % 60
        if minutes == 0 { return "\(remainder) sec" }
        return remainder == 0 ? "\(minutes) min" : "\(minutes)m \(remainder)s"
    }
}

private func rideStopService(_ stop: RideStop, final: Bool = false) -> String? {
    if stop.pickupType == 1 && stop.dropOffType == 1 { return "No pickup or drop-off" }
    if stop.dropOffType == 1 { return "Pickup only" }
    if final { return "Final drop-off" }
    if stop.pickupType == 1 { return "Drop-off only" }
    return nil
}
