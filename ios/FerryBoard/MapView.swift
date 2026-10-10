import SwiftUI
import MapKit
import FerryCore

struct HarborMapView: View {
    @EnvironmentObject private var store: FerryStore
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @State private var camera: MapCameraPosition = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 40.69, longitude: -74.02), span: MKCoordinateSpan(latitudeDelta: 0.30, longitudeDelta: 0.25)))
    @State private var showVessels = true

    private func compactHullNumber(_ number: String?) -> String {
        (number ?? "").replacingOccurrences(of: "-", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var boats: [Boat] {
        (store.boats?.boats ?? []).filter {
            (store.routeFilter == nil || $0.routeId == store.routeFilter) &&
            (store.mapSearch.isEmpty || [$0.name, $0.number ?? "", compactHullNumber($0.number), $0.destination ?? "", $0.stop?.name ?? ""].joined(separator: " ").localizedCaseInsensitiveContains(store.mapSearch))
        }
    }
    var body: some View {
        Map(position: $camera) {
            ForEach((store.harbor?.routes ?? []).filter { store.routeFilter == nil || $0.id == store.routeFilter }) { route in
                ForEach(Array((route.paths ?? []).enumerated()), id: \.offset) { _, path in
                    MapPolyline(coordinates: path.compactMap { point in
                        guard point.count == 2 else { return nil }
                        return CLLocationCoordinate2D(latitude: point[0], longitude: point[1])
                    }).stroke(Color(hex: route.color).opacity(store.routeFilter == nil ? 0.45 : 0.85), lineWidth: 3)
                }
            }
            ForEach(store.harbor?.landings ?? []) { landing in
                if let lat = landing.latitude, let lon = landing.longitude {
                    Annotation(landing.name, coordinate: .init(latitude: lat, longitude: lon), anchor: .bottom) {
                        Button { store.selectLanding(landing.id) } label: {
                            Image(systemName: "mappin.circle.fill").font(.title2).foregroundStyle(store.theme.accent).background(.background, in: Circle()).frame(width: 44, height: 44)
                        }
                        .contextMenu {
                            Button { store.selectLanding(landing.id) } label: {
                                Text("Open ") + Text(landing.displayName).fontWeight(store.preferences.favorites.contains(landing.id) ? .bold : .regular)
                            }
                        }
                        .accessibilityLabel("\(landing.displayName), open departure board")
                    }
                }
            }
            ForEach(boats) { boat in
                let hull = compactHullNumber(boat.number)
                Annotation(boat.name, coordinate: .init(latitude: boat.latitude, longitude: boat.longitude)) {
                    Button {
                        store.selectedBoatID = boat.id; store.wantedVesselName = nil; store.sheet = .boat(boat)
                    } label: {
                        Text(hull.isEmpty ? "?" : hull)
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .lineLimit(1).minimumScaleFactor(0.7)
                            .padding(.horizontal, 3)
                            .frame(width: 32, height: 32)
                            .foregroundStyle(.white)
                            .background(Color(hex: boat.color), in: Circle())
                            .overlay(Circle().strokeBorder(store.selectedBoatID == boat.id ? Color.primary : .clear, lineWidth: 2))
                            .opacity(store.boats?.stale == true || (boat.ageSeconds ?? 0) > 180 ? 0.6 : 1)
                            .frame(width: 44, height: 44)
                            .contentShape(Circle())
                    }.buttonStyle(.plain)
                        .accessibilityLabel("\(boat.name), \(boat.number ?? ""), \(boat.destination ?? "vessel details")")
                        .accessibilityIdentifier("mapBoatMarker-\(boat.id)")
                }
                .annotationTitles(.hidden)
            }
            if store.preferences.showMarineReferences {
                ForEach(store.harbor?.chart?.bridges ?? []) { bridge in
                    if bridge.points.count >= 2, bridge.points[0].count == 2, bridge.points[1].count == 2 {
                        Annotation(bridge.name, coordinate: .init(latitude: (bridge.points[0][0] + bridge.points[1][0]) / 2, longitude: (bridge.points[0][1] + bridge.points[1][1]) / 2)) {
                            Button { store.sheet = .bridge(bridge) } label: {
                                Image(systemName: "point.topleft.down.to.point.bottomright.curvepath").font(.caption).padding(7).background(.regularMaterial, in: Circle()).frame(width: 44, height: 44)
                            }.accessibilityLabel(bridge.name)
                        }
                    }
                }
                ForEach(store.harbor?.chart?.seamarks ?? []) { mark in
                    Annotation(mark.name, coordinate: .init(latitude: mark.latitude, longitude: mark.longitude)) {
                        Button { store.sheet = .seamark(mark) } label: {
                            Image(systemName: "light.beacon.max.fill").font(.caption2).foregroundStyle(.orange).padding(5).background(.regularMaterial, in: Circle()).frame(width: 44, height: 44)
                        }.accessibilityLabel(mark.name)
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll, showsTraffic: false))
        // On the map itself: applied after the insets it replaced the header and vessel list identifiers.
        .accessibilityIdentifier("harborMap")
        .mapControls { MapCompass(); MapScaleView() }
        .safeAreaInset(edge: .top, spacing: 0) { mapHeader }
        .safeAreaInset(edge: .bottom, spacing: 0) { vesselList }
        .navigationTitle("Harbor map")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Button("All routes") { store.routeFilter = nil }
                    ForEach(store.harbor?.routes ?? []) { route in Button(route.name) { store.routeFilter = route.id } }
                    Divider()
                    Toggle("Marine references", isOn: $store.preferences.showMarineReferences)
                } label: { Label("Map filters", systemImage: "line.3.horizontal.decrease.circle") }
                .accessibilityIdentifier("mapFilters")
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Fit harbor", systemImage: "arrow.up.left.and.arrow.down.right") { fit() }
                Button("Settings", systemImage: "gearshape") { store.sheet = .settings }
            }
        }
        .onChange(of: store.selectedBoatID) { _, _ in focusBoat() }
        .onAppear {
            if store.selectedBoatID != nil { focusBoat() }
            if verticalSizeClass == .compact { showVessels = false }
        }
        .onChange(of: verticalSizeClass) { _, value in if value == .compact { showVessels = false } }
    }

    private var mapHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Vessel, hull number, or destination", text: $store.mapSearch).font(.body).accessibilityIdentifier("vesselSearch")
                if !store.mapSearch.isEmpty { Button("Clear search", systemImage: "xmark.circle.fill") { store.mapSearch = "" }.labelStyle(.iconOnly).frame(width: 44, height: 44) }
            }
            HStack {
                Text(store.routeFilter.map { "\($0) · " } ?? "") + Text("\(boats.count) reporting vessels")
                Spacer()
                Text(store.boats?.stale == false ? "Live" : "Saved / unavailable").foregroundStyle(.secondary)
            }.font(.caption)
            if let wanted = store.wantedVesselName, !(store.boats?.boats ?? []).contains(where: { $0.name == wanted || $0.number == wanted || $0.vesselId == wanted }) {
                Text("\(wanted) is not reporting a position right now.").font(.caption)
            }
            if let error = store.mapError { Text(error).font(.caption).foregroundStyle(.secondary) }
        }.padding(.horizontal, 12).padding(.vertical, 6).background(.regularMaterial)
    }

    private var vesselList: some View {
        VStack(spacing: 0) {
            HStack {
                Button { showVessels.toggle() } label: {
                    Label("Vessels", systemImage: showVessels ? "chevron.down" : "chevron.up").font(.headline).frame(minHeight: 44)
                }
                Spacer()
                Button("Your boat", systemImage: "person.fill") {
                    if store.rideSession != nil { store.showingRide = true } else { store.sheet = .vessels(nil) }
                }.accessibilityIdentifier("chooseBoat")
            }.padding(.horizontal)
            if showVessels {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        if boats.isEmpty {
                            Text(store.mapSearch.isEmpty ? "No vessels are reporting here. You can still choose your boat." : "No vessels match your search.")
                                .font(.subheadline).foregroundStyle(.secondary).padding()
                        }
                        ForEach(boats) { boat in
                            Button {
                                store.selectedBoatID = boat.id; store.wantedVesselName = nil; focusBoat(); store.sheet = .boat(boat)
                            } label: {
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    Circle().fill(Color(hex: boat.color)).frame(width: 9, height: 9)
                                    Text(boat.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                                    Text([boat.number, boat.route, boat.destination].compactMap { $0 }.joined(separator: " · "))
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                    Spacer(minLength: 0)
                                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.secondary)
                                }.padding(.horizontal).frame(minHeight: 44).contentShape(Rectangle())
                            }.buttonStyle(.plain).accessibilityIdentifier("mapBoat-\(boat.id)")
                            Divider()
                        }
                    }
                }.frame(maxHeight: verticalSizeClass == .compact ? 84 : 170)
            }
        }.background(.regularMaterial)
    }
    private func focusBoat() {
        guard let boat = store.boats?.boats.first(where: { $0.id == store.selectedBoatID }) else { return }
        camera = .region(.init(center: .init(latitude: boat.latitude, longitude: boat.longitude), span: .init(latitudeDelta: 0.025, longitudeDelta: 0.025)))
    }
    private func fit() {
        guard let bounds = store.harbor?.bounds else { return }
        camera = .region(.init(center: .init(latitude: (bounds.minLatitude + bounds.maxLatitude) / 2, longitude: (bounds.minLongitude + bounds.maxLongitude) / 2), span: .init(latitudeDelta: max(0.02, bounds.maxLatitude - bounds.minLatitude) * 1.1, longitudeDelta: max(0.02, bounds.maxLongitude - bounds.minLongitude) * 1.1)))
    }
}

struct BoatDetail: View {
    @EnvironmentObject private var store: FerryStore
    let initial: Boat
    private var currentBoat: Boat? { store.boats?.boats.first { $0.id == initial.id } }
    private var boat: Boat { currentBoat ?? initial }
    private var fresh: Bool {
        guard let age = currentBoat?.ageSeconds else { return false }
        return store.boats?.stale == false && (0...180).contains(age)
    }
    var body: some View {
        List {
            Section {
                LabeledContent("Hull", value: boat.number ?? "Unknown")
                LabeledContent("Route", value: boat.routeName ?? boat.route ?? "Not assigned")
                LabeledContent("Destination", value: boat.destination ?? "Not reported")
                LabeledContent(boat.status == "stopped" ? "Alongside" : "Next landing", value: boat.stop?.name ?? "Not reported")
                if let speed = boat.speedKnots { LabeledContent("Reported speed", value: String(format: "%.1f kn", speed)) }
                if let age = boat.ageSeconds { LabeledContent("Position age", value: "\(Int(age)) seconds") }
                if !fresh { Text("Last reported vessel data · current position unavailable").foregroundStyle(.secondary) }
            }
            Section {
                Button("Riding this boat?", systemImage: "person.fill") {
                    if let id = boat.vesselId, fresh {
                        let vessel = Vessel(id: id, name: boat.name, number: boat.number)
                        store.afterSheet { store.startRide(vessel) }
                    } else { store.afterSheet { store.sheet = .vessels(boat.name) } }
                }.accessibilityIdentifier("rideThisBoat")
                if let stop = boat.stop, let lat = stop.latitude, let lon = stop.longitude,
                   let landing = store.harbor?.landings.min(by: { distance($0, lat, lon) < distance($1, lat, lon) }), distance(landing, lat, lon) < 250 {
                    Button("Departures at \(landing.displayName)") { store.afterSheet { store.selectLanding(landing.id) } }
                }
            }
        }.navigationTitle(boat.name)
    }
    private func distance(_ landing: Landing, _ latitude: Double, _ longitude: Double) -> Double {
        guard let lat = landing.latitude, let lon = landing.longitude else { return .infinity }
        return CLLocation(latitude: latitude, longitude: longitude).distance(from: CLLocation(latitude: lat, longitude: lon))
    }
}
