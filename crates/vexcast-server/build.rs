fn main() {
    // macOS: link args from libobs' build script don't reach this binary, so add the rpath
    // that finds libobs.framework next to the executable (flat runtime layout).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path");
    }
}
