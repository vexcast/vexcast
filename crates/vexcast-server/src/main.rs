//! Headless Vexcast: the full core plus the web UI at http://localhost:7420/app/
//!
//! Usage: vexcast-server [--port 7420] [--data-dir DIR] [--ui-dir DIR] [--local-only]

use std::path::PathBuf;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,vexcast_core=info".into()))
        .init();

    let mut cfg = vexcast_core::CoreConfig::default();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--port" | "-p" => cfg.port = args.next().and_then(|v| v.parse().ok()).unwrap_or(0),
            "--data-dir" => cfg.data_dir = args.next().map(PathBuf::from),
            "--ui-dir" => cfg.ui_dir = args.next().map(PathBuf::from),
            "--local-only" => cfg.lan = false,
            "--version" | "-V" => {
                println!("vexcast-server {}", env!("CARGO_PKG_VERSION"));
                return Ok(());
            }
            "--help" | "-h" => {
                println!("vexcast-server [--port N] [--data-dir DIR] [--ui-dir DIR] [--local-only]");
                return Ok(());
            }
            other => eprintln!("argumento desconocido: {other}"),
        }
    }

    let handle = vexcast_core::start(cfg).await?;
    println!("\n  Vexcast {} en marcha", env!("CARGO_PKG_VERSION"));
    println!("  Interfaz:  http://localhost:{}/app/", handle.port);
    println!("  Widgets:   http://localhost:{}/widgets/", handle.port);
    println!("  Token API: {}\n", handle.token);

    tokio::signal::ctrl_c().await?;
    println!("Cerrando…");
    handle.shutdown().await;
    Ok(())
}
