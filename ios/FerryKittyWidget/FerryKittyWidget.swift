import SwiftUI
import WidgetKit
import FerryCore
import AppIntents

@main
struct FerryKittyWidget: Widget {
    // Existing Home Screen widgets and timeline reloads use this stable kind.
    let kind = "NearbyFerries"
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: FerryWidgetConfiguration.self, provider: NearbyProvider()) { entry in NearbyWidgetView(entry: entry) }
            .configurationDisplayName("Nearby Ferries")
            .description("Nearest or fixed landing, with your choice of operators and departure information.")
            .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
