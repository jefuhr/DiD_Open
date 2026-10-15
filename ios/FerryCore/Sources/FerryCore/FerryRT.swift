import Foundation

/// Ferry RT republishes NYC Ferry's trip updates with each confirmed boarding slip in place of the
/// landing's stop. It is reachable only on the Hornblower network, so the app reads it directly
/// rather than through the board's server, and only for the slip: timing still comes from the board.
public enum FerryRT {
    public static let baseURL = URL(string: "http://nycf-web.dc-west.hornblower.com")!

    /// Reads one Ferry RT path ("api/slips", "gtfs-rt/tripupdate"). Injected so tests need no network.
    public struct Client: Sendable {
        public var data: @Sendable (String) async throws -> Data
        public init(data: @escaping @Sendable (String) async throws -> Data) { self.data = data }
        public static let live = Client { path in
            let request = URLRequest(url: baseURL.appendingPathComponent(path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw FerryError.invalidResponse }
            guard (200...299).contains(response.statusCode) else { throw FerryError.http(response.statusCode) }
            return data
        }
    }

    /// Slip id -> the landing stop it belongs to, from `/api/slips`.
    public struct SlipCatalog: Sendable {
        public var landings: [String: (landingStopId: String, slip: Slip)]
        public init(json: Data) throws {
            struct Payload: Decodable {
                struct Entry: Decodable { var id: String; var name: String?; var platformCode: String?; var landingStopId: String? }
                var slips: [Entry]
            }
            var landings: [String: (landingStopId: String, slip: Slip)] = [:]
            for entry in try JSONDecoder().decode(Payload.self, from: json).slips {
                // A slip that is its own landing stop says nothing a rider can use.
                guard let landing = entry.landingStopId, landing != entry.id else { continue }
                landings[entry.id] = (landing, Slip(id: entry.id, name: entry.name ?? entry.platformCode ?? entry.id))
            }
            self.landings = landings
        }
    }

    /// "tripId|landingStopId" -> slip, for every call the trip-update feed names a known slip for.
    public static func slips(tripUpdates: Data, catalog: SlipCatalog) throws -> [String: Slip] {
        var result: [String: Slip] = [:]
        for call in try GTFSRealtime.stopCalls(tripUpdates) {
            guard let known = catalog.landings[call.stopId] else { continue }
            result["\(call.tripId)|\(known.landingStopId)"] = known.slip
        }
        return result
    }
}

public extension Realtime {
    /// Every update carries the slip Ferry RT confirmed for it, or none; an empty map clears them all.
    func withSlips(_ slips: [String: Slip]) -> Realtime {
        var copy = self
        copy.updates = updates?.map { update in
            var update = update
            update.slip = slips["\(update.tripId)|\(update.stopId)"]
            return update
        }
        return copy
    }
}

/// Just enough protobuf to read trip ids and stop ids out of a GTFS-Realtime FeedMessage.
/// Field numbers are from gtfs-realtime.proto; everything else is skipped by wire type.
enum GTFSRealtime {
    struct StopCall: Equatable { var tripId: String; var stopId: String }

    static func stopCalls(_ data: Data) throws -> [StopCall] {
        var calls: [StopCall] = []
        // FeedMessage.entity = 2 -> FeedEntity.trip_update = 3
        try Reader.fields(in: data) { field, value in
            guard field == 2, case .bytes(let entity) = value else { return }
            try Reader.fields(in: entity) { field, value in
                guard field == 3, case .bytes(let update) = value else { return }
                calls += try tripCalls(update)
            }
        }
        return calls
    }

    // TripUpdate.trip = 1 (TripDescriptor.trip_id = 1), TripUpdate.stop_time_update = 2 (StopTimeUpdate.stop_id = 4)
    private static func tripCalls(_ update: Data) throws -> [StopCall] {
        var tripId: String?
        var stops: [String] = []
        try Reader.fields(in: update) { field, value in
            guard case .bytes(let message) = value else { return }
            if field == 1 {
                try Reader.fields(in: message) { field, value in
                    if field == 1, case .bytes(let text) = value { tripId = String(decoding: text, as: UTF8.self) }
                }
            } else if field == 2 {
                try Reader.fields(in: message) { field, value in
                    if field == 4, case .bytes(let text) = value { stops.append(String(decoding: text, as: UTF8.self)) }
                }
            }
        }
        guard let tripId, !tripId.isEmpty else { return [] }
        return stops.map { StopCall(tripId: tripId, stopId: $0) }
    }

    enum Value { case varint(UInt64), bytes(Data), fixed }

    struct Reader {
        private let bytes: [UInt8]
        private var index = 0
        private init(_ data: Data) { bytes = [UInt8](data) }

        static func fields(in data: Data, _ visit: (Int, Value) throws -> Void) throws {
            var reader = Reader(data)
            try reader.read(visit)
        }

        private mutating func read(_ visit: (Int, Value) throws -> Void) throws {
            while index < bytes.count {
                let key = try varint()
                let field = Int(key >> 3)
                switch key & 7 {
                case 0: try visit(field, .varint(try varint()))
                case 1: try skip(8); try visit(field, .fixed)
                case 2:
                    let length = Int(try varint())
                    guard length >= 0, index + length <= bytes.count else { throw FerryError.invalidResponse }
                    let value = Data(bytes[index..<index + length])
                    index += length
                    try visit(field, .bytes(value))
                case 5: try skip(4); try visit(field, .fixed)
                default: throw FerryError.invalidResponse
                }
            }
        }

        private mutating func skip(_ count: Int) throws {
            guard index + count <= bytes.count else { throw FerryError.invalidResponse }
            index += count
        }

        private mutating func varint() throws -> UInt64 {
            var result: UInt64 = 0
            for shift in stride(from: 0, to: 64, by: 7) {
                guard index < bytes.count else { throw FerryError.invalidResponse }
                let byte = bytes[index]; index += 1
                result |= UInt64(byte & 0x7F) << UInt64(shift)
                if byte & 0x80 == 0 { return result }
            }
            throw FerryError.invalidResponse
        }
    }
}
