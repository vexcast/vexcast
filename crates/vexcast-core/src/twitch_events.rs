//! Twitch EventSub over WebSocket: follows (Twitch only sends them this way, never in chat),
//! plus the channel's latest follower, follower / subscriber totals and top cheerer for the
//! labels, so they show real data from the first minute.

use crate::core::Core;
use crate::model::*;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

const WS_URL: &str = "wss://eventsub.wss.twitch.tv/ws";
const HELIX: &str = "https://api.twitch.tv/helix";

/// Keep a session open while a Twitch account is connected.
pub async fn run(core: Arc<Core>) {
    let mut wait = 5u64;
    loop {
        if core.is_stopping() {
            return;
        }
        if core.oauth.token("twitch").is_none() {
            tokio::time::sleep(Duration::from_secs(30)).await;
            continue;
        }
        match session(&core).await {
            Ok(()) => wait = 5,
            Err(e) => {
                tracing::warn!("twitch eventsub: {e}");
                wait = (wait * 2).min(120);
            }
        }
        tokio::time::sleep(Duration::from_secs(wait)).await;
    }
}

async fn helix(core: &Arc<Core>, token: &str, cid: &str, path: &str) -> anyhow::Result<Value> {
    let r = core.http.get(format!("{HELIX}{path}")).header("Client-Id", cid).bearer_auth(token).send().await?;
    let status = r.status();
    let v: Value = r.json().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("Twitch {status}: {}", v["message"].as_str().unwrap_or_default());
    }
    Ok(v)
}

/// Latest follower, totals and top cheerer from the Twitch API.
async fn refresh_labels(core: &Arc<Core>, token: &str, cid: &str, id: &str) {
    if let Ok(v) = helix(core, token, cid, &format!("/channels/followers?broadcaster_id={id}&first=1")).await {
        let total = v["total"].as_f64();
        let latest = v["data"][0]["user_name"].as_str().map(String::from);
        core.update(|s| {
            if let Some(t) = total {
                s.labels.totals.insert("followers".into(), t);
            }
            if let Some(name) = latest {
                if s.labels.latest.get("follow").is_none_or(|e| e.user != name && e.ts < now_ms() - 60_000) {
                    s.labels.latest.insert("follow".into(), LabelEvent { user: name, amount: None, currency: None, ts: now_ms() });
                }
            }
        });
    }
    if let Ok(v) = helix(core, token, cid, &format!("/subscriptions?broadcaster_id={id}&first=1")).await {
        if let Some(t) = v["total"].as_f64() {
            core.update(|s| {
                s.labels.totals.insert("subs".into(), t);
            });
        }
    }
    if let Ok(v) = helix(core, token, cid, "/bits/leaderboard?count=1&period=all").await {
        if let (Some(name), Some(score)) = (v["data"][0]["user_name"].as_str(), v["data"][0]["score"].as_f64()) {
            core.update(|s| {
                if s.labels.top.get("bits").is_none_or(|e| e.amount.unwrap_or(0.0) < score) {
                    s.labels.top.insert("bits".into(), LabelEvent { user: name.to_string(), amount: Some(score), currency: None, ts: now_ms() });
                }
            });
        }
    }
}

async fn session(core: &Arc<Core>) -> anyhow::Result<()> {
    let t = core.oauth.access("twitch").await?;
    let cid = crate::oauth::client_id("twitch");
    if cid.is_empty() || t.user_id.is_empty() {
        anyhow::bail!("falta el client id o el usuario de Twitch");
    }
    refresh_labels(core, &t.access_token, &cid, &t.user_id).await;
    let mut last_refresh = Instant::now();

    let mut url = WS_URL.to_string();
    let (mut ws, _) = tokio_tungstenite::connect_async(&url).await?;
    let mut keepalive = Duration::from_secs(30);
    let mut subscribed = false;
    loop {
        let msg = match tokio::time::timeout(keepalive + Duration::from_secs(10), ws.next()).await {
            Ok(Some(Ok(m))) => m,
            Ok(Some(Err(e))) => return Err(e.into()),
            Ok(None) => anyhow::bail!("Twitch cerró la conexión"),
            Err(_) => anyhow::bail!("sin noticias de Twitch"),
        };
        if core.is_stopping() {
            return Ok(());
        }
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Ping(p) => {
                let _ = ws.send(Message::Pong(p)).await;
                continue;
            }
            Message::Close(_) => anyhow::bail!("Twitch cerró la conexión"),
            _ => continue,
        };
        let v: Value = serde_json::from_str(&text).unwrap_or_default();
        match v["metadata"]["message_type"].as_str().unwrap_or_default() {
            "session_welcome" => {
                if let Some(k) = v["payload"]["session"]["keepalive_timeout_seconds"].as_u64() {
                    keepalive = Duration::from_secs(k.max(10));
                }
                if !subscribed {
                    let sid = v["payload"]["session"]["id"].as_str().unwrap_or_default();
                    let body = json!({
                        "type": "channel.follow",
                        "version": "2",
                        "condition": { "broadcaster_user_id": t.user_id, "moderator_user_id": t.user_id },
                        "transport": { "method": "websocket", "session_id": sid },
                    });
                    let r = core.http.post(format!("{HELIX}/eventsub/subscriptions")).header("Client-Id", &cid).bearer_auth(&t.access_token).json(&body).send().await?;
                    if !r.status().is_success() {
                        let e: Value = r.json().await.unwrap_or_default();
                        anyhow::bail!("no se pudo suscribir a los follows: {}", e["message"].as_str().unwrap_or("error"));
                    }
                    subscribed = true;
                }
            }
            "notification" => {
                let ev = &v["payload"]["event"];
                if v["payload"]["subscription"]["type"].as_str() == Some("channel.follow") {
                    if let Some(name) = ev["user_name"].as_str() {
                        core.alerts.push(AlertType::Follow, ChatPlatform::Twitch, name, None, None, None, false).await;
                    }
                }
            }
            "session_reconnect" => {
                // Move to the new address; subscriptions carry over.
                if let Some(u) = v["payload"]["session"]["reconnect_url"].as_str() {
                    url = u.to_string();
                    let (nws, _) = tokio_tungstenite::connect_async(&url).await?;
                    let _ = ws.close(None).await;
                    ws = nws;
                }
            }
            "revocation" => anyhow::bail!("Twitch retiró el permiso; vuelve a conectar la cuenta"),
            _ => {}
        }
        if last_refresh.elapsed() > Duration::from_secs(600) {
            last_refresh = Instant::now();
            if let Ok(t2) = core.oauth.access("twitch").await {
                refresh_labels(core, &t2.access_token, &cid, &t2.user_id).await;
            }
        }
    }
}
