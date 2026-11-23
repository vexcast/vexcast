fn main() {
    // macOS: libobs.framework and the OBS dylibs ship in Vexcast.app/Contents/Frameworks.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
    }
    tauri_build::build()
}
