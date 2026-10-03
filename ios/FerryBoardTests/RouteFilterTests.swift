import XCTest
import FerryCore
@testable import FerryBoard

@MainActor
final class RouteFilterTests: XCTestCase {
    private func store() throws -> FerryStore {
        let suite = "RouteFilters-" + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        let model = FerryStore(repository: FerryRepository(transport: OfflineRouteTransport(), cache: SnapshotCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent(suite))), defaults: defaults,
                               fixedNow: try XCTUnwrap(ServiceClock.instant("2026-09-04T12:50:00Z")))
        struct Fixture: Decodable { var schedule: DisplayData }
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<3 { root.deleteLastPathComponent() }
        model.schedule = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: root.appendingPathComponent("test/fixtures/schedule-contract.json"))).schedule
        return model
    }

    func testHiddenMovementDoesNotConsumeTheRouteLimitOrExtendTheWindow() throws {
        let model = try store()
        var schedule = try XCTUnwrap(model.schedule)
        schedule.departures = schedule.departures.filter { ["nine", "ten"].contains($0.tripId) }
        schedule.departures[0].outOfService = true
        schedule.meta.departuresShown = 1
        schedule.meta.departureWindowMinutes = 90
        model.schedule = schedule
        model.preferences.hiddenNYCMovements = [.outOfService]
        XCTAssertEqual(model.rows.map { $0.departure.tripId }, ["ten"])
        XCTAssertEqual(model.groups.flatMap(\.departures).map { $0.departure.tripId }, ["ten"])
        model.preferences.departureWindowMinutes = 30
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertTrue(model.groups.isEmpty)
    }

    func testRouteFiltersApplyToBothSortsAndTripConnections() throws {
        let model = try store()
        XCTAssertFalse(model.rows.isEmpty)
        model.preferences.hiddenRoutes = ["ER"]
        XCTAssertTrue(model.rows.isEmpty)
        XCTAssertTrue(model.groups.isEmpty)
        let connection = try JSONDecoder().decode(Connection.self, from: Data(#"{"tripId":"connecting","routeId":"ER","departureTime":"10:00:00","seconds":36000,"destination":"Pier 11","operator":"NYC Ferry"}"#.utf8))
        XCTAssertFalse(model.visible(connection))
        model.preferences.resetDepartureFilters()
        XCTAssertTrue(model.visible(connection))
        XCTAssertFalse(model.rows.isEmpty)
    }

    func testSavedRouteAndMovementChoicesSurviveRelaunch() throws {
        let suite = "SavedRouteFilters-" + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let repository = FerryRepository(transport: OfflineRouteTransport(), cache: SnapshotCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent(suite)))
        let model = FerryStore(repository: repository, defaults: defaults)
        model.preferences.hiddenRoutes = ["ER", "wtr:10225"]
        model.preferences.hiddenNYCMovements = [.pierC, .crewShuttle]
        let restored = FerryStore(repository: repository, defaults: defaults)
        XCTAssertEqual(restored.preferences.hiddenRoutes, ["ER", "wtr:10225"])
        XCTAssertEqual(restored.preferences.hiddenNYCMovements, [.pierC, .crewShuttle])
    }

    func testOperatorRoutesIncludeOtherDocksWithoutDuplicatingCrewShuttles() throws {
        let model = try store()
        model.roster = try JSONDecoder().decode(LandingRoster.self, from: Data(#"{"configured":16,"landings":[],"operators":["NYC Ferry","Seastreak"],"routes":{"sea:1":{"name":"Highlands","operator":"Seastreak"},"CREW":{"name":"Crew shuttle","operator":"NYC Ferry"}}}"#.utf8))
        XCTAssertEqual(model.filterRoutes(for: "Seastreak").map(\.id), ["sea:1"])
        XCTAssertEqual(model.filterRoutes(for: "NYC Ferry").map(\.id), ["ER"])
        // Existing servers omit the catalog; the current landing still supplies routes.
        model.roster = try JSONDecoder().decode(LandingRoster.self, from: Data(#"{"configured":16,"landings":[],"operators":["NYC Ferry"]}"#.utf8))
        XCTAssertEqual(model.filterRoutes(for: "NYC Ferry").map(\.id), ["ER"])
    }
}

private struct OfflineRouteTransport: FerryTransport {
    func data(for endpoint: FerryEndpoint) async throws -> Data { throw URLError(.notConnectedToInternet) }
}
