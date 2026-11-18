//! "Conectar con Twitch / Kick / YouTube": OAuth logins, token refresh and account actions
//! (auto-fill the stream key, connect chat, set title/category).

use crate::core::Core;
use crate::model::*;
use crate::oauth_config::get as cfg;
use base64::Engine as _;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;

pub const PLATFORMS: [&str; 3] = ["twitch", "kick", "youtube"];

const TWITCH_SCOPES: &str = "chat:read chat:edit channel:read:stream_key channel:manage:broadcast moderator:read:followers channel:read:subscriptions bits:read moderator:manage:chat_messages";
const KICK_SCOPES: &str = "user:read channel:read channel:write chat:write streamkey:read events:subscribe";
const YOUTUBE_SCOPES: &str = "https://www.googleapis.com/auth/youtube.force-ssl";

/// Persisted token (never sent to clients).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AccountToken {
    pub platform: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub scopes: Vec<String>,
    pub user_id: String,
    pub login: String,
    pub display_name: String,
    pub avatar_url: String,
}

/// Public view of an account.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedAccount {
    pub platform: String,
    pub available: bool,
    pub connected: bool,
    pub user_id: Option<String>,
    pub login: Option<String>,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub scopes: Vec<String>,
    pub pending: bool,
    pub error: Option<String>,
}

struct Pending {
    cancel: Arc<AtomicBool>,
    /// Browser flows: state -> PKCE verifier + redirect uri.
    state: String,
    verifier: String,
    redirect: String,
}

pub struct OAuth {
    core: Weak<Core>,
    pending: Mutex<HashMap<String, Pending>>,
    errors: Mutex<HashMap<String, String>>,
}

pub(crate) fn client_id(platform: &str) -> String {
    match platform {
        "twitch" => cfg("VEXCAST_TWITCH_CLIENT_ID"),
        "kick" => cfg("VEXCAST_KICK_CLIENT_ID"),
        "youtube" => cfg("VEXCAST_YOUTUBE_CLIENT_ID"),
        _ => String::new(),
    }
}

fn pkce() -> (String, String) {
    let verifier = crate::util::random_token(64);
    let digest = sha256(verifier.as_bytes());
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

impl OAuth {
    pub fn new(core: Weak<Core>) -> Arc<Self> {
        Arc::new(Self { core, pending: Mutex::new(HashMap::new()), errors: Mutex::new(HashMap::new()) })
    }

    fn core(&self) -> anyhow::Result<Arc<Core>> {
        self.core.upgrade().ok_or_else(|| anyhow::anyhow!("core stopped"))
    }

    pub fn accounts(&self, tokens: &[AccountToken]) -> Vec<ConnectedAccount> {
        let pending = self.pending.lock();
        let errors = self.errors.lock();
        PLATFORMS
            .iter()
            .map(|p| {
                let t = tokens.iter().find(|t| t.platform == *p);
                ConnectedAccount {
                    platform: p.to_string(),
                    available: !client_id(p).is_empty(),
                    connected: t.is_some(),
                    user_id: t.map(|t| t.user_id.clone()),
                    login: t.map(|t| t.login.clone()),
                    display_name: t.map(|t| t.display_name.clone()),
                    avatar_url: t.map(|t| t.avatar_url.clone()).filter(|a| !a.is_empty()),
                    scopes: t.map(|t| t.scopes.clone()).unwrap_or_default(),
                    pending: pending.contains_key(*p),
                    error: errors.get(*p).cloned(),
                }
            })
            .collect()
    }

    fn set_error(&self, platform: &str, e: Option<String>) {
        match e {
            Some(e) => {
                self.errors.lock().insert(platform.into(), e);
            }
            None => {
                self.errors.lock().remove(platform);
            }
        }
        if let Ok(c) = self.core() {
            c.broadcast_state();
        }
    }

    fn save_token(&self, t: AccountToken) {
        if let Ok(c) = self.core() {
            let name = if t.display_name.is_empty() { t.login.clone() } else { t.display_name.clone() };
            let platform = t.platform.clone();
            c.update(|s| {
                s.account_tokens.retain(|x| x.platform != t.platform);
                s.account_tokens.push(t);
            });
            c.notify("success", format!("Cuenta de {} conectada: {name}", pretty(&platform)));
        }
    }

    pub fn token(&self, platform: &str) -> Option<AccountToken> {
        self.core.upgrade()?.read(|s| s.account_tokens.iter().find(|t| t.platform == platform).cloned())
    }

    pub fn cancel(&self, platform: &str) {
        if let Some(p) = self.pending.lock().remove(platform) {
            p.cancel.store(true, Ordering::Release);
        }
        self.set_error(platform, None);
    }

    pub fn disconnect(&self, platform: &str) -> anyhow::Result<()> {
        let c = self.core()?;
        c.update(|s| s.account_tokens.retain(|t| t.platform != platform));
        Ok(())
    }

    /// Start a login. Returns what the UI must show/open.
    pub async fn start(self: &Arc<Self>, platform: &str) -> anyhow::Result<Value> {
        let cid = client_id(platform);
        if cid.is_empty() {
            anyhow::bail!("Falta configurar el Client ID de {} (ver docs/ACCOUNTS.md)", pretty(platform));
        }
        self.cancel(platform);
        let core = self.core()?;
        let cancel = Arc::new(AtomicBool::new(false));
        match platform {
            "twitch" => {
                let r: Value = core.http.post("https://id.twitch.tv/oauth2/device").form(&[("client_id", cid.as_str()), ("scopes", TWITCH_SCOPES)]).send().await?.json().await?;
                let device_code = r["device_code"].as_str().ok_or_else(|| anyhow::anyhow!("Twitch: {}", r["message"].as_str().unwrap_or("respuesta inválida")))?.to_string();
                let interval = r["interval"].as_u64().unwrap_or(5).max(1);
                let expires = r["expires_in"].as_u64().unwrap_or(1800);
                self.pending.lock().insert(platform.into(), Pending { cancel: cancel.clone(), state: String::new(), verifier: String::new(), redirect: String::new() });
                let me = self.clone();
                tokio::spawn(async move { me.twitch_poll(cid, device_code, interval, expires, cancel).await });
                core.broadcast_state();
                Ok(json!({ "mode": "device", "verificationUri": r["verification_uri"], "userCode": r["user_code"], "expiresIn": expires }))
            }
            "kick" | "youtube" => {
                let (verifier, challenge) = pkce();
                let state = crate::util::random_token(24);
                let redirect = if platform == "kick" { "http://localhost:7420/oauth/callback".to_string() } else { format!("http://127.0.0.1:{}/oauth/callback", core.port) };
                let url = if platform == "kick" {
                    format!(
                        "https://id.kick.com/oauth/authorize?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&state={}",
                        enc(&cid),
                        enc(&redirect),
                        enc(KICK_SCOPES),
                        challenge,
                        state
                    )
                } else {
                    format!(
                        "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&state={}&access_type=offline&prompt=consent",
                        enc(&cid),
                        enc(&redirect),
                        enc(YOUTUBE_SCOPES),
                        challenge,
                        state
                    )
                };
                if platform == "kick" && core.port != 7420 {
                    anyhow::bail!("El inicio de sesión de Kick necesita el puerto 7420 (está en uso por otra app)");
                }
                self.pending.lock().insert(platform.into(), Pending { cancel, state, verifier, redirect });
                core.broadcast_state();
                Ok(json!({ "mode": "browser", "url": url }))
            }
            _ => anyhow::bail!("Plataforma desconocida"),
        }
    }

    async fn twitch_poll(self: Arc<Self>, cid: String, device_code: String, interval: u64, expires: u64, cancel: Arc<AtomicBool>) {
        let Ok(core) = self.core() else { return };
        let deadline = std::time::Instant::now() + Duration::from_secs(expires);
        while std::time::Instant::now() < deadline && !cancel.load(Ordering::Acquire) {
            tokio::time::sleep(Duration::from_secs(interval)).await;
            let r = core
                .http
                .post("https://id.twitch.tv/oauth2/token")
                .form(&[("client_id", cid.as_str()), ("scopes", TWITCH_SCOPES), ("device_code", device_code.as_str()), ("grant_type", "urn:ietf:params:oauth:grant-type:device_code")])
                .send()
                .await;
            let Ok(r) = r else { continue };
            let v: Value = r.json().await.unwrap_or(Value::Null);
            if let Some(at) = v["access_token"].as_str() {
                let mut t = AccountToken {
                    platform: "twitch".into(),
                    access_token: at.into(),
                    refresh_token: v["refresh_token"].as_str().unwrap_or_default().into(),
                    expires_at: now_ms() + v["expires_in"].as_i64().unwrap_or(14_400) * 1000,
                    scopes: v["scope"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default(),
                    ..Default::default()
                };
                match twitch_user(&core.http, &cid, &t.access_token).await {
                    Ok(u) => {
                        t.user_id = u["id"].as_str().unwrap_or_default().into();
                        t.login = u["login"].as_str().unwrap_or_default().into();
                        t.display_name = u["display_name"].as_str().unwrap_or_default().into();
                        t.avatar_url = u["profile_image_url"].as_str().unwrap_or_default().into();
                    }
                    Err(e) => tracing::warn!("twitch user: {e}"),
                }
                self.pending.lock().remove("twitch");
                self.save_token(t);
                self.set_error("twitch", None);
                return;
            }
            match v["message"].as_str().unwrap_or("") {
                "authorization_pending" | "" => continue,
                "slow_down" => tokio::time::sleep(Duration::from_secs(5)).await,
                other => {
                    self.pending.lock().remove("twitch");
                    self.set_error("twitch", Some(format!("Twitch: {other}")));
                    return;
                }
            }
        }
        self.pending.lock().remove("twitch");
        if !cancel.load(Ordering::Acquire) {
            self.set_error("twitch", Some("El código caducó; vuelve a intentarlo".into()));
        }
    }

    /// Browser redirect target (`/oauth/callback?code=&state=`).
    pub async fn callback(self: &Arc<Self>, code: &str, state: &str) -> anyhow::Result<String> {
        let (platform, p) = {
            let mut pending = self.pending.lock();
            let platform = pending.iter().find(|(_, p)| !p.state.is_empty() && p.state == state).map(|(k, _)| k.clone()).ok_or_else(|| anyhow::anyhow!("Solicitud de inicio de sesión desconocida o caducada"))?;
            let p = pending.remove(&platform).unwrap();
            (platform, p)
        };
        let core = self.core()?;
        let res: anyhow::Result<AccountToken> = async {
            match platform.as_str() {
                "kick" => {
                    let cid = client_id("kick");
                    let proxy = cfg("VEXCAST_KICK_TOKEN_PROXY");
                    let secret = std::env::var("VEXCAST_KICK_CLIENT_SECRET").unwrap_or_default();
                    let form = [("grant_type", "authorization_code"), ("client_id", cid.as_str()), ("redirect_uri", p.redirect.as_str()), ("code_verifier", p.verifier.as_str()), ("code", code)];
                    let v: Value = if !secret.is_empty() {
                        let mut f = form.to_vec();
                        f.push(("client_secret", secret.as_str()));
                        core.http.post("https://id.kick.com/oauth/token").form(&f).send().await?.json().await?
                    } else if !proxy.is_empty() {
                        core.http.post(&proxy).form(&form).send().await?.json().await?
                    } else {
                        anyhow::bail!("Kick necesita configurar el proxy de tokens (ver docs/ACCOUNTS.md)");
                    };
                    let at = v["access_token"].as_str().ok_or_else(|| anyhow::anyhow!("Kick: {}", v["error_description"].as_str().or(v["error"].as_str()).unwrap_or("sin token")))?;
                    let mut t = AccountToken {
                        platform: "kick".into(),
                        access_token: at.into(),
                        refresh_token: v["refresh_token"].as_str().unwrap_or_default().into(),
                        expires_at: now_ms() + v["expires_in"].as_i64().unwrap_or(3600) * 1000,
                        scopes: v["scope"].as_str().map(|s| s.split_whitespace().map(String::from).collect()).unwrap_or_default(),
                        ..Default::default()
                    };
                    let u: Value = core.http.get("https://api.kick.com/public/v1/users").bearer_auth(&t.access_token).send().await?.json().await?;
                    let u = &u["data"][0];
                    t.user_id = u["user_id"].to_string().trim_matches('"').to_string();
                    t.display_name = u["name"].as_str().unwrap_or_default().into();
                    t.login = t.display_name.to_lowercase();
                    t.avatar_url = u["profile_picture"].as_str().unwrap_or_default().into();
                    Ok(t)
                }
                "youtube" => {
                    let cid = client_id("youtube");
                    let secret = cfg("VEXCAST_YOUTUBE_CLIENT_SECRET");
                    let v: Value = core
                        .http
                        .post("https://oauth2.googleapis.com/token")
                        .form(&[
                            ("grant_type", "authorization_code"),
                            ("client_id", cid.as_str()),
                            ("client_secret", secret.as_str()),
                            ("redirect_uri", p.redirect.as_str()),
                            ("code_verifier", p.verifier.as_str()),
                            ("code", code),
                        ])
                        .send()
                        .await?
                        .json()
                        .await?;
                    let at = v["access_token"].as_str().ok_or_else(|| anyhow::anyhow!("Google: {}", v["error_description"].as_str().unwrap_or("sin token")))?;
                    let mut t = AccountToken {
                        platform: "youtube".into(),
                        access_token: at.into(),
                        refresh_token: v["refresh_token"].as_str().unwrap_or_default().into(),
                        expires_at: now_ms() + v["expires_in"].as_i64().unwrap_or(3600) * 1000,
                        scopes: v["scope"].as_str().map(|s| s.split_whitespace().map(String::from).collect()).unwrap_or_default(),
                        ..Default::default()
                    };
                    let ch: Value = core.http.get("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true").bearer_auth(&t.access_token).send().await?.json().await?;
                    let item = &ch["items"][0];
                    t.user_id = item["id"].as_str().unwrap_or_default().into();
                    t.display_name = item["snippet"]["title"].as_str().unwrap_or_default().into();
                    t.login = item["snippet"]["customUrl"].as_str().unwrap_or(&t.display_name).to_string();
                    t.avatar_url = item["snippet"]["thumbnails"]["default"]["url"].as_str().unwrap_or_default().into();
                    Ok(t)
                }
                _ => anyhow::bail!("Plataforma desconocida"),
            }
        }
        .await;
        match res {
            Ok(t) => {
                let name = t.display_name.clone();
                self.save_token(t);
                self.set_error(&platform, None);
                Ok(format!("{} conectado como {name}", pretty(&platform)))
            }
            Err(e) => {
                self.set_error(&platform, Some(e.to_string()));
                Err(e)
            }
        }
    }

    /// Mark the access token as expired (the next `access` refreshes it).
    pub fn expire(&self, platform: &str) {
        if let Some(core) = self.core.upgrade() {
            core.update(|s| {
                if let Some(t) = s.account_tokens.iter_mut().find(|t| t.platform == platform) {
                    t.expires_at = 0;
                }
            });
        }
    }

    /// Valid access token (refreshing it if needed).
    pub async fn access(&self, platform: &str) -> anyhow::Result<AccountToken> {
        let mut t = self.token(platform).ok_or_else(|| anyhow::anyhow!("Conecta primero tu cuenta de {}", pretty(platform)))?;
        if t.expires_at - now_ms() > 120_000 || t.refresh_token.is_empty() {
            return Ok(t);
        }
        let core = self.core()?;
        let cid = client_id(platform);
        let v: Value = match platform {
            "twitch" => core.http.post("https://id.twitch.tv/oauth2/token").form(&[("client_id", cid.as_str()), ("grant_type", "refresh_token"), ("refresh_token", t.refresh_token.as_str())]).send().await?.json().await?,
            "youtube" => {
                let secret = cfg("VEXCAST_YOUTUBE_CLIENT_SECRET");
                core.http
                    .post("https://oauth2.googleapis.com/token")
                    .form(&[("client_id", cid.as_str()), ("client_secret", secret.as_str()), ("grant_type", "refresh_token"), ("refresh_token", t.refresh_token.as_str())])
                    .send()
                    .await?
                    .json()
                    .await?
            }
            "kick" => {
                let form = [("client_id", cid.as_str()), ("grant_type", "refresh_token"), ("refresh_token", t.refresh_token.as_str())];
                let proxy = cfg("VEXCAST_KICK_TOKEN_PROXY");
                let secret = std::env::var("VEXCAST_KICK_CLIENT_SECRET").unwrap_or_default();
                if !secret.is_empty() {
                    let mut f = form.to_vec();
                    f.push(("client_secret", secret.as_str()));
                    core.http.post("https://id.kick.com/oauth/token").form(&f).send().await?.json().await?
                } else {
                    core.http.post(&proxy).form(&form).send().await?.json().await?
                }
            }
            _ => anyhow::bail!("Plataforma desconocida"),
        };
        let at = v["access_token"].as_str().ok_or_else(|| anyhow::anyhow!("La sesión de {} caducó; vuelve a conectar la cuenta", pretty(platform)))?;
        t.access_token = at.into();
        if let Some(rt) = v["refresh_token"].as_str() {
            t.refresh_token = rt.into();
        }
        t.expires_at = now_ms() + v["expires_in"].as_i64().unwrap_or(3600) * 1000;
        let saved = t.clone();
        core.update(|s| {
            if let Some(x) = s.account_tokens.iter_mut().find(|x| x.platform == saved.platform) {
                *x = saved;
            }
        });
        Ok(t)
    }

    /// Create/update a destination with the account's stream key and/or connect chat.
    pub async fn apply(&self, platform: &str, destination: bool, chat: bool) -> anyhow::Result<Value> {
        let core = self.core()?;
        let t = self.access(platform).await?;
        let warnings: Vec<String> = vec![];
        let mut dest_id: Option<String> = None;
        if destination {
            let (service, server, key) = match platform {
                "twitch" => {
                    let cid = client_id("twitch");
                    let v: Value = core
                        .http
                        .get(format!("https://api.twitch.tv/helix/streams/key?broadcaster_id={}", t.user_id))
                        .header("Client-Id", &cid)
                        .bearer_auth(&t.access_token)
                        .send()
                        .await?
                        .json()
                        .await?;
                    let key = v["data"][0]["stream_key"].as_str().ok_or_else(|| anyhow::anyhow!("Twitch no devolvió la clave de transmisión"))?.to_string();
                    ("Twitch".to_string(), "rtmp://live.twitch.tv/app".to_string(), key)
                }
                "kick" => {
                    let v: Value = core.http.get("https://api.kick.com/public/v1/channels").bearer_auth(&t.access_token).send().await?.json().await?;
                    let ch = &v["data"][0];
                    let key = ch["stream"]["key"].as_str().or(ch["stream_key"].as_str()).unwrap_or_default().to_string();
                    let url = ch["stream"]["url"].as_str().or(ch["stream_url"].as_str()).unwrap_or_default().to_string();
                    if key.is_empty() || url.is_empty() {
                        anyhow::bail!("Kick no devolvió la clave de transmisión; cópiala desde kick.com/dashboard/settings/stream");
                    }
                    ("Custom".to_string(), url, key)
                }
                "youtube" => {
                    let v: Value = core.http.get("https://www.googleapis.com/youtube/v3/liveStreams?part=cdn,snippet&mine=true").bearer_auth(&t.access_token).send().await?.json().await?;
                    let mut item = v["items"][0].clone();
                    if item.is_null() {
                        let body = json!({ "snippet": { "title": "Vexcast" }, "cdn": { "frameRate": "variable", "ingestionType": "rtmp", "resolution": "variable" } });
                        item = core.http.post("https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn").bearer_auth(&t.access_token).json(&body).send().await?.json().await?;
                    }
                    let info = &item["cdn"]["ingestionInfo"];
                    let key = info["streamName"].as_str().ok_or_else(|| anyhow::anyhow!("YouTube no devolvió la clave (¿tienes la emisión en directo habilitada en el canal?)"))?.to_string();
                    let url = info["ingestionAddress"].as_str().unwrap_or("rtmp://a.rtmp.youtube.com/live2").to_string();
                    ("Custom".to_string(), url, key)
                }
                _ => anyhow::bail!("Plataforma desconocida"),
            };
            let name = format!("{} · {}", pretty(platform), if t.display_name.is_empty() { &t.login } else { &t.display_name });
            let id = core.update(|s| {
                if let Some(d) = s.destinations.iter_mut().find(|d| d.name.starts_with(&format!("{} · ", pretty(platform)))) {
                    d.service = service.clone();
                    d.server = server.clone();
                    d.stream_key = key.clone();
                    d.name = name.clone();
                    d.enabled = true;
                    d.id.clone()
                } else {
                    let d = Destination { id: new_id(), name: name.clone(), service: service.clone(), server: server.clone(), stream_key: key.clone(), enabled: true, canvas: "horizontal".into(), encoder_override: None };
                    let id = d.id.clone();
                    s.destinations.push(d);
                    id
                }
            });
            dest_id = Some(id);
        }
        if chat {
            let (p, channel, token) = match platform {
                "twitch" => (ChatPlatform::Twitch, t.login.clone(), t.access_token.clone()),
                // The chat needs the channel slug ("emanuel-dev"), not the username ("emanuel_dev").
                "kick" => {
                    let v: Value = core.http.get("https://api.kick.com/public/v1/channels").bearer_auth(&t.access_token).send().await?.json().await.unwrap_or(Value::Null);
                    let slug = v["data"][0]["slug"].as_str().map(String::from).unwrap_or_else(|| t.login.replace('_', "-"));
                    (ChatPlatform::Kick, slug, String::new())
                }
                "youtube" => (ChatPlatform::Youtube, t.user_id.clone(), format!("oauth:{}", t.access_token)),
                _ => unreachable!(),
            };
            core.update(|s| {
                if let Some(c) = s.chat.iter_mut().find(|c| c.platform == p) {
                    c.channel = channel.clone();
                    c.enabled = true;
                    if !token.is_empty() {
                        c.token = token.clone();
                    }
                }
            });
        }
        Ok(json!({ "destinationId": dest_id, "warnings": warnings }))
    }

    /// Current title and category on the platform.
    pub async fn get_stream_info(&self, platform: &str) -> anyhow::Result<StreamInfo> {
        let core = self.core()?;
        let t = self.access(platform).await?;
        match platform {
            "twitch" => {
                let cid = client_id("twitch");
                let v: Value = core
                    .http
                    .get("https://api.twitch.tv/helix/channels")
                    .query(&[("broadcaster_id", t.user_id.as_str())])
                    .header("Client-Id", &cid)
                    .bearer_auth(&t.access_token)
                    .send()
                    .await?
                    .error_for_status()?
                    .json()
                    .await?;
                let ch = &v["data"][0];
                let game_id = ch["game_id"].as_str().unwrap_or_default().to_string();
                let category = if game_id.is_empty() {
                    None
                } else {
                    // Box art comes from /games.
                    let g: Value = core
                        .http
                        .get("https://api.twitch.tv/helix/games")
                        .query(&[("id", game_id.as_str())])
                        .header("Client-Id", &cid)
                        .bearer_auth(&t.access_token)
                        .send()
                        .await?
                        .json()
                        .await
                        .unwrap_or(Value::Null);
                    Some(StreamCategory { id: game_id, name: ch["game_name"].as_str().unwrap_or_default().to_string(), image: twitch_box_art(&g["data"][0]["box_art_url"]) })
                };
                Ok(StreamInfo { title: ch["title"].as_str().unwrap_or_default().to_string(), category })
            }
            "kick" => {
                let v: Value = core.http.get("https://api.kick.com/public/v1/channels").bearer_auth(&t.access_token).send().await?.error_for_status()?.json().await?;
                let ch = &v["data"][0];
                let category = kick_category(&ch["category"]).filter(|c| c.id != "0");
                Ok(StreamInfo { title: ch["stream_title"].as_str().unwrap_or_default().to_string(), category })
            }
            _ => anyhow::bail!("No disponible para {}", pretty(platform)),
        }
    }

    /// Live viewers right now (None when the channel is offline).
    pub async fn viewer_count(&self, platform: &str) -> anyhow::Result<Option<u64>> {
        let core = self.core()?;
        let t = self.access(platform).await?;
        match platform {
            "twitch" => {
                let v: Value = core
                    .http
                    .get("https://api.twitch.tv/helix/streams")
                    .query(&[("user_id", t.user_id.as_str())])
                    .header("Client-Id", client_id("twitch"))
                    .bearer_auth(&t.access_token)
                    .send()
                    .await?
                    .error_for_status()?
                    .json()
                    .await?;
                Ok(v["data"][0]["viewer_count"].as_u64())
            }
            "kick" => {
                let v: Value = core.http.get("https://api.kick.com/public/v1/channels").bearer_auth(&t.access_token).send().await?.error_for_status()?.json().await?;
                let st = &v["data"][0]["stream"];
                Ok(if st["is_live"].as_bool() == Some(true) { st["viewer_count"].as_u64() } else { None })
            }
            _ => Ok(None),
        }
    }

    /// Search the platform's categories/games (empty query: popular ones where supported).
    pub async fn search_categories(&self, platform: &str, query: &str) -> anyhow::Result<Vec<StreamCategory>> {
        let core = self.core()?;
        let t = self.access(platform).await?;
        let q = query.trim();
        match platform {
            "twitch" => {
                let cid = client_id("twitch");
                let req = if q.is_empty() {
                    core.http.get("https://api.twitch.tv/helix/games/top").query(&[("first", "20")])
                } else {
                    core.http.get("https://api.twitch.tv/helix/search/categories").query(&[("query", q), ("first", "20")])
                };
                let v: Value = req.header("Client-Id", &cid).bearer_auth(&t.access_token).send().await?.error_for_status()?.json().await?;
                Ok(v["data"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|g| Some(StreamCategory { id: g["id"].as_str()?.to_string(), name: g["name"].as_str()?.to_string(), image: twitch_box_art(&g["box_art_url"]) }))
                            .collect()
                    })
                    .unwrap_or_default())
            }
            "kick" => {
                if q.is_empty() {
                    return Ok(vec![]);
                }
                // v1 takes ?q=, v2 takes ?name=; use whichever answers.
                let mut out = vec![];
                for (url, key) in [("https://api.kick.com/public/v1/categories", "q"), ("https://api.kick.com/public/v2/categories", "name")] {
                    let Ok(r) = core.http.get(url).query(&[(key, q)]).bearer_auth(&t.access_token).send().await else { continue };
                    if !r.status().is_success() {
                        continue;
                    }
                    let v: Value = r.json().await.unwrap_or(Value::Null);
                    out = v["data"].as_array().map(|a| a.iter().filter_map(kick_category).collect()).unwrap_or_default();
                    if !out.is_empty() {
                        break;
                    }
                }
                Ok(out)
            }
            _ => anyhow::bail!("No disponible para {}", pretty(platform)),
        }
    }

    /// Update title and/or category. `category_id` (from `search_categories`) wins over
    /// `category` (a name, matched with the platform's search).
    pub async fn set_stream_info(&self, platform: &str, title: Option<String>, category: Option<String>, category_id: Option<String>) -> anyhow::Result<()> {
        let core = self.core()?;
        let t = self.access(platform).await?;
        let title = title.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
        let category_id = category_id.filter(|s| !s.trim().is_empty());
        match platform {
            "twitch" => {
                let cid = client_id("twitch");
                let mut body = serde_json::Map::new();
                if let Some(title) = title {
                    body.insert("title".into(), json!(title));
                }
                if let Some(id) = category_id {
                    body.insert("game_id".into(), json!(id));
                } else if let Some(cat) = category.filter(|c| !c.trim().is_empty()) {
                    let v: Value = core
                        .http
                        .get("https://api.twitch.tv/helix/search/categories")
                        .query(&[("query", cat.as_str()), ("first", "1")])
                        .header("Client-Id", &cid)
                        .bearer_auth(&t.access_token)
                        .send()
                        .await?
                        .json()
                        .await?;
                    if let Some(id) = v["data"][0]["id"].as_str() {
                        body.insert("game_id".into(), json!(id));
                    }
                }
                let r = core
                    .http
                    .patch(format!("https://api.twitch.tv/helix/channels?broadcaster_id={}", t.user_id))
                    .header("Client-Id", &cid)
                    .bearer_auth(&t.access_token)
                    .json(&Value::Object(body))
                    .send()
                    .await?;
                if !r.status().is_success() {
                    anyhow::bail!("Twitch rechazó el cambio ({})", r.status());
                }
            }
            "kick" => {
                let mut body = serde_json::Map::new();
                if let Some(title) = title {
                    body.insert("stream_title".into(), json!(title));
                }
                let id = match (category_id, category.filter(|c| !c.trim().is_empty())) {
                    (Some(id), _) => Some(id),
                    (None, Some(name)) => self.search_categories("kick", &name).await?.into_iter().next().map(|c| c.id),
                    _ => None,
                };
                if let Some(id) = id {
                    body.insert("category_id".into(), json!(id.parse::<i64>().unwrap_or(0)));
                }
                if body.is_empty() {
                    return Ok(());
                }
                let r = core.http.patch("https://api.kick.com/public/v1/channels").bearer_auth(&t.access_token).json(&Value::Object(body)).send().await?;
                if !r.status().is_success() {
                    let status = r.status();
                    let text = r.text().await.unwrap_or_default();
                    anyhow::bail!("Kick rechazó el cambio ({status}) {}", text.chars().take(200).collect::<String>());
                }
            }
            _ => anyhow::bail!("Cambiar el título aún no está disponible para {}", pretty(platform)),
        }
        Ok(())
    }
}

/// Title and category of a channel.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub title: String,
    pub category: Option<StreamCategory>,
}

/// A game/category on a platform.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamCategory {
    pub id: String,
    pub name: String,
    pub image: Option<String>,
}

/// Twitch box art URLs carry a "{width}x{height}" template.
fn twitch_box_art(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(|s| s.replace("{width}", "52").replace("{height}", "72"))
}

fn kick_category(v: &Value) -> Option<StreamCategory> {
    let id = match &v["id"] {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => return None,
    };
    Some(StreamCategory { id, name: v["name"].as_str()?.to_string(), image: v["thumbnail"].as_str().filter(|s| !s.is_empty()).map(String::from) })
}

async fn twitch_user(http: &reqwest::Client, cid: &str, token: &str) -> anyhow::Result<Value> {
    let v: Value = http.get("https://api.twitch.tv/helix/users").header("Client-Id", cid).bearer_auth(token).send().await?.json().await?;
    Ok(v["data"][0].clone())
}

pub fn pretty(p: &str) -> &'static str {
    match p {
        "twitch" => "Twitch",
        "kick" => "Kick",
        "youtube" => "YouTube",
        _ => "la plataforma",
    }
}

fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

/// Minimal SHA-256 (for PKCE) to avoid an extra dependency.
fn sha256(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut msg = data.to_vec();
    let bitlen = (data.len() as u64) * 8;
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bitlen.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let mut a = h;
        for i in 0..64 {
            let s1 = a[4].rotate_right(6) ^ a[4].rotate_right(11) ^ a[4].rotate_right(25);
            let ch = (a[4] & a[5]) ^ (!a[4] & a[6]);
            let t1 = a[7].wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a[0].rotate_right(2) ^ a[0].rotate_right(13) ^ a[0].rotate_right(22);
            let maj = (a[0] & a[1]) ^ (a[0] & a[2]) ^ (a[1] & a[2]);
            let t2 = s0.wrapping_add(maj);
            a = [t1.wrapping_add(t2), a[0], a[1], a[2], a[3].wrapping_add(t1), a[4], a[5], a[6]];
        }
        for i in 0..8 {
            h[i] = h[i].wrapping_add(a[i]);
        }
    }
    let mut out = [0u8; 32];
    for (i, v) in h.iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn sha256_known() {
        let d = super::sha256(b"abc");
        let hex: String = d.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
