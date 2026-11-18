//! AI hub endpoints: engines, models from Hugging Face, downloads and local servers.
//! Installing or deleting anything is only allowed from this computer.

use super::{local_only, ApiError, ApiResult, St};
use crate::ai::hub::{ModelKind, Runtime};
use axum::extract::{ConnectInfo, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;

pub fn routes(r: Router<St>) -> Router<St> {
    r.route("/ai/hub", get(status))
        .route("/ai/hub/install", post(install))
        .route("/ai/hub/uninstall", post(uninstall))
        .route("/ai/hub/download", post(download))
        .route("/ai/hub/cancel", post(cancel))
        .route("/ai/hub/delete", post(delete))
        .route("/ai/hub/stop", post(stop))
        .route("/ai/hub/search", get(search))
        .route("/ai/hub/files", get(files))
        .route("/ai/hub/voices", get(voices))
}

async fn status(State(c): State<St>) -> Json<Value> {
    Json(c.hub.status())
}

#[derive(Deserialize)]
struct InstallBody {
    runtime: Runtime,
    backend: Option<String>,
}
async fn install(State(c): State<St>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Json(b): Json<InstallBody>) -> ApiResult<Json<Value>> {
    local_only(&addr)?;
    let id = c.hub.install(b.runtime, b.backend)?;
    Ok(Json(json!({ "job": id })))
}

#[derive(Deserialize)]
struct RuntimeBody {
    runtime: Runtime,
}
async fn uninstall(State(c): State<St>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Json(b): Json<RuntimeBody>) -> ApiResult<Json<Value>> {
    local_only(&addr)?;
    c.hub.uninstall(b.runtime).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct DownloadBody {
    kind: ModelKind,
    repo: String,
    file: String,
}
async fn download(State(c): State<St>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Json(b): Json<DownloadBody>) -> ApiResult<Json<Value>> {
    local_only(&addr)?;
    let id = c.hub.download_model(b.kind, &b.repo, &b.file)?;
    Ok(Json(json!({ "job": id })))
}

#[derive(Deserialize)]
struct IdBody {
    id: String,
}
async fn cancel(State(c): State<St>, Json(b): Json<IdBody>) -> Json<Value> {
    c.hub.cancel(&b.id);
    Json(json!({ "ok": true }))
}

#[derive(Deserialize)]
struct DeleteBody {
    kind: ModelKind,
    file: String,
}
async fn delete(State(c): State<St>, ConnectInfo(addr): ConnectInfo<SocketAddr>, Json(b): Json<DeleteBody>) -> ApiResult<Json<Value>> {
    local_only(&addr)?;
    c.hub.delete_model(b.kind, &b.file).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn stop(State(c): State<St>) -> Json<Value> {
    c.hub.stop_all().await;
    Json(json!({ "ok": true }))
}

async fn search(State(c): State<St>, Query(q): Query<HashMap<String, String>>) -> ApiResult<Json<Value>> {
    let text = q.get("q").map(String::as_str).unwrap_or("").trim();
    if text.is_empty() {
        return Err(ApiError::bad("Escribe qué modelo buscar"));
    }
    Ok(Json(c.hub.search(text).await?))
}

async fn files(State(c): State<St>, Query(q): Query<HashMap<String, String>>) -> ApiResult<Json<Value>> {
    let repo = q.get("repo").map(String::as_str).unwrap_or("");
    if repo.split('/').count() != 2 {
        return Err(ApiError::bad("Repositorio no válido (usuario/modelo)"));
    }
    Ok(Json(c.hub.files(repo, q.get("ext").map(String::as_str).unwrap_or("")).await?))
}

async fn voices(State(c): State<St>) -> ApiResult<Json<Value>> {
    Ok(Json(c.hub.voices().await?))
}
