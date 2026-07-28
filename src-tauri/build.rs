fn main() {
    tauri_build::build();

    #[cfg(target_os = "macos")]
    {
        let profile = "release"; // Swift bridge only built in release mode
        let lib_dir = format!(
            "{}/native/VisionBridge/.build/arm64-apple-macosx/{}",
            std::env::var("CARGO_MANIFEST_DIR").unwrap(),
            profile
        );
        println!("cargo:rustc-link-search=native={}", lib_dir);

        // Command Line Tools (no full Xcode) ships the Swift runtime at
        // /usr/lib/swift but does NOT include the back-deployment
        // compatibility shims (swiftCompatibility56, etc.) that only exist
        // inside Xcode.app. The Swift package is built with
        // -disable-autolinking-runtime-compatibility so those shims are
        // never requested by the linker in the first place.
        println!("cargo:rustc-link-search=native=/usr/lib/swift");

        println!("cargo:rustc-link-lib=static=VisionBridge");
        println!("cargo:rustc-link-lib=framework=Vision");
        println!("cargo:rustc-link-lib=framework=CoreML");
        println!("cargo:rustc-link-lib=framework=CoreVideo");
        println!("cargo:rustc-link-lib=framework=CoreImage");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
}
