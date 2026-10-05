import XCTest
import FerryCore
import WidgetKit
@testable import FerryBoard

@MainActor
final class WidgetSettingsTests: XCTestCase {
    func testCopyUsesMainBoardSettingsAndPreservesWidgetOnlyVisibilityChoices() throws {
        let suite = "WidgetSettings-" + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let repository = FerryRepository(transport: OfflineWidgetTransport(), cache: SnapshotCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent(suite)))
        let store = FerryStore(repository: repository, defaults: defaults)
        store.preferences.landingID = 26
        store.preferences.hiddenOperators = ["NY Waterway"]
        store.preferences.hiddenRoutes = ["ER"]
        store.preferences.hiddenNYCMovements = [.crewShuttle]
        store.preferences.twelveHour = true
        store.preferences.theme = "night"
        store.preferences.textSize = .larger
        store.preferences.sortByRoute = true
        store.preferences.showDwellTimes = false
        store.preferences.showLayoverTimes = false
        store.preferences.departureWindowMinutes = 60
        store.preferences.departuresPerRoute = 2
        store.widgetOptions.showBoatNames = false
        store.widgetOptions.showAssignments = false
        store.copyMainSettingsToWidget()
        XCTAssertFalse(store.widgetOptions.automaticLanding)
        XCTAssertEqual(store.widgetOptions.landingID, 26)
        XCTAssertEqual(store.widgetOptions.hiddenOperators, ["NY Waterway"])
        XCTAssertEqual(store.widgetOptions.hiddenRoutes, ["ER"])
        XCTAssertEqual(store.widgetOptions.hiddenNYCMovements, [.crewShuttle])
        XCTAssertTrue(store.widgetOptions.twelveHour)
        XCTAssertTrue(store.widgetOptions.sortByRoute)
        XCTAssertFalse(store.widgetOptions.showDwells)
        XCTAssertFalse(store.widgetOptions.showLayovers)
        XCTAssertFalse(store.widgetOptions.showBoatNames)
        XCTAssertFalse(store.widgetOptions.showAssignments)
        XCTAssertEqual(store.widgetOptions.theme, "night")
        XCTAssertEqual(store.widgetOptions.textSize, "larger")
        XCTAssertEqual(store.widgetOptions.departureWindowMinutes, 60)
        XCTAssertEqual(store.widgetOptions.departuresPerRoute, 2)
        let restored = FerryStore(repository: repository, defaults: defaults)
        XCTAssertEqual(restored.widgetOptions, store.widgetOptions)
        XCTAssertEqual(restored.preferences.hiddenOperators, ["NY Waterway"])
    }

    func testFixedLandingTimelineNeverRequestsLocationAndCustomSettingsIgnoreDefaults() async throws {
        struct Fixture: Decodable { let schedule: DisplayData }
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<3 { root.deleteLastPathComponent() }
        let data = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: root.appendingPathComponent("test/fixtures/schedule-contract.json"))).schedule
        let repository = FerryRepository(transport: WidgetFixtureTransport(schedule: try JSONEncoder().encode(data)), cache: SnapshotCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)))
        let now = try XCTUnwrap(ServiceClock.instant("2026-09-04T12:50:00Z"))
        let counter = LocationRequests()
        var defaults = WidgetOptions(); defaults.automaticLanding = false; defaults.landingID = 16; defaults.twelveHour = true; defaults.hiddenOperators = ["NYC Ferry"]
        let record = WidgetSettingsRecord(options: defaults, roster: nil, favorites: [])
        let provider = NearbyProvider(repository: repository, readSettings: { record }, clock: { now }, requestLocation: { counter.count += 1; return .notAuthorized })
        let custom = FerryWidgetConfiguration()
        custom.useAppDefaults = false; custom.automaticLanding = false
        custom.landing = WidgetLanding(id: 16, name: "Pier 11")
        custom.showBoatNames = false; custom.showAssignments = false
        let entries = await provider.entries(configuration: custom)
        let snapshot = try XCTUnwrap(entries.first)
        XCTAssertEqual(snapshot.landingID, 16)
        XCTAssertEqual(snapshot.locationLabel, "Fixed landing")
        XCTAssertEqual(snapshot.rows.first?.time, "09:00")
        XCTAssertFalse(snapshot.options.showAssignments)
        XCTAssertFalse(snapshot.rows.isEmpty)
        XCTAssertEqual(counter.count, 0)
        let appDefaults = FerryWidgetConfiguration()
        let filteredEntries = await provider.entries(configuration: appDefaults)
        let filtered = try XCTUnwrap(filteredEntries.first)
        XCTAssertTrue(filtered.rows.isEmpty)
        XCTAssertTrue(filtered.message?.contains("filters") == true)
        XCTAssertEqual(counter.count, 0)
    }

    func testMissingSharedSettingsShowsRecoveryInsteadOfIgnoringUserChoices() {
        let configuration = FerryWidgetConfiguration()
        XCTAssertNil(configuration.options(shared: nil))
        configuration.useAppDefaults = false
        configuration.automaticLanding = false
        configuration.landing = WidgetLanding(id: 26, name: "Pier 79")
        configuration.hiddenOperators = [WidgetOperator(id: "NY Waterway")]
        let options = configuration.options(shared: nil)
        XCTAssertEqual(options?.landingID, 26)
        XCTAssertEqual(options?.hiddenOperators, ["NY Waterway"])
    }
}

@MainActor private final class LocationRequests { var count = 0 }
private struct OfflineWidgetTransport: FerryTransport {
    func data(for endpoint: FerryEndpoint) async throws -> Data { throw URLError(.notConnectedToInternet) }
}
private struct WidgetFixtureTransport: FerryTransport {
    let schedule: Data
    func data(for endpoint: FerryEndpoint) async throws -> Data {
        if endpoint.path == "api/display-data" { return schedule }
        if endpoint.path == "api/realtime" { return Data(#"{"stale":true,"available":false,"updates":[],"vehicles":[]}"#.utf8) }
        throw URLError(.notConnectedToInternet)
    }
}
