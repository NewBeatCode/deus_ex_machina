// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "VisionBridge",
    platforms: [.macOS(.v12)],
    products: [
        .library(name: "VisionBridge", type: .static, targets: ["VisionBridge"])
    ],
    targets: [
        .target(
            name: "VisionBridge",
            path: "Sources/VisionBridge",
            swiftSettings: [
                // Command Line Tools installs (no full Xcode) do not ship the
                // Swift back-deployment compatibility shims (swiftCompatibility56,
                // swiftCompatibilityPacks, etc.). Those shims are only auto-linked
                // to support running on OLDER Swift runtimes than the one used to
                // compile. Since this app targets macOS 12+ exclusively (see
                // `platforms` above) and is never back-deployed to older Swift
                // runtimes, disabling this autolinking is safe and required for
                // the static library to link correctly on machines without full
                // Xcode installed. This must stay baked in here (not passed as a
                // manual `-Xswiftc` flag) so `swift build` produces a linkable
                // archive regardless of who runs it or from which script.
                .unsafeFlags(["-disable-autolinking-runtime-compatibility"])
            ]
        )
    ]
)
