import SwiftUI
import WidgetKit

struct WidgetSetupView: View {
    @EnvironmentObject private var store: FerryStore
    @StateObject private var locator = NearestLanding()
    @State private var requested = false
    @State private var copied = false

    var body: some View {
        Form {
            copySettingsSection
            landingSection
            operatorsSection
            visibilitySection
            readingSection
            refreshSection
            installSection
            notesSection
        }.navigationTitle("Nearby ferry widget")
    }
    private var copySettingsSection: some View {
        Section {
            Button("Copy main app settings") { store.copyMainSettingsToWidget(); copied = true }
                .accessibilityIdentifier("widgetCopySettings")
            if copied { Text("Copied to widget defaults.").font(.caption).foregroundStyle(.secondary) }
        } header: { Text("Widget defaults") } footer: {
            Text("Copies the current landing, operator/route filters, clock, theme, text size, dwell/layover and lookahead options. You can change these below. Widgets using custom settings keep their own choices.")
        }
    }

    private var landingSection: some View {
        Section {
            Toggle("Automatically use nearest landing", isOn: $store.widgetOptions.automaticLanding)
                .accessibilityIdentifier("widgetAutomaticLanding")
            if store.widgetOptions.automaticLanding {
                locationControls
            } else {
                Picker("Fixed landing", selection: $store.widgetOptions.landingID) {
                    Text("Choose a landing").tag(nil as Int?)
                    ForEach((store.roster?.landings ?? []).sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }) { landing in
                        Text(landing.displayName).fontWeight(store.preferences.favorites.contains(landing.id) ? .bold : .regular).tag(Optional(landing.id))
                    }
                }.pickerStyle(.navigationLink).accessibilityIdentifier("widgetFixedLanding")
                .onChange(of: store.widgetOptions.landingID) { _, id in
                    store.widgetOptions.landingName = store.roster?.landings.first { $0.id == id }?.displayName
                }
            }
        } header: { Text("Landing") } footer: {
            Text("A fixed landing works without location permission. In automatic mode, allow location in the app and for the widget when iOS asks. Coordinates stay on your device.")
        }
    }

    private var operatorsSection: some View {
        Section("Operators") {
            ForEach(store.roster?.operators ?? [], id: \.self) { name in
                Toggle(name, isOn: Binding(get: { !store.widgetOptions.hiddenOperators.contains(name) }, set: { visible in
                    if visible { store.widgetOptions.hiddenOperators.remove(name) } else { store.widgetOptions.hiddenOperators.insert(name) }
                })).accessibilityIdentifier("widgetOperator-\(name)")
            }
            if !store.widgetOptions.hiddenRoutes.isEmpty || !store.widgetOptions.hiddenNYCMovements.isEmpty {
                Text("Copied route and NYC movement filters are also active.").font(.caption).foregroundStyle(.secondary)
                Button("Clear copied route and movement filters") {
                    store.widgetOptions.hiddenRoutes = []; store.widgetOptions.hiddenNYCMovements = []
                }
            }
        }
    }

    private var visibilitySection: some View {
        Section("Show information") {
            Toggle("Boat names", isOn: $store.widgetOptions.showBoatNames).accessibilityIdentifier("widgetBoatNames")
            Toggle("Route assignments", isOn: $store.widgetOptions.showAssignments).accessibilityIdentifier("widgetAssignments")
            Toggle("Dwell times", isOn: $store.widgetOptions.showDwells).accessibilityIdentifier("widgetDwells")
            Toggle("Layover times", isOn: $store.widgetOptions.showLayovers).accessibilityIdentifier("widgetLayovers")
            Toggle("Countdowns", isOn: $store.widgetOptions.showCountdown).accessibilityIdentifier("widgetCountdowns")
        }
    }

    private var readingSection: some View {
        Section("Reading and departures") {
            Toggle("12-hour time", isOn: $store.widgetOptions.twelveHour)
            Toggle("Sort by route", isOn: $store.widgetOptions.sortByRoute)
            Picker("Theme", selection: $store.widgetOptions.theme) {
                Text("Follow device appearance").tag("system")
                ForEach(FerryTheme.all) { theme in Text(theme.name).tag(theme.id) }
            }
            Picker("Text size", selection: $store.widgetOptions.textSize) {
                Text("System").tag("system"); Text("Compact").tag("compact"); Text("Larger").tag("larger")
            }
            Picker("Look ahead", selection: $store.widgetOptions.departureWindowMinutes) {
                Text("Schedule default").tag(0); Text("30 minutes").tag(30)
                Text("1 hour").tag(60); Text("2 hours").tag(120); Text("4 hours").tag(240)
            }
            Picker("Departures per route", selection: $store.widgetOptions.departuresPerRoute) {
                Text("Fill widget").tag(0)
                ForEach(1...5, id: \.self) { Text(String($0)).tag($0) }
            }
        }
    }

    private var refreshSection: some View {
        Section {
            Button("Refresh widget settings") { store.syncWidgetSettings() }
            if let error = store.widgetSharingError { Text(error).font(.caption).foregroundStyle(.secondary) }
            Button("Reset widget defaults") { store.widgetOptions = .init(); copied = false }
        } footer: {
            Text("Changes apply to widgets with Use app widget defaults enabled. To give one widget its own settings, touch and hold it, choose Edit Widget, then turn that option off.")
        }
    }

    private var installSection: some View {
        Section("Add the widget") {
            Text("Touch and hold your Home Screen, choose Edit → Add Widget, then search for Ferry Board or Nearby Ferries. Choose a small, medium or large widget.")
            Button("Request widget refresh") { WidgetCenter.shared.reloadTimelines(ofKind: "NearbyFerries") }
        }
    }

    private var notesSection: some View {
        Section("During your shift") {
            Text("The widget requests updates every 15 minutes; iOS decides when they run. Scheduled departures advance between downloads. Live timing and vessel names expire after five minutes.")
            Text("If GPS is temporarily unavailable, the widget labels its last location. After six hours it asks you to update location. Tap the widget to open its landing in Ferry Board.")
        }.font(.footnote)
    }

    @ViewBuilder private var locationControls: some View {
        Button {
            requested = true
            locator.locate(store.roster?.landings ?? [])
        } label: {
            Label(locator.locating ? "Finding nearest landing…" : "Enable location / find nearest", systemImage: "location.fill")
        }.disabled(locator.locating || store.roster == nil).accessibilityIdentifier("widgetEnableLocation")
        if requested, let saved = locator.saved, !locator.locating, locator.error == nil {
            Text("Nearest: \(saved.name)").font(.footnote)
            Button("Open this landing") { store.selectLanding(saved.id); store.sheet = nil }
        }
        if let error = locator.error { Text(error).font(.footnote).foregroundStyle(.secondary) }
        Link("Location settings", destination: URL(string: UIApplication.openSettingsURLString)!)
    }
}
