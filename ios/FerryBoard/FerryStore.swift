import Foundation
import SwiftUI
import FerryCore

enum FerryTab: String, Codable { case departures, map }

enum FerrySheet: Identifiable {
    case landings, operators, settings, alerts, vessels(String?), trip(ScheduledDeparture), boat(Boat), bridge(Bridge), seamark(Seamark)
    var id: String {
        switch self {
        case .landings: "landings"
        case .operators: "operators"
        case .settings: "settings"
        case .alerts: "alerts"
        case .vessels: "vessels"
        case .trip(let row): "trip-" + row.id
        case .boat(let boat): "boat-" + boat.id
        case .bridge(let bridge): "bridge-" + bridge.id
        case .seamark(let mark): "seamark-" + mark.id
        }
    }
}

struct RideSession: Codable {
    var vessel: Vessel
    var startedAt: Date
    var returnTab: FerryTab
}

@MainActor
final class FerryStore: ObservableObject {
    @Published var preferences: Preferences { didSet { save(preferences, key: "preferences") } }
    @Published var tab: FerryTab = .departures {
        didSet { if preferences.lastTab != tab { preferences.lastTab = tab } }
    }
    @Published var sheet: FerrySheet?
    @Published var roster: LandingRoster?
    @Published var schedule: DisplayData?
    @Published var scheduleSaved = false
    @Published var realtime: Realtime = .empty
    @Published var alerts: Alerts?
    @Published var harbor: Harbor?
    @Published var boats: Boats?
    @Published var vessels: [Vessel] = []
    @Published var changelog: Changelog?
    @Published var rideSession: RideSession? { didSet { save(rideSession, key: "ride-session") } }
    @Published var ride: Ride?
    @Published var showingRide = false
    @Published var viewDate: String?
    @Published var now = Date()
    @Published var loadingLanding = false
    @Published var boardError: String?
    @Published var mapError: String?
    @Published var rideError: String?
    @Published var offlineWarning: String?
    @Published var routeFilter: String?
    @Published var selectedBoatID: String?
    @Published var wantedVesselName: String?
    @Published var mapSearch = ""

    let repository: FerryRepository
    private let defaults: UserDefaults
    private var polling: Task<Void, Never>?
    private var selectionTask: Task<Void, Never>?
    private var rideTask: Task<Void, Never>?
    private var tabTask: Task<Void, Never>?
    private var landingGeneration = 0
    private var rideGeneration = 0
    private var lifecycleGeneration = 0
    private var active = false
    private var lastAlerts: Date = .distantPast
    private var sharedLoaded = false
    private let fixedNow: Date?
    private var pendingSheetAction: (() -> Void)?
    private var requests: Set<String> = []

    init(repository: FerryRepository, defaults: UserDefaults = .standard, fixedNow: Date? = nil) {
        self.repository = repository; self.defaults = defaults; self.fixedNow = fixedNow
        var savedPreferences = defaults.data(forKey: "preferences").flatMap { try? JSONDecoder().decode(Preferences.self, from: $0) } ?? Preferences()
        if savedPreferences.launchLanding == .home { savedPreferences.landingID = savedPreferences.homeLandingID }
        self.preferences = savedPreferences
        switch savedPreferences.launchTab {
        case .lastUsed: self.tab = savedPreferences.lastTab
        case .departures: self.tab = .departures
        case .map: self.tab = .map
        }
        self.rideSession = defaults.data(forKey: "ride-session").flatMap { try? JSONDecoder().decode(RideSession.self, from: $0) }
        now = fixedNow ?? Date()
    }

    private func save<T: Encodable>(_ value: T, key: String) {
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: key) }
    }

    var theme: FerryTheme { FerryTheme.all.first { $0.id == preferences.theme } ?? FerryTheme.all[0] }
    var frame: ScheduleFrame? { schedule.map { ScheduleEngine.frame($0, viewDate: viewDate, now: now) } }
    var currentDate: String { frame?.dateKey ?? ServiceClock.parts(now).dateKey }
    var isToday: Bool { frame?.live ?? true }
    var landingTitle: String {
        schedule?.meta.landing.displayName ?? roster?.landings.first { $0.id == preferences.landingID }?.displayName ?? "Ferry Board"
    }
    /// Local display options never rewrite downloaded schedules or cached source data.
    var displaySchedule: DisplayData? {
        guard var result = schedule else { return nil }
        result.meta.showDwellTimes = preferences.showDwellTimes
        result.meta.showLayoverTimes = preferences.showLayoverTimes
        if preferences.departuresPerRoute > 0 { result.meta.departuresShown = preferences.departuresPerRoute }
        if preferences.departureWindowMinutes > 0 { result.meta.departureWindowMinutes = preferences.departureWindowMinutes }
        return result
    }
    var rows: [ScheduledDeparture] {
        guard let schedule = displaySchedule else { return [] }
        return ScheduleEngine.timeline(data: schedule, realtime: realtime, viewDate: viewDate, now: now).filter { visible($0.departure.routeId) }
    }
    var groups: [DepartureGroup] {
        guard let schedule = displaySchedule else { return [] }
        return ScheduleEngine.groups(data: schedule, realtime: realtime, viewDate: viewDate, now: now,
            limitPerGroup: schedule.meta.departuresShown).filter { visible($0.routeId) }
    }
    func operatorName(_ routeID: String) -> String { schedule?.routes[routeID]?.operator ?? schedule?.meta.agencyName ?? "NYC Ferry" }
    func visible(_ routeID: String) -> Bool { !preferences.hiddenOperators.contains(operatorName(routeID)) }
    func time(_ seconds: Double) -> String { ServiceClock.time(seconds: seconds, twelveHour: preferences.twelveHour) }
    func time(_ date: Date?, timezone: String? = nil) -> String {
        guard let date else { return "—" }
        return time(ServiceClock.parts(date, timezone: timezone ?? schedule?.meta.timezone ?? "America/New_York").seconds)
    }
    var boardNote: String? {
        guard let schedule else { return nil }
        var notes: [String] = []
        if let crew = ScheduleEngine.crewCoverage(schedule, date: currentDate) {
            if let message = crew.message { notes.append(message) }
        } else if let crew = schedule.meta.crewScheduleStatus, crew.status == "unconfirmed", let message = crew.message { notes.append(message) }
        if schedule.meta.landing.stopIds?.contains("home-port") == true {
            notes.append("* Listed times are first pickups. Home-port departure is at the captain’s discretion.")
        }
        if let holiday = schedule.meta.holidaySchedule, holiday.dates.contains(currentDate) { notes.append(holiday.message) }
        return notes.isEmpty ? nil : notes.joined(separator: " · ")
    }

    func setActive(_ value: Bool) {
        guard value != active else { return }
        active = value; lifecycleGeneration += 1
        polling?.cancel(); selectionTask?.cancel(); rideTask?.cancel(); tabTask?.cancel()
        markSaved()
        guard value else { return }
        let generation = lifecycleGeneration
        if rideSession != nil { showingRide = true }
        polling = Task { [weak self] in
            guard let self else { return }
            await self.bootstrap()
            guard !Task.isCancelled, generation == self.lifecycleGeneration else { return }
            await self.refresh()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
                guard generation == self.lifecycleGeneration else { return }
                await self.refresh()
            }
        }
    }

    private func markSaved() {
        realtime.stale = true; boats?.stale = true; alerts?.stale = true
        ride?.stale = true; ride?.positionStale = true
    }

    private func bootstrap() async {
        // Restore the visible ride before any unrelated request can wait on the network.
        if let session = rideSession { await loadSavedRide(session) }
        if let saved = await repository.saved(LandingRoster.self, endpoint: .init("api/landings")) { roster = saved.value }
        if preferences.landingID == nil { preferences.landingID = roster?.configured }
        if let id = preferences.landingID {
            let generation = landingGeneration
            if let saved = await repository.saved(DisplayData.self, endpoint: .init("api/display-data", ["landingId":String(id)]), validate: { try $0.validate(landingID: id) }),
               generation == landingGeneration, preferences.landingID == id { applySchedule(saved) }
        }
        do {
            let response = try await repository.fetch(LandingRoster.self, endpoint: .init("api/landings"))
            guard !Task.isCancelled else { return }
            roster = response.value
            if preferences.landingID == nil { preferences.landingID = response.value.configured }
        } catch { if roster == nil { boardError = "Connect to load the landing list. \(error.localizedDescription)" } }
        guard !Task.isCancelled else { return }
        if let id = preferences.landingID { await loadLanding(id) }
        await loadShared()
    }

    private func applySchedule(_ response: SavedResponse<DisplayData>) {
        schedule = response.value; scheduleSaved = response.saved; boardError = response.saved ? response.warning : nil
        offlineWarning = response.warning
    }

    func selectLanding(_ id: Int) {
        tab = .departures
        guard id != preferences.landingID || schedule == nil else { return }
        selectionTask?.cancel(); landingGeneration += 1
        preferences.landingID = id; schedule = nil; realtime = .empty; viewDate = nil; boardError = nil
        selectionTask = Task { [weak self] in
            await self?.loadLanding(id)
            await self?.refreshRealtime()
        }
    }

    private func loadLanding(_ id: Int) async {
        let generation = landingGeneration
        let requestKey = "landing-\(id)-\(generation)-\(lifecycleGeneration)"
        guard requests.insert(requestKey).inserted else { return }
        defer { requests.remove(requestKey) }
        loadingLanding = true
        defer { if generation == landingGeneration { loadingLanding = false } }
        let endpoint = FerryEndpoint("api/display-data", ["landingId":String(id)])
        let validate: @Sendable (DisplayData) throws -> Void = { try $0.validate(landingID: id) }
        if let saved = await repository.saved(DisplayData.self, endpoint: endpoint, validate: validate),
           generation == landingGeneration, preferences.landingID == id { applySchedule(saved) }
        do {
            let response = try await repository.fetch(DisplayData.self, endpoint: endpoint, validate: validate)
            guard !Task.isCancelled, generation == landingGeneration, preferences.landingID == id else { return }
            applySchedule(response)
        } catch {
            guard !Task.isCancelled, generation == landingGeneration else { return }
            boardError = "Schedule unavailable. \(error.localizedDescription)"
        }
    }

    func refresh() async {
        now = fixedNow ?? Date()
        if tab == .departures && !showingRide {
            if schedule == nil, let id = preferences.landingID { await loadLanding(id) }
            await refreshRealtime()
            if now.timeIntervalSince(lastAlerts) >= 60 { await refreshAlerts() }
        }
        if tab == .map && !showingRide { await refreshMap() }
        if rideSession != nil { await refreshRide() }
    }

    func refreshAll() async {
        if let response = try? await repository.fetch(LandingRoster.self, endpoint: .init("api/landings")), !Task.isCancelled {
            roster = response.value
            if preferences.landingID == nil { preferences.landingID = response.value.configured }
        }
        if let id = preferences.landingID { await loadLanding(id) }
        await loadShared(force: true)
        await refreshAlerts()
        await refresh()
    }

    func refreshRealtime() async {
        guard let id = preferences.landingID, schedule?.meta.landingNumber == id else { return }
        let generation = landingGeneration, lifecycle = lifecycleGeneration
        let requestKey = "realtime-\(id)-\(generation)-\(lifecycle)"
        guard requests.insert(requestKey).inserted else { return }
        defer { requests.remove(requestKey) }
        do {
            let response = try await repository.fetch(Realtime.self, endpoint: .init("api/realtime", ["landingId":String(id)]))
            guard !Task.isCancelled, lifecycle == lifecycleGeneration, generation == landingGeneration, preferences.landingID == id else { return }
            realtime = response.value
            if response.saved { realtime.stale = true }
        } catch { if generation == landingGeneration { realtime.stale = true } }
    }

    func refreshAlerts() async {
        let lifecycle = lifecycleGeneration, requestKey = "alerts-\(lifecycleGeneration)"
        guard requests.insert(requestKey).inserted else { return }
        defer { requests.remove(requestKey) }
        lastAlerts = now
        do {
            let response = try await repository.fetch(Alerts.self, endpoint: .init("api/alerts"))
            guard !Task.isCancelled, lifecycle == lifecycleGeneration else { return }
            alerts = response.value
            if response.saved { alerts?.stale = true }
        } catch { alerts?.stale = true }
    }

    func loadShared(force: Bool = false) async {
        guard !sharedLoaded || force else { return }
        if harbor == nil, let saved = await repository.saved(Harbor.self, endpoint: .init("api/map")) { harbor = saved.value }
        if vessels.isEmpty, let saved = await repository.saved(Vessels.self, endpoint: .init("api/vessels")) { vessels = saved.value.vessels }
        do {
            let response = try await repository.fetch(Harbor.self, endpoint: .init("api/map"))
            guard !Task.isCancelled else { return }
            harbor = response.value
        } catch { mapError = error.localizedDescription }
        await refreshVessels()
        if let response = try? await repository.fetch(Changelog.self, endpoint: .init("api/changelog")), !Task.isCancelled { changelog = response.value }
        sharedLoaded = harbor != nil
    }

    func refreshVessels() async {
        if let response = try? await repository.fetch(Vessels.self, endpoint: .init("api/vessels")), !Task.isCancelled { vessels = response.value.vessels }
    }

    func refreshMap() async {
        let lifecycle = lifecycleGeneration, requestKey = "map-\(lifecycleGeneration)"
        guard requests.insert(requestKey).inserted else { return }
        defer { requests.remove(requestKey) }
        if harbor == nil { await loadShared(force: true) }
        do {
            let response = try await repository.fetch(Boats.self, endpoint: .init("api/boats"))
            guard !Task.isCancelled, lifecycle == lifecycleGeneration else { return }
            boats = response.value
            if response.saved { boats?.stale = true }
            mapError = response.saved ? "Saved vessel positions" : nil
            resolveWantedBoat()
        } catch { boats?.stale = true; mapError = "Vessel positions unavailable. \(error.localizedDescription)" }
    }

    func showBoat(name: String) {
        wantedVesselName = name; mapSearch = ""; routeFilter = nil; tab = .map
        resolveWantedBoat()
    }
    func resolveWantedBoat() {
        if let name = wantedVesselName, let boat = boats?.boats.first(where: { $0.name == name || $0.number == name || $0.vesselId == name }) { selectedBoatID = boat.id }
    }

    func startRide(_ vessel: Vessel) {
        rideTask?.cancel(); rideGeneration += 1
        if rideSession?.vessel.id != vessel.id { ride = nil }
        rideSession = RideSession(vessel: vessel, startedAt: now, returnTab: tab)
        rideError = nil; showingRide = true
        rideTask = Task { [weak self] in
            guard let self, let session = self.rideSession else { return }
            await self.loadSavedRide(session)
            await self.refreshRide()
        }
    }

    private func loadSavedRide(_ session: RideSession) async {
        let id = session.vessel.id, generation = rideGeneration
        if let response = await repository.saved(Ride.self, endpoint: .init("api/ride", ["vesselId":id]), validate: { if $0.vessel.id != id { throw FerryError.wrongIdentity } }),
           generation == rideGeneration, rideSession?.vessel.id == id {
            ride = response.value; ride?.stale = true; ride?.positionStale = true
        }
    }

    func refreshRide() async {
        guard let id = rideSession?.vessel.id else { return }
        let generation = rideGeneration, lifecycle = lifecycleGeneration
        let requestKey = "ride-\(id)-\(generation)-\(lifecycle)"
        guard requests.insert(requestKey).inserted else { return }
        defer { requests.remove(requestKey) }
        do {
            let response = try await repository.fetch(Ride.self, endpoint: .init("api/ride", ["vesselId":id]), validate: {
                if $0.vessel.id != id { throw FerryError.wrongIdentity }
            })
            guard !Task.isCancelled, lifecycle == lifecycleGeneration, generation == rideGeneration, rideSession?.vessel.id == id else { return }
            ride = response.value; rideError = response.saved ? "Saved boat data" : nil
            if response.saved { ride?.stale = true; ride?.positionStale = true }
        } catch {
            guard !Task.isCancelled, generation == rideGeneration else { return }
            ride?.stale = true; ride?.positionStale = true
            rideError = "Reconnect to load this boat’s confirmed trips."
        }
    }

    func minimizeRide() { showingRide = false; tab = rideSession?.returnTab ?? .departures }
    func viewChanged() {
        tabTask?.cancel()
        guard active else { return }
        if !showingRide, rideSession != nil { rideSession?.returnTab = tab }
        tabTask = Task { [weak self] in await self?.refresh() }
    }
    func afterSheet(_ action: @escaping () -> Void) { pendingSheetAction = action; sheet = nil }
    func sheetDismissed() { let action = pendingSheetAction; pendingSheetAction = nil; action?() }
    func exitRide() {
        rideGeneration += 1; rideTask?.cancel()
        let destination = rideSession?.returnTab ?? .departures
        rideSession = nil; ride = nil; showingRide = false; rideError = nil; tab = destination
    }

    func stepDate(_ amount: Int) {
        let next = ServiceClock.addDays(currentDate, amount)
        guard let schedule, ScheduleEngine.range(schedule)?.contains(next) == true else { return }
        viewDate = next == frame?.today ? nil : next
    }
}
