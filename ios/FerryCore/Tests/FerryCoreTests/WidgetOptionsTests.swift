import XCTest
@testable import FerryCore

final class WidgetOptionsTests: XCTestCase {
    private let now = ServiceClock.instant("2026-09-04T12:50:00Z")!
    private func schedule() throws -> DisplayData {
        struct Fixture: Decodable { let schedule: DisplayData }
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: root.appendingPathComponent("test/fixtures/schedule-contract.json"))).schedule
    }
    private func live() throws -> Realtime {
        try JSONDecoder().decode(Realtime.self, from: Data(#"{"available":true,"stale":false,"fetchedAt":"2026-09-04T12:50:00Z","updates":[],"vehicles":[{"tripId":"nine","boatName":"Opportunity"}]}"#.utf8))
    }
    private func rows(_ data: DisplayData, options: WidgetOptions, realtime: Realtime = .empty) -> [WidgetDeparture] {
        NearbyWidgetBoard.departures(data: data, realtime: realtime, receivedAt: now, now: now, options: options)
    }

    func testOlderSettingsMigrateWithoutLosingIndividualChoices() throws {
        let options = try JSONDecoder().decode(WidgetOptions.self, from: Data(#"{"showBoatNames":false,"hiddenOperators":["Seastreak"],"hiddenNYCMovements":["crewShuttle","future"],"departureWindowMinutes":-2,"departuresPerRoute":100}"#.utf8))
        XCTAssertFalse(options.showBoatNames)
        XCTAssertTrue(options.automaticLanding)
        XCTAssertTrue(options.showAssignments)
        XCTAssertEqual(options.hiddenOperators, ["Seastreak"])
        XCTAssertEqual(options.hiddenNYCMovements, [.crewShuttle])
        XCTAssertEqual(options.departureWindowMinutes, 0)
        XCTAssertEqual(options.departuresPerRoute, 0)
        XCTAssertEqual(try JSONDecoder().decode(WidgetOptions.self, from: JSONEncoder().encode(options)), options)
    }

    func testOperatorFilterRunsBeforeWidgetCapacity() throws {
        var data = try schedule()
        let template = data.departures[0]
        data.departures = (0..<9).map { i in
            var departure = template
            departure.tripId = "capacity-\(i)"; departure.seconds = 32400 + Double(i) * 60
            departure.operator = i == 8 ? "NY Waterway" : "NYC Ferry"
            return departure
        }
        var options = WidgetOptions(); options.hiddenOperators = ["NYC Ferry"]
        XCTAssertEqual(rows(data, options: options).count, 1)
        XCTAssertTrue(rows(data, options: options)[0].id.contains("capacity-8"))
    }

    func testBoatNamesAndWorkingAssignmentsCanBeHiddenIndependently() throws {
        let data = try schedule(), feed = try live()
        var options = WidgetOptions()
        options.showBoatNames = false
        let withoutNames = rows(data, options: options, realtime: feed)
        XCTAssertTrue(withoutNames[0].detail.contains("ER1"))
        XCTAssertFalse(withoutNames.contains { $0.detail.contains("Opportunity") || $0.detail.contains("Pred.") })
        options.showBoatNames = true; options.showAssignments = false
        let withoutAssignments = rows(data, options: options, realtime: feed)
        XCTAssertTrue(withoutAssignments[0].detail.contains("Opportunity"))
        XCTAssertFalse(withoutAssignments[0].detail.contains("ER1"))
        var crew = data
        crew.departures[4].crewBoats = ["A26", "D10"]
        XCTAssertFalse(rows(crew, options: options).contains { $0.detail.contains("A26") || $0.detail.contains("D10") })
        XCTAssertTrue(rows(crew, options: options).contains { $0.detail.contains("CREW") })
    }

    func testDwellAndLayoverSwitchesAndClockFormat() throws {
        var data = try schedule()
        data.tripSchedules["nine"] = try JSONDecoder().decode(TripSchedule.self, from: Data(#"{"stops":[{"stopId":"1","sequence":1,"arrivalSeconds":32220,"departureSeconds":32400}],"turnaround":{"scheduledLayoverSeconds":600}}"#.utf8))
        var options = WidgetOptions()
        XCTAssertTrue(rows(data, options: options)[0].detail.contains("Dwell 3m"))
        XCTAssertTrue(rows(data, options: options)[0].detail.contains("Turn 10m"))
        options.showDwells = false
        XCTAssertFalse(rows(data, options: options)[0].detail.contains("Dwell"))
        XCTAssertTrue(rows(data, options: options)[0].detail.contains("Turn 10m"))
        options.showLayovers = false; options.twelveHour = true
        XCTAssertFalse(rows(data, options: options)[0].detail.contains("Turn"))
        XCTAssertEqual(rows(data, options: options)[0].time, "9:00 AM")
    }

    func testCopiedRouteAndMovementFiltersRunBeforePerRouteLimit() throws {
        var data = try schedule()
        data.departures = Array(data.departures.prefix(2))
        data.departures[0].crewShuttle = true
        var options = WidgetOptions()
        options.sortByRoute = true; options.departuresPerRoute = 1
        options.hiddenNYCMovements = [.crewShuttle]
        XCTAssertEqual(rows(data, options: options).count, 1)
        XCTAssertTrue(rows(data, options: options)[0].id.contains("|ten|"))
        options.departureWindowMinutes = 30
        XCTAssertTrue(rows(data, options: options).isEmpty)
        options.departureWindowMinutes = 0; options.hiddenRoutes = ["ER"]
        XCTAssertTrue(rows(data, options: options).isEmpty)
    }
}
