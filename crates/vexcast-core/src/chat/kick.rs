//! Kick chat (read) through the realtime websocket used by kick.com.
//!
//! kick.com asks `web.kick.com/api/v1/realtime/channels/{id}/chat/connection` which
//! realtime provider to use: currently Centrifugo (older builds used Pusher). Both
//! deliver the same `App\Events\*` payloads. Sending goes through the official API
//! with the connected account.

use super::{backoff, ConnCtx, Outgoing};
use crate::model::*;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const REALTIME_API: &str = "https://web.kick.com/api/v1/realtime";
const CENTRIFUGO_FALLBACK: &str = "wss://realtime.us-west-2.platform.kick.com/connection/websocket";

struct Channel {
    id: u64,
    chatroom: u64,
    /// Channel subscriber badges: (months, image url), ascending.
    sub_badges: Vec<(u64, String)>,
}

enum Provider {
    Centrifugo(String),
    Pusher { key: String, cluster: String },
}

pub async fn run(ctx: ConnCtx, channel: String, http: reqwest::Client, mut rx: mpsc::Receiver<Outgoing>) {
    let slug = channel.trim().trim_start_matches("https://kick.com/").trim_matches('/').to_lowercase();
    let mut attempt = 0u32;
    loop {
        ctx.set_state(ConnState::Connecting, None);
        let res = async {
            let ch = channel_ids(&http, &slug).await?;
            match provider(&http, ch.id).await {
                Provider::Centrifugo(url) => centrifugo(&ctx, &http, &url, &slug, &ch, &mut rx, &mut attempt).await,
                Provider::Pusher { key, cluster } => pusher(&ctx, &key, &cluster, &slug, &ch, &mut rx, &mut attempt).await,
            }
        }
        .await;
        if let Err(e) = res {
            ctx.set_state(ConnState::Error, Some(e.to_string()));
        }
        backoff(&mut attempt).await;
    }
}

async fn channel_ids(http: &reqwest::Client, slug: &str) -> anyhow::Result<Channel> {
    // Manual override: "slug:CHATROOM_ID" (channel id unknown → realtime fallback URL).
    if let Some((_, id)) = slug.split_once(':') {
        if let Ok(n) = id.parse() {
            return Ok(Channel { id: 0, chatroom: n, sub_badges: vec![] });
        }
    }
    // Channel slugs use "-" where usernames have "_" (emanuel_dev → emanuel-dev).
    let mut candidates = vec![slug.to_string()];
    if slug.contains('_') {
        candidates.push(slug.replace('_', "-"));
    }
    let mut last = String::new();
    for s in candidates {
        let r = http.get(format!("https://kick.com/api/v2/channels/{s}")).header("Accept", "application/json").header("User-Agent", UA).send().await?;
        if r.status().is_success() {
            let v: Value = r.json().await?;
            let chatroom = v["chatroom"]["id"].as_u64().ok_or_else(|| anyhow::anyhow!("Canal de Kick no encontrado"))?;
            let mut sub_badges: Vec<(u64, String)> = v["subscriber_badges"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|b| Some((b["months"].as_u64()?, b["badge_image"]["src"].as_str()?.to_string())))
                .collect();
            sub_badges.sort_by_key(|b| b.0);
            return Ok(Channel { id: v["id"].as_u64().unwrap_or(0), chatroom, sub_badges });
        }
        last = r.status().to_string();
    }
    anyhow::bail!("Kick no devolvió el canal «{slug}» ({last}). Usa el nombre que aparece en la dirección kick.com/…, o el id manual: canal:ID_DEL_CHATROOM")
}

/// Ask Kick which realtime provider to use (falls back to its Centrifugo endpoint).
async fn provider(http: &reqwest::Client, channel_id: u64) -> Provider {
    if channel_id > 0 {
        let body = json!({ "client": { "id": client_id(), "type": "web" }, "capabilities": { "accepted_providers": [{ "provider": "centrifugo" }, { "provider": "pusher" }] } });
        if let Ok(r) = http.post(format!("{REALTIME_API}/channels/{channel_id}/chat/connection")).header("User-Agent", UA).header("Accept", "application/json").json(&body).send().await {
            if let Ok(v) = r.json::<Value>().await {
                for c in v["data"]["connections"].as_array().into_iter().flatten() {
                    match c["provider"].as_str() {
                        Some("centrifugo") => {
                            if let Some(url) = c["credentials"]["url"].as_str() {
                                return Provider::Centrifugo(url.to_string());
                            }
                        }
                        Some("pusher") => {
                            if let (Some(key), Some(cluster)) = (c["credentials"]["app_key"].as_str(), c["credentials"]["cluster"].as_str()) {
                                return Provider::Pusher { key: key.into(), cluster: cluster.into() };
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    Provider::Centrifugo(CENTRIFUGO_FALLBACK.into())
}

fn client_id() -> String {
    format!("vexcast-{}", new_id())
}

async fn centrifugo(ctx: &ConnCtx, http: &reqwest::Client, url: &str, slug: &str, ch: &Channel, rx: &mut mpsc::Receiver<Outgoing>, attempt: &mut u32) -> anyhow::Result<()> {
    // Anonymous (guest) connection token.
    let v: Value = http
        .post(format!("{REALTIME_API}/auth/connection"))
        .header("User-Agent", UA)
        .header("Accept", "application/json")
        .json(&json!({ "client_id": client_id() }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let token = v["data"]["token"].as_str().ok_or_else(|| anyhow::anyhow!("Kick no dio acceso al chat en tiempo real"))?.to_string();
    let (ws, _) = tokio_tungstenite::connect_async(url).await?;
    let (mut tx, mut stream) = ws.split();
    tx.send(Message::Text(json!({ "connect": { "token": token, "name": "js" }, "id": 1 }).to_string().into())).await?;
    let mut channels = vec![format!("chatrooms.{}.v2", ch.chatroom)];
    if ch.id > 0 {
        channels.push(format!("channel.{}", ch.id));
    }
    loop {
        tokio::select! {
            msg = stream.next() => {
                let Some(msg) = msg else { return Ok(()) };
                let Message::Text(text) = msg? else { continue };
                // Several JSON replies can arrive in one frame, one per line.
                for line in text.as_str().lines().filter(|l| !l.trim().is_empty()) {
                    let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
                    if v.as_object().is_some_and(|o| o.is_empty()) {
                        tx.send(Message::Text("{}".into())).await?; // ping → pong
                        continue;
                    }
                    if v["id"] == 1 {
                        if !v["error"].is_null() {
                            anyhow::bail!("Kick rechazó la conexión del chat: {}", v["error"]["message"].as_str().unwrap_or("?"));
                        }
                        for (i, c) in channels.iter().enumerate() {
                            tx.send(Message::Text(json!({ "subscribe": { "channel": c }, "id": 2 + i }).to_string().into())).await?;
                        }
                        continue;
                    }
                    if v["id"] == 2 {
                        if !v["error"].is_null() {
                            anyhow::bail!("Kick no dejó leer el chat: {}", v["error"]["message"].as_str().unwrap_or("?"));
                        }
                        *attempt = 0;
                        ctx.set_state(ConnState::Connected, None);
                        continue;
                    }
                    let d = &v["push"]["pub"]["data"];
                    if let Some(event) = d["event"].as_str() {
                        let data: Value = d["data"].as_str().and_then(|s| serde_json::from_str(s).ok()).unwrap_or_else(|| d["data"].clone());
                        handle_event(ctx, slug, ch, event, &data);
                    }
                }
            }
            out = rx.recv() => {
                let Some(out) = out else { return Ok(()) };
                send(ctx, out).await;
            }
        }
    }
}

async fn pusher(ctx: &ConnCtx, key: &str, cluster: &str, slug: &str, ch: &Channel, rx: &mut mpsc::Receiver<Outgoing>, attempt: &mut u32) -> anyhow::Result<()> {
    let url = format!("wss://ws-{cluster}.pusher.com/app/{key}?protocol=7&client=js&version=8.4.0&flash=false");
    let (ws, _) = tokio_tungstenite::connect_async(url).await?;
    let (mut tx, mut stream) = ws.split();
    tx.send(Message::Text(json!({"event":"pusher:subscribe","data":{"auth":"","channel":format!("chatrooms.{}.v2", ch.chatroom)}}).to_string().into())).await?;
    loop {
        tokio::select! {
            msg = stream.next() => {
                let Some(msg) = msg else { return Ok(()) };
                let Message::Text(text) = msg? else { continue };
                let v: Value = match serde_json::from_str(text.as_str()) { Ok(v) => v, Err(_) => continue };
                let event = v["event"].as_str().unwrap_or_default();
                match event {
                    "pusher:ping" => { tx.send(Message::Text(json!({"event":"pusher:pong","data":{}}).to_string().into())).await?; }
                    "pusher:error" => anyhow::bail!("Kick (Pusher): {}", v["data"]["message"].as_str().unwrap_or("error")),
                    "pusher_internal:subscription_succeeded" => { *attempt = 0; ctx.set_state(ConnState::Connected, None); }
                    _ => {
                        let data: Value = v["data"].as_str().and_then(|d| serde_json::from_str(d).ok()).unwrap_or(Value::Null);
                        handle_event(ctx, slug, ch, event, &data);
                    }
                }
            }
            out = rx.recv() => {
                let Some(out) = out else { return Ok(()) };
                send(ctx, out).await;
            }
        }
    }
}

fn handle_event(ctx: &ConnCtx, slug: &str, ch: &Channel, event: &str, data: &Value) {
    match event {
        "App\\Events\\ChatMessageEvent" => {
            let sender = &data["sender"];
            let badges = sender["identity"]["badges"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|b| {
                    let kind = b["type"].as_str()?;
                    let label = b["text"].as_str().filter(|t| !t.is_empty()).unwrap_or(kind).to_string();
                    // Subscriber badge: the channel's own picture for that many months.
                    let image = (kind == "subscriber")
                        .then(|| {
                            let months = b["count"].as_u64().unwrap_or(1);
                            ch.sub_badges.iter().filter(|(m, _)| *m <= months).last().or(ch.sub_badges.first()).map(|(_, u)| u.clone())
                        })
                        .flatten();
                    Some(ChatBadge { id: kind.to_string(), label, image })
                })
                .collect();
            ctx.message(ChatMessage {
                id: data["id"].as_str().map(String::from).unwrap_or_else(new_id),
                platform: ChatPlatform::Kick,
                channel: slug.to_string(),
                user: ChatUser {
                    id: sender["id"].to_string(),
                    name: sender["username"].as_str().unwrap_or("?").to_string(),
                    color: sender["identity"]["color"].as_str().map(String::from),
                    badges,
                },
                text: strip_emotes(data["content"].as_str().unwrap_or_default()),
                ts: now_ms(),
                is_bot: false,
                flagged: false,
                viewer: None,
                question: false,
                translated: None,
            });
        }
        "App\\Events\\MessageDeletedEvent" => {
            if let Some(id) = data["message"]["id"].as_str() {
                ctx.deleted(id);
            }
        }
        "App\\Events\\SubscriptionEvent" => {
            let user = data["username"].as_str().unwrap_or("?");
            ctx.alert(AlertType::Subscription, user, data["months"].as_f64(), None, None);
        }
        "App\\Events\\GiftedSubscriptionsEvent" => {
            let user = data["gifter_username"].as_str().unwrap_or("?");
            let n = data["gifted_usernames"].as_array().map(|a| a.len() as f64);
            ctx.alert(AlertType::GiftSub, user, n, None, None);
        }
        "App\\Events\\StreamHostEvent" => {
            let user = data["host_username"].as_str().unwrap_or("?");
            ctx.alert(AlertType::Host, user, data["number_viewers"].as_f64(), None, None);
        }
        "App\\Events\\FollowersUpdated" => {
            if data["followed"].as_bool() == Some(true) {
                if let Some(user) = data["username"].as_str() {
                    ctx.alert(AlertType::Follow, user, None, None, None);
                }
            }
        }
        _ => {}
    }
}

async fn send(ctx: &ConnCtx, out: Outgoing) {
    if let Outgoing::Say(text) = out {
        // Sending needs a connected Kick account (OAuth, chat:write).
        if let Some(core) = ctx.core.upgrade() {
            if let Ok(t) = core.oauth.access("kick").await {
                let body = json!({ "broadcaster_user_id": t.user_id.parse::<u64>().unwrap_or(0), "content": text, "type": "user" });
                if let Ok(r) = core.http.post("https://api.kick.com/public/v1/chat").bearer_auth(&t.access_token).json(&body).send().await {
                    if !r.status().is_success() {
                        tracing::warn!("kick chat send: {}", r.status());
                    }
                }
            }
        }
    }
}

/// Kick encodes emotes as [emote:123:name]; keep just the name.
fn strip_emotes(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find("[emote:") {
        out.push_str(&rest[..start]);
        let after = &rest[start..];
        match after.find(']') {
            Some(end) => {
                let inner = &after[7..end];
                out.push_str(inner.split(':').nth(1).unwrap_or(""));
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(after);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn emotes() {
        assert_eq!(super::strip_emotes("hola [emote:37226:KEKW] jaja"), "hola KEKW jaja");
    }
}
