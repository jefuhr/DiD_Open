import SwiftUI
import CoreLocation
import FerryCore

@MainActor
final class NearestLanding: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    struct Saved: Codable { var id: Int; var name: String; var distance: Double; var at: Date }
    @Published var saved: Saved?
    @Published var locating = false
    @Published var error: String?
    private let manager = CLLocationManager()
    private var landings: [Landing] = []
    private var timeout: Task<Void, Never>?
    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        if let raw = UserDefaults.standard.data(forKey: "nearest-landing"), let value = try? JSONDecoder().decode(Saved.self, from: raw), Date().timeIntervalSince(value.at) < 12 * 3600 { saved = value }
    }
    func locate(_ landings: [Landing]) {
        self.landings = landings; error = nil; locating = true
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse: request()
        default: fail("Location access is off. You can enable it in Settings, or choose a landing manually.")
        }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard locating else { return }
        if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways { request() }
        else if manager.authorizationStatus != .notDetermined { fail("Location access is off. Choose a landing manually or enable access in Settings.") }
    }
    private func request() {
        manager.requestLocation(); timeout?.cancel()
        timeout = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(15)) } catch { return }
            self?.fail("A location could not be found. Try again outdoors or choose a landing manually.")
        }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let fix = locations.last, fix.horizontalAccuracy >= 0 else { fail("No usable location was reported."); return }
        let ranked = landings.compactMap { landing -> (Landing, Double)? in
            guard let lat = landing.latitude, let lon = landing.longitude else { return nil }
            return (landing, fix.distance(from: CLLocation(latitude: lat, longitude: lon)))
        }.sorted { $0.1 < $1.1 }
        guard let nearest = ranked.first else { fail("Connect to download landing locations first."); return }
        let value = Saved(id: nearest.0.id, name: nearest.0.name, distance: nearest.1, at: Date())
        saved = value; locating = false; timeout?.cancel(); manager.stopUpdatingLocation()
        if let raw = try? JSONEncoder().encode(value) { UserDefaults.standard.set(raw, forKey: "nearest-landing") }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { fail("Your location could not be determined. Try again or choose a landing manually.") }
    private func fail(_ message: String) { error = message; locating = false; timeout?.cancel(); manager.stopUpdatingLocation() }
}

struct NearestLandingButton: View {
    @EnvironmentObject private var store: FerryStore
    @StateObject private var locator = NearestLanding()
    var body: some View {
        Button {
            if let saved = locator.saved, saved.id != store.preferences.landingID, Date().timeIntervalSince(saved.at) < 12 * 3600 { store.selectLanding(saved.id) }
            else { locator.locate(store.roster?.landings ?? []) }
        } label: {
            Label(locator.locating ? "Locating…" : "Nearest", systemImage: "location")
        }.disabled(locator.locating).accessibilityIdentifier("nearestLanding")
            .contextMenu {
                Button("Update location", systemImage: "location.fill") { locator.locate(store.roster?.landings ?? []) }
            }
            .onChange(of: locator.saved?.at) { _, _ in
                if let saved = locator.saved { store.selectLanding(saved.id) }
            }
            .alert("Location unavailable", isPresented: Binding(get: { locator.error != nil }, set: { if !$0 { locator.error = nil } })) {
                Button("OK", role: .cancel) { locator.error = nil }
                Link("Open Settings", destination: URL(string: UIApplication.openSettingsURLString)!)
            } message: { Text(locator.error ?? "") }
    }
}
