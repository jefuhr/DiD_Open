import XCTest
@testable import FerryCore

private actor StubTransport: FerryTransport {
    var responses: [Result<Data, Error>]
    init(_ responses: [Result<Data, Error>]) { self.responses = responses }
    func data(for endpoint: FerryEndpoint) async throws -> Data {
        guard !responses.isEmpty else { throw URLError(.notConnectedToInternet) }
        return try responses.removeFirst().get()
    }
}

final class RepositoryTests: XCTestCase {
    struct Payload: Codable, Sendable { var landingID: Int; var text: String }
    private var directory: URL!
    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: directory) }

    func testOfflineRelaunchAndIdentityMismatchRetainOriginalSnapshot() async throws {
        let original = Data(#"{"landingID":16,"text":"Pier 11","futureField":true}"#.utf8)
        let wrong = Data(#"{"landingID":26,"text":"Pier 79"}"#.utf8)
        let cache = SnapshotCache(directory: directory)
        let transport = StubTransport([.success(original), .success(wrong), .success(Data("broken".utf8))])
        let repository = FerryRepository(transport: transport, cache: cache)
        let endpoint = FerryEndpoint("api/display-data", ["landingId":"16"])
        let validate: @Sendable (Payload) throws -> Void = { if $0.landingID != 16 { throw FerryError.wrongIdentity } }
        let initial = try await repository.fetch(Payload.self, endpoint: endpoint, validate: validate)
        XCTAssertFalse(initial.saved)
        for _ in 0..<2 {
            let fallback = try await repository.fetch(Payload.self, endpoint: endpoint, validate: validate)
            XCTAssertTrue(fallback.saved)
            XCTAssertEqual(fallback.value.text, "Pier 11")
        }
        let relaunched = FerryRepository(transport: StubTransport([]), cache: SnapshotCache(directory: directory))
        let saved = try await relaunched.fetch(Payload.self, endpoint: endpoint)
        XCTAssertTrue(saved.saved)
        let raw = await cache.read("production" + endpoint.cacheKey)
        XCTAssertEqual(raw?.0, original, "Keep additive fields in the disk snapshot")
        let other = await relaunched.saved(Payload.self, endpoint: FerryEndpoint("api/display-data", ["landingId":"26"]))
        XCTAssertNil(other)
    }

    func testCorruptCacheAndOfflineFirstLaunchAreRecoverable() async throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let cache = SnapshotCache(directory: directory)
        try await cache.write(Data("corrupt".utf8), key: "productionapi/landings", at: Date())
        let repository = FerryRepository(transport: StubTransport([]), cache: cache)
        let saved = await repository.saved(Payload.self, endpoint: FerryEndpoint("api/landings"))
        XCTAssertNil(saved)
        do {
            _ = try await repository.fetch(Payload.self, endpoint: FerryEndpoint("api/landings"))
            XCTFail("An empty cache cannot produce a usable board")
        } catch { XCTAssertTrue(error is URLError) }
    }

    func testConnectionsExpireAndCannotCrossServiceDays() throws {
        let value = try JSONDecoder().decode(Connections.self, from: Data(#"{"tripId":"nyu:1","generatedAt":"2026-09-28T12:00:00Z","serviceDate":"2026-09-28","stale":false,"stops":[]}"#.utf8))
        XCTAssertTrue(value.usable(tripID: "nyu:1", serviceDate: "2026-09-28", now: ServiceClock.instant("2026-09-28T12:04:00Z")!))
        XCTAssertFalse(value.usable(tripID: "nyu:1", serviceDate: "2026-09-28", now: ServiceClock.instant("2026-09-28T12:06:00Z")!))
        XCTAssertFalse(value.usable(tripID: "nyu:1", serviceDate: "2026-09-29", now: ServiceClock.instant("2026-09-28T12:04:00Z")!))
    }
}
