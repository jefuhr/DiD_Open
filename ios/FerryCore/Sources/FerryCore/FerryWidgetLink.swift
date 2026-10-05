import Foundation

public enum FerryWidgetLink: Equatable {
    case nearby, landing(Int)

    public init?(_ url: URL) {
        guard url.scheme?.lowercased() == "ferryboard" else { return nil }
        if url.host == "nearby", url.path.isEmpty || url.path == "/" { self = .nearby; return }
        guard url.host == "landing", url.pathComponents.count == 2,
              let id = Int(url.lastPathComponent), id > 0 else { return nil }
        self = .landing(id)
    }
}
