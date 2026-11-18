//! YouTube live chat via the Data API v3 (read-only with an API key).
//! `channel` may be a video id, a channel id (UC...) or a @handle.

use super::{backoff, ConnCtx, Outgoing};
use crate::model::*;
use serde_json::Value;
use std::time::Duration;
use tokio::sync::mpsc;

const API: &str = "https://www.googleapis.com/youtube/v3";

pub async fn run(ctx: ConnCtx, channel: String, key: String, http: reqwest::Client, mut rx: mpsc::Receiver<Outgoing>) {
    if key.trim().is_empty() {
        ctx.set_state(ConnState::Error, Some("Añade una API key de YouTube Data API v3 (gratis en Google Cloud Console)".into()));
        return;
    }
    let mut attempt = 0u32;
    loop {
        ctx.set_state(ConnState::Connecting, None);
        // A connected account's token (copied as "oauth:…") lasts an hour: take a fresh one
        // from the account on every (re)connection.
        let mut key = key.clone();
        if key.starts_with("oauth:") {
            if let Some(core) = ctx.core.upgrade() {
                if core.oauth.token("youtube").is_some() {
                    match core.oauth.access("youtube").await {
                        Ok(t) => key = format!("oauth:{}", t.access_token),
                        Err(e) => {
                            ctx.set_state(ConnState::Error, Some(format!("{e}. Vuelve a conectar tu cuenta de YouTube en Cuentas")));
                            backoff(&mut attempt).await;
                            continue;
                        }
                    }
                }
            }
        }
        match session(&ctx, &channel, key.trim(), &http, &mut rx, &mut attempt).await {
            Ok(()) => {}
            Err(e) => ctx.set_state(ConnState::Error, Some(e.to_string())),
        }
        // Waiting for the stream to go live: retry slowly to save quota.
        backoff(&mut attempt).await;
        tokio::time::sleep(Duration::from_secs(20)).await;
    }
}

async fn get(http: &reqwest::Client, url: &str, q: &[(&str, &str)], key: &str) -> anyhow::Result<Value> {
    let mut query: Vec<(&str, &str)> = q.to_vec();
    // "oauth:<token>" = connected account (Vexcast login); otherwise an API key.
    let r = match key.strip_prefix("oauth:") {
        Some(token) => http.get(url).query(&query).bearer_auth(token).send().await?,
        None => {
            query.push(("key", key));
            http.get(url).query(&query).send().await?
        }
    };
    let status = r.status();
    let v: Value = r.json().await?;
    if !status.is_success() {
        let msg = v["error"]["message"].as_str().unwrap_or("error de la API de YouTube");
        anyhow::bail!("YouTube: {msg}");
    }
    Ok(v)
}

async fn resolve_video(http: &reqwest::Client, channel: &str, key: &str) -> anyhow::Result<String> {
    let c = channel.trim();
    if let Some(id) = c.split("v=").nth(1).map(|s| s.split('&').next().unwrap_or(s)) {
        return Ok(id.to_string());
    }
    if c.len() == 11 && !c.starts_with('@') {
        return Ok(c.to_string());
    }
    let channel_id = if c.starts_with("UC") && c.len() > 20 {
        c.to_string()
    } else {
        let handle = if c.starts_with('@') { c.to_string() } else { format!("@{c}") };
        let v = get(http, &format!("{API}/channels"), &[("part", "id"), ("forHandle", &handle)], key).await?;
        v["items"][0]["id"].as_str().ok_or_else(|| anyhow::anyhow!("No se encontró el canal {handle}"))?.to_string()
    };
    let v = get(http, &format!("{API}/search"), &[("part", "id"), ("channelId", &channel_id), ("eventType", "live"), ("type", "video")], key).await?;
    v["items"][0]["id"]["videoId"].as_str().map(String::from).ok_or_else(|| anyhow::anyhow!("El canal no está en directo ahora mismo"))
}

async fn session(ctx: &ConnCtx, channel: &str, key: &str, http: &reqwest::Client, rx: &mut mpsc::Receiver<Outgoing>, attempt: &mut u32) -> anyhow::Result<()> {
    let video = resolve_video(http, channel, key).await?;
    let v = get(http, &format!("{API}/videos"), &[("part", "liveStreamingDetails"), ("id", &video)], key).await?;
    let chat_id = v["items"][0]["liveStreamingDetails"]["activeLiveChatId"].as_str().ok_or_else(|| anyhow::anyhow!("Este video no tiene chat en vivo activo"))?.to_string();
    ctx.set_state(ConnState::Connected, None);
    *attempt = 0;
    let mut page: Option<String> = None;
    let mut first = true;
    loop {
        let mut q = vec![("liveChatId", chat_id.as_str()), ("part", "snippet,authorDetails"), ("maxResults", "200")];
        if let Some(p) = page.as_deref() {
            q.push(("pageToken", p));
        }
        let v = get(http, &format!("{API}/liveChat/messages"), &q, key).await?;
        page = v["nextPageToken"].as_str().map(String::from);
        // Skip the backlog on first poll (don't replay old alerts).
        if !first {
            for item in v["items"].as_array().cloned().unwrap_or_default() {
                handle_item(ctx, channel, &item);
            }
        }
        first = false;
        let wait = v["pollingIntervalMillis"].as_u64().unwrap_or(5000).max(3000);
        let deadline = tokio::time::Instant::now() + Duration::from_millis(wait);
        loop {
            tokio::select! {
                _ = tokio::time::sleep_until(deadline) => break,
                out = rx.recv() => {
                    if out.is_none() { return Ok(()); }
                    // Sending/deleting needs OAuth; not supported with an API key.
                }
            }
        }
    }
}

fn handle_item(ctx: &ConnCtx, channel: &str, item: &Value) {
    let sn = &item["snippet"];
    let au = &item["authorDetails"];
    let name = au["displayName"].as_str().unwrap_or("?").to_string();
    let mut badges = vec![];
    if au["isChatOwner"].as_bool() == Some(true) {
        badges.push(ChatBadge { id: "broadcaster".into(), label: "Streamer".into(), image: None });
    }
    if au["isChatModerator"].as_bool() == Some(true) {
        badges.push(ChatBadge { id: "moderator".into(), label: "Moderador".into(), image: None });
    }
    if au["isChatSponsor"].as_bool() == Some(true) {
        badges.push(ChatBadge { id: "member".into(), label: "Miembro".into(), image: None });
    }
    let text = sn["displayMessage"].as_str().unwrap_or_default().to_string();
    match sn["type"].as_str().unwrap_or_default() {
        "superChatEvent" | "superStickerEvent" => {
            let d = if sn["type"] == "superChatEvent" { &sn["superChatDetails"] } else { &sn["superStickerDetails"] };
            let amount = d["amountMicros"].as_str().and_then(|m| m.parse::<f64>().ok()).map(|m| m / 1_000_000.0);
            let comment = d["userComment"].as_str().map(String::from);
            ctx.alert(AlertType::Superchat, &name, amount, d["currency"].as_str().map(String::from), comment);
        }
        "newSponsorEvent" | "memberMilestoneChatEvent" => ctx.alert(AlertType::Member, &name, None, None, None),
        "membershipGiftingEvent" => {
            let n = sn["membershipGiftingDetails"]["giftMembershipsCount"].as_f64();
            ctx.alert(AlertType::GiftSub, &name, n, None, None)
        }
        _ => {}
    }
    if text.is_empty() {
        return;
    }
    ctx.message(ChatMessage {
        id: item["id"].as_str().map(String::from).unwrap_or_else(new_id),
        platform: ChatPlatform::Youtube,
        channel: channel.to_string(),
        user: ChatUser { id: au["channelId"].as_str().unwrap_or_default().to_string(), name, color: None, badges },
        text,
        ts: now_ms(),
        is_bot: false,
        flagged: false,
        viewer: None,
        question: false,
        translated: None,
    });
}
