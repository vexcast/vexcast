//! Twitch chat over IRC-WebSocket. Anonymous (read-only) or with an OAuth token
//! (scopes: chat:read chat:edit, optional moderator:manage:chat_messages).

use super::{backoff, ConnCtx, Outgoing};
use crate::model::*;
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

const IRC_URL: &str = "wss://irc-ws.chat.twitch.tv:443";

struct Auth {
    login: String,
    user_id: String,
    client_id: String,
    token: String,
}

async fn validate(token: &str) -> anyhow::Result<Auth> {
    let t = token.trim().trim_start_matches("oauth:").to_string();
    let r = reqwest::Client::new().get("https://id.twitch.tv/oauth2/validate").header("Authorization", format!("OAuth {t}")).send().await?;
    if !r.status().is_success() {
        anyhow::bail!("Token de Twitch inválido o caducado");
    }
    let v: serde_json::Value = r.json().await?;
    Ok(Auth {
        login: v["login"].as_str().unwrap_or_default().to_string(),
        user_id: v["user_id"].as_str().unwrap_or_default().to_string(),
        client_id: v["client_id"].as_str().unwrap_or_default().to_string(),
        token: t,
    })
}

/// The chat keeps a copy of the account's access token, which expires after a few hours:
/// get a fresh one from the connected Twitch account (refreshing it) and save it for the chat.
async fn renewed(ctx: &ConnCtx, old: &str) -> Option<Auth> {
    let core = ctx.core.upgrade()?;
    core.oauth.token("twitch")?;
    let mut fresh = core.oauth.access("twitch").await.ok()?;
    if fresh.access_token.trim_start_matches("oauth:") == old.trim().trim_start_matches("oauth:") {
        // Same (dead) token: force a refresh.
        core.oauth.expire("twitch");
        fresh = core.oauth.access("twitch").await.ok()?;
    }
    let auth = validate(&fresh.access_token).await.ok()?;
    let token = fresh.access_token.clone();
    core.update(|s| {
        if let Some(c) = s.chat.iter_mut().find(|c| c.platform == ChatPlatform::Twitch) {
            c.token = token;
        }
    });
    Some(auth)
}

pub async fn run(ctx: ConnCtx, channel: String, token: String, mut rx: mpsc::Receiver<Outgoing>) {
    let channel = channel.trim_start_matches('#').to_lowercase();
    let mut attempt = 0u32;
    loop {
        ctx.set_state(ConnState::Connecting, None);
        let auth = if token.trim().is_empty() {
            None
        } else {
            match validate(&token).await {
                Ok(a) => Some(a),
                Err(e) => match renewed(&ctx, &token).await {
                    // Saving the new token restarts this connection with it.
                    Some(a) => Some(a),
                    None => {
                        ctx.set_state(ConnState::Error, Some(format!("{e}. Vuelve a conectar tu cuenta de Twitch en Cuentas")));
                        backoff(&mut attempt).await;
                        continue;
                    }
                },
            }
        };
        match session(&ctx, &channel, auth.as_ref(), &mut rx, &mut attempt).await {
            Ok(()) => {}
            Err(e) => ctx.set_state(ConnState::Error, Some(e.to_string())),
        }
        backoff(&mut attempt).await;
    }
}

async fn session(ctx: &ConnCtx, channel: &str, auth: Option<&Auth>, rx: &mut mpsc::Receiver<Outgoing>, attempt: &mut u32) -> anyhow::Result<()> {
    let (ws, _) = tokio_tungstenite::connect_async(IRC_URL).await?;
    let (mut tx, mut stream) = ws.split();
    tx.send(Message::Text("CAP REQ :twitch.tv/tags twitch.tv/commands".into())).await?;
    match auth {
        Some(a) => {
            tx.send(Message::Text(format!("PASS oauth:{}", a.token).into())).await?;
            tx.send(Message::Text(format!("NICK {}", a.login).into())).await?;
        }
        None => {
            let n: u32 = rand::random::<u32>() % 89_999 + 10_000;
            tx.send(Message::Text(format!("NICK justinfan{n}").into())).await?;
        }
    }
    tx.send(Message::Text(format!("JOIN #{channel}").into())).await?;
    let mut broadcaster_id: Option<String> = None;
    let http = reqwest::Client::new();
    let mut badges = Badges::new();

    loop {
        tokio::select! {
            msg = stream.next() => {
                let Some(msg) = msg else { return Ok(()) };
                let Message::Text(text) = msg? else { continue };
                for line in text.as_str().split("\r\n").filter(|l| !l.is_empty()) {
                    if line.starts_with("PING") {
                        tx.send(Message::Text(line.replacen("PING", "PONG", 1).into())).await?;
                        continue;
                    }
                    let m = parse_irc(line);
                    match m.command.as_str() {
                        "001" => {}
                        "JOIN" | "ROOMSTATE" => {
                            if let Some(id) = m.tags.get("room-id") {
                                if broadcaster_id.as_deref() != Some(id.as_str()) {
                                    badges = fetch_badges(ctx, &http, auth, id).await;
                                }
                                broadcaster_id = Some(id.clone());
                            }
                            *attempt = 0;
                            ctx.set_state(ConnState::Connected, None);
                        }
                        "NOTICE" => {
                            if m.trailing.to_lowercase().contains("login") || m.trailing.contains("authentication") {
                                anyhow::bail!("Twitch rechazó el inicio de sesión: {}", m.trailing);
                            }
                        }
                        "RECONNECT" => return Ok(()),
                        "PRIVMSG" => {
                            let user = user_from(&m, &badges);
                            if let Some(bits) = m.tags.get("bits").and_then(|b| b.parse::<f64>().ok()) {
                                ctx.alert(AlertType::Bits, &user.name, Some(bits), None, Some(m.trailing.clone()));
                            }
                            ctx.message(ChatMessage {
                                id: m.tags.get("id").cloned().unwrap_or_else(new_id),
                                platform: ChatPlatform::Twitch,
                                channel: channel.to_string(),
                                user,
                                text: m.trailing.trim_start_matches("\u{1}ACTION ").trim_end_matches('\u{1}').to_string(),
                                ts: m.tags.get("tmi-sent-ts").and_then(|t| t.parse().ok()).unwrap_or_else(now_ms),
                                is_bot: false,
                                flagged: false,
                                viewer: None,
                                question: false,
                                translated: None,
                            });
                        }
                        "USERNOTICE" => {
                            let name = m.tags.get("display-name").cloned().unwrap_or_default();
                            let msg = if m.trailing.is_empty() { None } else { Some(m.trailing.clone()) };
                            let num = |k: &str| m.tags.get(k).and_then(|v| v.parse::<f64>().ok());
                            match m.tags.get("msg-id").map(String::as_str) {
                                Some("sub") | Some("resub") => ctx.alert(AlertType::Subscription, &name, num("msg-param-cumulative-months"), None, msg),
                                Some("submysterygift") => ctx.alert(AlertType::GiftSub, &name, num("msg-param-mass-gift-count"), None, None),
                                Some("subgift") if !m.tags.contains_key("msg-param-community-gift-id") => ctx.alert(AlertType::GiftSub, &name, Some(1.0), None, None),
                                Some("raid") => {
                                    let raider = m.tags.get("msg-param-displayName").cloned().unwrap_or(name);
                                    ctx.alert(AlertType::Raid, &raider, num("msg-param-viewerCount"), None, None)
                                }
                                _ => {}
                            }
                        }
                        "CLEARMSG" => {
                            if let Some(id) = m.tags.get("target-msg-id") { ctx.deleted(id); }
                        }
                        _ => {}
                    }
                }
            }
            out = rx.recv() => {
                let Some(out) = out else { return Ok(()) };
                match out {
                    Outgoing::Say(text) => {
                        if auth.is_some() {
                            let text = text.replace(['\r', '\n'], " ");
                            tx.send(Message::Text(format!("PRIVMSG #{channel} :{text}").into())).await?;
                        }
                    }
                    Outgoing::Delete(id) => {
                        if let (Some(a), Some(b)) = (auth, broadcaster_id.as_ref()) {
                            let _ = http
                                .delete("https://api.twitch.tv/helix/moderation/chat")
                                .query(&[("broadcaster_id", b.as_str()), ("moderator_id", a.user_id.as_str()), ("message_id", id.as_str())])
                                .header("Authorization", format!("Bearer {}", a.token))
                                .header("Client-Id", &a.client_id)
                                .send()
                                .await;
                        }
                    }
                }
            }
        }
    }
}

/// "set/version" → (image url, title), global badges overridden by the channel's own.
type Badges = HashMap<String, (String, String)>;

/// Badge pictures from Helix (needs a token: the chat's own, or the connected Twitch account).
async fn fetch_badges(ctx: &ConnCtx, http: &reqwest::Client, auth: Option<&Auth>, room: &str) -> Badges {
    let creds = match auth {
        Some(a) => Some((a.token.clone(), a.client_id.clone())),
        None => match ctx.core.upgrade() {
            Some(core) => core.oauth.access("twitch").await.ok().map(|t| (t.access_token, crate::oauth_config::get("VEXCAST_TWITCH_CLIENT_ID"))),
            None => None,
        },
    };
    let mut out = Badges::new();
    let Some((token, client_id)) = creds.filter(|(_, c)| !c.is_empty()) else { return out };
    for url in ["https://api.twitch.tv/helix/chat/badges/global".to_string(), format!("https://api.twitch.tv/helix/chat/badges?broadcaster_id={room}")] {
        let Ok(r) = http.get(&url).bearer_auth(&token).header("Client-Id", &client_id).send().await else { continue };
        let Ok(v) = r.json::<serde_json::Value>().await else { continue };
        for set in v["data"].as_array().into_iter().flatten() {
            let Some(set_id) = set["set_id"].as_str() else { continue };
            for ver in set["versions"].as_array().into_iter().flatten() {
                if let (Some(id), Some(img)) = (ver["id"].as_str(), ver["image_url_2x"].as_str().or(ver["image_url_1x"].as_str())) {
                    out.insert(format!("{set_id}/{id}"), (img.to_string(), ver["title"].as_str().unwrap_or(set_id).to_string()));
                }
            }
        }
    }
    out
}

fn user_from(m: &Irc, known: &Badges) -> ChatUser {
    let login = m.prefix.split('!').next().unwrap_or_default().to_string();
    let name = m.tags.get("display-name").filter(|n| !n.is_empty()).cloned().unwrap_or(login.clone());
    let badges = m
        .tags
        .get("badges")
        .map(|b| {
            b.split(',')
                .filter(|x| !x.is_empty())
                .map(|x| {
                    let id = x.split('/').next().unwrap_or(x);
                    let found = known.get(x);
                    ChatBadge {
                        id: id.to_string(),
                        label: found.map(|(_, t)| t.clone()).unwrap_or_else(|| badge_label(id).to_string()),
                        image: found.map(|(u, _)| u.clone()),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    ChatUser { id: m.tags.get("user-id").cloned().unwrap_or(login), name, color: m.tags.get("color").filter(|c| !c.is_empty()).cloned(), badges }
}

fn badge_label(id: &str) -> &str {
    match id {
        "broadcaster" => "Streamer",
        "moderator" => "Moderador",
        "vip" => "VIP",
        "subscriber" => "Suscriptor",
        "founder" => "Fundador",
        "partner" => "Verificado",
        _ => id,
    }
}

#[derive(Debug, Default)]
pub struct Irc {
    pub tags: HashMap<String, String>,
    pub prefix: String,
    pub command: String,
    pub params: Vec<String>,
    pub trailing: String,
}

pub fn parse_irc(line: &str) -> Irc {
    let mut m = Irc::default();
    let mut rest = line;
    if let Some(r) = rest.strip_prefix('@') {
        let (tags, r) = r.split_once(' ').unwrap_or((r, ""));
        for kv in tags.split(';') {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            m.tags.insert(k.to_string(), unescape_tag(v));
        }
        rest = r;
    }
    if let Some(r) = rest.strip_prefix(':') {
        let (p, r) = r.split_once(' ').unwrap_or((r, ""));
        m.prefix = p.to_string();
        rest = r;
    }
    let (head, trailing) = match rest.split_once(" :") {
        Some((h, t)) => (h, t),
        None => (rest, ""),
    };
    let mut parts = head.split_whitespace();
    m.command = parts.next().unwrap_or_default().to_string();
    m.params = parts.map(String::from).collect();
    m.trailing = trailing.to_string();
    m
}

fn unescape_tag(v: &str) -> String {
    let mut o = String::with_capacity(v.len());
    let mut it = v.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() {
                Some(':') => o.push(';'),
                Some('s') => o.push(' '),
                Some('r') => o.push('\r'),
                Some('n') => o.push('\n'),
                Some(x) => o.push(x),
                None => {}
            }
        } else {
            o.push(c);
        }
    }
    o
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_privmsg() {
        let l = "@badge-info=;badges=moderator/1,subscriber/12;color=#FF0000;display-name=Pepe;id=abc-123;user-id=42;tmi-sent-ts=1700000000000 :pepe!pepe@pepe.tmi.twitch.tv PRIVMSG #canal :hola mundo :)";
        let m = parse_irc(l);
        assert_eq!(m.command, "PRIVMSG");
        assert_eq!(m.trailing, "hola mundo :)");
        assert_eq!(m.tags["display-name"], "Pepe");
        let mut known = Badges::new();
        known.insert("subscriber/12".into(), ("https://example/sub12.png".into(), "Suscriptor de 1 año".into()));
        let u = user_from(&m, &known);
        assert_eq!(u.badges.len(), 2);
        assert_eq!(u.badges[1].image.as_deref(), Some("https://example/sub12.png"));
        assert_eq!(u.badges[0].image, None);
        assert_eq!(u.color.as_deref(), Some("#FF0000"));
    }
    #[test]
    fn parses_raid() {
        let l = r"@msg-id=raid;msg-param-viewerCount=25;msg-param-displayName=Amiga;display-name=Amiga :tmi.twitch.tv USERNOTICE #canal";
        let m = parse_irc(l);
        assert_eq!(m.command, "USERNOTICE");
        assert_eq!(m.tags["msg-param-viewerCount"], "25");
    }
    #[test]
    fn tag_escape() {
        assert_eq!(unescape_tag(r"hola\smundo\:"), "hola mundo;");
    }
}
