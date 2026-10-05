import AppIntents
import FerryCore

private func widgetRoster() async -> (LandingRoster?, Set<Int>) {
    if let record = WidgetSettingsBridge.read(), let roster = record.roster { return (roster, record.favorites) }
    let response = try? await WidgetRepository.repository.fetch(LandingRoster.self, endpoint: .init("api/landings"))
    return (response?.value, [])
}

struct WidgetLanding: AppEntity {
    let id: Int
    let name: String
    var favorite = false
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Landing"
    static var defaultQuery = WidgetLandingQuery()
    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(favorite ? "★ " : "")\(name)")
    }
}

struct WidgetLandingQuery: EntityStringQuery {
    func entities(for identifiers: [Int]) async throws -> [WidgetLanding] {
        let (roster, favorites) = await widgetRoster()
        return identifiers.map { id in
            WidgetLanding(id: id, name: roster?.landings.first { $0.id == id }?.displayName ?? "Landing \(id)", favorite: favorites.contains(id))
        }
    }
    func suggestedEntities() async throws -> [WidgetLanding] {
        let (roster, favorites) = await widgetRoster()
        return (roster?.landings ?? []).map { WidgetLanding(id: $0.id, name: $0.displayName, favorite: favorites.contains($0.id)) }
            .sorted { $0.favorite != $1.favorite ? $0.favorite : $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
    func entities(matching string: String) async throws -> [WidgetLanding] {
        try await suggestedEntities().filter { $0.name.localizedCaseInsensitiveContains(string) }
    }
}

struct WidgetOperator: AppEntity {
    let id: String
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Operator"
    static var defaultQuery = WidgetOperatorQuery()
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(id)") }
}

struct WidgetOperatorQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [WidgetOperator] { identifiers.map { WidgetOperator(id: $0) } }
    func suggestedEntities() async throws -> [WidgetOperator] {
        let (roster, _) = await widgetRoster()
        return (roster?.operators ?? []).sorted().map { WidgetOperator(id: $0) }
    }
}

struct FerryWidgetConfiguration: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Configure Ferry Widget"
    static var description = IntentDescription("Use defaults from Ferry Board or customize this widget independently.")

    @Parameter(title: "Use app widget defaults", default: true) var useAppDefaults: Bool
    @Parameter(title: "Automatically use nearest landing", default: true) var automaticLanding: Bool
    @Parameter(title: "Fixed landing (when automatic is off)") var landing: WidgetLanding?
    @Parameter(title: "Hide operators") var hiddenOperators: [WidgetOperator]?
    @Parameter(title: "Show boat names", default: true) var showBoatNames: Bool
    @Parameter(title: "Show route assignments", default: true) var showAssignments: Bool
    @Parameter(title: "Show dwell times", default: true) var showDwells: Bool
    @Parameter(title: "Show layover times", default: true) var showLayovers: Bool
    @Parameter(title: "Show countdowns", default: true) var showCountdown: Bool
    @Parameter(title: "12-hour time", default: false) var twelveHour: Bool
    @Parameter(title: "Sort by route", default: false) var sortByRoute: Bool

    static var parameterSummary: some ParameterSummary {
        When(\.$useAppDefaults, .equalTo, true) {
            Summary("Use defaults set in Ferry Board") { \.$useAppDefaults }
        } otherwise: {
            Summary("Customize this widget") {
                \.$useAppDefaults
                \.$automaticLanding
                \.$landing
                \.$hiddenOperators
                \.$showBoatNames
                \.$showAssignments
                \.$showDwells
                \.$showLayovers
                \.$showCountdown
                \.$twelveHour
                \.$sortByRoute
            }
        }
    }

    func options(shared: WidgetSettingsRecord?) -> WidgetOptions? {
        if useAppDefaults { return shared?.options }
        var options = WidgetOptions()
        options.automaticLanding = automaticLanding
        options.landingID = landing?.id
        options.landingName = landing?.name
        options.hiddenOperators = Set((hiddenOperators ?? []).map(\.id))
        options.showBoatNames = showBoatNames
        options.showAssignments = showAssignments
        options.showDwells = showDwells
        options.showLayovers = showLayovers
        options.showCountdown = showCountdown
        options.twelveHour = twelveHour
        options.sortByRoute = sortByRoute
        return options
    }
}
