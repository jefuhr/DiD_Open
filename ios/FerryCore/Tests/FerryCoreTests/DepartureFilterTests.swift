import XCTest
@testable import FerryCore

final class DepartureFilterTests: XCTestCase {
    private func departures() throws -> [Departure] {
        struct Fixture: Decodable { var schedule: DisplayData }
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: root.appendingPathComponent("test/fixtures/schedule-contract.json"))).schedule.departures
    }

    func testPierCReturnsAndCrewShuttlesAreIndependentOfOtherOutOfServiceBoats() throws {
        let rows = try departures()
        let home = try XCTUnwrap(rows.first { $0.tripId == "home" })
        var crew = try XCTUnwrap(rows.first { $0.crewShuttle == true })
        crew.destination = "Pier C"; crew.outOfService = true
        var tiedUp = try XCTUnwrap(rows.first { $0.tripId == "nine" })
        tiedUp.outOfService = true
        let filters = DepartureFilters(hiddenNYCMovements: [.outOfService])
        XCTAssertTrue(filters.allows(home, operatorName: "NYC Ferry"))
        XCTAssertTrue(filters.allows(crew, operatorName: "NYC Ferry"))
        XCTAssertFalse(filters.allows(tiedUp, operatorName: "NYC Ferry"))
        let noReturns = DepartureFilters(hiddenNYCMovements: [.pierC])
        XCTAssertFalse(noReturns.allows(home, operatorName: "NYC Ferry"))
        XCTAssertTrue(noReturns.allows(crew, operatorName: "NYC Ferry"))
        XCTAssertTrue(noReturns.allows(tiedUp, operatorName: "NYC Ferry"))
        let noShuttles = DepartureFilters(hiddenNYCMovements: [.crewShuttle])
        XCTAssertTrue(noShuttles.allows(home, operatorName: "NYC Ferry"))
        XCTAssertFalse(noShuttles.allows(crew, operatorName: "NYC Ferry"))
    }

    func testOperationalFiltersDoNotHidePassengerTripsOrPartnerArrivals() throws {
        let passenger = try XCTUnwrap(departures().first { $0.tripId == "nine" })
        let filters = DepartureFilters(hiddenNYCMovements: Set(NYCFerryMovement.allCases))
        XCTAssertTrue(filters.allows(passenger, operatorName: "NYC Ferry"))
        var partner = passenger
        partner.routeId = "wtr:ER"; partner.outOfService = true; partner.arrival = true
        XCTAssertTrue(filters.allows(partner, operatorName: "NY Waterway"))
    }

    func testRoutesUseFeedNamespacesAndParentOperatorStillControlsAllMovements() throws {
        let filters = DepartureFilters(hiddenRoutes: ["ER"])
        XCTAssertFalse(filters.allows(routeID: "ER", operatorName: "NYC Ferry"))
        XCTAssertTrue(filters.allows(routeID: "wtr:ER", operatorName: "NY Waterway"))
        let hidden = DepartureFilters(hiddenOperators: ["NYC Ferry"])
        for row in try departures() { XCTAssertFalse(hidden.allows(row, operatorName: "NYC Ferry")) }
        XCTAssertTrue(hidden.allows(routeID: "wtr:ER", operatorName: "NY Waterway"))
    }

    func testConfirmedSukkotMovementsUseTheSameFilters() throws {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        let data = try JSONDecoder().decode(DisplayData.self, from: Data(contentsOf: root.appendingPathComponent("public/data/display-data.json")))
        let rows = ScheduleEngine.timeline(data: data, viewDate: "2026-09-30", now: try XCTUnwrap(ServiceClock.instant("2026-09-29T04:00:00Z")))
        let returns = rows.filter { $0.departure.serviceId == "nyc:sukkot:2026" && $0.departure.outOfService == true && $0.departure.destination == "Pier C" }
        let shuttles = rows.filter { $0.departure.serviceId == "nyc:sukkot:2026" && $0.departure.crewShuttle == true }
        XCTAssertFalse(returns.isEmpty)
        XCTAssertFalse(shuttles.isEmpty)
        for row in returns {
            XCTAssertFalse(DepartureFilters(hiddenNYCMovements: [.pierC]).allows(row.departure, operatorName: "NYC Ferry"))
            XCTAssertTrue(DepartureFilters(hiddenNYCMovements: [.crewShuttle, .outOfService]).allows(row.departure, operatorName: "NYC Ferry"))
        }
        for row in shuttles {
            XCTAssertFalse(DepartureFilters(hiddenNYCMovements: [.crewShuttle]).allows(row.departure, operatorName: "NYC Ferry"))
            XCTAssertTrue(DepartureFilters(hiddenNYCMovements: [.pierC, .outOfService]).allows(row.departure, operatorName: "NYC Ferry"))
        }
    }
}
