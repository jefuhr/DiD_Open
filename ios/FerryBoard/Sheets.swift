import SwiftUI
import FerryCore

struct FerrySheetView: View {
    @EnvironmentObject private var store: FerryStore
    let sheet: FerrySheet
    var body: some View {
        NavigationStack {
            Group {
                switch sheet {
                case .landings: LandingPicker()
                case .operators: OperatorPicker()
                case .settings: SettingsView()
                case .alerts: AlertsView()
                case .vessels(let suggestion): VesselPicker(suggestedName: suggestion) { vessel in store.afterSheet { store.startRide(vessel) } }
                case .trip(let row):
                    if let data = store.displaySchedule { TripView(row: row, data: data) }
                case .boat(let boat): BoatDetail(initial: boat)
                case .bridge(let bridge):
                    List {
                        Text([bridge.type, bridge.waterway].compactMap { $0 }.joined(separator: " · "))
                        if let feet = bridge.clearanceFeet { LabeledContent("Reference clearance", value: "\(Int(feet)) ft") }
                        Text(bridge.clearanceNote ?? "")
                        Text("Reference only; verify current charts, tide and vessel air draft.").font(.footnote).foregroundStyle(.secondary)
                    }.navigationTitle(bridge.name)
                case .seamark(let mark):
                    List {
                        if let kind = mark.type { LabeledContent("Type", value: kind) }
                        if let characteristic = mark.characteristic { LabeledContent("Characteristic", value: characteristic) }
                        if let range = mark.rangeNm { LabeledContent("Range", value: "\(range.formatted()) nm") }
                        if let description = mark.description { Text(description) }
                        Text("Marine reference data: OpenStreetMap / OpenSeaMap contributors, ODbL.").font(.footnote).foregroundStyle(.secondary)
                    }.navigationTitle(mark.name)
                }
            }.toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { store.sheet = nil }.accessibilityIdentifier("dismissSheet") }
            }.navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct LandingPicker: View {
    @EnvironmentObject private var store: FerryStore
    var dismissOnSelection = true
    /// Called after a sidebar choice, so an overlaid sidebar can close.
    var chosen: () -> Void = {}
    @State private var search = ""
    private var choices: [Landing] {
        (store.roster?.landings ?? []).filter { search.isEmpty || "\($0.displayName) \($0.id)".localizedCaseInsensitiveContains(search) }
            .sorted {
                let a = store.preferences.favorites.contains($0.id), b = store.preferences.favorites.contains($1.id)
                return a != b ? a : $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending
            }
    }
    var body: some View {
        List {
            if !dismissOnSelection {
                Section("Workspace") {
                    Button { store.tab = .departures; chosen() } label: {
                        HStack {
                            Label("Departures", systemImage: "ferry")
                            Spacer()
                            if store.tab == .departures { Image(systemName: "checkmark") }
                        }.frame(minHeight: 44)
                    }.accessibilityIdentifier("sidebarDepartures")
                    Button { store.tab = .map; chosen() } label: {
                        HStack {
                            Label("Harbor map", systemImage: "map")
                            Spacer()
                            if store.tab == .map { Image(systemName: "checkmark") }
                        }.frame(minHeight: 44)
                    }.accessibilityIdentifier("sidebarMap")
                }
            }
            ForEach(choices) { landing in
                // The sidebar is narrow: a smaller name keeps most landings to one line.
                HStack(spacing: dismissOnSelection ? 12 : 6) {
                    Button {
                        if !store.preferences.favorites.insert(landing.id).inserted { store.preferences.favorites.remove(landing.id) }
                    } label: {
                        Image(systemName: store.preferences.favorites.contains(landing.id) ? "star.fill" : "star").frame(width: dismissOnSelection ? 44 : 30, height: 44)
                    }.buttonStyle(.borderless).accessibilityLabel("\(store.preferences.favorites.contains(landing.id) ? "Unfavorite" : "Favorite") \(landing.displayName)")
                        .accessibilityIdentifier("favorite-\(landing.id)")
                    Button {
                        if dismissOnSelection {
                            store.afterSheet { store.selectLanding(landing.id) }
                        } else {
                            store.selectLanding(landing.id); chosen()
                        }
                    } label: {
                        HStack {
                            Text(landing.displayName).font(dismissOnSelection ? .body : .subheadline)
                                .foregroundStyle(.primary).multilineTextAlignment(.leading)
                            Spacer()
                            if store.preferences.landingID == landing.id { Image(systemName: "checkmark").accessibilityLabel("Selected") }
                            Text(String(landing.id)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }.frame(minHeight: 44).contentShape(Rectangle())
                    }.buttonStyle(.borderless).accessibilityIdentifier("landing-\(landing.id)")
                }
            }
            if choices.isEmpty { Text("No matching landings.").foregroundStyle(.secondary) }
        }.searchable(text: $search, prompt: "Landing name or number").navigationTitle("Choose landing")
    }
}

struct OperatorPicker: View {
    @EnvironmentObject private var store: FerryStore
    var body: some View {
        List {
            Section("Show departures from") {
                ForEach(store.roster?.operators ?? [], id: \.self) { name in
                    Toggle(name, isOn: Binding(get: { !store.preferences.hiddenOperators.contains(name) }, set: { value in
                        if value { store.preferences.hiddenOperators.remove(name) } else { store.preferences.hiddenOperators.insert(name) }
                    })).accessibilityIdentifier("operator-\(name)")
                }
            }
            Button("Show all operators") { store.preferences.hiddenOperators = [] }
            Text("These choices apply to every landing and to trip connections.").font(.footnote).foregroundStyle(.secondary)
        }.navigationTitle("Operators")
    }
}

struct SettingsView: View {
    @EnvironmentObject private var store: FerryStore
    @State private var refreshing = false
    @State private var refreshNote: String?

    var body: some View {
        Form {
            Section {
                Picker("Text size", selection: $store.preferences.textSize) {
                    ForEach(FerryTextSize.allCases, id: \.self) { size in Text(size.label).tag(size) }
                }.accessibilityIdentifier("textSize")
                Toggle("12-hour time", isOn: $store.preferences.twelveHour).accessibilityIdentifier("clockFormat")
                Picker("Sort departures", selection: $store.preferences.sortByRoute) {
                    Text("Departure time").tag(false); Text("Route").tag(true)
                }.accessibilityIdentifier("defaultSort")
                NavigationLink {
                    ThemePicker()
                } label: {
                    HStack { Text("Theme"); Spacer(); Text(store.theme.name).foregroundStyle(.secondary) }
                }.accessibilityIdentifier("settingsTheme")
            } header: {
                Text("Reading")
            } footer: {
                Text("System follows iPhone text size. Accessibility text sizes are always respected.")
            }
            Section {
                Toggle("Show dwell times", isOn: $store.preferences.showDwellTimes).accessibilityIdentifier("showDwellTimes")
                Toggle("Show layover times", isOn: $store.preferences.showLayoverTimes).accessibilityIdentifier("showLayoverTimes")
                Picker("Departures per route", selection: $store.preferences.departuresPerRoute) {
                    Text("Default (\(store.schedule?.meta.departuresShown ?? 3))").tag(0)
                    ForEach(1...5, id: \.self) { Text(String($0)).tag($0) }
                }.accessibilityIdentifier("departuresPerRoute")
                Picker("Look ahead", selection: $store.preferences.departureWindowMinutes) {
                    Text("Default (\(store.schedule?.meta.departureWindowMinutes ?? 180) min)").tag(0)
                    Text("30 minutes").tag(30); Text("1 hour").tag(60)
                    Text("2 hours").tag(120); Text("4 hours").tag(240)
                }.accessibilityIdentifier("departureWindow")
            } header: {
                Text("Departure board")
            } footer: {
                Text("Dwell and layover appear when the schedule supplies them. The route limit applies when sorting by route; look ahead applies to today.")
            }
            Section {
                Picker("Opening landing", selection: $store.preferences.launchLanding) {
                    Text("Last used").tag(LaunchLanding.lastUsed)
                    Text("Home landing").tag(LaunchLanding.home)
                }.accessibilityIdentifier("launchLanding")
                Picker("Home landing", selection: $store.preferences.homeLandingID) {
                    Text("Server default").tag(nil as Int?)
                    ForEach((store.roster?.landings ?? []).sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }) { landing in
                        Text(landing.displayName).tag(Optional(landing.id))
                    }
                }.pickerStyle(.navigationLink).accessibilityIdentifier("homeLanding")
                if let id = store.preferences.landingID, id != store.preferences.homeLandingID {
                    Button("Use \(store.landingTitle) as home") { store.preferences.homeLandingID = id }
                }
                Picker("Opening screen", selection: $store.preferences.launchTab) {
                    Text("Departures").tag(LaunchTab.departures)
                    Text("Map").tag(LaunchTab.map)
                    Text("Last used").tag(LaunchTab.lastUsed)
                }.accessibilityIdentifier("launchTab")
            } header: {
                Text("On launch")
            } footer: {
                Text("Applied on the next app launch. An active ride still reopens on your boat.")
            }
            Section {
                Toggle("Marine references on map", isOn: $store.preferences.showMarineReferences)
                    .accessibilityIdentifier("showMarineReferences")
                Toggle("Keep screen awake", isOn: $store.preferences.keepScreenAwake)
                    .accessibilityIdentifier("keepScreenAwake")
            } header: {
                Text("On shift")
            } footer: {
                Text("Keep screen awake applies while Ferry Board is open. Marine references show bridges and seamarks.")
            }
            Section("Tools") {
                NavigationLink("Operators", destination: OperatorPicker())
                NavigationLink("Landings & favorites", destination: LandingPicker())
                NavigationLink("Service alerts", destination: AlertsView())
                Button(store.rideSession == nil ? "Choose your boat" : "Switch boats") {
                    store.afterSheet { store.sheet = .vessels(nil) }
                }
                Button {
                    refreshing = true
                    Task {
                        await store.refreshAll()
                        refreshNote = store.schedule == nil ? "Connect to download a schedule." : store.scheduleSaved ? "Saved schedule is still in use." : "Data refreshed."
                        refreshing = false
                    }
                } label: {
                    HStack { Text("Refresh data now"); if refreshing { Spacer(); ProgressView() } }
                }.disabled(refreshing).accessibilityIdentifier("refreshData")
                if let refreshNote { Text(refreshNote).font(.caption).foregroundStyle(.secondary) }
            }
            Section("Ferry Board") {
                NavigationLink("What’s new", destination: ChangelogView())
                Link("Open the website", destination: URL(string: "https://juliet.nyc/ferryTimesMobile/")!)
                Text("Downloaded schedules are available offline. Apple Maps’ background needs a connection or previously cached map data.").font(.footnote).foregroundStyle(.secondary)
                Text("Marine references: OpenStreetMap / OpenSeaMap contributors, ODbL. Reference information only.").font(.footnote).foregroundStyle(.secondary)
            }
        }.navigationTitle("Settings")
    }
}

private struct ThemePicker: View {
    @EnvironmentObject private var store: FerryStore
    var body: some View {
        List(FerryTheme.all) { theme in
            Button { store.preferences.theme = theme.id } label: {
                HStack {
                    Circle().fill(theme.accent).frame(width: 20, height: 20)
                    Text(theme.name).foregroundStyle(.primary)
                    Spacer()
                    if theme.id == store.preferences.theme { Image(systemName: "checkmark") }
                }.frame(minHeight: 44)
            }.accessibilityIdentifier("theme-\(theme.id)")
        }.navigationTitle("Theme")
    }
}

struct ChangelogView: View {
    @EnvironmentObject private var store: FerryStore
    var body: some View {
        List {
            ForEach(Array((store.changelog?.entries ?? []).enumerated()), id: \.offset) { _, entry in
                Section {
                    Text(entry.title).font(.headline)
                    ForEach(entry.notes, id: \.self) { Text($0) }
                } header: { Text(entry.date) }
            }
            if store.changelog == nil { Text("Connect to load the change log.") }
        }.navigationTitle("What’s new")
    }
}

struct AlertsView: View {
    @EnvironmentObject private var store: FerryStore
    var body: some View {
        List {
            if store.alerts?.stale == true { Text("Saved alerts · reconnect for the latest updates").foregroundStyle(.secondary) }
            if store.alerts?.partial == true { Text("Some alert sources are temporarily unavailable.").foregroundStyle(.secondary) }
            ForEach(Array((store.alerts?.alerts ?? []).enumerated()), id: \.offset) { _, alert in
                Section {
                    if let header = alert.header { Text(header).font(.headline) }
                    if let description = alert.description, description != alert.header { Text(description).font(.body) }
                    if let raw = alert.url, let url = URL(string: raw), ["https", "http"].contains(url.scheme) {
                        Link("Read the full notice", destination: url)
                    }
                } header: { Text(alert.agency ?? "Service notice") }
            }
            if store.alerts?.alerts.isEmpty != false {
                MessageCard(title: store.alerts?.available == true ? "No active alerts" : "Alerts unavailable", message: "Updates refresh automatically.", symbol: "exclamationmark.bubble")
            }
        }.navigationTitle("Service alerts").refreshable { await store.refreshAlerts() }
    }
}

struct VesselPicker: View {
    @EnvironmentObject private var store: FerryStore
    let suggestedName: String?
    var select: (Vessel) -> Void
    @State private var search = ""
    private var choices: [Vessel] {
        store.vessels.filter { search.isEmpty || "\($0.name) \($0.number ?? "")".localizedCaseInsensitiveContains(search) }
            .sorted {
                if ($0.name == suggestedName) != ($1.name == suggestedName) { return $0.name == suggestedName }
                return $0.name.localizedStandardCompare($1.name) == .orderedAscending
            }
    }
    var body: some View {
        List {
            Section {
                Text("Choose the name or hull number on your boat. Only trips confirmed by the ferry feed appear in its day.").font(.subheadline).foregroundStyle(.secondary)
            }
            ForEach(choices) { vessel in
                Button { select(vessel) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(vessel.name).font(.headline).foregroundStyle(.primary)
                        Text([vessel.number, vessel.name == suggestedName ? "Suggested · check your boat" : nil].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading).contentShape(Rectangle())
                }.accessibilityIdentifier("vessel-\(vessel.id)")
            }
            if choices.isEmpty { Text(store.vessels.isEmpty ? "Reconnect to load the vessel list." : "No matching vessels.") }
        }.navigationTitle(store.rideSession == nil ? "Which boat?" : "Switch boats")
            .searchable(text: $search, prompt: "Vessel or hull number")
            .task { await store.refreshVessels() }
    }
}
