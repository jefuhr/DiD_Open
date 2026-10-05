import Foundation

public struct WidgetOptions: Codable, Sendable, Equatable {
    public var automaticLanding = true
    public var landingID: Int?
    public var landingName: String?
    public var hiddenOperators: Set<String> = []
    public var hiddenRoutes: Set<String> = []
    public var hiddenNYCMovements: Set<NYCFerryMovement> = []
    public var twelveHour = false
    public var sortByRoute = false
    public var showBoatNames = true
    public var showAssignments = true
    public var showDwells = true
    public var showLayovers = true
    public var showCountdown = true
    public var departureWindowMinutes = 0
    public var departuresPerRoute = 0
    public var theme = "system"
    public var textSize = "system"

    public init() {}
    public var filters: DepartureFilters {
        DepartureFilters(hiddenOperators: hiddenOperators, hiddenRoutes: hiddenRoutes, hiddenNYCMovements: hiddenNYCMovements)
    }

    private enum CodingKeys: String, CodingKey {
        case automaticLanding, landingID, landingName, hiddenOperators, hiddenRoutes, hiddenNYCMovements
        case twelveHour, sortByRoute, showBoatNames, showAssignments, showDwells, showLayovers, showCountdown
        case departureWindowMinutes, departuresPerRoute, theme, textSize
    }
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        automaticLanding = (try? values.decode(Bool.self, forKey: .automaticLanding)) ?? true
        landingID = try? values.decode(Int.self, forKey: .landingID)
        landingName = try? values.decode(String.self, forKey: .landingName)
        hiddenOperators = (try? values.decode(Set<String>.self, forKey: .hiddenOperators)) ?? []
        hiddenRoutes = (try? values.decode(Set<String>.self, forKey: .hiddenRoutes)) ?? []
        hiddenNYCMovements = Set(((try? values.decode([String].self, forKey: .hiddenNYCMovements)) ?? []).compactMap(NYCFerryMovement.init(rawValue:)))
        twelveHour = (try? values.decode(Bool.self, forKey: .twelveHour)) ?? false
        sortByRoute = (try? values.decode(Bool.self, forKey: .sortByRoute)) ?? false
        showBoatNames = (try? values.decode(Bool.self, forKey: .showBoatNames)) ?? true
        showAssignments = (try? values.decode(Bool.self, forKey: .showAssignments)) ?? true
        showDwells = (try? values.decode(Bool.self, forKey: .showDwells)) ?? true
        showLayovers = (try? values.decode(Bool.self, forKey: .showLayovers)) ?? true
        showCountdown = (try? values.decode(Bool.self, forKey: .showCountdown)) ?? true
        let window = (try? values.decode(Int.self, forKey: .departureWindowMinutes)) ?? 0
        departureWindowMinutes = [0, 30, 60, 120, 240].contains(window) ? window : 0
        let count = (try? values.decode(Int.self, forKey: .departuresPerRoute)) ?? 0
        departuresPerRoute = (0...5).contains(count) ? count : 0
        theme = (try? values.decode(String.self, forKey: .theme)) ?? "system"
        textSize = (try? values.decode(String.self, forKey: .textSize)) ?? "system"
    }
}

public struct WidgetSettingsRecord: Codable, Sendable {
    public var options: WidgetOptions
    public var roster: LandingRoster?
    public var favorites: Set<Int>
    public init(options: WidgetOptions, roster: LandingRoster?, favorites: Set<Int>) {
        self.options = options; self.roster = roster; self.favorites = favorites
    }
}
