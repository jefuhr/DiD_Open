import SwiftUI
import WidgetKit
import FerryCore
import AppIntents

enum WidgetRepository {
    static let repository: FerryRepository = {
        let baseURL = URL(string: Bundle.main.object(forInfoDictionaryKey: "FerryAPIBaseURL") as? String ?? "https://juliet.nyc")!
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NearbyFerries", isDirectory: true)
        let session = URLSession(configuration: {
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = 8
            config.timeoutIntervalForResource = 10
            return config
        }())
        return FerryRepository(transport: HTTPTransport(baseURL: baseURL, session: session),
            cache: SnapshotCache(directory: root), namespace: baseURL.absoluteString)
    }()
}

private struct LastLanding: Codable {
    let id: Int
    let name: String
    let at: Date
    static func read() -> Self? {
        UserDefaults.standard.data(forKey: "widget-last-landing").flatMap { try? JSONDecoder().decode(Self.self, from: $0) }
    }
    func save() {
        if let data = try? JSONEncoder().encode(self) { UserDefaults.standard.set(data, forKey: "widget-last-landing") }
    }
}

struct NearbyProvider: AppIntentTimelineProvider {
    typealias Intent = FerryWidgetConfiguration
    var repository = WidgetRepository.repository
    var readSettings: @Sendable () -> WidgetSettingsRecord? = { WidgetSettingsBridge.read() }
    var clock: @Sendable () -> Date = { Date() }
    var requestLocation: @MainActor @Sendable () async -> WidgetLocation.Result = {
        let locator = WidgetLocation()
        return await locator.request()
    }
    func placeholder(in context: Context) -> NearbyEntry {
        NearbyEntry(date: clock(), landingName: "Nearest landing", message: "Upcoming ferries, boats and dwell times.")
    }

    func snapshot(for configuration: Intent, in context: Context) async -> NearbyEntry {
        if context.isPreview { return placeholder(in: context) }
        return await entries(configuration: configuration).first ?? placeholder(in: context)
    }

    func timeline(for configuration: Intent, in context: Context) async -> Timeline<NearbyEntry> {
        let values = await entries(configuration: configuration)
        // WidgetKit owns the actual reload time; entries advance the schedule meanwhile.
        return Timeline(entries: values, policy: .after(clock().addingTimeInterval(15 * 60)))
    }

    func entries(configuration: Intent) async -> [NearbyEntry] {
        let now = clock()
        guard let options = configuration.options(shared: readSettings()) else {
            return [NearbyEntry(date: now, message: "Open Ferry Board once to share widget defaults, or choose custom settings in Edit Widget.")]
        }
        var selection: LastLanding?
        var currentFix = false
        if !options.automaticLanding {
            guard let id = options.landingID else {
                return [NearbyEntry(date: now, message: "Choose a fixed landing in Ferry Board widget defaults or Edit Widget.")]
            }
            // No GPS request or location authorization is needed in fixed mode.
            selection = LastLanding(id: id, name: options.landingName ?? "Landing \(id)", at: now)
        } else {
            async let rosterResponse = try? repository.fetch(LandingRoster.self, endpoint: .init("api/landings"))
            async let location = requestLocation()
            let (roster, result) = await (rosterResponse?.value, location)
            switch result {
        case .notAuthorized:
            // Do not keep using a saved location after permission is withdrawn.
            UserDefaults.standard.removeObject(forKey: "widget-last-landing")
            return [NearbyEntry(date: now, message: "Tap to enable location in Ferry Board, then allow location for this widget.")]
        case .fix(let fix):
            if let landing = NearbyWidgetBoard.nearest(in: roster?.landings ?? [], latitude: fix.coordinate.latitude, longitude: fix.coordinate.longitude) {
                selection = LastLanding(id: landing.id, name: landing.displayName, at: fix.timestamp)
                currentFix = true
                selection?.save()
            }
        case .unavailable: break
            }
        }
        if selection == nil, let saved = LastLanding.read(),
           NearbyWidgetBoard.usableLocation(at: saved.at, now: now) {
            selection = saved
        }
        guard let landing = selection else {
            return [NearbyEntry(date: now, message: "Location is unavailable. Open Ferry Board to enable location or try again when this widget is visible.")]
        }
        async let scheduleResponse = try? repository.fetch(DisplayData.self,
            endpoint: .init("api/display-data", ["landingId": String(landing.id)]), validate: { try $0.validate(landingID: landing.id) })
        async let realtimeResponse = try? repository.fetch(Realtime.self,
            endpoint: .init("api/realtime", ["landingId": String(landing.id)]))
        let (schedule, realtime) = await (scheduleResponse, realtimeResponse)
        let created = clock()
        // Two hours of lightweight entries keep scheduled rows advancing if iOS
        // delays our reload. Live timing and vessel names expire after five minutes.
        var entries = (0...120).map { minute in
            let date = created.addingTimeInterval(Double(minute) * 60)
            guard !options.automaticLanding || NearbyWidgetBoard.usableLocation(at: landing.at, now: date) else {
                return NearbyEntry(date: date, message: "Location is unavailable. Tap to open Ferry Board.")
            }
            let label = !options.automaticLanding ? "Fixed landing" : currentFix && date.timeIntervalSince(landing.at) <= 15 * 60 ? "Nearest landing" : "Last location · waiting for GPS"
            var entry = NearbyEntry(date: date, landingID: landing.id, landingName: schedule?.value.meta.landing.displayName ?? landing.name, locationLabel: label,
                updatedAt: schedule?.receivedAt, saved: schedule?.saved ?? false, options: options)
            if let data = schedule?.value {
                let feed = realtime?.saved == false ? realtime?.value ?? .empty : .empty
                entry.rows = NearbyWidgetBoard.departures(data: data, realtime: feed, receivedAt: realtime?.receivedAt, now: date, options: options)
                if entry.rows.isEmpty { entry.message = options.filters.isActive ? "No departures match your widget filters in this window." : "No upcoming ferries in the schedule window." }
            } else { entry.message = "Schedule unavailable. Tap to open the board." }
            return entry
        }
        // Never leave expired departures looking current if a reload is deferred
        // longer than the schedule timeline we generated.
        entries.append(NearbyEntry(date: created.addingTimeInterval(121 * 60), landingID: landing.id,
            landingName: landing.name, locationLabel: options.automaticLanding ? "Location needs refresh" : "Fixed landing", updatedAt: schedule?.receivedAt,
            message: "Data needs a refresh. Tap to open Ferry Board.", saved: true, options: options))
        return entries
    }

}
