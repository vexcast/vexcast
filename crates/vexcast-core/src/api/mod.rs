//! HTTP + WebSocket API (see docs/API.md and packages/protocol/src/client.ts).

#[cfg(feature = "obs")]
mod engine;
mod hub;

use crate::core::Core;
use crate::model::*;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post, put};
use axum::{Form, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tower_http::cors::CorsLayer;

pub(crate) type St = Arc<Core>;
pub(crate) type ApiResult<T> = Result<T, ApiError>;

pub struct ApiError(pub StatusCode, pub String);

impl ApiError {
    pub fn bad(msg: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, msg.into())
    }
    pub fn not_found(what: &str) -> Self {
        Self(StatusCode::NOT_FOUND, format!("{what} no encontrado"))
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(e: serde_json::Error) -> Self {
        ApiError::bad(format!("datos inválidos: {e}"))
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        ApiError::bad(e.to_string())
    }
}

pub fn router(core: Arc<Core>, ui_dir: Option<PathBuf>) -> Router {
    let api = Router::new()
        .route("/state", get(get_state))
        .route("/settings/{section}", put(put_settings))
        .route("/destinations", post(create_destination))
        .route("/destinations/{id}", patch(update_destination).delete(delete_destination))
        .route("/chat/connections", put(put_chat_connection))
        .route("/chat/send", post(chat_send))
        .route("/chat/delete", post(chat_delete))
        .route("/chat/highlight", get(chat_highlight_get).post(chat_highlight).delete(chat_highlight_clear))
        .route("/chat/history", get(chat_history))
        .route("/alerts/test", post(alert_test))
        .route("/alerts/skip", post(alert_skip))
        .route("/alerts/recent", get(alerts_recent))
        .route("/labels/reset", post(labels_reset))
        .route("/credits", get(credits_get))
        .route("/poll", get(poll_get).post(poll_start).delete(poll_clear))
        .route("/poll/end", post(poll_end))
        .route("/poll/resolve", post(poll_resolve))
        .route("/giveaway", get(giveaway_get).post(giveaway_start).delete(giveaway_clear))
        .route("/giveaway/close", post(giveaway_close))
        .route("/giveaway/draw", post(giveaway_draw))
        .route("/songs", get(songs_get).post(songs_add).delete(songs_clear))
        .route("/songs/next", post(songs_next))
        .route("/songs/ended", post(songs_ended))
        .route("/songs/duration", post(songs_duration))
        .route("/songs/pause", post(songs_pause))
        .route("/songs/volume", post(songs_volume))
        .route("/songs/{id}", axum::routing::delete(songs_remove))
        .route("/counters", put(counters_put))
        .route("/counters/{id}/add", post(counter_add))
        .route("/counters/{id}/set", post(counter_set))
        .route("/countdown", put(countdown_put).post(countdown_action))
        .route("/loyalty", get(loyalty_list))
        .route("/loyalty/set", post(loyalty_set))
        .route("/loyalty/reset", post(loyalty_reset))
        .route("/tts/speak", post(tts_speak))
        .route("/tts/audio/{id}", get(tts_audio))
        .route("/ai/cohost", post(ai_cohost))
        .route("/ai/test", post(ai_test))
        .route("/chat/translate", post(chat_translate))
        .route("/chat/summary", post(chat_summary))
        .route("/sessions", get(sessions_list))
        .route("/sessions/{id}", get(session_get).delete(session_delete))
        .route("/sessions/{id}/insights", post(session_insights))
        .route("/pairing", get(pairing))
        .route("/update/check", post(update_check))
        .route("/oauth/{platform}/start", post(oauth_start))
        .route("/oauth/{platform}/cancel", post(oauth_cancel))
        .route("/oauth/{platform}/disconnect", post(oauth_disconnect))
        .route("/oauth/{platform}/apply", post(oauth_apply))
        .route("/oauth/{platform}/stream-info", get(oauth_get_stream_info).post(oauth_stream_info))
        .route("/oauth/{platform}/categories", get(oauth_categories))
        .route("/files", get(data_file))
        .route("/media/import", post(import_media))
        .route("/mcp", post(mcp).get(|| async { StatusCode::METHOD_NOT_ALLOWED }))
        .route("/remote/devices", get(remote_devices))
        .route("/remote/devices/{id}", patch(update_remote_device).delete(forget_remote_device))
        .route("/remote/reset-token", post(reset_remote_token))
        .route("/alerts/designs/export", post(export_alerts))
        .route("/alerts/designs/import", post(import_alerts))
        .route("/ws", get(ws_handler))
        .route("/phonecam", get(crate::phonecam::list))
        .route("/phonecam/ws", get(crate::phonecam::ws))
        .route("/uploads", post(upload).layer(axum::extract::DefaultBodyLimit::disable()));
    #[cfg(feature = "obs")]
    let api = engine::routes(api);
    let api = hub::routes(api);
    #[cfg(not(feature = "obs"))]
    let api = api.fallback(|| async { ApiError(StatusCode::SERVICE_UNAVAILABLE, "Vexcast se compiló sin el motor de OBS".into()) });
    let api = api.layer(middleware::from_fn_with_state(core.clone(), auth));

    let mut app = Router::new()
        .route("/api/v1/health", get(health))
        .nest("/api/v1", api)
        .route("/widgets/{*path}", get(crate::widgets::serve))
        .route("/widgets/", get(|| crate::widgets::serve(Path(String::new()))))
        .route("/webhooks/kofi", post(kofi_webhook))
        .route("/oauth/callback", get(oauth_callback))
        .route("/", get(|| async { axum::response::Redirect::temporary("/app/") }));

    let ui = ui_dir
        .or_else(|| std::env::var("VEXCAST_UI_DIR").ok().map(PathBuf::from))
        .or_else(|| std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("ui"))))
        .filter(|p| p.join("index.html").is_file());
    if let Some(dir) = ui {
        let index = dir.join("index.html");
        app = app.nest_service("/app", tower_http::services::ServeDir::new(dir).fallback(tower_http::services::ServeFile::new(index)));
    }

    app.layer(CorsLayer::very_permissive()).with_state(core)
}

/// Token auth: required for remote clients; localhost is trusted unless VEXCAST_REQUIRE_TOKEN=1.
async fn auth(State(core): State<St>, ConnectInfo(addr): ConnectInfo<SocketAddr>, req: Request, next: Next) -> Response {
    let local = addr.ip().is_loopback();
    let require_local = std::env::var("VEXCAST_REQUIRE_TOKEN").map(|v| v == "1").unwrap_or(false);
    if local && !require_local {
        return next.run(req).await;
    }
    if !local && !core.read(|s| s.general.remote_control_enabled) {
        return ApiError(StatusCode::FORBIDDEN, "El control remoto está desactivado".into()).into_response();
    }
    let token = core.token();
    let header_ok = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim_start_matches("Bearer ").trim() == token)
        .unwrap_or(false);
    let query_ok = req.uri().query().map(|q| url::form_urlencoded::parse(q.as_bytes()).any(|(k, v)| k == "token" && v == token.as_str())).unwrap_or(false);
    if header_ok || query_ok {
        let mut req = req;
        if !local {
            // Remote device: record it, refuse it if blocked (or new while new devices are not allowed).
            let ip = addr.ip().to_string();
            let (id, name) = crate::remote::RemoteRegistry::identify(req.headers(), req.uri().query(), &ip);
            if let Err(msg) = core.remote.touch(&core, &id, &name, &ip) {
                return ApiError(StatusCode::FORBIDDEN, msg).into_response();
            }
            // Moderators and viewers only get part of the API.
            let role = core.read(|s| s.remote_devices.iter().find(|d| d.id == id).map(|d| d.role.clone()).unwrap_or_else(|| crate::remote::default_role(&s.remote_devices)));
            if !crate::remote::allowed(&role, req.method().as_str(), req.uri().path()) {
                let msg = if role == "viewer" { "Este dispositivo solo puede mirar (rol «Solo ver»)" } else { "Los moderadores no pueden hacer esto; pídeselo al streamer" };
                return ApiError(StatusCode::FORBIDDEN, msg.into()).into_response();
            }
            req.extensions_mut().insert(crate::remote::DeviceId(id));
        }
        next.run(req).await
    } else {
        ApiError(StatusCode::UNAUTHORIZED, "Token inválido".into()).into_response()
    }
}

async fn health(State(core): State<St>) -> Json<Value> {
    Json(json!({ "ok": true, "version": core.read(|s| s.version.clone()), "app": "vexcast", "name": crate::pairing::computer_name(), "serverTime": now_ms() }))
}

async fn get_state(State(core): State<St>) -> ApiResult<Json<PublicState>> {
    let c = core.clone();
    Ok(Json(tokio::task::spawn_blocking(move || c.public_state()).await.map_err(|e| ApiError::bad(e.to_string()))?))
}

// ------------------------------------------------------------------ settings

fn restore_masked(v: &mut Value, before: &Value) {
    match v {
        Value::String(s) if is_masked(s) => *v = before.clone(),
        Value::Object(o) => {
            for (k, x) in o.iter_mut() {
                restore_masked(x, &before[k]);
            }
        }
        _ => {}
    }
}

async fn put_settings(State(core): State<St>, Path(section): Path<String>, Json(patch): Json<Value>) -> ApiResult<Json<Value>> {
    let key = match section.as_str() {
        "video" | "audio" | "output" | "advanced" | "widgets" | "ai" | "bot" | "general" => section.clone(),
        _ => return Err(ApiError::not_found("Sección")),
    };
    // Compute the new state without committing yet.
    let (before, next) = core.read(|s| -> ApiResult<(AppState, AppState)> {
        let mut full = serde_json::to_value(s)?;
        let prev = full[&key].clone();
        merge_json(&mut full[&key], patch);
        restore_masked(&mut full[&key], &prev);
        let mut next: AppState = serde_json::from_value(full)?;
        next.api_token = s.api_token.clone();
        next.update = s.update.clone();
        next.stream_started_at = s.stream_started_at;
        Ok((s.clone(), next))
    })?;
    // Apply engine-side effects first; on failure keep the old settings.
    let engine = core.engine.clone();
    let (b, n) = (before.clone(), next.clone());
    let key2 = key.clone();
    let warning = tokio::task::spawn_blocking(move || -> anyhow::Result<Option<String>> {
        apply_engine_settings(&engine, &key2, &b, &n)
    })
    .await
    .map_err(|e| ApiError::bad(e.to_string()))??;
    let out = core.update(|s| {
        let token = s.api_token.clone();
        *s = next;
        s.api_token = token;
        serde_json::to_value(&*s).map(|v| v[&key].clone())
    })?;
    if let Some(w) = warning {
        core.notify("warning", w);
    }
    Ok(Json(mask_section(&key, out)))
}

#[cfg(feature = "obs")]
fn apply_engine_settings(engine: &crate::obs::Engine, key: &str, before: &AppState, next: &AppState) -> anyhow::Result<Option<String>> {
    let mut warn = None;
    match key {
        "video" => {
            let v = &next.video;
            let b = &before.video;
            let core_changed = (v.base_width, v.base_height, v.output_width, v.output_height, v.fps_num, v.fps_den, &v.downscale_filter, &v.color_format, &v.color_space, &v.color_range, v.sdr_white_level, v.hdr_nominal_peak_level)
                != (b.base_width, b.base_height, b.output_width, b.output_height, b.fps_num, b.fps_den, &b.downscale_filter, &b.color_format, &b.color_space, &b.color_range, b.sdr_white_level, b.hdr_nominal_peak_level);
            if core_changed && engine.is_ready() {
                engine.apply_video(v, &next.advanced.renderer)?;
            }
            if engine.is_ready() && (v.vertical_enabled, v.vertical_width, v.vertical_height) != (b.vertical_enabled, b.vertical_width, b.vertical_height) {
                engine.apply_vertical(v)?;
            }
        }
        "audio" => {
            let a = &next.audio;
            let b = &before.audio;
            if engine.is_ready() {
                engine.audio_devices_apply(a);
                if (&a.monitoring_device_id, &a.monitoring_device_name) != (&b.monitoring_device_id, &b.monitoring_device_name) {
                    engine.set_monitoring_device(&a.monitoring_device_name, &a.monitoring_device_id);
                }
            }
            if (a.sample_rate, &a.channels, a.low_latency_buffering) != (b.sample_rate, &b.channels, b.low_latency_buffering) {
                warn = Some("La frecuencia de muestreo y los canales se aplicarán al reiniciar Vexcast".into());
            }
        }
        "advanced" => {
            if next.advanced.renderer != before.advanced.renderer {
                warn = Some("El cambio de renderizador se aplicará al reiniciar Vexcast".into());
            }
        }
        "general" => {
            if next.general.language != before.general.language {
                warn = Some("Los nombres de fuentes y filtros de OBS cambiarán de idioma al reiniciar Vexcast".into());
            }
        }
        _ => {}
    }
    Ok(warn)
}

#[cfg(not(feature = "obs"))]
fn apply_engine_settings(_e: &crate::obs::Engine, _k: &str, _b: &AppState, _n: &AppState) -> anyhow::Result<Option<String>> {
    Ok(None)
}

fn mask_section(key: &str, mut v: Value) -> Value {
    if key == "ai" {
        for sec in ["llm", "stt"] {
            if let Some(k) = v[sec]["apiKey"].as_str().map(mask) {
                v[sec]["apiKey"] = Value::String(k);
            }
        }
    }
    if key == "general" {
        if let Some(k) = v["kofiVerificationToken"].as_str().map(mask) {
            v["kofiVerificationToken"] = Value::String(k);
        }
    }
    v
}

// ------------------------------------------------------------------ destinations

async fn create_destination(State(core): State<St>, Json(mut d): Json<Destination>) -> ApiResult<Json<Destination>> {
    if d.service != "Custom" && d.service.trim().is_empty() {
        d.service = "Custom".into();
    }
    if d.service == "Custom" && d.server.trim().is_empty() {
        return Err(ApiError::bad("La URL del servidor es obligatoria"));
    }
    d.id = new_id();
    d.server = d.server.trim().to_string();
    d.stream_key = d.stream_key.trim().to_string();
    if d.name.trim().is_empty() {
        d.name = d.service.clone();
    }
    let out = d.clone();
    core.update(|s| s.destinations.push(d));
    Ok(Json(Destination { stream_key: mask(&out.stream_key), ..out }))
}

async fn update_destination(State(core): State<St>, Path(id): Path<String>, Json(mut body): Json<Value>) -> ApiResult<Json<Destination>> {
    core.update(|s| {
        let d = s.destinations.iter_mut().find(|x| x.id == id).ok_or_else(|| ApiError::not_found("Destino"))?;
        if let Some(o) = body.as_object_mut() {
            o.remove("id");
            if o.get("streamKey").and_then(|k| k.as_str()).map(|k| is_masked(k) || k.is_empty()).unwrap_or(false) {
                o.remove("streamKey");
            }
        }
        let mut v = serde_json::to_value(&*d)?;
        merge_json(&mut v, body);
        *d = serde_json::from_value(v)?;
        Ok(Json(Destination { stream_key: mask(&d.stream_key), ..d.clone() }))
    })
}

async fn delete_destination(State(core): State<St>, Path(id): Path<String>) -> StatusCode {
    core.update(|s| s.destinations.retain(|d| d.id != id));
    StatusCode::NO_CONTENT
}

// ------------------------------------------------------------------ chat

#[derive(Deserialize)]
struct ChatConnBody {
    platform: ChatPlatform,
    channel: Option<String>,
    enabled: Option<bool>,
    token: Option<String>,
}

async fn put_chat_connection(State(core): State<St>, Json(b): Json<ChatConnBody>) -> Json<Vec<ChatConnection>> {
    core.update(|s| {
        if !s.chat.iter().any(|c| c.platform == b.platform) {
            s.chat.push(ChatConnection { platform: b.platform, channel: String::new(), enabled: false, token: String::new(), state: ConnState::Disconnected, error: None });
        }
        let c = s.chat.iter_mut().find(|c| c.platform == b.platform).unwrap();
        if let Some(ch) = b.channel {
            c.channel = ch.trim().to_string();
        }
        if let Some(e) = b.enabled {
            c.enabled = e;
        }
        if let Some(t) = b.token.filter(|t| !is_masked(t)) {
            c.token = t.trim().to_string();
        }
    });
    Json(core.read(|s| s.masked().chat))
}

#[derive(Deserialize)]
struct ChatSendBody {
    text: String,
    platforms: Option<Vec<ChatPlatform>>,
}

async fn chat_send(State(core): State<St>, Json(b): Json<ChatSendBody>) -> ApiResult<StatusCode> {
    let text = b.text.trim();
    if text.is_empty() {
        return Err(ApiError::bad("Mensaje vacío"));
    }
    let n = core.chat.send(text, b.platforms);
    core.chat.local_echo(&core, "Tú", text, false);
    if n == 0 {
        core.notify("warning", "No hay chats conectados con permiso de escritura (añade el token de Twitch)");
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct IdBody {
    id: String,
}

async fn chat_delete(State(core): State<St>, Json(b): Json<IdBody>) -> StatusCode {
    core.chat.delete(&b.id);
    StatusCode::NO_CONTENT
}

async fn chat_highlight_get(State(core): State<St>) -> Json<Option<ChatHighlight>> {
    Json(core.chat.highlight.lock().clone())
}

async fn chat_highlight(State(core): State<St>, Json(b): Json<IdBody>) -> Result<StatusCode, ApiError> {
    if core.chat.set_highlight(&core, Some(&b.id)) {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::bad("message not found"))
    }
}

async fn chat_highlight_clear(State(core): State<St>) -> StatusCode {
    core.chat.set_highlight(&core, None);
    StatusCode::NO_CONTENT
}

async fn chat_history(State(core): State<St>) -> Json<Vec<ChatMessage>> {
    Json(core.chat.history.lock().iter().cloned().collect())
}

// ------------------------------------------------------------------ alerts / AI

#[derive(Deserialize)]
struct TypeBody {
    #[serde(rename = "type")]
    kind: AlertType,
    /// Optional user-made design to show (alert designer).
    #[serde(default)]
    design: Option<String>,
}

async fn alert_test(State(core): State<St>, Json(b): Json<TypeBody>) -> StatusCode {
    core.alerts.test_design(b.kind, b.design).await;
    StatusCode::NO_CONTENT
}

async fn alert_skip(State(core): State<St>) -> StatusCode {
    core.alerts.skip();
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct LoyaltyQuery {
    #[serde(default)]
    q: String,
    #[serde(default)]
    limit: Option<usize>,
}

async fn loyalty_list(State(core): State<St>, axum::extract::Query(q): axum::extract::Query<LoyaltyQuery>) -> Json<Value> {
    let (rows, total) = core.loyalty.leaderboard(q.limit.unwrap_or(100).min(1000), &q.q);
    Json(json!({ "viewers": rows, "total": total }))
}

#[derive(Deserialize)]
struct LoyaltySetBody {
    key: String,
    points: i64,
}

async fn loyalty_set(State(core): State<St>, Json(b): Json<LoyaltySetBody>) -> Result<StatusCode, ApiError> {
    if core.loyalty.set(&b.key, b.points) {
        core.loyalty.save();
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::bad("viewer not found"))
    }
}

async fn loyalty_reset(State(core): State<St>) -> StatusCode {
    core.loyalty.reset();
    StatusCode::NO_CONTENT
}

async fn poll_get(State(core): State<St>) -> Json<Option<crate::polls::Poll>> {
    Json(core.polls.current())
}

async fn poll_start(State(core): State<St>, Json(b): Json<crate::polls::NewPoll>) -> Result<Json<crate::polls::Poll>, ApiError> {
    core.polls.start(&core, b).map(Json).map_err(ApiError::bad)
}

async fn poll_end(State(core): State<St>) -> Json<Option<crate::polls::Poll>> {
    Json(core.polls.end(&core))
}

async fn songs_get(State(core): State<St>) -> Json<crate::songs::SongQueue> {
    Json(core.songs.state())
}

#[derive(Deserialize)]
struct SongAddBody {
    url: String,
}

async fn songs_add(State(core): State<St>, Json(b): Json<SongAddBody>) -> Result<Json<crate::songs::Song>, ApiError> {
    core.songs.request(&core, &b.url, None).await.map(|(s, _)| Json(s)).map_err(ApiError::bad)
}

async fn songs_clear(State(core): State<St>) -> StatusCode {
    core.songs.clear(&core);
    StatusCode::NO_CONTENT
}

async fn songs_next(State(core): State<St>) -> StatusCode {
    core.songs.next(&core);
    StatusCode::NO_CONTENT
}

async fn songs_ended(State(core): State<St>, Json(b): Json<IdBody>) -> StatusCode {
    core.songs.ended(&core, &b.id);
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct SongDurationBody {
    id: String,
    sec: u32,
    #[serde(default)]
    title: Option<String>,
}

async fn songs_duration(State(core): State<St>, Json(b): Json<SongDurationBody>) -> StatusCode {
    core.songs.duration(&core, &b.id, b.sec, b.title.as_deref());
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct SongPauseBody {
    paused: bool,
}

async fn songs_pause(State(core): State<St>, Json(b): Json<SongPauseBody>) -> StatusCode {
    core.songs.set_paused(&core, b.paused);
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct SongVolumeBody {
    volume: u32,
}

async fn songs_volume(State(core): State<St>, Json(b): Json<SongVolumeBody>) -> StatusCode {
    core.songs.set_volume(&core, b.volume);
    StatusCode::NO_CONTENT
}

async fn songs_remove(State(core): State<St>, Path(id): Path<String>) -> StatusCode {
    core.songs.remove(&core, &id);
    StatusCode::NO_CONTENT
}

/// Replace the counters (name, command, template…; values included).
async fn counters_put(State(core): State<St>, Json(list): Json<Vec<Counter>>) -> Json<Vec<Counter>> {
    Json(core.update(|s| {
        s.counters = list;
        s.counters.clone()
    }))
}

#[derive(Deserialize)]
struct CounterBody {
    #[serde(default)]
    delta: i64,
    #[serde(default)]
    value: i64,
}

async fn counter_add(State(core): State<St>, Path(id): Path<String>, Json(b): Json<CounterBody>) -> Result<Json<Value>, ApiError> {
    crate::counters::add(&core, &id, b.delta).map(|v| Json(json!({ "value": v }))).ok_or_else(|| ApiError::bad("counter not found"))
}

async fn counter_set(State(core): State<St>, Path(id): Path<String>, Json(b): Json<CounterBody>) -> Result<Json<Value>, ApiError> {
    crate::counters::set(&core, &id, b.value).map(|v| Json(json!({ "value": v }))).ok_or_else(|| ApiError::bad("counter not found"))
}

/// Countdown look and subathon settings (the time itself changes with POST).
async fn countdown_put(State(core): State<St>, Json(mut b): Json<Countdown>) -> Json<Countdown> {
    Json(core.update(|s| {
        b.ends_at = s.countdown.ends_at;
        b.paused_left_ms = s.countdown.paused_left_ms;
        s.countdown = b;
        s.countdown.clone()
    }))
}

#[derive(Deserialize)]
struct CountdownBody {
    action: String,
    #[serde(default)]
    seconds: i64,
}

async fn countdown_action(State(core): State<St>, Json(b): Json<CountdownBody>) -> Json<Countdown> {
    Json(crate::counters::countdown(&core, &b.action, b.seconds))
}

async fn giveaway_get(State(core): State<St>) -> Json<Option<crate::giveaway::Giveaway>> {
    Json(core.giveaways.current())
}

async fn giveaway_start(State(core): State<St>, Json(b): Json<crate::giveaway::NewGiveaway>) -> Result<Json<crate::giveaway::Giveaway>, ApiError> {
    core.giveaways.start(&core, b).map(Json).map_err(ApiError::bad)
}

async fn giveaway_close(State(core): State<St>) -> Json<Option<crate::giveaway::Giveaway>> {
    Json(core.giveaways.close(&core))
}

async fn giveaway_draw(State(core): State<St>) -> Result<Json<crate::giveaway::Giveaway>, ApiError> {
    core.giveaways.draw(&core).map(Json).map_err(ApiError::bad)
}

async fn giveaway_clear(State(core): State<St>) -> StatusCode {
    core.giveaways.clear(&core);
    StatusCode::NO_CONTENT
}

#[derive(Deserialize)]
struct ResolveBody {
    winner: usize,
}

async fn poll_resolve(State(core): State<St>, Json(b): Json<ResolveBody>) -> Result<Json<crate::polls::Poll>, ApiError> {
    core.polls.resolve(&core, b.winner).map(Json).map_err(ApiError::bad)
}

async fn poll_clear(State(core): State<St>) -> StatusCode {
    core.polls.clear(&core);
    StatusCode::NO_CONTENT
}

async fn credits_get(State(core): State<St>) -> Json<Value> {
    Json(core.sessions.credits())
}

/// Clear the label values: {"scope": "session"} (this stream's totals) or "all".
async fn labels_reset(State(core): State<St>, Json(b): Json<serde_json::Value>) -> StatusCode {
    let all = b["scope"].as_str() == Some("all");
    core.update(|s| {
        if all {
            s.labels = LabelData::default();
        } else {
            s.labels.session.clear();
            s.labels.session_top.clear();
        }
    });
    StatusCode::NO_CONTENT
}

async fn alerts_recent(State(core): State<St>) -> Json<Vec<AlertEvent>> {
    Json(core.alerts.recent.lock().iter().cloned().collect())
}

#[derive(Deserialize)]
struct TextBody {
    text: String,
}

#[derive(Deserialize)]
struct SpeakBody {
    text: String,
    /// Only synthesize (voice test in the app): nothing plays on stream.
    #[serde(default)]
    preview: bool,
}

async fn tts_speak(State(core): State<St>, Json(b): Json<SpeakBody>) -> ApiResult<Json<Value>> {
    let id = if b.preview { core.tts.synthesize(&b.text).await?.0 } else { core.tts.speak(&b.text).await? };
    Ok(Json(json!({ "url": format!("/api/v1/tts/audio/{id}") })))
}

async fn tts_audio(State(core): State<St>, Path(id): Path<String>) -> Response {
    match core.tts.get(&id) {
        Some((bytes, mime)) => ([(header::CONTENT_TYPE, mime)], Body::from(bytes.to_vec())).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn ai_cohost(State(core): State<St>, Json(b): Json<TextBody>) -> ApiResult<Json<Value>> {
    let reply = core.ai.ask_cohost("Streamer", &b.text).await?;
    let speak = core.read(|s| s.ai.cohost.speak && s.ai.tts.provider != "none");
    if speak {
        let c = core.clone();
        let r = reply.clone();
        tokio::spawn(async move {
            let _ = c.tts.speak(&r).await;
        });
    }
    Ok(Json(json!({ "reply": reply })))
}

#[derive(Deserialize)]
struct TranslateBody {
    /// Chat message to translate (its translation is kept and broadcast).
    id: Option<String>,
    text: Option<String>,
    to: Option<String>,
}
async fn chat_translate(State(core): State<St>, Json(b): Json<TranslateBody>) -> ApiResult<Json<Value>> {
    let text = match (&b.text, &b.id) {
        (Some(t), _) => t.clone(),
        (None, Some(id)) => core.chat.history.lock().iter().find(|m| &m.id == id).map(|m| m.text.clone()).ok_or_else(|| ApiError::bad("Ese mensaje ya no está en el historial"))?,
        _ => return Err(ApiError::bad("Falta el texto")),
    };
    let to = b.to.clone().filter(|t| !t.is_empty()).unwrap_or_else(|| core.read(|s| if s.ai.assist.translate_to.is_empty() { s.general.language.clone() } else { s.ai.assist.translate_to.clone() }));
    let translated = core.ai.translate(&text, &to).await?;
    if let (Some(id), Some(t)) = (&b.id, &translated) {
        if let Some(m) = core.chat.history.lock().iter_mut().find(|m| &m.id == id) {
            m.translated = Some(t.clone());
        }
        core.emit(ServerEvent::ChatTranslated { id: id.clone(), text: t.clone() });
    }
    Ok(Json(json!({ "text": translated })))
}

async fn sessions_list(State(core): State<St>) -> Json<Value> {
    Json(json!(core.sessions.list()))
}
async fn session_get(State(core): State<St>, Path(id): Path<String>) -> ApiResult<Json<crate::sessions::Session>> {
    core.sessions.get(&id).map(Json).ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "No existe ese directo".into()))
}
async fn session_delete(State(core): State<St>, Path(id): Path<String>) -> StatusCode {
    if core.sessions.delete(&id) {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
}
async fn session_insights(State(core): State<St>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let text = crate::sessions::insights(&core, &id).await?;
    Ok(Json(json!({ "text": text })))
}

async fn chat_summary(State(core): State<St>) -> ApiResult<Json<Value>> {
    let text = core.ai.summarize_chat(&core).await?;
    Ok(Json(json!({ "text": text })))
}

async fn ai_test(State(core): State<St>) -> Json<Value> {
    let (ok, models, error) = core.ai.test().await;
    Json(json!({ "ok": ok, "models": models, "error": error }))
}

// ------------------------------------------------------------------ misc

async fn pairing(State(core): State<St>) -> Json<PairingInfo> {
    Json(crate::pairing::info(core.port, &core.token()))
}

async fn update_check(State(core): State<St>) -> ApiResult<Json<UpdateInfo>> {
    crate::update::check(&core).await.map(Json).map_err(|e| ApiError::bad(format!("No se pudo comprobar: {e}")))
}

async fn ws_handler(State(core): State<St>, device: Option<axum::Extension<crate::remote::DeviceId>>, ws: WebSocketUpgrade) -> Response {
    let device = device.map(|d| d.0 .0);
    ws.on_upgrade(move |socket| async move {
        let Some(id) = device else { return ws_session(core, socket, None).await };
        core.remote.session_started(&id);
        ws_session(core.clone(), socket, Some(id.clone())).await;
        core.remote.session_ended(&id);
    })
}

async fn state_json(core: &Arc<Core>) -> String {
    let c = core.clone();
    tokio::task::spawn_blocking(move || serde_json::to_string(&ServerEvent::State(Box::new(c.public_state()))).unwrap_or_default()).await.unwrap_or_default()
}

async fn ws_session(core: Arc<Core>, mut socket: WebSocket, device: Option<String>) {
    let mut rx = core.subscribe_events();
    let mut kick = core.remote.subscribe_kick();
    let initial = state_json(&core).await;
    if socket.send(Message::Text(initial.into())).await.is_err() {
        return;
    }
    let mut ping = tokio::time::interval(Duration::from_secs(20));
    loop {
        tokio::select! {
            ev = rx.recv() => match ev {
                Ok(text) => {
                    if socket.send(Message::Text(text.to_string().into())).await.is_err() { break; }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let s = state_json(&core).await;
                    if socket.send(Message::Text(s.into())).await.is_err() { break; }
                }
                Err(_) => break,
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
            _ = ping.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() { break; }
            }
            k = kick.recv(), if device.is_some() => {
                if let Ok(id) = k {
                    if id == "*" || Some(&id) == device.as_ref() {
                        let _ = socket.send(Message::Close(None)).await;
                        break;
                    }
                }
            }
        }
    }
}

// ------------------------------------------------------------------ uploads (drag & drop)

/// Save a dropped file into <data dir>/media and return its absolute path.
async fn upload(State(core): State<St>, axum::extract::Query(q): axum::extract::Query<HashMap<String, String>>, body: axum::body::Bytes) -> ApiResult<Json<Value>> {
    let raw = q.get("name").cloned().unwrap_or_else(|| "archivo".into());
    let file_name: String = std::path::Path::new(&raw)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "archivo".into())
        .chars()
        .map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') { '_' } else { c })
        .collect();
    if body.is_empty() {
        return Err(ApiError::bad("Archivo vacío"));
    }
    let dir = core.data_dir.join("media");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| ApiError::bad(e.to_string()))?;
    let (stem, ext) = match file_name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (file_name.clone(), String::new()),
    };
    let mut path = dir.join(&file_name);
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    tokio::fs::write(&path, &body).await.map_err(|e| ApiError::bad(e.to_string()))?;
    Ok(Json(json!({ "path": path.to_string_lossy() })))
}

// ------------------------------------------------------------------ MCP (AI assistants)

/// MCP "Streamable HTTP" endpoint (JSON responses). Only from this PC, and only when enabled.
async fn mcp(State(core): State<St>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Json(msg): Json<Value>) -> Response {
    if !addr.ip().is_loopback() {
        return ApiError(StatusCode::FORBIDDEN, "El MCP de Vexcast solo acepta conexiones desde este PC".into()).into_response();
    }
    if !core.read(|s| s.general.mcp_enabled) {
        return ApiError(StatusCode::FORBIDDEN, "El MCP está desactivado en Ajustes → General".into()).into_response();
    }
    let replies: Vec<Value> = match msg {
        Value::Array(batch) => {
            let mut out = vec![];
            for m in batch {
                if let Some(r) = crate::mcp::handle(core.clone(), m).await {
                    out.push(r);
                }
            }
            out
        }
        m => crate::mcp::handle(core.clone(), m).await.into_iter().collect(),
    };
    match replies.len() {
        0 => StatusCode::ACCEPTED.into_response(),
        1 => Json(replies.into_iter().next().unwrap()).into_response(),
        _ => Json(Value::Array(replies)).into_response(),
    }
}

// ------------------------------------------------------------------ remote devices (managed from the PC only)

pub(super) fn local_only(addr: &SocketAddr) -> ApiResult<()> {
    if addr.ip().is_loopback() {
        Ok(())
    } else {
        Err(ApiError(StatusCode::FORBIDDEN, "Solo se puede gestionar desde el PC".into()))
    }
}

async fn remote_devices(State(core): State<St>, ConnectInfo(addr): ConnectInfo<SocketAddr>) -> ApiResult<Json<Vec<RemoteDevice>>> {
    local_only(&addr)?;
    Ok(Json(core.remote.list(&core)))
}

#[derive(Deserialize)]
struct DevicePatch {
    blocked: Option<bool>,
    name: Option<String>,
    role: Option<String>,
}

async fn update_remote_device(State(core): State<St>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Path(id): Path<String>, Json(b): Json<DevicePatch>) -> ApiResult<StatusCode> {
    local_only(&addr)?;
    let mut found = false;
    core.update(|s| {
        if let Some(d) = s.remote_devices.iter_mut().find(|d| d.id == id) {
            found = true;
            if let Some(v) = b.blocked {
                d.blocked = v;
            }
            if let Some(r) = b.role.as_deref().filter(|r| matches!(*r, "admin" | "moderator" | "viewer")) {
                d.role = r.to_string();
            }
            if let Some(n) = b.name.as_ref().filter(|n| !n.trim().is_empty()) {
                d.name = n.trim().to_string();
            }
        }
    });
    if !found {
        return Err(ApiError::not_found("Dispositivo"));
    }
    if b.blocked == Some(true) {
        core.remote.kick(&id);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn forget_remote_device(State(core): State<St>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Path(id): Path<String>) -> ApiResult<StatusCode> {
    local_only(&addr)?;
    core.update(|s| s.remote_devices.retain(|d| d.id != id));
    core.remote.kick(&id);
    Ok(StatusCode::NO_CONTENT)
}

/// New pairing code: every paired device is disconnected and has to scan the new QR.
async fn reset_remote_token(State(core): State<St>, ConnectInfo(addr): ConnectInfo<SocketAddr>) -> ApiResult<Json<Value>> {
    local_only(&addr)?;
    core.update(|s| s.api_token = crate::util::random_token(32));
    core.remote.kick("*");
    Ok(Json(json!(crate::pairing::info(core.port, &core.token()))))
}

#[derive(Deserialize)]
struct ExportAlertsBody {
    /// Design ids (empty: all).
    #[serde(default)]
    ids: Vec<String>,
    path: String,
}

/// Save user-made alerts (+ their media) as a `.vxalert` file.
async fn export_alerts(State(core): State<St>, Json(b): Json<ExportAlertsBody>) -> ApiResult<Json<Value>> {
    let designs: Vec<AlertDesign> = core.read(|s| s.widgets.alert_box.designs.iter().filter(|d| b.ids.is_empty() || b.ids.contains(&d.id)).cloned().collect());
    if designs.is_empty() {
        return Err(ApiError::bad("No hay alertas que exportar"));
    }
    let path = std::path::PathBuf::from(b.path.trim());
    let n = tokio::task::spawn_blocking(move || crate::alert_pack::export(designs, &path)).await.map_err(|e| ApiError::bad(e.to_string()))??;
    Ok(Json(json!({ "count": n })))
}

/// Add the alerts of a `.vxalert` (or `.json`) file to the library.
async fn import_alerts(State(core): State<St>, Json(b): Json<ImportMediaBody>) -> ApiResult<Json<Value>> {
    let path = std::path::PathBuf::from(b.path.trim());
    let media = core.data_dir.join("media").join("alerts");
    let designs = tokio::task::spawn_blocking(move || crate::alert_pack::import(&path, &media)).await.map_err(|e| ApiError::bad(e.to_string()))??;
    let ids: Vec<String> = designs.iter().map(|d| d.id.clone()).collect();
    core.update(|s| s.widgets.alert_box.designs.extend(designs));
    Ok(Json(json!({ "count": ids.len(), "ids": ids })))
}

#[derive(Deserialize)]
struct ImportMediaBody {
    path: String,
}

/// Copy a local file (picked in the file dialog) into <data dir>/media; returns its new path.
/// Files already inside the data folder are returned as they are.
async fn import_media(State(core): State<St>, Json(b): Json<ImportMediaBody>) -> ApiResult<Json<Value>> {
    let src = std::path::PathBuf::from(b.path.trim());
    if !src.is_file() {
        return Err(ApiError::bad("No se encontró el archivo"));
    }
    if let (Ok(c), Ok(root)) = (std::fs::canonicalize(&src), std::fs::canonicalize(&core.data_dir)) {
        if c.starts_with(&root) {
            return Ok(Json(json!({ "path": src.to_string_lossy() })));
        }
    }
    let dir = core.data_dir.join("media");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| ApiError::bad(e.to_string()))?;
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "archivo".into());
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.clone(), String::new()),
    };
    let mut path = dir.join(&name);
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    tokio::fs::copy(&src, &path).await.map_err(|e| ApiError::bad(e.to_string()))?;
    Ok(Json(json!({ "path": path.to_string_lossy() })))
}

/// Serve a file from Vexcast's data folder (alert media, theme files) to the widgets:
/// `GET /files?path=<absolute path>`. Anything outside the data folder is refused.
async fn data_file(State(core): State<St>, axum::extract::Query(q): axum::extract::Query<HashMap<String, String>>, req: Request) -> Response {
    let Some(raw) = q.get("path") else { return StatusCode::BAD_REQUEST.into_response() };
    let (Ok(path), Ok(root)) = (std::fs::canonicalize(raw), std::fs::canonicalize(&core.data_dir)) else { return StatusCode::NOT_FOUND.into_response() };
    if !path.starts_with(&root) || !path.is_file() {
        return StatusCode::FORBIDDEN.into_response();
    }
    // Only media (what overlays show and play): never config, tokens or other data files.
    const MEDIA: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "apng", "svg", "bmp", "webm", "mp4", "mov", "mkv", "m4v", "mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "ttf", "otf", "woff", "woff2"];
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    if !MEDIA.contains(&ext.as_str()) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match tower::ServiceExt::oneshot(tower_http::services::ServeFile::new(path), req).await {
        Ok(r) => r.into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

// ------------------------------------------------------------------ OAuth accounts

fn platform_ok(p: &str) -> ApiResult<()> {
    if crate::oauth::PLATFORMS.contains(&p) {
        Ok(())
    } else {
        Err(ApiError::not_found("Plataforma"))
    }
}

async fn oauth_start(State(core): State<St>, Path(p): Path<String>) -> ApiResult<Json<Value>> {
    platform_ok(&p)?;
    Ok(Json(core.oauth.start(&p).await?))
}

async fn oauth_cancel(State(core): State<St>, Path(p): Path<String>) -> ApiResult<StatusCode> {
    platform_ok(&p)?;
    core.oauth.cancel(&p);
    Ok(StatusCode::NO_CONTENT)
}

async fn oauth_disconnect(State(core): State<St>, Path(p): Path<String>) -> ApiResult<StatusCode> {
    platform_ok(&p)?;
    core.oauth.disconnect(&p)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ApplyBody {
    destination: Option<bool>,
    chat: Option<bool>,
}

async fn oauth_apply(State(core): State<St>, Path(p): Path<String>, Json(b): Json<ApplyBody>) -> ApiResult<Json<Value>> {
    platform_ok(&p)?;
    let r = core.oauth.apply(&p, b.destination.unwrap_or(false), b.chat.unwrap_or(false)).await?;
    core.notify("success", format!("Cuenta de {} aplicada", crate::oauth::pretty(&p)));
    Ok(Json(r))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StreamInfoBody {
    title: Option<String>,
    category: Option<String>,
    category_id: Option<String>,
}

async fn oauth_stream_info(State(core): State<St>, Path(p): Path<String>, Json(b): Json<StreamInfoBody>) -> ApiResult<StatusCode> {
    platform_ok(&p)?;
    core.oauth.set_stream_info(&p, b.title, b.category, b.category_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn oauth_get_stream_info(State(core): State<St>, Path(p): Path<String>) -> ApiResult<Json<crate::oauth::StreamInfo>> {
    platform_ok(&p)?;
    Ok(Json(core.oauth.get_stream_info(&p).await?))
}

async fn oauth_categories(State(core): State<St>, Path(p): Path<String>, axum::extract::Query(q): axum::extract::Query<HashMap<String, String>>) -> ApiResult<Json<Vec<crate::oauth::StreamCategory>>> {
    platform_ok(&p)?;
    Ok(Json(core.oauth.search_categories(&p, q.get("q").map(String::as_str).unwrap_or("")).await?))
}

/// Browser redirect after logging in to Kick/YouTube.
async fn oauth_callback(State(core): State<St>, axum::extract::Query(q): axum::extract::Query<HashMap<String, String>>) -> Response {
    let page = |title: &str, msg: &str| {
        let html = format!(
            "<!doctype html><html lang=es><meta charset=utf-8><title>Vexcast</title><body style=\"font-family:system-ui;background:#0a0a0a;color:#fafafa;display:grid;place-items:center;height:100vh;margin:0\"><div style=\"text-align:center\"><h1 style=\"font-size:22px\">{}</h1><p style=\"color:#a1a1aa\">{}</p></div></body></html>",
            title, msg
        );
        ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response()
    };
    if let Some(e) = q.get("error") {
        return page("No se pudo conectar la cuenta", &format!("{e}. Vuelve a Vexcast e inténtalo de nuevo."));
    }
    let (Some(code), Some(state)) = (q.get("code"), q.get("state")) else {
        return page("Solicitud inválida", "Falta el código de autorización.");
    };
    match core.oauth.callback(code, state).await {
        Ok(msg) => page("¡Listo!", &format!("{msg}. Ya puedes cerrar esta pestaña y volver a Vexcast.")),
        Err(e) => page("No se pudo conectar la cuenta", &e.to_string()),
    }
}

async fn kofi_webhook(State(core): State<St>, Form(form): Form<HashMap<String, String>>) -> ApiResult<StatusCode> {
    let data = form.get("data").ok_or_else(|| ApiError::bad("falta el campo data"))?;
    crate::alerts::handle_kofi(&core, data).await.map_err(|e| ApiError(StatusCode::UNAUTHORIZED, e))?;
    Ok(StatusCode::OK)
}
