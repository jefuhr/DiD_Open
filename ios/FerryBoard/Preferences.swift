import Foundation
import SwiftUI

enum FerryTextSize: String, Codable, CaseIterable {
    case system, compact, larger
    var label: String {
        switch self { case .system: "System"; case .compact: "Compact"; case .larger: "Larger" }
    }
    func resolved(_ system: DynamicTypeSize) -> DynamicTypeSize {
        guard !system.isAccessibilitySize else { return system }
        switch self {
        case .system: return system
        case .compact: return .medium
        case .larger: return max(system, .xxLarge)
        }
    }
}

enum LaunchLanding: String, Codable { case lastUsed, home }
enum LaunchTab: String, Codable { case lastUsed, departures, map }

struct Preferences: Codable {
    var landingID: Int?
    var favorites: Set<Int> = []
    var hiddenOperators: Set<String> = []
    var sortByRoute = false
    var twelveHour = false
    var theme = "nyc-ferry"
    var textSize: FerryTextSize = .system
    var launchLanding: LaunchLanding = .lastUsed
    var homeLandingID: Int?
    var launchTab: LaunchTab = .departures
    var lastTab: FerryTab = .departures
    var showDwellTimes = true
    var showLayoverTimes = true
    var showMarineReferences = true
    var departuresPerRoute = 0
    var departureWindowMinutes = 0
    var keepScreenAwake = false

    init() {}

    private enum CodingKeys: String, CodingKey {
        case landingID, favorites, hiddenOperators, sortByRoute, twelveHour, theme, textSize
        case launchLanding, homeLandingID, launchTab, lastTab
        case showDwellTimes, showLayoverTimes, showMarineReferences
        case departuresPerRoute, departureWindowMinutes, keepScreenAwake
    }

    // Each new setting has a default so upgrading preserves the user's existing choices.
    // Unknown future enum values also fall back independently instead of clearing all preferences.
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        landingID = try? values.decode(Int.self, forKey: .landingID)
        favorites = (try? values.decode(Set<Int>.self, forKey: .favorites)) ?? []
        hiddenOperators = (try? values.decode(Set<String>.self, forKey: .hiddenOperators)) ?? []
        sortByRoute = (try? values.decode(Bool.self, forKey: .sortByRoute)) ?? false
        twelveHour = (try? values.decode(Bool.self, forKey: .twelveHour)) ?? false
        theme = (try? values.decode(String.self, forKey: .theme)) ?? "nyc-ferry"
        textSize = (try? values.decode(FerryTextSize.self, forKey: .textSize)) ?? .system
        launchLanding = (try? values.decode(LaunchLanding.self, forKey: .launchLanding)) ?? .lastUsed
        homeLandingID = try? values.decode(Int.self, forKey: .homeLandingID)
        launchTab = (try? values.decode(LaunchTab.self, forKey: .launchTab)) ?? .departures
        lastTab = (try? values.decode(FerryTab.self, forKey: .lastTab)) ?? .departures
        showDwellTimes = (try? values.decode(Bool.self, forKey: .showDwellTimes)) ?? true
        showLayoverTimes = (try? values.decode(Bool.self, forKey: .showLayoverTimes)) ?? true
        showMarineReferences = (try? values.decode(Bool.self, forKey: .showMarineReferences)) ?? true
        let count = (try? values.decode(Int.self, forKey: .departuresPerRoute)) ?? 0
        departuresPerRoute = (0...5).contains(count) ? count : 0
        let window = (try? values.decode(Int.self, forKey: .departureWindowMinutes)) ?? 0
        departureWindowMinutes = [0, 30, 60, 120, 240].contains(window) ? window : 0
        keepScreenAwake = (try? values.decode(Bool.self, forKey: .keepScreenAwake)) ?? false
    }
}
