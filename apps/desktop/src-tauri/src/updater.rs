//! Update popup, run entirely from the Rust side.
//!
//! On start (and when the UI asks), it checks the signed `latest.json` and, if
//! there is a new version, opens its own small window (`public/updater.html`,
//! plain HTML/JS that shares no code with the main UI). So a broken UI can
//! still be fixed by the next update.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};

const LABEL: &str = "updater";
const RELEASES: &str = "https://github.com/vexcast/vexcast/releases/latest";

/// The update the popup is showing, and whether it's being installed.
#[derive(Default)]
pub struct UpdaterState {
    update: Mutex<Option<Update>>,
    busy: Mutex<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDetails {
    current: String,
    version: String,
    notes: String,
    date: Option<String>,
    /// False for installs the updater can't replace (Linux .deb): the popup offers the download page.
    can_install: bool,
    /// Live or recording right now: installing restarts the app.
    busy_output: bool,
    language: String,
    release_url: String,
}

fn core(app: &AppHandle) -> Option<std::sync::Arc<vexcast_core::core::Core>> {
    let state = app.try_state::<crate::CoreState>()?;
    let guard = state.0.lock().ok()?;
    guard.as_ref().map(|h| h.core.clone())
}

fn skip_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("update-skip"))
}

fn skipped(app: &AppHandle) -> Option<String> {
    std::fs::read_to_string(skip_file(app)?).ok().map(|s| s.trim().to_string())
}

/// `VEXCAST_UPDATER_FORCE=1` offers the latest release even when it isn't newer (to try the popup).
fn forced() -> bool {
    std::env::var_os("VEXCAST_UPDATER_FORCE").is_some()
}

async fn check(app: &AppHandle) -> anyhow::Result<Option<Update>> {
    let mut b = app.updater_builder().timeout(Duration::from_secs(20));
    if forced() {
        b = b.version_comparator(|_, _| true);
    }
    Ok(b.build()?.check().await?)
}

/// Startup check: waits a moment, then opens the popup if there's an update the user didn't skip.
pub fn spawn_startup_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let enabled = core(&app).map(|c| c.read(|s| s.general.check_for_updates)).unwrap_or(true);
        if !enabled && !forced() {
            return;
        }
        if cfg!(debug_assertions) && !forced() {
            return;
        }
        match check(&app).await {
            Ok(Some(u)) => {
                if skipped(&app).as_deref() == Some(u.version.as_str()) && !forced() {
                    log::info!("update {} skipped by the user", u.version);
                    return;
                }
                show(&app, u).await;
            }
            Ok(None) => log::info!("no update available"),
            Err(e) => log::warn!("update check failed: {e:#}"),
        }
    });
}

/// Notes of a GitHub release (`latest.json` may not carry them).
async fn github_notes(app: &AppHandle, version: &str) -> Option<String> {
    let c = core(app)?;
    let url = format!("https://api.github.com/repos/vexcast/vexcast/releases/tags/v{version}");
    let r = c.http.get(url).header("Accept", "application/vnd.github+json").timeout(Duration::from_secs(10)).send().await.ok()?;
    let v: Value = r.error_for_status().ok()?.json().await.ok()?;
    v["body"].as_str().map(String::from)
}

async fn show(app: &AppHandle, mut update: Update) {
    if update.body.as_deref().map_or(true, |b| b.trim().is_empty()) {
        update.body = github_notes(app, &update.version).await;
    }
    let state = app.state::<UpdaterState>();
    *state.update.lock().unwrap() = Some(update);
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.eval("window.vxReload && window.vxReload()");
        let _ = w.unminimize();
        let _ = w.set_focus();
        return;
    }
    let es = language(app) == "es";
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("updater.html".into()))
        .title(if es { "Actualización de Vexcast" } else { "Vexcast update" })
        .inner_size(480.0, 560.0)
        .min_inner_size(420.0, 420.0)
        .center()
        .focused(true)
        .always_on_top(true)
        .theme(Some(tauri::Theme::Dark))
        .background_color(tauri::window::Color(7, 8, 15, 255))
        .build();
    if let Err(e) = built {
        log::error!("could not open the update window: {e}");
    }
}

fn language(app: &AppHandle) -> String {
    core(app).map(|c| c.read(|s| s.general.language.clone())).filter(|l| !l.is_empty()).unwrap_or_else(|| "es".into())
}

/// Sends a progress/state message to the popup.
fn push(app: &AppHandle, msg: Value) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.eval(&format!("window.vxUpdate && window.vxUpdate({msg})"));
    }
}

#[tauri::command]
pub fn update_details(app: AppHandle, state: tauri::State<'_, UpdaterState>) -> Option<UpdateDetails> {
    let guard = state.update.lock().unwrap();
    let u = guard.as_ref()?;
    let busy_output = core(&app).map(|c| { let st = c.engine.status(); st.streaming || st.recording }).unwrap_or(false);
    Some(UpdateDetails {
        current: u.current_version.clone(),
        version: u.version.clone(),
        notes: u.body.clone().unwrap_or_default(),
        date: u.date.map(|d| d.date().to_string()),
        can_install: crate::can_self_update(),
        busy_output,
        language: language(&app),
        release_url: format!("https://github.com/vexcast/vexcast/releases/tag/v{}", u.version),
    })
}

/// Checks now and opens the popup. Returns false when there's no update.
#[tauri::command]
pub async fn update_open(app: AppHandle) -> Result<bool, String> {
    match check(&app).await.map_err(|e| format!("{e:#}"))? {
        Some(u) => {
            show(&app, u).await;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Downloads (reporting progress to the popup), stops the core and installs, then restarts.
#[tauri::command]
pub async fn update_install(app: AppHandle, state: tauri::State<'_, UpdaterState>) -> Result<(), String> {
    {
        let mut busy = state.busy.lock().unwrap();
        if *busy {
            return Ok(());
        }
        *busy = true;
    }
    let update = state.update.lock().unwrap().clone();
    let Some(update) = update else {
        *state.busy.lock().unwrap() = false;
        return Err("no update".into());
    };
    let result = install(&app, update).await;
    *state.busy.lock().unwrap() = false;
    if let Err(e) = &result {
        log::error!("update failed: {e}");
    }
    result
}

#[tauri::command]
pub fn update_restart(app: AppHandle) {
    app.restart();
}

async fn install(app: &AppHandle, update: Update) -> Result<(), String> {
    let mut done: u64 = 0;
    let mut last = std::time::Instant::now() - Duration::from_secs(1);
    push(app, json!({ "phase": "download", "done": 0, "total": null }));
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                // The popup doesn't need every chunk.
                if last.elapsed() >= Duration::from_millis(120) || total == Some(done) {
                    last = std::time::Instant::now();
                    push(app, json!({ "phase": "download", "done": done, "total": total }));
                }
            },
            || {},
        )
        .await
        .map_err(|e| {
            push(app, json!({ "phase": "error", "error": e.to_string(), "restart": false }));
            e.to_string()
        })?;
    push(app, json!({ "phase": "install" }));
    // Stop streaming/recording and the engine cleanly before the installer replaces the files.
    let handle = app.try_state::<crate::CoreState>().and_then(|s| s.0.lock().ok().and_then(|mut h| h.take()));
    let stopped = handle.is_some();
    if let Some(handle) = handle {
        handle.shutdown().await;
    }
    // On Windows this starts the installer and quits the app; it opens the new version when done.
    if let Err(e) = update.install(bytes) {
        // The engine is already stopped: the popup offers to restart Vexcast.
        push(app, json!({ "phase": "error", "error": e.to_string(), "restart": stopped }));
        return Err(e.to_string());
    }
    push(app, json!({ "phase": "restart" }));
    tokio::time::sleep(Duration::from_millis(400)).await;
    app.restart();
}

/// Don't offer this version again on start (a manual check still shows it).
#[tauri::command]
pub fn update_skip(app: AppHandle, version: String) {
    if let Some(f) = skip_file(&app) {
        if let Some(dir) = f.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(f, version);
    }
    update_close(app);
}

#[tauri::command]
pub fn update_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}

#[tauri::command]
pub fn update_open_page(app: AppHandle, url: Option<String>) {
    let url = url.filter(|u| u.starts_with("https://github.com/vexcast/vexcast/")).unwrap_or_else(|| RELEASES.into());
    let _ = app.opener().open_url(url, None::<&str>);
}
