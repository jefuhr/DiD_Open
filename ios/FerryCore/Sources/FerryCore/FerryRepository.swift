import Foundation

public enum FerryError: Error, LocalizedError {
    case unsupportedSchedule(Int), wrongIdentity, invalidResponse, http(Int), noSavedData
    public var errorDescription: String? {
        switch self {
        case .unsupportedSchedule: return "This schedule needs a newer version of Ferry Board."
        case .wrongIdentity: return "The server returned data for a different selection."
        case .invalidResponse: return "The ferry server returned an unreadable response."
        case .http(let code): return "The ferry server could not answer (\(code))."
        case .noSavedData: return "Connect to download this schedule for offline use."
        }
    }
}

public struct FerryEndpoint: Sendable, Hashable {
    public let path: String
    public let parameters: [String: String]
    public init(_ path: String, _ parameters: [String: String] = [:]) { self.path = path; self.parameters = parameters }
    public var cacheKey: String {
        ([path] + parameters.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }).joined(separator: "&")
    }
}

public protocol FerryTransport: Sendable {
    func data(for endpoint: FerryEndpoint) async throws -> Data
}

public struct HTTPTransport: FerryTransport {
    public let baseURL: URL
    public let session: URLSession
    public init(baseURL: URL = URL(string: "https://juliet.nyc")!, session: URLSession = .shared) {
        self.baseURL = baseURL; self.session = session
    }
    public func data(for endpoint: FerryEndpoint) async throws -> Data {
        var url = URLComponents(url: baseURL.appendingPathComponent(endpoint.path), resolvingAgainstBaseURL: false)!
        url.queryItems = endpoint.parameters.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        var request = URLRequest(url: url.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        try Task.checkCancellation()
        guard let response = response as? HTTPURLResponse else { throw FerryError.invalidResponse }
        // Feed endpoints also return typed unavailable/stale snapshots with HTTP 503.
        let snapshot = ["api/realtime", "api/boats", "api/alerts"].contains(endpoint.path)
        guard (200...299).contains(response.statusCode) || (snapshot && response.statusCode == 503) else { throw FerryError.http(response.statusCode) }
        return data
    }
}

public struct SavedResponse<Value: Sendable>: Sendable {
    public let value: Value
    public let saved: Bool
    public let receivedAt: Date
    public let warning: String?
}

private struct DiskEntry: Codable { var data: Data; var receivedAt: Date }

/// Files contain the original response, so optional fields survive model changes.
public actor SnapshotCache {
    private let directory: URL
    public init(directory: URL) { self.directory = directory }
    private func file(_ key: String) -> URL {
        let encoded = Data(key.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "+", with: "-")
        return directory.appendingPathComponent(encoded + ".json")
    }
    public func read(_ key: String) -> (Data, Date)? {
        guard let data = try? Data(contentsOf: file(key)), let entry = try? JSONDecoder().decode(DiskEntry.self, from: data) else { return nil }
        return (entry.data, entry.receivedAt)
    }
    public func write(_ data: Data, key: String, at: Date) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(DiskEntry(data: data, receivedAt: at)).write(to: file(key), options: .atomic)
    }
}

public actor FerryRepository {
    private let transport: any FerryTransport
    private let cache: SnapshotCache
    private let namespace: String
    public init(transport: any FerryTransport, cache: SnapshotCache, namespace: String = "production") {
        self.transport = transport; self.cache = cache; self.namespace = namespace
    }

    public func saved<T: Decodable & Sendable>(_ type: T.Type, endpoint: FerryEndpoint,
        validate: @Sendable (T) throws -> Void = { _ in }) async -> SavedResponse<T>? {
        guard let (data, at) = await cache.read(namespace + endpoint.cacheKey), let value = try? JSONDecoder().decode(type, from: data),
              (try? validate(value)) != nil else { return nil }
        return SavedResponse(value: value, saved: true, receivedAt: at, warning: nil)
    }

    public func fetch<T: Decodable & Sendable>(_ type: T.Type, endpoint: FerryEndpoint,
        validate: @Sendable (T) throws -> Void = { _ in }) async throws -> SavedResponse<T> {
        do {
            let data = try await transport.data(for: endpoint)
            try Task.checkCancellation()
            let value = try JSONDecoder().decode(type, from: data)
            try validate(value)
            let now = Date()
            var warning: String?
            do { try await cache.write(data, key: namespace + endpoint.cacheKey, at: now) }
            catch { warning = "Offline storage is unavailable. Keep the app open until you can reconnect." }
            return SavedResponse(value: value, saved: false, receivedAt: now, warning: warning)
        } catch {
            if Task.isCancelled || error is CancellationError { throw CancellationError() }
            if let result = await saved(type, endpoint: endpoint, validate: validate) {
                return SavedResponse(value: result.value, saved: true, receivedAt: result.receivedAt, warning: error.localizedDescription)
            }
            throw error
        }
    }
}
