import XCTest
@testable import FerryBoard

final class BoardLayoutTests: XCTestCase {
    func testSecondColumnOnlyWhenBothColumnsStayReadable() {
        XCTAssertEqual(BoardLayout.columns(width: 402, accessibilityText: false), 1, "iPhone portrait")
        XCTAssertEqual(BoardLayout.columns(width: 554, accessibilityText: false), 1, "11-inch iPad portrait beside the sidebar")
        XCTAssertEqual(BoardLayout.columns(width: 744, accessibilityText: false), 2, "iPad mini portrait")
        XCTAssertEqual(BoardLayout.columns(width: 834, accessibilityText: false), 2, "11-inch iPad portrait")
        XCTAssertEqual(BoardLayout.columns(width: 930, accessibilityText: false), 2, "11-inch iPad landscape beside the sidebar")
        XCTAssertEqual(BoardLayout.columns(width: 1376, accessibilityText: false), 2, "Only a second column, never a third")
        XCTAssertEqual(BoardLayout.columns(width: 1376, accessibilityText: true), 1, "Accessibility text keeps one column")
    }

    func testRowsFillLeftToRight() {
        XCTAssertEqual(BoardLayout.rows(of: Array(1...5), columns: 2), [[1, 2], [3, 4], [5]])
        XCTAssertEqual(BoardLayout.rows(of: Array(1...3), columns: 1), [[1], [2], [3]])
        XCTAssertEqual(BoardLayout.rows(of: [Int](), columns: 2), [])
    }

    func testCompactCountdownFitsTheTimeColumn() {
        XCTAssertEqual(BoardLayout.countdown(seconds: 90, live: true, dueLabel: "Boarding"), "Boarding")
        XCTAssertEqual(BoardLayout.countdown(seconds: 60, live: true, dueLabel: "Due"), "Due")
        XCTAssertEqual(BoardLayout.countdown(seconds: 91, live: true, dueLabel: "Boarding"), "2 min")
        XCTAssertEqual(BoardLayout.countdown(seconds: 600, live: true, dueLabel: "Boarding"), "10 min")
        XCTAssertEqual(BoardLayout.countdown(seconds: 3540, live: true, dueLabel: "Boarding"), "59 min")
        XCTAssertEqual(BoardLayout.countdown(seconds: 3599, live: true, dueLabel: "Boarding"), "1h")
        XCTAssertEqual(BoardLayout.countdown(seconds: 4200, live: true, dueLabel: "Boarding"), "1h 10m")
        XCTAssertEqual(BoardLayout.countdown(seconds: 7199, live: true, dueLabel: "Boarding"), "2h")
        XCTAssertEqual(BoardLayout.countdown(seconds: 86400, live: true, dueLabel: "Boarding"), "Tomorrow")
        XCTAssertEqual(BoardLayout.countdown(seconds: 600, live: false, dueLabel: "Boarding"), "", "Browsed dates have no countdown")
    }

    func testSpokenCountdownUsesWords() {
        XCTAssertEqual(BoardLayout.spokenCountdown(seconds: 60, live: true, dueLabel: "Due"), "Due")
        XCTAssertEqual(BoardLayout.spokenCountdown(seconds: 61 * 60, live: true, dueLabel: "Boarding"), "in 1 hour 1 minute")
        XCTAssertEqual(BoardLayout.spokenCountdown(seconds: 7200, live: true, dueLabel: "Boarding"), "in 2 hours")
        XCTAssertNil(BoardLayout.spokenCountdown(seconds: 600, live: false, dueLabel: "Boarding"))
    }

    func testBrowsedDateNamesTheWeekday() {
        XCTAssertEqual(BoardLayout.dateLabel("2026-09-05"), "Sat Sep 5")
        XCTAssertEqual(BoardLayout.dateLabel("2026-12-31"), "Thu Dec 31")
        XCTAssertEqual(BoardLayout.dateLabel("not-a-date"), "not-a-date")
    }
}
