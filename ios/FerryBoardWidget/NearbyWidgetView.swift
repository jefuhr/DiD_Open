import SwiftUI
import WidgetKit
import FerryCore

struct NearbyEntry: TimelineEntry {
    let date: Date
    var landingID: Int?
    var landingName = "Nearby Ferries"
    var locationLabel = "Nearest landing"
    var updatedAt: Date?
    var rows: [WidgetDeparture] = []
    var message: String?
    var saved = false
    var options = WidgetOptions()

    /// The provider labels a location it could not refresh; widgets mark it so it is not mistaken for current.
    var staleLocation: Bool { locationLabel.hasPrefix("Last location") || locationLabel == "Location needs refresh" }

    var url: URL {
        if let landingID { return URL(string: "ferryboard://landing/\(landingID)")! }
        return URL(string: "ferryboard://nearby")!
    }
}

struct NearbyWidgetView: View {
    let entry: NearbyEntry
    var familyOverride: WidgetFamily?
    var renderingModeOverride: WidgetRenderingMode?
    @Environment(\.widgetFamily) private var systemFamily
    @Environment(\.widgetRenderingMode) private var systemRenderingMode
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.colorScheme) private var systemScheme
    private var family: WidgetFamily { familyOverride ?? systemFamily }
    private var theme: FerryTheme? { FerryTheme.all.first { $0.id == entry.options.theme } }
    /// Tinted and clear Home Screens draw every view in one color over their own
    /// background, so theme colors and the theme's color scheme apply only in full color.
    private var fullColor: Bool { (renderingModeOverride ?? systemRenderingMode) == .fullColor }
    private var accent: Color { fullColor ? theme?.accent ?? .cyan : .primary }
    private var resolvedTextSize: DynamicTypeSize {
        guard !textSize.isAccessibilitySize else { return textSize }
        if entry.options.textSize == "compact" { return .medium }
        if entry.options.textSize == "larger" { return max(textSize, .xxLarge) }
        return textSize
    }

    /// Each size starts a little above what it usually holds; the layout keeps the most
    /// rows that fit, so larger text shows fewer. Every candidate tried costs a layout
    /// pass for each timeline entry, so the lists stay short.
    private var candidateCounts: [Int] {
        let maximum: Int
        switch family {
        case .systemSmall: maximum = 3
        case .systemMedium: maximum = 4
        default: maximum = NearbyWidgetBoard.maximumRows
        }
        return NearbyWidgetBoard.fitCandidates(available: entry.rows.count, maximum: maximum)
    }

    /// Short widgets mark the location state with an icon so it never costs a row of departures.
    private var showsLocationLabel: Bool { family == .systemLarge || family == .systemExtraLarge }
    private var locationSymbol: String {
        if entry.staleLocation { return "location.slash.fill" }
        return entry.options.automaticLanding ? "location.fill" : "mappin.circle.fill"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Image(systemName: locationSymbol).font(.caption2)
                    .foregroundStyle(entry.staleLocation && fullColor ? .orange : accent)
                    .accessibilityLabel(entry.locationLabel)
                Text(entry.landingName).font(.system(family == .systemLarge ? .subheadline : .caption, design: .rounded, weight: .bold)).lineLimit(1)
                    .widgetAccentable().accessibilityIdentifier("widgetLandingName")
            }.layoutPriority(1)
            if showsLocationLabel {
                Text(entry.locationLabel).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1).layoutPriority(1)
            }
            if let message = entry.message {
                Spacer(minLength: 0)
                Text(message).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            } else {
                ViewThatFits(in: .vertical) {
                    ForEach(candidateCounts, id: \.self) { limit in rows(limit: limit).fixedSize(horizontal: false, vertical: true) }
                }
                .frame(maxHeight: .infinity, alignment: .top)
            }
            // The header and footer are sized first; departures fill what remains.
            footer.layoutPriority(1)
        }
        .containerBackground(for: .widget) { background }
        .environment(\.colorScheme, fullColor ? theme?.scheme ?? systemScheme : systemScheme)
        .dynamicTypeSize(resolvedTextSize)
        .widgetURL(entry.url)
    }

    /// A faint wash from the top gives a flat theme color some depth.
    @ViewBuilder private var background: some View {
        if let theme {
            theme.background.overlay(LinearGradient(colors: [Color.white.opacity(theme.dark ? 0.07 : 0.45), .clear], startPoint: .top, endPoint: .bottom))
        } else { Color(.systemBackground) }
    }

    private func rows(limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(entry.rows.prefix(limit).enumerated()), id: \.element.id) { index, row in
                Group {
                    if family == .systemLarge {
                        Link(destination: entry.url) { departure(row) }.buttonStyle(.plain)
                    } else { departure(row) }
                }.accessibilityIdentifier("widgetDeparture_\(index)")
            }
        }
    }

    /// The dot uses the theme accent for a fresh download and orange for a saved schedule.
    private var footer: some View {
        HStack(spacing: 3) {
            if let updated = entry.updatedAt {
                Circle().fill(entry.saved ? Color.orange : accent).frame(width: 5, height: 5).padding(.trailing, 1)
                Text(entry.saved ? "Saved" : "Updated")
                Text(ServiceClock.time(seconds: ServiceClock.parts(updated).seconds, twelveHour: entry.options.twelveHour)).monospacedDigit()
            } else { Text("Tap to set up location") }
            Spacer(minLength: 0)
            Image(systemName: "ferry.fill").accessibilityHidden(true)
        }
        .font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
        .accessibilityElement(children: .combine).accessibilityIdentifier("widgetUpdatedAt")
    }

    private func departure(_ row: WidgetDeparture) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text((row.estimated ? "≈" : "") + row.time).font(.system(family == .systemLarge ? .caption : .caption2, design: .monospaced, weight: .bold))
                Text(row.route).font(.caption2.bold()).foregroundStyle(accent).widgetAccentable()
                if family != .systemSmall {
                    Text(row.destination).font(family == .systemLarge ? .caption : .caption2).lineLimit(1)
                }
                // Countdowns keep to a right-aligned column in every size.
                Spacer(minLength: 0)
                if entry.options.showCountdown {
                    Text(row.countdown).font(.system(size: 10, weight: .semibold)).lineLimit(1)
                        .foregroundStyle(row.estimated && fullColor ? .green : .secondary)
                }
            }
            if family == .systemSmall { Text(row.destination).font(.caption2).lineLimit(1) }
            if !row.detail.isEmpty { Text(row.detail).font(.system(size: family == .systemLarge ? 10 : 9)).foregroundStyle(.secondary).lineLimit(1) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(row.estimated ? "Estimated" : "Scheduled") \(row.time), \(row.route), \(row.destination), \(entry.options.showCountdown ? row.countdown : ""), \(row.detail)")
    }
}
