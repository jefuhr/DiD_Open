import XCTest
import SwiftUI
import FerryCore
@testable import FerryBoard

final class PreferencesTests: XCTestCase {
    func testUpgradeKeepsExistingChoicesAndDefaultsNewSettings() throws {
        let legacy = Data(#"{"landingID":26,"favorites":[16,26],"hiddenOperators":["NY Waterway"],"sortByRoute":true,"twelveHour":true,"theme":"night"}"#.utf8)
        let preferences = try JSONDecoder().decode(Preferences.self, from: legacy)
        XCTAssertEqual(preferences.landingID, 26)
        XCTAssertEqual(preferences.favorites, [16, 26])
        XCTAssertEqual(preferences.hiddenOperators, ["NY Waterway"])
        XCTAssertTrue(preferences.hiddenRoutes.isEmpty)
        XCTAssertTrue(preferences.hiddenNYCMovements.isEmpty)
        XCTAssertTrue(preferences.sortByRoute)
        XCTAssertTrue(preferences.twelveHour)
        XCTAssertEqual(preferences.theme, "night")
        XCTAssertEqual(preferences.textSize, .system)
        XCTAssertEqual(preferences.launchLanding, .lastUsed)
        XCTAssertTrue(preferences.showDwellTimes)
        XCTAssertTrue(preferences.showLayoverTimes)
        XCTAssertEqual(preferences.departuresPerRoute, 0)
        XCTAssertEqual(preferences.departureWindowMinutes, 0)
        XCTAssertFalse(preferences.keepScreenAwake)
    }

    func testInvalidNewValuesDoNotDiscardOldPreferences() throws {
        let data = Data(#"{"landingID":16,"theme":"night","textSize":"future-option","launchTab":"future-option","departuresPerRoute":999,"departureWindowMinutes":-60}"#.utf8)
        let preferences = try JSONDecoder().decode(Preferences.self, from: data)
        XCTAssertEqual(preferences.landingID, 16)
        XCTAssertEqual(preferences.theme, "night")
        XCTAssertEqual(preferences.textSize, .system)
        XCTAssertEqual(preferences.launchTab, .departures)
        XCTAssertEqual(preferences.departuresPerRoute, 0)
        XCTAssertEqual(preferences.departureWindowMinutes, 0)
    }

    func testTextPreferencesPreserveEveryAccessibilitySize() {
        let accessible: [DynamicTypeSize] = [.accessibility1, .accessibility2, .accessibility3, .accessibility4, .accessibility5]
        for preference in FerryTextSize.allCases {
            for size in accessible { XCTAssertEqual(preference.resolved(size), size) }
        }
        XCTAssertEqual(FerryTextSize.system.resolved(.xLarge), .xLarge)
        XCTAssertEqual(FerryTextSize.compact.resolved(.large), .medium)
        XCTAssertEqual(FerryTextSize.larger.resolved(.large), .xxLarge)
        XCTAssertEqual(FerryTextSize.larger.resolved(.xxxLarge), .xxxLarge)
    }

    func testRouteAndMovementFiltersRoundTripAndIgnoreUnknownFutureMovements() throws {
        let data = Data(#"{"hiddenRoutes":["ER","wtr:10225"],"hiddenNYCMovements":["pierC","crewShuttle","future-movement"],"favorites":[26]}"#.utf8)
        let preferences = try JSONDecoder().decode(Preferences.self, from: data)
        XCTAssertEqual(preferences.hiddenRoutes, ["ER", "wtr:10225"])
        XCTAssertEqual(preferences.hiddenNYCMovements, [.pierC, .crewShuttle])
        var restored = try JSONDecoder().decode(Preferences.self, from: JSONEncoder().encode(preferences))
        XCTAssertEqual(restored.hiddenRoutes, preferences.hiddenRoutes)
        XCTAssertEqual(restored.hiddenNYCMovements, preferences.hiddenNYCMovements)
        restored.resetDepartureFilters()
        XCTAssertFalse(restored.departureFilters.isActive)
        XCTAssertEqual(restored.favorites, [26])
    }

    @MainActor func testLaunchChoicesAndDisplayOptionsPersistWithoutChangingSourceSchedule() throws {
        let suite = "PreferencesTests-" + UUID().uuidString
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let cache = SnapshotCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent(suite))
        let repository = FerryRepository(transport: OfflinePreferencesTransport(), cache: cache)
        let store = FerryStore(repository: repository, defaults: defaults)
        store.preferences.landingID = 16
        store.preferences.homeLandingID = 26
        store.preferences.launchLanding = .home
        store.preferences.launchTab = .lastUsed
        store.preferences.departuresPerRoute = 5
        store.preferences.departureWindowMinutes = 30
        store.preferences.showDwellTimes = false
        store.preferences.showLayoverTimes = false
        store.preferences.showMarineReferences = false
        store.preferences.keepScreenAwake = true
        store.tab = .map
        let restored = FerryStore(repository: repository, defaults: defaults)
        XCTAssertEqual(restored.preferences.landingID, 26)
        XCTAssertEqual(restored.tab, .map)
        XCTAssertFalse(restored.preferences.showMarineReferences)
        XCTAssertTrue(restored.preferences.keepScreenAwake)
        let source = try Data(contentsOf: XCTUnwrap(Bundle.main.url(forResource: "schedule-16", withExtension: "json")))
        restored.schedule = try JSONDecoder().decode(DisplayData.self, from: source)
        let original = try XCTUnwrap(restored.schedule)
        let display = try XCTUnwrap(restored.displaySchedule)
        XCTAssertEqual(display.meta.departuresShown, 5)
        XCTAssertEqual(display.meta.departureWindowMinutes, 30)
        XCTAssertEqual(display.meta.showDwellTimes, false)
        XCTAssertEqual(display.meta.showLayoverTimes, false)
        XCTAssertEqual(restored.schedule?.meta.departuresShown, original.meta.departuresShown)
        XCTAssertEqual(restored.schedule?.meta.departureWindowMinutes, original.meta.departureWindowMinutes)
        XCTAssertEqual(restored.schedule?.meta.showDwellTimes, original.meta.showDwellTimes)
        XCTAssertEqual(restored.schedule?.meta.showLayoverTimes, original.meta.showLayoverTimes)
    }
}

private struct OfflinePreferencesTransport: FerryTransport {
    func data(for endpoint: FerryEndpoint) async throws -> Data { throw URLError(.notConnectedToInternet) }
}
