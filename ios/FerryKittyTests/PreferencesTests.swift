import XCTest
import SwiftUI
import FerryCore
@testable import FerryKitty

final class PreferencesTests: XCTestCase {
    func testUpgradeKeepsExistingChoicesAndDefaultsNewSettings() throws {
        let legacy = Data(#"{"landingID":26,"favorites":[16,26],"hiddenOperators":["NY Waterway"],"sortByRoute":true,"twelveHour":true,"theme":"night"}"#.utf8)
        let preferences = try JSONDecoder().decode(Preferences.self, from: legacy)
        XCTAssertEqual(preferences.landingID, 26)
        XCTAssertEqual(preferences.favorites, [16, 26])
        XCTAssertEqual(preferences.hiddenOperators, ["NY Waterway"])
        XCTAssertTrue(preferences.hiddenRoutes.isEmpty)
        XCTAssertTrue(preferences.hiddenNYCMovements.isEmpty)
        XCTAssertTrue(preferences.sortByRoute)
        XCTAssertTrue(preferences.twelveHour)
        XCTAssertEqual(preferences.theme, "night")
        XCTAssertEqual(preferences.textSize, .system)
        XCTAssertEqual(preferences.launchLanding, .lastUsed)
        XCTAssertTrue(preferences.showDwellTimes)
        XCTAssertTrue(preferences.showLayoverTimes)
        XCTAssertEqual(preferences.departuresPerRoute, 0)
        XCTAssertEqual(preferences.departureWindowMinutes, 0)
        XCTAssertFalse(preferences.keepScreenAwake)
        XCTAssertEqual(preferences.apiServer, .production)
        XCTAssertEqual(preferences.customAPIURL, "")
    }

    func testAPIServerFallsBackToProductionUntilOtherHasAUsableAddress() throws {
        let production = URL(string: "https://juliet.nyc")!
        var preferences = Preferences()
        preferences.apiServer = .ferryRT
        XCTAssertEqual(preferences.apiBaseURL(production: production), production)
        preferences.apiServer = .custom
        for bad in ["", "juliet.nyc", "ftp://example.com", "https://"] {
            preferences.customAPIURL = bad
            XCTAssertEqual(preferences.apiBaseURL(production: production), production, bad)
        }
        preferences.customAPIURL = "  http://192.168.1.20:8090 "
        XCTAssertEqual(preferences.apiBaseURL(production: production).absoluteString, "http://192.168.1.20:8090")
        let unknown = try JSONDecoder().decode(Preferences.self, from: Data(#"{"apiServer":"future-server","customAPIURL":"https://x.example"}"#.utf8))
        XCTAssertEqual(unknown.apiServer, .production)
        XCTAssertEqual(unknown.customAPIURL, "https://x.example")
    }

    @MainActor func testChangingServerRebuildsTheRepositoryAndReadsSlipsFromFerryRT() async throws {
        let suite = "PreferencesTests-" + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let cache = SnapshotCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent(suite))
        let production = URL(string: "https://juliet.nyc")!
        var built: [URL] = []
        let make = { (url: URL) -> FerryRepository in
            built.append(url)
            return FerryRepository(transport: RealtimeOnlyTransport(), cache: cache, namespace: url.absoluteString)
        }
        // The captured Ferry RT feed in test/fixtures, which puts trip 1500 at Slip 2 of stop 20.
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<3 { root.deleteLastPathComponent() }
        let capture = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("test/fixtures/ferry-rt-slips.json"))) as! [String: Any]
        let feed = try XCTUnwrap(Data(base64Encoded: capture["feed"] as! String))
        let catalog = try JSONSerialization.data(withJSONObject: capture["slips"]!)
        let reachable = LockedFlag(true)
        let client = FerryRT.Client { path in
            guard reachable.value else { throw URLError(.cannotFindHost) }
            return path == "api/slips" ? catalog : feed
        }
        let store = FerryStore(repository: make(production), defaults: defaults, productionURL: production, makeRepository: make, ferryRT: client)
        store.preferences.apiServer = .custom
        store.preferences.customAPIURL = "http://localhost:8090"
        XCTAssertEqual(store.apiBaseURL.absoluteString, "http://localhost:8090")
        store.preferences.apiServer = .ferryRT
        XCTAssertEqual(store.apiBaseURL, production)
        XCTAssertEqual(built.map(\.absoluteString), ["https://juliet.nyc", "http://localhost:8090", "https://juliet.nyc"])

        let source = try Data(contentsOf: XCTUnwrap(Bundle.main.url(forResource: "schedule-16", withExtension: "json")))
        store.preferences.landingID = 16
        store.schedule = try JSONDecoder().decode(DisplayData.self, from: source)
        await store.refreshRealtime()
        XCTAssertEqual(store.realtime.updates?.map(\.slip?.name), ["Slip 2", nil])
        XCTAssertNil(store.ferryRTStatus)

        // Off the internal network: no stale slip stays up, and Settings says why.
        reachable.value = false
        await store.refreshRealtime()
        XCTAssertEqual(store.realtime.updates?.map(\.slip?.name), [nil, nil])
        XCTAssertNotNil(store.ferryRTStatus)

        // Prod never asks Ferry RT.
        reachable.value = true
        store.preferences.apiServer = .production
        await store.refreshRealtime()
        XCTAssertEqual(store.realtime.updates?.map(\.slip?.name), [nil, nil])
        XCTAssertNil(store.ferryRTStatus)
    }

    func testInvalidNewValuesDoNotDiscardOldPreferences() throws {
        let data = Data(#"{"landingID":16,"theme":"night","textSize":"future-option","launchTab":"future-option","departuresPerRoute":999,"departureWindowMinutes":-60}"#.utf8)
        let preferences = try JSONDecoder().decode(Preferences.self, from: data)
        XCTAssertEqual(preferences.landingID, 16)
        XCTAssertEqual(preferences.theme, "night")
        XCTAssertEqual(preferences.textSize, .system)
        XCTAssertEqual(preferences.launchTab, .departures)
        XCTAssertEqual(preferences.departuresPerRoute, 0)
        XCTAssertEqual(preferences.departureWindowMinutes, 0)
    }

    func testTextPreferencesPreserveEveryAccessibilitySize() {
        let accessible: [DynamicTypeSize] = [.accessibility1, .accessibility2, .accessibility3, .accessibility4, .accessibility5]
        for preference in FerryTextSize.allCases {
            for size in accessible { XCTAssertEqual(preference.resolved(size), size) }
        }
        XCTAssertEqual(FerryTextSize.system.resolved(.xLarge), .xLarge)
        XCTAssertEqual(FerryTextSize.compact.resolved(.large), .medium)
        XCTAssertEqual(FerryTextSize.larger.resolved(.large), .xxLarge)
        XCTAssertEqual(FerryTextSize.larger.resolved(.xxxLarge), .xxxLarge)
    }

    func testRouteAndMovementFiltersRoundTripAndIgnoreUnknownFutureMovements() throws {
        let data = Data(#"{"hiddenRoutes":["ER","wtr:10225"],"hiddenNYCMovements":["pierC","crewShuttle","future-movement"],"favorites":[26]}"#.utf8)
        let preferences = try JSONDecoder().decode(Preferences.self, from: data)
        XCTAssertEqual(preferences.hiddenRoutes, ["ER", "wtr:10225"])
        XCTAssertEqual(preferences.hiddenNYCMovements, [.pierC, .crewShuttle])
        var restored = try JSONDecoder().decode(Preferences.self, from: JSONEncoder().encode(preferences))
        XCTAssertEqual(restored.hiddenRoutes, preferences.hiddenRoutes)
        XCTAssertEqual(restored.hiddenNYCMovements, preferences.hiddenNYCMovements)
        restored.resetDepartureFilters()
        XCTAssertFalse(restored.departureFilters.isActive)
        XCTAssertEqual(restored.favorites, [26])
    }

    @MainActor func testLaunchChoicesAndDisplayOptionsPersistWithoutChangingSourceSchedule() throws {
        let suite = "PreferencesTests-" + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let cache = SnapshotCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent(suite))
        let repository = FerryRepository(transport: OfflinePreferencesTransport(), cache: cache)
        let store = FerryStore(repository: repository, defaults: defaults)
        store.preferences.landingID = 16
        store.preferences.homeLandingID = 26
        store.preferences.launchLanding = .home
        store.preferences.launchTab = .lastUsed
        store.preferences.departuresPerRoute = 5
        store.preferences.departureWindowMinutes = 30
        store.preferences.showDwellTimes = false
        store.preferences.showLayoverTimes = false
        store.preferences.showMarineReferences = false
        store.preferences.keepScreenAwake = true
        store.tab = .map
        let restored = FerryStore(repository: repository, defaults: defaults)
        XCTAssertEqual(restored.preferences.landingID, 26)
        XCTAssertEqual(restored.tab, .map)
        XCTAssertFalse(restored.preferences.showMarineReferences)
        XCTAssertTrue(restored.preferences.keepScreenAwake)
        let source = try Data(contentsOf: XCTUnwrap(Bundle.main.url(forResource: "schedule-16", withExtension: "json")))
        restored.schedule = try JSONDecoder().decode(DisplayData.self, from: source)
        let original = try XCTUnwrap(restored.schedule)
        let display = try XCTUnwrap(restored.displaySchedule)
        XCTAssertEqual(display.meta.departuresShown, 5)
        XCTAssertEqual(display.meta.departureWindowMinutes, 30)
        XCTAssertEqual(display.meta.showDwellTimes, false)
        XCTAssertEqual(display.meta.showLayoverTimes, false)
        XCTAssertEqual(restored.schedule?.meta.departuresShown, original.meta.departuresShown)
        XCTAssertEqual(restored.schedule?.meta.departureWindowMinutes, original.meta.departureWindowMinutes)
        XCTAssertEqual(restored.schedule?.meta.showDwellTimes, original.meta.showDwellTimes)
        XCTAssertEqual(restored.schedule?.meta.showLayoverTimes, original.meta.showLayoverTimes)
    }
}

private struct OfflinePreferencesTransport: FerryTransport {
    func data(for endpoint: FerryEndpoint) async throws -> Data { throw URLError(.notConnectedToInternet) }
}

private struct RealtimeOnlyTransport: FerryTransport {
    func data(for endpoint: FerryEndpoint) async throws -> Data {
        guard endpoint.path == "api/realtime" else { throw URLError(.notConnectedToInternet) }
        return Data(#"{"stale":false,"updates":[{"tripId":"1500","stopId":"20","delaySeconds":0},{"tripId":"1500","stopId":"87","delaySeconds":0}]}"#.utf8)
    }
}

private final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Bool
    init(_ value: Bool) { stored = value }
    var value: Bool {
        get { lock.withLock { stored } }
        set { lock.withLock { stored = newValue } }
    }
}
