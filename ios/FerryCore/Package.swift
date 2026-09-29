// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "FerryCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [.library(name: "FerryCore", targets: ["FerryCore"])],
    targets: [
        .target(name: "FerryCore"),
        .testTarget(name: "FerryCoreTests", dependencies: ["FerryCore"])
    ]
)
