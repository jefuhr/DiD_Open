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

    var url: URL {
        if let landingID { return URL(string: "ferryboard://landing/\(landingID)")! }
        return URL(string: "ferryboard://nearby")!
    }
}

struct NearbyWidgetView: View {
    let entry: NearbyEntry
    var familyOverride: WidgetFamily?
    @Environment(\.widgetFamily) private var systemFamily
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.colorScheme) private var systemScheme
    private var family: WidgetFamily { familyOverride ?? systemFamily }
    private var theme: FerryTheme? { FerryTheme.all.first { $0.id == entry.options.theme } }
    private var resolvedTextSize: DynamicTypeSize {
        guard !textSize.isAccessibilitySize else { return textSize }
        if entry.options.textSize == "compact" { return .medium }
        if entry.options.textSize == "larger" { return max(textSize, .xxLarge) }
        return textSize
    }

    private var limit: Int {
        if resolvedTextSize.isAccessibilitySize { return family == .systemLarge ? 4 : 1 }
        if resolvedTextSize >= .xxLarge { return family == .systemLarge ? 5 : family == .systemMedium ? 2 : 1 }
        switch family {
        case .systemSmall: return entry.locationLabel == "Nearest landing" ? 2 : 1
        case .systemLarge: return 7
        default: return 3
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Image(systemName: entry.options.automaticLanding ? "location.fill" : "mappin.circle.fill").font(.caption2).foregroundStyle(theme?.accent ?? .cyan)
                Text(entry.landingName).font(.system(family == .systemLarge ? .subheadline : .caption, design: .rounded, weight: .bold)).lineLimit(1)
            }
            if family != .systemSmall || entry.locationLabel != "Nearest landing" {
                Text(entry.locationLabel).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
            }
            if let message = entry.message {
                Spacer(minLength: 0)
                Text(message).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            } else {
                ForEach(Array(entry.rows.prefix(limit))) { row in
                    if family == .systemLarge {
                        Link(destination: entry.url) { departure(row) }.buttonStyle(.plain)
                    } else { departure(row) }
                }
                Spacer(minLength: 0)
            }
            HStack(spacing: 3) {
                if let updated = entry.updatedAt {
                    Text(entry.saved ? "Saved" : "Updated")
                    Text(ServiceClock.time(seconds: ServiceClock.parts(updated).seconds, twelveHour: entry.options.twelveHour)).monospacedDigit()
                } else { Text("Tap to set up location") }
                Spacer(minLength: 0)
                Image(systemName: "ferry.fill")
            }.font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
        }
        .containerBackground(for: .widget) { theme?.background ?? Color(.systemBackground) }
        .environment(\.colorScheme, theme?.scheme ?? systemScheme)
        .dynamicTypeSize(resolvedTextSize)
        .widgetURL(entry.url)
    }

    private func departure(_ row: WidgetDeparture) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text((row.estimated ? "≈" : "") + row.time).font(.system(family == .systemLarge ? .caption : .caption2, design: .monospaced, weight: .bold))
                Text(row.route).font(.caption2.bold()).foregroundStyle(theme?.accent ?? .cyan)
                if family != .systemSmall {
                    Text(row.destination).font(family == .systemLarge ? .caption : .caption2).lineLimit(1)
                    Spacer(minLength: 0)
                }
                if entry.options.showCountdown {
                    Text(row.countdown).font(.system(size: 10, weight: .semibold)).lineLimit(1)
                        .foregroundStyle(row.estimated ? .green : .secondary)
                }
            }
            if family == .systemSmall { Text(row.destination).font(.caption2).lineLimit(1) }
            if !row.detail.isEmpty { Text(row.detail).font(.system(size: family == .systemLarge ? 10 : 9)).foregroundStyle(.secondary).lineLimit(1) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(row.estimated ? "Estimated" : "Scheduled") \(row.time), \(row.route), \(row.destination), \(entry.options.showCountdown ? row.countdown : ""), \(row.detail)")
    }
}
