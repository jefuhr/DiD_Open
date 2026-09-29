import XCTest
import FerryCore
@testable import FerryBoard

private actor DelayedTransport: FerryTransport {
    private var pending: [String: CheckedContinuation<Data, Error>] = [:]
    func data(for endpoint: FerryEndpoint) async throws -> Data {
        guard ["api/display-data", "api/ride"].contains(endpoint.path) else { throw URLError(.notConnectedToInternet) }
        return try await withCheckedThrowingContinuation { pending[endpoint.cacheKey] = $0 }
    }
    func has(_ key: String) -> Bool { pending[key] != nil }
    func reply(_ key: String, _ data: Data) { pending.removeValue(forKey: key)?.resume(returning: data) }
}

@MainActor
final class FerryStoreTests: XCTestCase {
    private var folder: URL!
    private var defaults: UserDefaults!
    private var suite: String!
    override func setUp() {
        suite = "FerryStoreTests-" + UUID().uuidString
        defaults = UserDefaults(suiteName: suite)!
        folder = FileManager.default.temporaryDirectory.appendingPathComponent(suite)
    }
    override func tearDown() {
        defaults.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: folder)
    }
    private func data(_ name: String) throws -> Data {
        try Data(contentsOf: XCTUnwrap(Bundle.main.url(forResource: name, withExtension: "json")))
    }
    private func waitForRequest(_ key: String, on transport: DelayedTransport) async throws {
        for _ in 0..<100 {
            if await transport.has(key) { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Request not started: " + key)
    }
    private func store(_ transport: DelayedTransport) -> FerryStore {
        FerryStore(repository: FerryRepository(transport: transport, cache: SnapshotCache(directory: folder)), defaults: defaults)
    }
    func testLateLandingResponseCannotReplaceNewSelection() async throws {
        let transport = DelayedTransport()
        let active = store(transport)
        active.selectLanding(16)
        try await waitForRequest("api/display-data&landingId=16", on: transport)
        active.selectLanding(26)
        try await waitForRequest("api/display-data&landingId=26", on: transport)
        await transport.reply("api/display-data&landingId=26", try data("schedule-26"))
        for _ in 0..<100 where active.schedule == nil { try await Task.sleep(for: .milliseconds(10)) }
        await transport.reply("api/display-data&landingId=16", try data("schedule-16"))
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(active.preferences.landingID, 26)
        XCTAssertEqual(active.schedule?.meta.landingNumber, 26)
    }
    func testExitInvalidatesOutstandingRideAndSurvivesRelaunch() async throws {
        let transport = DelayedTransport()
        let model = store(transport)
        model.startRide(Vessel(id: "opportunity", name: "Opportunity"))
        try await waitForRequest("api/ride&vesselId=opportunity", on: transport)
        model.exitRide()
        await transport.reply("api/ride&vesselId=opportunity", try data("ride-opportunity"))
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertNil(model.rideSession)
        XCTAssertNil(model.ride)
        XCTAssertFalse(model.showingRide)
        XCTAssertNil(store(DelayedTransport()).rideSession)
    }
    func testPreferencesPersistWithoutBrowserStorage() {
        let model = store(DelayedTransport())
        model.preferences.favorites.insert(26)
        model.preferences.hiddenOperators.insert("NY Waterway")
        model.preferences.twelveHour = true
        model.preferences.theme = "hello-kitty"
        let restored = store(DelayedTransport())
        XCTAssertTrue(restored.preferences.favorites.contains(26))
        XCTAssertTrue(restored.preferences.hiddenOperators.contains("NY Waterway"))
        XCTAssertTrue(restored.preferences.twelveHour)
        XCTAssertEqual(restored.theme.id, "hello-kitty")
    }
    func testSwitchingBoatsRejectsLatePreviousVessel() async throws {
        let transport = DelayedTransport()
        let model = store(transport)
        model.startRide(Vessel(id: "opportunity", name: "Opportunity"))
        try await waitForRequest("api/ride&vesselId=opportunity", on: transport)
        model.startRide(Vessel(id: "bay-hopper", name: "Bay Hopper"))
        try await waitForRequest("api/ride&vesselId=bay-hopper", on: transport)
        await transport.reply("api/ride&vesselId=bay-hopper", try data("ride-bay-hopper"))
        for _ in 0..<100 where model.ride == nil { try await Task.sleep(for: .milliseconds(10)) }
        await transport.reply("api/ride&vesselId=opportunity", try data("ride-opportunity"))
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertEqual(model.ride?.vessel.id, "bay-hopper")
        XCTAssertEqual(model.rideSession?.vessel.id, "bay-hopper")
        model.minimizeRide()
        XCTAssertFalse(model.showingRide)
        XCTAssertEqual(store(DelayedTransport()).rideSession?.vessel.id, "bay-hopper")
    }
    func testSavedRideAppearsBeforeStartupNetworkCompletes() async throws {
        var preferences = Preferences()
        preferences.landingID = 16
        defaults.set(try JSONEncoder().encode(preferences), forKey: "preferences")
        let session = RideSession(vessel: Vessel(id: "opportunity", name: "Opportunity"), startedAt: Date(), returnTab: .map)
        defaults.set(try JSONEncoder().encode(session), forKey: "ride-session")
        let cache = SnapshotCache(directory: folder)
        try await cache.write(try data("ride-opportunity"), key: "productionapi/ride&vesselId=opportunity", at: Date())
        let transport = DelayedTransport()
        let model = store(transport)
        model.setActive(true)
        try await waitForRequest("api/display-data&landingId=16", on: transport)
        XCTAssertTrue(model.showingRide)
        XCTAssertEqual(model.ride?.vessel.id, "opportunity")
        XCTAssertEqual(model.ride?.stale, true)
        model.setActive(false)
        await transport.reply("api/display-data&landingId=16", try data("schedule-16"))
    }
}
