//! Vexcast core library.
//!
//! Runs the local API server, the compositor/encoding engine, chat connectors,
//! alerts, the chat bot and the local-AI integrations. Used in-process by the
//! desktop app (Tauri) and by the headless `vexcast-server` binary.

pub mod ai;
pub mod alert_pack;
pub mod alerts;
pub mod api;
pub mod bot;
pub mod chat;
pub mod core;
pub mod counters;
pub mod model;
pub mod mcp;
pub mod giveaway;
pub mod live_text;
pub mod loyalty;
#[cfg(feature = "obs")]
pub mod macros;
#[cfg(feature = "obs")]
pub mod health;
pub mod oauth;
pub mod oauth_config;
pub mod obs;
pub mod pairing;
pub mod phonecam;
pub mod polls;
pub mod remote;
pub mod twitch_events;
pub mod update;
pub mod util;
pub mod viewers;
pub mod sessions;
pub mod songs;
pub mod widgets;

use std::path::PathBuf;
use std::sync::Arc;

pub use crate::core::Core;

pub const DEFAULT_PORT: u16 = 7420;

#[derive(Debug, Clone)]
pub struct CoreConfig {
    /// 0 = default 7420 (falls back to a free port if taken).
    pub port: u16,
    /// Where config.json and caches live. None = OS config dir / vexcast.
    pub data_dir: Option<PathBuf>,
    /// Folder with the built web UI, served at /app/ (headless mode).
    pub ui_dir: Option<PathBuf>,
    pub app_version: String,
    /// Bind on all interfaces (needed for the mobile remote). Default true.
    pub lan: bool,
}

impl Default for CoreConfig {
    fn default() -> Self {
        Self { port: 0, data_dir: None, ui_dir: None, app_version: env!("CARGO_PKG_VERSION").to_string(), lan: true }
    }
}

pub struct CoreHandle {
    pub port: u16,
    pub token: String,
    pub core: Arc<Core>,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    server_task: Option<tokio::task::JoinHandle<()>>,
}

impl CoreHandle {
    pub async fn shutdown(mut self) {
        self.core.shutdown();
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(t) = self.server_task.take() {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(3), t).await;
        }
    }
}

/// Start the core: load config, start the engine and the API server.
pub async fn start(config: CoreConfig) -> anyhow::Result<CoreHandle> {
    let data_dir = config
        .data_dir
        .clone()
        .unwrap_or_else(|| dirs::config_dir().unwrap_or_else(std::env::temp_dir).join("vexcast"));
    std::fs::create_dir_all(&data_dir)?;

    let want_port = if config.port == 0 { DEFAULT_PORT } else { config.port };
    let host = if config.lan { "0.0.0.0" } else { "127.0.0.1" };
    let listener = match tokio::net::TcpListener::bind((host, want_port)).await {
        Ok(l) => l,
        Err(e) => {
            tracing::warn!("port {want_port} unavailable ({e}), using a random free port");
            tokio::net::TcpListener::bind((host, 0)).await?
        }
    };
    let port = listener.local_addr()?.port();

    let core = Core::new(data_dir, config.app_version.clone(), port)?;
    core.clone().spawn_background();

    let token = core.token();
    let app = api::router(core.clone(), config.ui_dir.clone());
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let server_task = tokio::spawn(async move {
        let res = axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>())
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await;
        if let Err(e) = res {
            tracing::error!("api server stopped: {e}");
        }
    });
    tracing::info!("Vexcast core listening on http://{host}:{port}");

    Ok(CoreHandle { port, token, core, shutdown_tx: Some(tx), server_task: Some(server_task) })
}
