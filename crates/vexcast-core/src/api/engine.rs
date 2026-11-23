//! Routes backed by the libobs engine.

use super::{ApiError, ApiResult, St};
use crate::obs::model::*;
use crate::obs::{Engine, PreviewKey, PreviewQuality};
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post, put};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

/// Run a blocking engine call off the async runtime.
async fn eng<T: Send + 'static>(core: &St, f: impl FnOnce(&Arc<Engine>) -> anyhow::Result<T> + Send + 'static) -> ApiResult<T> {
    let e = core.engine.clone();
    tokio::task::spawn_blocking(move || f(&e)).await.map_err(|e| ApiError::bad(e.to_string()))?.map_err(ApiError::from)
}

/// Theme fonts the text sources ask for (Streamlabs `custom_font`): file, family, installed.
fn wanted_fonts(c: &St) -> Vec<(String, std::path::PathBuf, String, bool)> {
    use crate::obs::fonts;
    let mut out: Vec<(String, std::path::PathBuf, String, bool)> = vec![];
    for s in c.engine.snapshot().sources.iter().filter(|s| s.kind.starts_with("text_")) {
        let Some(custom) = s.settings["custom_font"].as_str().filter(|f| !f.trim().is_empty()) else { continue };
        if out.iter().any(|x| x.0 == custom) {
            continue;
        }
        if let Some(path) = fonts::find_font(&c.data_dir, custom) {
            if let Some(family) = fonts::family_name(&path) {
                let ok = fonts::installed(&family);
                out.push((custom.to_string(), path, family, ok));
            }
        }
    }
    out
}

/// Fonts the scenes' texts use and whether Windows has them.
async fn theme_fonts(State(c): State<St>) -> ApiResult<Json<Value>> {
    let list = eng(&c, {
        let c = c.clone();
        move |_| Ok(wanted_fonts(&c))
    })
    .await?;
    Ok(Json(json!(list.iter().map(|(file, _, family, installed)| json!({ "file": file, "family": family, "installed": installed, "pending": crate::obs::fonts::installed_this_run(family) })).collect::<Vec<_>>())))
}

/// Install the theme's fonts for this Windows user and switch the texts to them.
async fn install_theme_fonts(State(c): State<St>) -> ApiResult<Json<Value>> {
    let c2 = c.clone();
    let done = eng(&c, move |e| {
        let mut done = vec![];
        for (file, path, family, installed) in wanted_fonts(&c2) {
            // Only install: the running engine can't draw a font installed now (the text would
            // turn invisible); the texts switch to it on the next start.
            let _ = (&path, &e, &file);
            if !installed {
                crate::obs::fonts::install_for_user(&path)?;
            }
            done.push(family);
        }
        Ok(done)
    })
    .await?;
    Ok(Json(json!({ "installed": done, "restart": true })))
}

pub fn routes(r: Router<St>) -> Router<St> {
    r.route("/stats", get(stats))
        .route("/obs/plugins", get(plugins))
        .route("/obs/source-types", get(source_types))
        .route("/obs/source-types/{kind}/defaults", get(type_defaults))
        .route("/obs/filter-types", get(filter_types))
        .route("/obs/transition-types", get(transition_types))
        .route("/obs/encoders", get(encoders))
        .route("/obs/encoders/{id}/properties", post(encoder_properties))
        .route("/obs/services", get(services))
        .route("/obs/audio-devices", get(audio_devices))
        .route("/obs/monitoring-devices", get(monitoring_devices))
        .route("/collections", post(create_collection))
        .route("/collections/obs", get(obs_collections))
        .route("/collections/import", post(import_collection))
        .route("/collections/install-theme", post(install_theme))
        .route("/collections/setup-devices", post(setup_devices))
        .route("/fonts/theme", get(theme_fonts).post(install_theme_fonts))
        .route("/collections/export-overlay", post(export_overlay))
        .route("/alerts/split-sources", post(split_alert_sources))
        .route("/collections/{name}", patch(rename_collection).delete(delete_collection))
        .route("/collections/{name}/activate", post(switch_collection))
        .route("/collections/{name}/duplicate", post(duplicate_collection))
        .route("/scenes", post(create_scene))
        .route("/scenes/reorder", post(reorder_scenes))
        .route("/scenes/{uuid}", patch(rename).delete(delete_scene))
        .route("/scenes/{uuid}/duplicate", post(duplicate_scene))
        .route("/scenes/{uuid}/program", post(program_scene))
        .route("/scenes/{uuid}/preview", post(preview_scene))
        .route("/scenes/{uuid}/group", post(group_items))
        .route("/scenes/{uuid}/arrange-vertical", post(arrange_vertical))
        .route("/scenes/{uuid}/items", post(add_item))
        .route("/scenes/{uuid}/items/reorder", post(reorder_items))
        .route("/scenes/{uuid}/items/{id}", patch(update_item).delete(remove_item))
        .route("/scenes/{uuid}/items/{id}/transform", post(transform_item))
        .route("/scenes/{uuid}/items/{id}/order", post(order_item))
        .route("/scenes/{uuid}/items/{id}/copy-transform", post(copy_transform))
        .route("/scenes/{uuid}/items/{id}/paste-transform", post(paste_transform))
        .route("/scenes/{uuid}/items/{id}/ungroup", post(ungroup))
        .route("/studio-mode", post(studio_mode))
        .route("/studio-mode/transition", post(studio_transition))
        .route("/sources", post(create_source))
        .route("/sources/{uuid}", patch(update_source).delete(delete_source))
        .route("/sources/{uuid}/duplicate", post(duplicate_source))
        .route("/sources/{uuid}/properties", get(source_properties))
        .route("/sources/{uuid}/settings", patch(source_settings))
        .route("/sources/{uuid}/settings/reset", post(reset_settings))
        .route("/sources/{uuid}/properties/{prop}/click", post(click_source))
        .route("/sources/{uuid}/media", post(media))
        .route("/sources/{uuid}/interact", post(interact))
        .route("/sources/{uuid}/snapshot.jpg", get(source_snapshot))
        .route("/sources/{uuid}/filters", post(add_filter))
        .route("/sources/{uuid}/filters/reorder", post(reorder_filters))
        .route("/sources/{uuid}/filters/{f}", patch(update_filter).delete(remove_filter))
        .route("/sources/{uuid}/filters/{f}/properties", get(filter_properties))
        .route("/sources/{uuid}/filters/{f}/settings", patch(filter_settings))
        .route("/sources/{uuid}/filters/{f}/properties/{prop}/click", post(click_filter))
        .route("/transitions", post(add_transition))
        .route("/transitions/duration", put(transition_duration))
        .route("/transitions/{uuid}", patch(rename_transition).delete(remove_transition))
        .route("/transitions/{uuid}/current", post(current_transition))
        .route("/transitions/{uuid}/properties", get(transition_properties))
        .route("/transitions/{uuid}/settings", patch(transition_settings))
        .route("/hotkeys", get(hotkeys))
        .route("/hotkeys/{id}", put(set_hotkey))
        .route("/stream/start", post(stream_start))
        .route("/stream/rehearsal", post(stream_rehearsal))
        .route("/stream-health", get(stream_health))
        .route("/stream-health/fix", post(stream_health_fix))
        .route("/macros", put(set_macros))
        .route("/macros/{id}/run", post(run_macro))
        .route("/stream/stop", post(stream_stop))
        .route("/record/start", post(record_start))
        .route("/record/stop", post(record_stop))
        .route("/record/pause", post(record_pause))
        .route("/record/split", post(record_split))
        .route("/replay/start", post(replay_start))
        .route("/replay/stop", post(replay_stop))
        .route("/replay/save", post(replay_save))
        .route("/virtualcam/start", post(vcam_start))
        .route("/virtualcam/stop", post(vcam_stop))
        .route("/screenshot", post(screenshot))
        .route("/preview.mjpeg", get(preview_mjpeg))
        .route("/preview.jpg", get(preview_jpg))
}

#[derive(Deserialize)]
struct NameBody {
    name: Option<String>,
}

#[derive(Deserialize)]
struct UuidsBody {
    uuids: Vec<String>,
}

#[derive(Deserialize)]
struct IdsBody {
    ids: Vec<i64>,
}

#[derive(Deserialize)]
struct ActionBody {
    action: String,
}

fn ok() -> StatusCode {
    StatusCode::NO_CONTENT
}

// ---------------------------------------------------------------- catalog

async fn stats(State(c): State<St>) -> ApiResult<Json<Stats>> {
    eng(&c, |e| Ok(e.stats())).await.map(Json)
}
async fn plugins(State(c): State<St>) -> Json<ObsPlugins> {
    Json(c.engine.plugins())
}
async fn source_types(State(c): State<St>) -> ApiResult<Json<Vec<SourceType>>> {
    eng(&c, |e| e.source_types()).await.map(Json)
}
async fn type_defaults(State(c): State<St>, Path(kind): Path<String>) -> ApiResult<Json<Value>> {
    eng(&c, move |e| e.type_defaults(&kind)).await.map(Json)
}
async fn filter_types(State(c): State<St>, Query(q): Query<HashMap<String, String>>) -> ApiResult<Json<Vec<SourceType>>> {
    eng(&c, move |e| e.filter_types(q.get("source").map(String::as_str))).await.map(Json)
}
async fn transition_types(State(c): State<St>) -> ApiResult<Json<Vec<SourceType>>> {
    eng(&c, |e| e.transition_types()).await.map(Json)
}
async fn encoders(State(c): State<St>) -> ApiResult<Json<Vec<EncoderType>>> {
    eng(&c, |e| e.encoders()).await.map(Json)
}
async fn encoder_properties(State(c): State<St>, Path(id): Path<String>, Json(b): Json<Value>) -> ApiResult<Json<Vec<Property>>> {
    let settings = b.get("settings").cloned().unwrap_or(json!({}));
    eng(&c, move |e| e.encoder_properties(&id, &settings)).await.map(Json)
}
async fn services(State(c): State<St>) -> ApiResult<Json<Vec<StreamService>>> {
    eng(&c, |e| e.services()).await.map(Json)
}
async fn audio_devices(State(c): State<St>, Query(q): Query<HashMap<String, String>>) -> ApiResult<Json<Vec<AudioDevice>>> {
    let kind = q.get("kind").cloned().unwrap_or_else(|| "input".into());
    eng(&c, move |e| e.audio_devices(&kind)).await.map(Json)
}
async fn monitoring_devices(State(c): State<St>) -> ApiResult<Json<Vec<AudioDevice>>> {
    eng(&c, |e| Ok(e.monitoring_devices())).await.map(Json)
}

// ---------------------------------------------------------------- collections

async fn create_collection(State(c): State<St>, Json(b): Json<NameBody>) -> ApiResult<StatusCode> {
    let name = b.name.unwrap_or_default();
    eng(&c, move |e| e.create_collection(&name)).await.map(|_| ok())
}
async fn switch_collection(State(c): State<St>, Path(name): Path<String>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.switch_collection(&name)).await.map(|_| ok())
}
async fn rename_collection(State(c): State<St>, Path(name): Path<String>, Json(b): Json<NameBody>) -> ApiResult<StatusCode> {
    let new_name = b.name.unwrap_or_default();
    eng(&c, move |e| e.rename_collection(&name, &new_name)).await.map(|_| ok())
}
async fn duplicate_collection(State(c): State<St>, Path(name): Path<String>, Json(b): Json<NameBody>) -> ApiResult<StatusCode> {
    let new_name = b.name.unwrap_or_default();
    eng(&c, move |e| e.duplicate_collection(&name, &new_name)).await.map(|_| ok())
}
async fn delete_collection(State(c): State<St>, Path(name): Path<String>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.delete_collection(&name)).await.map(|_| ok())
}
async fn obs_collections(State(c): State<St>) -> ApiResult<Json<Value>> {
    eng(&c, |e| Ok(e.obs_collections_list()))
        .await
        .map(|v| Json(json!(v.into_iter().map(|(name, path, app)| json!({"name": name, "path": path.to_string_lossy(), "app": app})).collect::<Vec<_>>())))
}
#[derive(Deserialize)]
struct ImportBody {
    path: String,
    name: Option<String>,
}
async fn import_collection(State(c): State<St>, Json(b): Json<ImportBody>) -> ApiResult<Json<Value>> {
    let name = eng(&c, move |e| e.import_collection(&b.path, b.name.clone())).await?;
    let _ = eng(&c, |e| Ok(devices(e))).await;
    c.notify("success", format!("Colección «{name}» importada"));
    Ok(Json(json!({ "name": name })))
}

/// Download an overlay shared as a link (.vxoverlay, .overlay or .zip) next to the themes.
async fn download_overlay(c: &St, link: &str) -> ApiResult<String> {
    let r = c
        .http
        .get(link)
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| ApiError::bad(format!("No se pudo descargar el overlay: {e}")))?;
    if !r.status().is_success() {
        return Err(ApiError::bad(format!("El enlace respondió {}", r.status())));
    }
    let from_url = link.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("").to_string();
    let disposition = r.headers().get("content-disposition").and_then(|v| v.to_str().ok()).and_then(|v| v.split("filename=").nth(1)).map(|v| v.trim_matches(['"', '\'', ' ']).to_string());
    let name = disposition.filter(|n| !n.is_empty()).unwrap_or(from_url);
    let lower = name.to_lowercase();
    let name = if [".vxoverlay", ".overlay", ".zip", ".json"].iter().any(|x| lower.ends_with(x)) { name } else { format!("{}.zip", if name.is_empty() { "overlay" } else { &name }) };
    let safe: String = name.chars().map(|ch| if ch.is_alphanumeric() || "._- ".contains(ch) { ch } else { '_' }).collect();
    let bytes = r.bytes().await.map_err(|e| ApiError::bad(format!("Se cortó la descarga: {e}")))?;
    let dir = c.data_dir.join("themes").join("downloads");
    std::fs::create_dir_all(&dir).map_err(|e| ApiError::bad(e.to_string()))?;
    let path = dir.join(safe);
    std::fs::write(&path, &bytes).map_err(|e| ApiError::bad(e.to_string()))?;
    Ok(path.to_string_lossy().to_string())
}

async fn install_theme(State(c): State<St>, Json(mut b): Json<ImportBody>) -> ApiResult<Json<Value>> {
    let port = c.port;
    let link = b.path.trim().to_string();
    if link.starts_with("http://") || link.starts_with("https://") {
        b.path = download_overlay(&c, &link).await?;
    }
    let (name, alerts, extras) = eng(&c, move |e| e.install_theme(&b.path, b.name.clone(), port)).await?;
    let mut new_designs: Vec<crate::model::AlertDesign> = vec![];
    // The pack's alert videos become editable alert designs (full-frame video + text in its banner).
    for (kind, path) in &alerts {
        new_designs.push(crate::model::theme_alert_design(&name, *kind, &path.to_string_lossy().replace('\\', "/")));
    }
    // A Vexcast overlay brings its own alert designs and widget looks.
    let packaged: Vec<crate::model::AlertDesign> = serde_json::from_value(extras["designs"].clone()).unwrap_or_default();
    let packaged_count = packaged.len();
    c.update(|s| {
        s.widgets.alert_box.designs.extend(new_designs.iter().cloned());
        s.widgets.alert_box.designs.extend(packaged);
        let groups: Vec<crate::model::AlertGroup> = serde_json::from_value(extras["groups"].clone()).unwrap_or_default();
        s.widgets.alert_box.groups.extend(groups);
        if let Ok(chat) = serde_json::from_value(extras["chatBox"].clone()) {
            s.widgets.chat_box = chat;
        }
        if let Ok(mut goal) = serde_json::from_value::<crate::model::GoalSettings>(extras["goal"].clone()) {
            goal.current = s.widgets.goal.current; // keep this channel's progress
            s.widgets.goal = goal;
        }
    });
    // Each alert gets its own browser source where the theme had its single alert box.
    let ids: Vec<(String, String)> = new_designs.iter().map(|d| (d.id.clone(), d.name.clone())).collect();
    if !ids.is_empty() {
        if eng(&c, move |e| e.split_alert_sources(&ids, port)).await.is_err() {
            tracing::warn!("split alert sources failed");
        }
    }
    let _ = eng(&c, |e| Ok(devices(e))).await;
    c.notify("success", format!("Overlay «{name}» instalado"));
    Ok(Json(json!({ "name": name, "alerts": alerts.len() + packaged_count })))
}

/// Imported files point to another PC's devices: main monitor for screens (also under game
/// captures, so something shows while not gaming) and the first camera for webcams.
fn devices(e: &Arc<Engine>) -> Value {
    // Device lists can take a moment after a collection loads.
    std::thread::sleep(std::time::Duration::from_millis(300));
    let screens = e.add_screen_under_game_captures("Pantalla principal");
    let devices = e.assign_default_devices();
    json!({ "screensAdded": screens, "devicesSet": devices })
}

/// Run the device setup on the current collection.
async fn setup_devices(State(c): State<St>) -> ApiResult<Json<Value>> {
    eng(&c, |e| Ok(devices(e))).await.map(Json)
}

#[derive(Deserialize)]
struct ExportOverlayBody {
    path: String,
}

/// Export the current scene collection + files + alert designs + widget looks as a `.vxoverlay`.
async fn export_overlay(State(c): State<St>, Json(b): Json<ExportOverlayBody>) -> ApiResult<Json<Value>> {
    let extras = c.read(|s| json!({ "designs": s.widgets.alert_box.designs, "groups": s.widgets.alert_box.groups, "chatBox": s.widgets.chat_box, "goal": s.widgets.goal }));
    let path = std::path::PathBuf::from(b.path.trim());
    let files = eng(&c, move |e| e.export_overlay(&path, extras)).await?;
    Ok(Json(json!({ "files": files })))
}

/// Replace the old "all alerts" browser sources by one source per enabled alert design.
async fn split_alert_sources(State(c): State<St>) -> ApiResult<Json<Value>> {
    let port = c.port;
    let ids: Vec<(String, String)> = c.read(|s| s.widgets.alert_box.designs.iter().filter(|d| d.enabled).map(|d| (d.id.clone(), d.name.clone())).collect());
    let created = eng(&c, move |e| e.split_alert_sources(&ids, port)).await?;
    Ok(Json(json!({ "created": created })))
}

// ---------------------------------------------------------------- scenes

async fn create_scene(State(c): State<St>, Json(b): Json<NameBody>) -> ApiResult<Json<Value>> {
    let name = b.name.unwrap_or_default();
    eng(&c, move |e| e.create_scene(&name)).await.map(|u| Json(json!({ "uuid": u })))
}
async fn rename(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<NameBody>) -> ApiResult<StatusCode> {
    let name = b.name.unwrap_or_default();
    eng(&c, move |e| e.rename_source_or_scene(&uuid, &name)).await.map(|_| ok())
}
async fn duplicate_scene(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<NameBody>) -> ApiResult<Json<Value>> {
    let name = b.name.unwrap_or_default();
    eng(&c, move |e| e.duplicate_scene(&uuid, &name)).await.map(|u| Json(json!({ "uuid": u })))
}
async fn delete_scene(State(c): State<St>, Path(uuid): Path<String>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.delete_scene(&uuid)).await.map(|_| ok())
}
async fn reorder_scenes(State(c): State<St>, Json(b): Json<UuidsBody>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.reorder_scenes(&b.uuids)).await.map(|_| ok())
}
async fn program_scene(State(c): State<St>, Path(uuid): Path<String>, Query(q): Query<HashMap<String, String>>) -> ApiResult<StatusCode> {
    let force = q.get("force").map(|v| v == "1" || v == "true").unwrap_or(false);
    eng(&c, move |e| e.set_program_scene(&uuid, force)).await.map(|_| ok())
}
async fn preview_scene(State(c): State<St>, Path(uuid): Path<String>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.set_preview_scene(&uuid)).await.map(|_| ok())
}
#[derive(Deserialize)]
struct ArrangeBody {
    mode: Option<String>,
    background: Option<String>,
}
/// Rebuild a scene's 9:16 twin from its 16:9 layout (`auto` or `fit`).
async fn arrange_vertical(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<ArrangeBody>) -> ApiResult<Json<Value>> {
    let mode = b.mode.unwrap_or_else(|| "auto".into());
    eng(&c, move |e| e.arrange_vertical(&uuid, &mode, b.background.as_deref())).await.map(|n| Json(json!({ "items": n })))
}
#[derive(Deserialize)]
struct EnabledBody {
    enabled: bool,
}
async fn studio_mode(State(c): State<St>, Json(b): Json<EnabledBody>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.set_studio_mode(b.enabled)).await.map(|_| ok())
}
async fn studio_transition(State(c): State<St>) -> ApiResult<StatusCode> {
    eng(&c, |e| e.transition_to_program()).await.map(|_| ok())
}

// ---------------------------------------------------------------- items

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddItemBody {
    source_uuid: String,
}
async fn add_item(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<AddItemBody>) -> ApiResult<Json<SceneItem>> {
    eng(&c, move |e| e.add_source_to_scene(&uuid, &b.source_uuid)).await.map(Json)
}
async fn update_item(State(c): State<St>, Path((uuid, id)): Path<(String, i64)>, Json(p): Json<SceneItemPatch>) -> ApiResult<Json<SceneItem>> {
    eng(&c, move |e| e.update_item(&uuid, id, p)).await.map(Json)
}
async fn transform_item(State(c): State<St>, Path((uuid, id)): Path<(String, i64)>, Json(b): Json<ActionBody>) -> ApiResult<Json<SceneItem>> {
    eng(&c, move |e| e.transform_item(&uuid, id, &b.action)).await.map(Json)
}
async fn order_item(State(c): State<St>, Path((uuid, id)): Path<(String, i64)>, Json(b): Json<ActionBody>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.order_item(&uuid, id, &b.action)).await.map(|_| ok())
}
async fn reorder_items(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<IdsBody>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.reorder_items(&uuid, &b.ids)).await.map(|_| ok())
}
async fn remove_item(State(c): State<St>, Path((uuid, id)): Path<(String, i64)>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.remove_item(&uuid, id)).await.map(|_| ok())
}
async fn copy_transform(State(c): State<St>, Path((uuid, id)): Path<(String, i64)>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.copy_transform(&uuid, id)).await.map(|_| ok())
}
async fn paste_transform(State(c): State<St>, Path((uuid, id)): Path<(String, i64)>) -> ApiResult<Json<SceneItem>> {
    eng(&c, move |e| e.paste_transform(&uuid, id)).await.map(Json)
}
#[derive(Deserialize)]
struct GroupBody {
    ids: Vec<i64>,
    name: Option<String>,
}
async fn group_items(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<GroupBody>) -> ApiResult<Json<SceneItem>> {
    eng(&c, move |e| e.group_items(&uuid, &b.ids, b.name.as_deref().unwrap_or("Grupo"))).await.map(Json)
}
async fn ungroup(State(c): State<St>, Path((uuid, id)): Path<(String, i64)>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.ungroup_item(&uuid, id)).await.map(|_| ok())
}

// ---------------------------------------------------------------- sources

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSourceBody {
    name: String,
    kind: String,
    settings: Option<Value>,
    scene_uuid: Option<String>,
}
async fn create_source(State(c): State<St>, Json(b): Json<CreateSourceBody>) -> ApiResult<Json<SourceInfo>> {
    eng(&c, move |e| e.create_source(&b.name, &b.kind, b.settings.clone(), b.scene_uuid.as_deref())).await.map(Json)
}
async fn update_source(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<Value>) -> ApiResult<Json<SourceInfo>> {
    eng(&c, move |e| e.update_source(&uuid, &b)).await.map(Json)
}
async fn delete_source(State(c): State<St>, Path(uuid): Path<String>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.delete_source(&uuid)).await.map(|_| ok())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateBody {
    name: Option<String>,
    scene_uuid: Option<String>,
}
async fn duplicate_source(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<DuplicateBody>) -> ApiResult<Json<SourceInfo>> {
    eng(&c, move |e| e.duplicate_source(&uuid, b.name.as_deref().unwrap_or(""), b.scene_uuid.as_deref())).await.map(Json)
}
async fn source_properties(State(c): State<St>, Path(uuid): Path<String>) -> ApiResult<Json<Vec<Property>>> {
    eng(&c, move |e| e.source_properties(&uuid)).await.map(Json)
}
async fn source_settings(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<Value>) -> ApiResult<Json<Vec<Property>>> {
    eng(&c, move |e| e.update_source_settings(&uuid, &b)).await.map(Json)
}
async fn reset_settings(State(c): State<St>, Path(uuid): Path<String>) -> ApiResult<Json<Vec<Property>>> {
    eng(&c, move |e| e.reset_source_settings(&uuid)).await.map(Json)
}
async fn click_source(State(c): State<St>, Path((uuid, prop)): Path<(String, String)>) -> ApiResult<Json<Vec<Property>>> {
    eng(&c, move |e| e.click_source_button(&uuid, &prop)).await.map(Json)
}
async fn media(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<ActionBody>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.media_action(&uuid, &b.action)).await.map(|_| ok())
}
async fn interact(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<Value>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.interact(&uuid, &b)).await.map(|_| ok())
}

// ---------------------------------------------------------------- filters

#[derive(Deserialize)]
struct FilterBody {
    kind: String,
    name: Option<String>,
}
async fn add_filter(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<FilterBody>) -> ApiResult<Json<Value>> {
    eng(&c, move |e| e.add_filter(&uuid, &b.kind, b.name.as_deref().unwrap_or(""))).await.map(|u| Json(json!({ "uuid": u })))
}
async fn update_filter(State(c): State<St>, Path((uuid, f)): Path<(String, String)>, Json(b): Json<Value>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.update_filter(&uuid, &f, &b)).await.map(|_| ok())
}
async fn remove_filter(State(c): State<St>, Path((uuid, f)): Path<(String, String)>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.remove_filter(&uuid, &f)).await.map(|_| ok())
}
async fn filter_properties(State(c): State<St>, Path((uuid, f)): Path<(String, String)>) -> ApiResult<Json<Vec<Property>>> {
    eng(&c, move |e| e.filter_properties(&uuid, &f)).await.map(Json)
}
async fn filter_settings(State(c): State<St>, Path((uuid, f)): Path<(String, String)>, Json(b): Json<Value>) -> ApiResult<Json<Vec<Property>>> {
    eng(&c, move |e| e.update_filter_settings(&uuid, &f, &b)).await.map(Json)
}
async fn click_filter(State(c): State<St>, Path((uuid, f, prop)): Path<(String, String, String)>) -> ApiResult<Json<Vec<Property>>> {
    eng(&c, move |e| e.click_filter_button(&uuid, &f, &prop)).await.map(Json)
}
async fn reorder_filters(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<UuidsBody>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.reorder_filters(&uuid, &b.uuids)).await.map(|_| ok())
}

// ---------------------------------------------------------------- transitions

async fn add_transition(State(c): State<St>, Json(b): Json<FilterBody>) -> ApiResult<Json<TransitionInfo>> {
    eng(&c, move |e| e.add_transition(&b.kind, b.name.as_deref().unwrap_or(""))).await.map(Json)
}
#[derive(Deserialize)]
struct MsBody {
    ms: u32,
}
async fn transition_duration(State(c): State<St>, Json(b): Json<MsBody>) -> ApiResult<StatusCode> {
    eng(&c, move |e| {
        e.set_transition_duration(b.ms);
        Ok(())
    })
    .await
    .map(|_| ok())
}
async fn current_transition(State(c): State<St>, Path(uuid): Path<String>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.set_current_transition(&uuid)).await.map(|_| ok())
}
async fn transition_properties(State(c): State<St>, Path(uuid): Path<String>) -> ApiResult<Json<Vec<Property>>> {
    eng(&c, move |e| e.transition_properties(&uuid)).await.map(Json)
}
async fn transition_settings(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<Value>) -> ApiResult<Json<Vec<Property>>> {
    eng(&c, move |e| e.update_transition_settings(&uuid, &b)).await.map(Json)
}
async fn rename_transition(State(c): State<St>, Path(uuid): Path<String>, Json(b): Json<NameBody>) -> ApiResult<StatusCode> {
    let name = b.name.unwrap_or_default();
    eng(&c, move |e| e.rename_transition(&uuid, &name)).await.map(|_| ok())
}
async fn remove_transition(State(c): State<St>, Path(uuid): Path<String>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.remove_transition(&uuid)).await.map(|_| ok())
}

// ---------------------------------------------------------------- hotkeys

async fn hotkeys(State(c): State<St>) -> ApiResult<Json<Vec<Hotkey>>> {
    eng(&c, |e| Ok(e.hotkeys())).await.map(Json)
}
#[derive(Deserialize)]
struct BindingsBody {
    bindings: Vec<HotkeyBinding>,
}
async fn set_hotkey(State(c): State<St>, Path(id): Path<u64>, Json(b): Json<BindingsBody>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.set_hotkey(id, &b.bindings)).await.map(|_| ok())
}

// ---------------------------------------------------------------- outputs

async fn stream_health() -> Json<Value> {
    Json(crate::health::report())
}

#[derive(Deserialize)]
struct FixBody {
    id: String,
}
/// One-click fix from the stream health assistant.
async fn stream_health_fix(State(c): State<St>, Json(b): Json<FixBody>) -> ApiResult<Json<Value>> {
    let msg = crate::health::fix(&c, &b.id)?;
    c.notify("success", msg.clone());
    Ok(Json(json!({ "message": msg })))
}

/// Rehearsal: stream to Twitch in bandwidth-test mode (not published).
async fn stream_rehearsal(State(c): State<St>) -> ApiResult<StatusCode> {
    let warnings = eng(&c, |e| e.start_stream_mode(true)).await?;
    for w in warnings {
        c.notify("warning", w);
    }
    c.broadcast_state();
    Ok(ok())
}

/// Replace the macro list (and their hotkeys).
async fn set_macros(State(c): State<St>, Json(list): Json<Vec<crate::model::Macro>>) -> ApiResult<Json<Vec<crate::model::Macro>>> {
    let list: Vec<crate::model::Macro> = list.into_iter().map(|mut m| {
        m.name = m.name.trim().to_string();
        if m.id.is_empty() {
            m.id = crate::model::new_id();
        }
        m
    }).collect();
    let names: Vec<(String, String)> = list.iter().map(|m| (m.id.clone(), m.name.clone())).collect();
    c.update(|s| s.macros = list.clone());
    eng(&c, move |e| Ok(e.sync_macro_hotkeys(&names))).await?;
    Ok(Json(list))
}

async fn run_macro(State(c): State<St>, Path(id): Path<String>) -> ApiResult<StatusCode> {
    crate::macros::run_by_id(&c, &id).await?;
    c.broadcast_state();
    Ok(ok())
}

async fn stream_start(State(c): State<St>) -> ApiResult<StatusCode> {
    let warnings = eng(&c, |e| e.start_stream()).await?;
    for w in warnings {
        c.notify("warning", w);
    }
    c.broadcast_state();
    Ok(ok())
}
async fn stream_stop(State(c): State<St>) -> ApiResult<StatusCode> {
    eng(&c, |e| {
        e.stop_stream();
        Ok(())
    })
    .await?;
    c.broadcast_state();
    Ok(ok())
}
async fn record_start(State(c): State<St>) -> ApiResult<StatusCode> {
    eng(&c, |e| e.start_recording()).await?;
    c.broadcast_state();
    Ok(ok())
}
async fn record_stop(State(c): State<St>) -> ApiResult<StatusCode> {
    eng(&c, |e| {
        e.stop_recording();
        Ok(())
    })
    .await?;
    c.broadcast_state();
    Ok(ok())
}
#[derive(Deserialize)]
struct PausedBody {
    paused: bool,
}
async fn record_pause(State(c): State<St>, Json(b): Json<PausedBody>) -> ApiResult<StatusCode> {
    eng(&c, move |e| e.outputs_pause(b.paused)).await?;
    c.broadcast_state();
    Ok(ok())
}
async fn record_split(State(c): State<St>) -> ApiResult<StatusCode> {
    eng(&c, |e| e.outputs_split()).await.map(|_| ok())
}
async fn replay_start(State(c): State<St>) -> ApiResult<StatusCode> {
    eng(&c, |e| e.start_replay()).await?;
    c.broadcast_state();
    Ok(ok())
}
async fn replay_stop(State(c): State<St>) -> ApiResult<StatusCode> {
    eng(&c, |e| {
        e.stop_replay();
        Ok(())
    })
    .await?;
    c.broadcast_state();
    Ok(ok())
}
async fn replay_save(State(c): State<St>) -> ApiResult<Json<Value>> {
    eng(&c, |e| e.save_replay()).await?;
    Ok(Json(json!({ "path": null })))
}
async fn vcam_start(State(c): State<St>) -> ApiResult<StatusCode> {
    eng(&c, |e| e.start_virtualcam()).await?;
    c.broadcast_state();
    Ok(ok())
}
async fn vcam_stop(State(c): State<St>) -> ApiResult<StatusCode> {
    eng(&c, |e| {
        e.stop_virtualcam();
        Ok(())
    })
    .await?;
    c.broadcast_state();
    Ok(ok())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScreenshotBody {
    source_uuid: Option<String>,
}
/// Save a PNG of the program (or one source) next to the recordings.
async fn screenshot(State(c): State<St>, Json(b): Json<ScreenshotBody>) -> ApiResult<Json<Value>> {
    let key = match b.source_uuid {
        Some(u) => PreviewKey::Source(u),
        None => PreviewKey::Program,
    };
    let jpg = first_frame(&c, key, 10).await.ok_or_else(|| ApiError::bad("No hay imagen disponible"))?;
    let dir = c.engine.screenshot_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join(format!("Captura {}.jpg", crate::obs::outputs_filename("%CCYY-%MM-%DD %hh-%mm-%ss")));
    std::fs::write(&path, &jpg).map_err(|e| ApiError::bad(e.to_string()))?;
    let p = path.to_string_lossy().to_string();
    c.notify("success", format!("Captura guardada: {p}"));
    Ok(Json(json!({ "path": p })))
}

// ---------------------------------------------------------------- previews

fn preview_key(q: &HashMap<String, String>) -> PreviewKey {
    if q.get("canvas").map(String::as_str) == Some("vertical") && !q.contains_key("scene") && !q.contains_key("source") {
        return PreviewKey::Vertical;
    }
    if let Some(s) = q.get("source").filter(|s| !s.is_empty()) {
        PreviewKey::Source(s.clone())
    } else if let Some(s) = q.get("scene").filter(|s| !s.is_empty()) {
        PreviewKey::Scene(s.clone())
    } else {
        PreviewKey::Program
    }
}

async fn first_frame(c: &St, key: PreviewKey, fps: u32) -> Option<bytes::Bytes> {
    let e = c.engine.clone();
    let (mut rx, _guard) = tokio::task::spawn_blocking(move || e.subscribe_preview(key, PreviewQuality::Medium, fps)).await.ok()?.ok()?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    loop {
        if let Some(j) = rx.borrow_and_update().clone() {
            return Some(j);
        }
        match tokio::time::timeout_at(deadline, rx.changed()).await {
            Ok(Ok(())) => continue,
            _ => return None,
        }
    }
}

async fn preview_mjpeg(State(c): State<St>, Query(q): Query<HashMap<String, String>>) -> ApiResult<Response> {
    // `quality=low|medium|high|full` sets size, JPEG quality and the frame-rate cap; `fps` can lower it.
    let quality = PreviewQuality::parse(q.get("quality").map(String::as_str));
    let fps = q.get("fps").and_then(|f| f.parse().ok()).unwrap_or(60u32).clamp(1, 60);
    let key = preview_key(&q);
    let subscribe = {
        let e = c.engine.clone();
        move |key: PreviewKey| {
            let e = e.clone();
            async move { tokio::task::spawn_blocking(move || e.subscribe_preview(key, quality, fps)).await.map_err(|e| anyhow::anyhow!(e.to_string())).and_then(|r| r) }
        }
    };
    let (mut rx, guard) = subscribe(key.clone()).await.map_err(|e| ApiError::bad(e.to_string()))?;
    let stream = async_stream::stream! {
        let mut _guard = guard;
        loop {
            let frame = rx.borrow_and_update().clone();
            if let Some(jpg) = frame {
                let mut part = Vec::with_capacity(jpg.len() + 128);
                part.extend_from_slice(format!("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n", jpg.len()).as_bytes());
                part.extend_from_slice(&jpg);
                part.extend_from_slice(b"\r\n");
                yield Ok::<_, std::io::Error>(bytes::Bytes::from(part));
            }
            if rx.changed().await.is_ok() { continue; }
            // The capture was torn down (scene collection loaded, video reset, engine restart):
            // keep the connection and pick up the new one instead of ending the image.
            let mut resumed = false;
            for _ in 0..240 {
                tokio::time::sleep(Duration::from_millis(500)).await;
                if let Ok((r, g)) = subscribe(key.clone()).await {
                    rx = r;
                    _guard = g;
                    resumed = true;
                    break;
                }
            }
            if !resumed { break; }
        }
    };
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "multipart/x-mixed-replace; boundary=frame")
        .header(header::CACHE_CONTROL, "no-cache, no-store")
        .body(Body::from_stream(stream))
        .unwrap())
}

async fn preview_jpg(State(c): State<St>, Query(q): Query<HashMap<String, String>>) -> Response {
    match first_frame(&c, preview_key(&q), 10).await {
        Some(j) => ([(header::CONTENT_TYPE, "image/jpeg"), (header::CACHE_CONTROL, "no-cache, no-store")], j).into_response(),
        None => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}

async fn source_snapshot(State(c): State<St>, Path(uuid): Path<String>) -> Response {
    match first_frame(&c, PreviewKey::Source(uuid), 10).await {
        Some(j) => ([(header::CONTENT_TYPE, "image/jpeg"), (header::CACHE_CONTROL, "no-cache, no-store")], j).into_response(),
        None => StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
}
