import Foundation

public enum NYCFerryMovement: String, Codable, CaseIterable, Sendable {
    case pierC, crewShuttle, outOfService

    /// A shuttle going to Pier C remains a crew shuttle. Home-port returns are
    /// distinct from other out-of-service movements even though both carry no passengers.
    public static func classify(_ departure: Departure) -> Self? {
        if departure.crewShuttle == true { return .crewShuttle }
        if departure.fromHomePort != true,
           departure.destination.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare("Pier C") == .orderedSame {
            return .pierC
        }
        return departure.outOfService == true ? .outOfService : nil
    }
}

public struct DepartureFilters: Sendable {
    public var hiddenOperators: Set<String>
    public var hiddenRoutes: Set<String>
    public var hiddenNYCMovements: Set<NYCFerryMovement>

    public init(hiddenOperators: Set<String> = [], hiddenRoutes: Set<String> = [],
                hiddenNYCMovements: Set<NYCFerryMovement> = []) {
        self.hiddenOperators = hiddenOperators
        self.hiddenRoutes = hiddenRoutes
        self.hiddenNYCMovements = hiddenNYCMovements
    }

    public var isActive: Bool {
        !hiddenOperators.isEmpty || !hiddenRoutes.isEmpty || !hiddenNYCMovements.isEmpty
    }

    public func allows(routeID: String, operatorName: String) -> Bool {
        !hiddenOperators.contains(operatorName) && !hiddenRoutes.contains(routeID)
    }

    public func allows(_ departure: Departure, operatorName: String) -> Bool {
        guard allows(routeID: departure.routeId, operatorName: operatorName) else { return false }
        guard operatorName == "NYC Ferry", let movement = NYCFerryMovement.classify(departure) else { return true }
        return !hiddenNYCMovements.contains(movement)
    }
}
