import CoreLocation
import Foundation

/// A bounded one-shot request; the widget never runs continuous location tracking
/// and cannot ask for authorization itself. The containing app handles permission.
@MainActor
final class WidgetLocation: NSObject, @preconcurrency CLLocationManagerDelegate {
    enum Result { case fix(CLLocation), unavailable, notAuthorized }
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<Result, Never>?
    private var timeout: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func request() async -> Result {
        guard manager.isAuthorizedForWidgetUpdates else { return .notAuthorized }
        return await withCheckedContinuation { continuation in
            self.continuation = continuation
            manager.requestLocation()
            timeout = Task { [weak self] in
                do { try await Task.sleep(for: .seconds(8)) } catch { return }
                self?.finish(.unavailable)
            }
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let now = Date()
        guard let fix = locations.last, fix.horizontalAccuracy >= 0, fix.horizontalAccuracy <= 5000,
              abs(now.timeIntervalSince(fix.timestamp)) <= 15 * 60 else { finish(.unavailable); return }
        finish(.fix(fix))
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { finish(.unavailable) }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard continuation != nil else { return }
        if !manager.isAuthorizedForWidgetUpdates { finish(.notAuthorized) }
    }
    private func finish(_ result: Result) {
        guard let continuation else { return }
        self.continuation = nil
        timeout?.cancel(); timeout = nil
        manager.stopUpdatingLocation()
        continuation.resume(returning: result)
    }
}
