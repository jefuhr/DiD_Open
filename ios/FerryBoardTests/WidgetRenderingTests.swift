import XCTest
import SwiftUI
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

    private func render(_ entry: NearbyEntry, family: WidgetFamily, size: CGSize, name: String,
                        dark: Bool = false, textSize: DynamicTypeSize = .medium) throws {
        let view = NearbyWidgetView(entry: entry, familyOverride: family)
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
