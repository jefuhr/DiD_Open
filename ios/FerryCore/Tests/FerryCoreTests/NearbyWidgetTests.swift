import XCTest
@testable import FerryCore

final class NearbyWidgetTests: XCTestCase {
    private let now = ServiceClock.instant("2026-09-04T12:50:00Z")!
    private func schedule() throws -> DisplayData {
        struct Fixture: Decodable { let schedule: DisplayData }
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: root.appendingPathComponent("test/fixtures/schedule-contract.json"))).schedule
    }
    private func feed() throws -> Realtime {
        try JSONDecoder().decode(Realtime.self, from: Data(#"{"available":true,"stale":false,"fetchedAt":"2026-09-04T12:50:00Z","vehiclesStale":false,"updates":[{"tripId":"nine","stopId":"PIER11","delaySeconds":120}],"vehicles":[{"tripId":"nine","boatName":"Opportunity"}]}"#.utf8))
    }

    func testNearestLandingChangesAsWorkerMovesAndSkipsBadCoordinates() throws {
        let landings = try JSONDecoder().decode([Landing].self, from: Data(#"[{"id":16,"name":"Pier 11","displayName":"Wall St","latitude":40.703161,"longitude":-74.006144},{"id":26,"name":"Pier 79","displayName":"Midtown","latitude":40.760323,"longitude":-74.004075},{"id":1,"name":"Missing","displayName":"Missing"},{"id":2,"name":"Invalid","displayName":"Invalid","latitude":100,"longitude":-74}]"#.utf8))
        XCTAssertEqual(NearbyWidgetBoard.nearest(in: landings, latitude: 40.704, longitude: -74.005)?.id, 16)
        XCTAssertEqual(NearbyWidgetBoard.nearest(in: landings, latitude: 40.760, longitude: -74.003)?.id, 26)
        XCTAssertNil(NearbyWidgetBoard.nearest(in: landings, latitude: .nan, longitude: -74))
        XCTAssertNil(NearbyWidgetBoard.nearest(in: landings, latitude: 40, longitude: 181))
        XCTAssertNil(NearbyWidgetBoard.nearest(in: [], latitude: 40, longitude: -74))
    }

    func testOldLocationExpiresAndFutureDatesAreRejected() {
        XCTAssertTrue(NearbyWidgetBoard.usableLocation(at: now.addingTimeInterval(-300), now: now))
        XCTAssertFalse(NearbyWidgetBoard.usableLocation(at: now.addingTimeInterval(-21601), now: now))
        XCTAssertFalse(NearbyWidgetBoard.usableLocation(at: now.addingTimeInterval(1), now: now))
    }

    func testLiveTimingAndAssignmentsExpireEvenWhenTimelineIsNotReloaded() throws {
        var data = try schedule()
        data.departures[0].stopId = "PIER11"
        let feed = try feed()
        let fresh = NearbyWidgetBoard.departures(data: data, realtime: feed, receivedAt: now, now: now)
        XCTAssertEqual(fresh.first?.time, "09:02")
        XCTAssertEqual(fresh.first?.estimated, true)
        XCTAssertTrue(fresh.first?.detail.contains("Opportunity") == true)
        let old = NearbyWidgetBoard.departures(data: data, realtime: feed, receivedAt: now, now: now.addingTimeInterval(301))
        XCTAssertEqual(old.first?.time, "09:00")
        XCTAssertEqual(old.first?.estimated, false)
        XCTAssertFalse(old.contains { $0.detail.contains("Opportunity") })
        // A newly downloaded stale feed still cannot present estimates or vessel names.
        var stale = feed
        stale.stale = true
        XCTAssertTrue(NearbyWidgetBoard.freshRealtime(stale, receivedAt: now, now: now).stale)
        stale = feed; stale.fetchedAt = "2026-09-04T12:40:00Z"
        XCTAssertTrue(NearbyWidgetBoard.freshRealtime(stale, receivedAt: now, now: now).stale)
        stale = feed; stale.vehiclesStale = true
        XCTAssertTrue(NearbyWidgetBoard.freshRealtime(stale, receivedAt: now, now: now).vehicles?.isEmpty == true)
    }

    func testScheduleAdvancesWithoutANetworkRefreshAndPreservesOperationalDetails() throws {
        var data = try schedule()
        data.meta.showDwellTimes = true
        data.departures[0].boatAssignment = 2
        data.tripSchedules["nine"] = try JSONDecoder().decode(TripSchedule.self, from: Data(#"{"stops":[{"stopId":"PIER11","sequence":1,"arrivalSeconds":32220,"departureSeconds":32400}],"turnaround":{"scheduledLayoverSeconds":600}}"#.utf8))
        data.departures[0].stopId = "PIER11"
        let rows = NearbyWidgetBoard.departures(data: data, realtime: .empty, receivedAt: nil, now: now)
        XCTAssertTrue(rows[0].detail.contains("ER2"))
        XCTAssertTrue(rows[0].detail.contains("Dwell 3m"))
        XCTAssertTrue(rows[0].detail.contains("Turn 10m"))
        XCTAssertTrue(rows.contains { $0.detail.contains("TO PIER C") })
        XCTAssertTrue(rows.contains { $0.detail.contains("CREW") })
        data.departures[0].fromHomePort = true
        XCTAssertTrue(NearbyWidgetBoard.departures(data: data, realtime: .empty, receivedAt: nil, now: now)[0].detail.contains("FROM PIER C"))
        data.departures[0].fromHomePort = nil
        data.departures[0].destination = "Pier C"; data.departures[0].outOfService = true; data.departures[0].arrival = true
        let pierC = NearbyWidgetBoard.departures(data: data, realtime: .empty, receivedAt: nil, now: now)[0]
        XCTAssertTrue(pierC.detail.contains("TO PIER C"))
        XCTAssertTrue(pierC.detail.contains("ARR"))
        let later = NearbyWidgetBoard.departures(data: data, realtime: .empty, receivedAt: nil, now: now.addingTimeInterval(12 * 60))
        XCTAssertFalse(later.contains { $0.id.contains("|nine|") })
    }

    func testLargeWidgetsReceiveEnoughRowsToFillTheirHeight() throws {
        var data = try schedule()
        let template = data.departures[0]
        data.departures = (0..<20).map { index in
            var departure = template
            departure.tripId = "fill-\(index)"
            departure.seconds = 32400 + Double(index) * 120
            return departure
        }
        let rows = NearbyWidgetBoard.departures(data: data, realtime: .empty, receivedAt: nil, now: now)
        XCTAssertEqual(rows.count, NearbyWidgetBoard.maximumRows)
        XCTAssertGreaterThan(NearbyWidgetBoard.maximumRows, 7)
    }

    func testFitCandidatesTryTheMostRowsTheSizeAndBoardAllow() {
        XCTAssertEqual(NearbyWidgetBoard.fitCandidates(available: 12, maximum: 3), [3, 2, 1])
        XCTAssertEqual(NearbyWidgetBoard.fitCandidates(available: 2, maximum: 4), [2, 1])
        XCTAssertEqual(NearbyWidgetBoard.fitCandidates(available: 0, maximum: 4), [1])
        XCTAssertEqual(NearbyWidgetBoard.fitCandidates(available: 5, maximum: 0), [1])
    }

    func testWidgetLinksOnlyAcceptSupportedActions() {
        XCTAssertEqual(FerryWidgetLink(URL(string: "ferryboard://landing/16")!), .landing(16))
        XCTAssertEqual(FerryWidgetLink(URL(string: "ferryboard://nearby")!), .nearby)
        for text in ["https://landing/16", "ferryboard://landing/-1", "ferryboard://landing/nope", "ferryboard://landing/16/other", "ferryboard://unknown"] {
            XCTAssertNil(FerryWidgetLink(URL(string: text)!))
        }
    }
}
