import XCTest
@testable import FerryCore

final class FerryRTTests: XCTestCase {
    private struct Fixture: Decodable {
        var feed: String
        var slips: AnyJSON
        var expected: [String: String]
    }
    /// Re-encodes the catalog the way the endpoint serves it.
    private struct AnyJSON: Decodable {
        var data: Data
        init(from decoder: Decoder) throws {
            data = try JSONSerialization.data(withJSONObject: try decoder.singleValueContainer().decode(JSONValue.self).object)
        }
    }
    private enum JSONValue: Decodable {
        case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if c.decodeNil() { self = .null }
            else if let v = try? c.decode(Bool.self) { self = .bool(v) }
            else if let v = try? c.decode(Double.self) { self = .number(v) }
            else if let v = try? c.decode(String.self) { self = .string(v) }
            else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
            else { self = .object(try c.decode([String: JSONValue].self)) }
        }
        var object: Any {
            switch self {
            case .object(let v): v.mapValues(\.object)
            case .array(let v): v.map(\.object)
            case .string(let v): v
            case .number(let v): v
            case .bool(let v): v
            case .null: NSNull()
            }
        }
    }

    private func fixture() throws -> Fixture {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: root.appendingPathComponent("test/fixtures/ferry-rt-slips.json")))
    }

    func testCapturedFeedMatchesTheReferenceDecoder() throws {
        let f = try fixture()
        let catalog = try FerryRT.SlipCatalog(json: f.slips.data)
        XCTAssertNil(catalog.landings["87"], "A landing's own stop is not a slip")
        let slips = try FerryRT.slips(tripUpdates: XCTUnwrap(Data(base64Encoded: f.feed)), catalog: catalog)
        XCTAssertEqual(slips.mapValues(\.name), f.expected)
    }

    func testSlipsLandOnlyOnTheMatchingUpdateAndCanBeCleared() throws {
        let realtime = try JSONDecoder().decode(Realtime.self, from: Data(#"{"stale":false,"updates":[{"tripId":"759","stopId":"138","delaySeconds":0},{"tripId":"759","stopId":"87","delaySeconds":0}]}"#.utf8))
        let slipped = realtime.withSlips(["759|138": Slip(id: "NYCF_138_SLIP_2", name: "Slip 2")])
        XCTAssertEqual(slipped.updates?.map(\.slip?.name), ["Slip 2", nil])
        XCTAssertEqual(slipped.withSlips([:]).updates?.map(\.slip?.name), [nil, nil])
    }

    func testTruncatedFeedIsRejectedRatherThanMisread() throws {
        let feed = try XCTUnwrap(Data(base64Encoded: fixture().feed))
        XCTAssertThrowsError(try GTFSRealtime.stopCalls(feed.prefix(feed.count - 3)))
    }
}
