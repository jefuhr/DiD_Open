import XCTest
import SwiftUI
import UIKit
import WidgetKit
import FerryCore

/// Render the actual extension view at Home Screen sizes for layout review.
@MainActor
final class WidgetRenderingTests: XCTestCase {
    func testHomeScreenSizesAndLocationSetupRender() throws {
        struct Fixture: Decodable { let schedule: DisplayData }
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<3 { root.deleteLastPathComponent() }
        var data = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: root.appendingPathComponent("test/fixtures/schedule-contract.json"))).schedule
        let template = data.departures[0]
        data.departures = (0..<7).map { index in
            var departure = template
            departure.tripId = "widget-\(index)"
            departure.seconds = 32400 + Double(index) * 180
            departure.boatAssignment = index + 1
            departure.destination = index == 1 ? "Pier C" : "East 34th Street / Midtown East"
            departure.outOfService = index == 1
            departure.crewShuttle = index == 2
            departure.crewBoats = index == 2 ? ["A26", "D10"] : nil
            return departure
        }
        let now = try XCTUnwrap(ServiceClock.instant("2026-09-04T12:50:00Z"))
        let rows = NearbyWidgetBoard.departures(data: data, realtime: .empty, receivedAt: nil, now: now)
        let entry = NearbyEntry(date: now, landingID: 16, landingName: "Pier 11 / Wall St", updatedAt: now, rows: rows)
        try render(entry, family: .systemSmall, size: CGSize(width: 158, height: 158), name: "nearby-small")
        var oldLocation = entry
        oldLocation.locationLabel = "Last location · waiting for GPS"
        try render(oldLocation, family: .systemSmall, size: CGSize(width: 158, height: 158), name: "nearby-small-last-location")
        try render(entry, family: .systemMedium, size: CGSize(width: 338, height: 158), name: "nearby-medium")
        try render(entry, family: .systemLarge, size: CGSize(width: 338, height: 354), name: "nearby-large", dark: true)
        // Tinted Home Screens draw in one color, so theme colors and scheme must not leak in.
        var tinted = entry
        tinted.options.theme = "nyc-ferry"
        try render(tinted, family: .systemMedium, size: CGSize(width: 338, height: 158), name: "nearby-medium-tinted", dark: true, renderingMode: .accented)
        try render(entry, family: .systemMedium, size: CGSize(width: 338, height: 158), name: "nearby-accessibility", textSize: .accessibility1)
        var minimal = entry
        minimal.locationLabel = "Fixed landing"
        minimal.options.automaticLanding = false
        minimal.options.showAssignments = false
        minimal.options.showBoatNames = false
        minimal.options.showDwells = false
        minimal.options.showLayovers = false
        minimal.options.showCountdown = false
        minimal.rows = NearbyWidgetBoard.departures(data: data, realtime: .empty, receivedAt: nil, now: now, options: minimal.options)
        try render(minimal, family: .systemMedium, size: CGSize(width: 338, height: 158), name: "nearby-minimal-fixed")
        var copiedTheme = entry
        copiedTheme.options.theme = "night"
        copiedTheme.options.textSize = "larger"
        try render(copiedTheme, family: .systemMedium, size: CGSize(width: 338, height: 158), name: "nearby-copied-night-larger", dark: true)
        try render(NearbyEntry(date: now, message: "Tap to enable location in Ferry Board, then allow location for this widget."),
                   family: .systemSmall, size: CGSize(width: 158, height: 158), name: "nearby-location-setup")
    }

    /// iPhone 17e and iPhone 17 Pro Max Home Screen sizes, the smallest and largest phones.
    private let phoneSizes: [(name: String, sizes: [WidgetFamily: CGSize])] = [
        ("17e", [.systemSmall: CGSize(width: 158, height: 158), .systemMedium: CGSize(width: 338, height: 158), .systemLarge: CGSize(width: 338, height: 354)]),
        ("17 Pro Max", [.systemSmall: CGSize(width: 170, height: 170), .systemMedium: CGSize(width: 364, height: 170), .systemLarge: CGSize(width: 364, height: 382)])
    ]

    func testHomeScreenSizesKeepMarginsAndFillTheirHeight() throws {
        let (data, now) = try fixture(count: 14)
        let rows = NearbyWidgetBoard.departures(data: data, realtime: .empty, receivedAt: nil, now: now)
        var entry = NearbyEntry(date: now, landingID: 16, landingName: "Pier 11 / Wall St", updatedAt: now, rows: rows)
        for phone in phoneSizes {
            for (family, minimum) in [(WidgetFamily.systemSmall, 2), (.systemMedium, 3), (.systemLarge, 8)] {
                let size = try XCTUnwrap(phone.sizes[family])
                let layout = try measure(entry, family: family, size: size)
                let label = "\(phone.name) \(family)"
                print("Widget fit: \(label) shows \(layout.rows.count) departures; header \(layout.header), footer \(layout.footer), lowest row \(layout.rows.last ?? .zero)")
                // WidgetKit insets Home Screen content by 16 points on every side.
                let content = CGRect(origin: .zero, size: size).insetBy(dx: 15.5, dy: 15.5)
                XCTAssertGreaterThanOrEqual(layout.rows.count, minimum, "\(label) should fit at least \(minimum) departures")
                for row in layout.rows {
                    XCTAssertTrue(content.contains(row), "\(label) rows must stay inside the content margins: \(row)")
                    XCTAssertGreaterThan(row.minY, layout.header.maxY - 0.5, "\(label) rows must sit below the landing name")
                    XCTAssertLessThanOrEqual(row.maxY, layout.footer.minY + 0.5, "\(label) rows must not run into the footer")
                }
                XCTAssertTrue(content.contains(layout.header), "\(label) landing name must stay inside the margins: \(layout.header)")
                XCTAssertTrue(content.contains(layout.footer), "\(label) footer must stay inside the margins: \(layout.footer)")
                if family == .systemLarge, let lowest = layout.rows.map(\.maxY).max(), let tallest = layout.rows.map(\.height).max() {
                    XCTAssertLessThan(layout.footer.minY - lowest, tallest + 8, "\(label) should use its height for more departures instead of leaving a gap")
                }
            }
        }
        // A waiting-for-GPS label costs no row in small and medium widgets.
        entry.locationLabel = "Last location · waiting for GPS"
        XCTAssertGreaterThanOrEqual(try measure(entry, family: .systemSmall, size: CGSize(width: 158, height: 158)).rows.count, 2)
        XCTAssertGreaterThanOrEqual(try measure(entry, family: .systemMedium, size: CGSize(width: 338, height: 158)).rows.count, 3)
        // Larger text shows fewer departures, never departures outside the widget.
        let large = try measure(entry, family: .systemMedium, size: CGSize(width: 338, height: 158), textSize: .accessibility1)
        XCTAssertGreaterThanOrEqual(large.rows.count, 1)
        XCTAssertLessThan(large.rows.count, 3)
        for row in large.rows { XCTAssertLessThanOrEqual(row.maxY, large.footer.minY + 0.5) }
    }

    private func fixture(count: Int) throws -> (DisplayData, Date) {
        struct Fixture: Decodable { let schedule: DisplayData }
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<3 { root.deleteLastPathComponent() }
        var data = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: root.appendingPathComponent("test/fixtures/schedule-contract.json"))).schedule
        let template = data.departures[0]
        data.departures = (0..<count).map { index in
            var departure = template
            departure.tripId = "widget-\(index)"
            departure.seconds = 32400 + Double(index) * 180
            departure.boatAssignment = index + 1
            departure.destination = index == 1 ? "Pier C" : "East 34th Street / Midtown East"
            departure.outOfService = index == 1
            departure.crewShuttle = index == 2
            departure.crewBoats = index == 2 ? ["A26", "D10"] : nil
            return departure
        }
        return (data, try XCTUnwrap(ServiceClock.instant("2026-09-04T12:50:00Z")))
    }

    /// SwiftUI builds its accessibility tree only for assistive technology or UI automation,
    /// so the test process turns automation on, as XCUITest does for an app under test.
    private func enableAccessibilityTree() throws {
        guard let library = dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW),
              let symbol = dlsym(library, "_AXSSetAutomationEnabled") else { throw XCTSkip("Accessibility automation is unavailable") }
        unsafeBitCast(symbol, to: (@convention(c) (Int32) -> Void).self)(1)
    }

    /// Lays the extension's view out in a window and reads element frames from its accessibility tree.
    private func measure(_ entry: NearbyEntry, family: WidgetFamily, size: CGSize, textSize: DynamicTypeSize = .large) throws -> (header: CGRect, footer: CGRect, rows: [CGRect]) {
        try enableAccessibilityTree()
        let host = UIHostingController(rootView: NearbyWidgetView(entry: entry, familyOverride: family)
            .environment(\.dynamicTypeSize, textSize)
            .padding(16).frame(width: size.width, height: size.height))
        // Widgets have no safe area; the test window's status bar inset would shift the content.
        host.safeAreaRegions = []
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 400, height: 500))
        window.rootViewController = host
        window.makeKeyAndVisible()
        host.view.frame = CGRect(origin: .zero, size: size)
        host.view.layoutIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.5))
        defer { window.isHidden = true }
        var frames: [String: [CGRect]] = [:]
        func visit(_ node: NSObject, depth: Int) {
            guard depth < 40 else { return }
            // SwiftUI's nodes answer accessibilityIdentifier without declaring UIAccessibilityIdentification.
            if node.responds(to: NSSelectorFromString("accessibilityIdentifier")), let id = node.value(forKey: "accessibilityIdentifier") as? String, !id.isEmpty {
                frames[id, default: []].append(window.convert(node.accessibilityFrame, from: nil))
            }
            let count = node.accessibilityElementCount()
            let children = (node.accessibilityElements as? [NSObject]) ?? (count > 0 && count != NSNotFound ? (0..<count).compactMap { node.accessibilityElement(at: $0) as? NSObject } : [])
            for child in children { visit(child, depth: depth + 1) }
            for view in (node as? UIView)?.subviews ?? [] { visit(view, depth: depth + 1) }
        }
        visit(host.view, depth: 0)
        let header = try XCTUnwrap(frames["widgetLandingName"]?.first, "landing name missing in \(frames.keys)")
        let footer = try XCTUnwrap(frames["widgetUpdatedAt"]?.first, "footer missing in \(frames.keys)")
        let rows = frames.filter { $0.key.hasPrefix("widgetDeparture_") }.flatMap(\.value).sorted { $0.minY < $1.minY }
        return (header, footer, rows)
    }

    private func render(_ entry: NearbyEntry, family: WidgetFamily, size: CGSize, name: String,
                        dark: Bool = false, textSize: DynamicTypeSize = .medium, renderingMode: WidgetRenderingMode = .fullColor) throws {
        let view = NearbyWidgetView(entry: entry, familyOverride: family, renderingModeOverride: renderingMode)
            .environment(\.dynamicTypeSize, textSize)
            .environment(\.colorScheme, dark ? .dark : .light)
            .padding(16).frame(width: size.width, height: size.height)
            .background(dark ? Color.black : Color.white)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let rendered = try XCTUnwrap(renderer.uiImage)
        let attachment = XCTAttachment(image: rendered)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
