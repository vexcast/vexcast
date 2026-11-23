//! Vexcast desktop shell.
//!
//! Starts the Vexcast core in-process (local HTTP + WebSocket API), then opens
//! the web UI, which talks to the core through that API. The UI learns the
//! port and token through the `get_core_info` command.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{Manager, RunEvent};
use vexcast_core::{CoreConfig, CoreHandle};

/// Port and API token of the in-process core, handed to the UI.
#[derive(Clone, Serialize)]
pub struct CoreInfo {
    pub port: u16,
    pub token: String,
}

/// Running core, kept so it can be shut down cleanly on exit.
struct CoreState(Mutex<Option<CoreHandle>>);

#[tauri::command]
fn get_core_info(info: tauri::State<'_, CoreInfo>) -> CoreInfo {
    info.inner().clone()
}

/// Whether the built-in updater can replace this install. On Linux only the AppImage can
/// update itself; the .deb is updated by downloading the new package.
#[tauri::command]
fn can_self_update() -> bool {
    !cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some()
}

/// Bring the existing window to the front (used by single-instance).
fn focus_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// If an FFmpeg binary ships with the app (`resources/ffmpeg[.exe]`), point the
/// core at it through `VEXCAST_FFMPEG` (unless the user already set it).
fn use_bundled_ffmpeg(app: &tauri::AppHandle) {
    if std::env::var_os("VEXCAST_FFMPEG").is_some() {
        return;
    }
    let Ok(dir) = app.path().resource_dir() else { return };
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let candidate = dir.join("resources").join(name);
    if candidate.is_file() {
        log::info!("using bundled FFmpeg at {}", candidate.display());
        std::env::set_var("VEXCAST_FFMPEG", &candidate);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // Must be registered first so a second launch focuses the running app.
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| focus_main(app)))
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    let app = builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            use_bundled_ffmpeg(app.handle());
            let config = CoreConfig {
                app_version: env!("CARGO_PKG_VERSION").into(),
                ..Default::default()
            };
            let handle = tauri::async_runtime::block_on(vexcast_core::start(config))
                .map_err(|e| format!("failed to start the Vexcast core: {e:#}"))?;
            log::info!("Vexcast core running on port {}", handle.port);
            app.manage(CoreInfo { port: handle.port, token: handle.token.clone() });
            app.manage(CoreState(Mutex::new(Some(handle))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_core_info, can_self_update])
        .build(tauri::generate_context!())
        .expect("error while building the Vexcast app");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app.try_state::<CoreState>() {
                let handle = state.0.lock().ok().and_then(|mut h| h.take());
                if let Some(handle) = handle {
                    tauri::async_runtime::block_on(handle.shutdown());
                }
            }
        }
    });
}
