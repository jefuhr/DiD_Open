import XCTest
@testable import FerryCore

/// An opt-in smoke check of the real deployment; regular tests remain deterministic.
final class LiveContractTests: XCTestCase {
    func testProductionResponsesDecode() async throws {
        guard ProcessInfo.processInfo.environment["FERRY_LIVE_SMOKE"] == "1" else {
            throw XCTSkip("Set FERRY_LIVE_SMOKE=1 to check the deployed API.")
        }
        let transport = HTTPTransport()
        func fetch<T: Decodable>(_ type: T.Type, _ path: String, _ query: [String: String] = [:]) async throws -> T {
            let raw = try await transport.data(for: FerryEndpoint(path, query))
            return try JSONDecoder().decode(type, from: raw)
        }
        let roster = try await fetch(LandingRoster.self, "api/landings")
        XCTAssertFalse(roster.landings.isEmpty)
        let landing = roster.configured
        let schedule = try await fetch(DisplayData.self, "api/display-data", ["landingId":String(landing)])
        try schedule.validate(landingID: landing)
        _ = try await fetch(Realtime.self, "api/realtime", ["landingId":String(landing)])
        _ = try await fetch(Alerts.self, "api/alerts")
        let map = try await fetch(Harbor.self, "api/map")
        XCTAssertFalse(map.landings.isEmpty)
        _ = try await fetch(Boats.self, "api/boats")
        _ = try await fetch(Changelog.self, "api/changelog")
        let vessels = try await fetch(Vessels.self, "api/vessels")
        let vessel = try XCTUnwrap(vessels.vessels.first)
        let ride = try await fetch(Ride.self, "api/ride", ["vesselId":vessel.id])
        XCTAssertEqual(ride.vessel.id, vessel.id)
        let candidate = schedule.departures.first { !$0.routeId.contains(":") && $0.scheduleOnly != true }
        let tripID = try XCTUnwrap(candidate?.liveTripId ?? candidate?.tripId)
        let connections = try await fetch(Connections.self, "api/connections", ["tripId":tripID])
        XCTAssertEqual(connections.tripId, tripID)
    }
}
