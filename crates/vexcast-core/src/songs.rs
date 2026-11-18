//! Song requests from every platform: viewers queue YouTube videos with !sr <link>; the
//! songs overlay (songs.html, a browser source, so its audio goes into the stream) plays
//! the queue and reports back when a song starts, how long it is and when it ends.

use crate::core::Core;
use crate::model::*;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Weak};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub id: Id,
    pub video_id: String,
    pub title: String,
    pub author: String,
    pub requested_by: String,
    pub platform: Option<ChatPlatform>,
    /// Known once the player loads it.
    pub duration_sec: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SongQueue {
    pub current: Option<Song>,
    pub queue: Vec<Song>,
    pub paused: bool,
    /// 0..100
    pub volume: u32,
}

pub struct Songs {
    _core: Weak<Core>,
    q: Mutex<SongQueue>,
}

/// YouTube video id from a link or a bare id.
pub fn video_id(input: &str) -> Option<String> {
    let s = input.trim().trim_matches(|c| c == '<' || c == '>');
    let ok = |id: &str| id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok(s) {
        return Some(s.to_string());
    }
    let lower = s.to_ascii_lowercase();
    let rest = lower.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.").trim_start_matches("m.").trim_start_matches("music.");
    let start = s.len() - rest.len();
    let orig = &s[start..];
    let id = if rest.starts_with("youtu.be/") {
        orig[9..].split(['?', '&', '/', '#']).next().map(String::from)
    } else if rest.starts_with("youtube.com/watch") {
        orig.split(['?', '&']).find_map(|kv| kv.strip_prefix("v=")).map(|v| v.split('#').next().unwrap_or(v).to_string())
    } else if let Some(p) = ["youtube.com/shorts/", "youtube.com/embed/", "youtube.com/live/"].iter().find(|p| rest.starts_with(**p)) {
        orig[p.len()..].split(['?', '&', '/', '#']).next().map(String::from)
    } else {
        None
    }?;
    ok(&id).then_some(id)
}

impl Songs {
    pub fn new(core: Weak<Core>) -> Self {
        Self { _core: core, q: Mutex::new(SongQueue { volume: 50, ..Default::default() }) }
    }

    pub fn state(&self) -> SongQueue {
        self.q.lock().clone()
    }

    fn emit(&self, core: &Arc<Core>) {
        core.emit(ServerEvent::Songs(self.state()));
    }

    /// Queue a video. `by` = (name, platform) of who asked (None: the streamer from the app).
    pub async fn request(&self, core: &Arc<Core>, link: &str, by: Option<(&str, ChatPlatform)>) -> Result<(Song, usize), String> {
        let cfg = core.read(|s| s.bot.songs.clone());
        let vid = video_id(link).ok_or("Eso no es un enlace de YouTube")?;
        {
            let q = self.q.lock();
            if q.current.as_ref().is_some_and(|s| s.video_id == vid) || q.queue.iter().any(|s| s.video_id == vid) {
                return Err("Esa canción ya está en la cola".into());
            }
            if cfg.max_queue > 0 && q.queue.len() >= cfg.max_queue as usize {
                return Err("La cola está llena".into());
            }
            if let Some((name, _)) = by {
                let mine = q.queue.iter().filter(|s| s.requested_by.eq_ignore_ascii_case(name)).count();
                if cfg.max_per_user > 0 && mine >= cfg.max_per_user as usize {
                    return Err(format!("Ya tienes {mine} canciones en la cola"));
                }
            }
        }
        // Title and channel (no API key needed).
        let watch = format!("https://www.youtube.com/watch?v={vid}");
        let res = core.http.get("https://www.youtube.com/oembed").query(&[("format", "json"), ("url", watch.as_str())]).send().await;
        let meta: serde_json::Value = match res {
            Ok(r) if r.status().is_success() => match r.text().await {
                Ok(body) => serde_json::from_str(&body).unwrap_or_else(|e| {
                    tracing::warn!("songs oembed: bad json ({e}): {}", body.chars().take(120).collect::<String>());
                    serde_json::Value::Null
                }),
                Err(e) => {
                    tracing::warn!("songs oembed body: {e}");
                    serde_json::Value::Null
                }
            },
            Ok(r) if r.status().as_u16() == 404 || r.status().as_u16() == 401 || r.status().as_u16() == 403 => {
                return Err("Ese vídeo no existe o no se puede reproducir fuera de YouTube".into())
            }
            Ok(r) => {
                tracing::warn!("songs oembed: HTTP {}", r.status());
                serde_json::Value::Null
            }
            Err(e) => {
                tracing::warn!("songs oembed: {e}");
                serde_json::Value::Null
            }
        };
        let vid_for_title = vid.clone();
        let song = Song {
            id: new_id(),
            video_id: vid,
            // Live streams come without a title; the player sends it once it plays.
            title: meta["title"].as_str().map(String::from).unwrap_or_else(|| format!("Vídeo de YouTube ({vid})", vid = vid_for_title)),
            author: meta["author_name"].as_str().unwrap_or_default().to_string(),
            requested_by: by.map(|b| b.0.to_string()).unwrap_or_default(),
            platform: by.map(|b| b.1),
            duration_sec: None,
        };
        let pos = {
            let mut q = self.q.lock();
            if q.current.as_ref().is_some_and(|s| s.video_id == song.video_id) || q.queue.iter().any(|s| s.video_id == song.video_id) {
                return Err("Esa canción ya está en la cola".into());
            }
            if cfg.max_queue > 0 && q.queue.len() >= cfg.max_queue as usize {
                return Err("La cola está llena".into());
            }
            if let Some((name, _)) = by {
                let mine = q.queue.iter().filter(|s| s.requested_by.eq_ignore_ascii_case(name)).count();
                if cfg.max_per_user > 0 && mine >= cfg.max_per_user as usize {
                    return Err(format!("Ya tienes {mine} canciones en la cola"));
                }
            }
            if q.current.is_none() {
                q.current = Some(song.clone());
                0
            } else {
                q.queue.push(song.clone());
                q.queue.len()
            }
        };
        self.emit(core);
        Ok((song, pos))
    }

    /// Next song (the current one ended, failed or was skipped).
    pub fn next(&self, core: &Arc<Core>) {
        {
            let mut q = self.q.lock();
            q.current = if q.queue.is_empty() { None } else { Some(q.queue.remove(0)) };
        }
        self.emit(core);
    }

    /// The player finished (or couldn't play) `id`.
    pub fn ended(&self, core: &Arc<Core>, id: &str) {
        if self.q.lock().current.as_ref().is_some_and(|s| s.id == id) {
            self.next(core);
        }
    }

    /// The player knows the length (and the title); songs over the limit are skipped.
    pub fn duration(&self, core: &Arc<Core>, id: &str, sec: u32, title: Option<&str>) {
        let max = core.read(|s| s.bot.songs.max_minutes) * 60;
        let too_long = {
            let mut q = self.q.lock();
            match q.current.as_mut().filter(|s| s.id == id) {
                Some(s) => {
                    s.duration_sec = Some(sec);
                    if let Some(t) = title.map(str::trim).filter(|t| !t.is_empty()) {
                        if s.title.starts_with("Vídeo de YouTube (") {
                            s.title = t.to_string();
                        }
                    }
                    max > 0 && sec > max && !s.requested_by.is_empty()
                }
                None => false,
            }
        };
        if too_long {
            let t = format!("⏭️ Canción saltada: dura más de {} min", max / 60);
            core.chat.send(&t, None);
            core.chat.local_echo(core, "Vexcast Bot", &t, true);
            self.next(core);
        } else {
            self.emit(core);
        }
    }

    pub fn remove(&self, core: &Arc<Core>, id: &str) {
        let cur = self.q.lock().current.as_ref().is_some_and(|s| s.id == id);
        if cur {
            return self.next(core);
        }
        self.q.lock().queue.retain(|s| s.id != id);
        self.emit(core);
    }

    pub fn set_paused(&self, core: &Arc<Core>, paused: bool) {
        self.q.lock().paused = paused;
        self.emit(core);
    }

    pub fn set_volume(&self, core: &Arc<Core>, volume: u32) {
        self.q.lock().volume = volume.min(100);
        self.emit(core);
    }

    pub fn clear(&self, core: &Arc<Core>) {
        {
            let mut q = self.q.lock();
            q.queue.clear();
            q.current = None;
        }
        self.emit(core);
    }

    /// Chat commands: !sr <link>, !cancion, !cola, !skip (mods), !quitar (own last). True if handled.
    pub async fn on_message(&self, core: &Arc<Core>, msg: &ChatMessage) -> bool {
        let (cfg, prefix, enabled) = core.read(|s| (s.bot.songs.clone(), s.bot.prefix.clone(), s.bot.enabled));
        if !enabled || !cfg.enabled || msg.is_bot {
            return false;
        }
        let Some(rest) = msg.text.trim().strip_prefix(prefix.as_str()) else { return false };
        let (cmd, arg) = rest.split_once(' ').map(|(a, b)| (a.to_lowercase(), b.trim())).unwrap_or((rest.to_lowercase(), ""));
        let reply = |t: String| {
            core.chat.send(&t, Some(vec![msg.platform]));
            core.chat.local_echo(core, "Vexcast Bot", &t, true);
        };
        let role = crate::bot::role(msg);
        let is = |c: &str| !c.trim().is_empty() && cmd == c.trim().trim_start_matches(&prefix).to_lowercase();
        if is(&cfg.command) {
            if arg.is_empty() {
                reply(format!("Uso: {prefix}{} <enlace de YouTube>", cfg.command));
                return true;
            }
            if cfg.subs_only && role < 1 {
                reply(format!("@{} las peticiones son solo para subs", msg.user.name));
                return true;
            }
            let cost = if role >= 3 { 0 } else { cfg.cost as i64 };
            // Pay first (atomically), refund if the song can't be queued.
            if !core.loyalty.try_spend(msg.platform, &msg.user.name, cost) {
                let (have, _) = core.loyalty.points(msg.platform, &msg.user.name);
                let unit = core.read(|s| s.bot.loyalty.name.clone());
                reply(format!("@{} pedir una canción cuesta {cost} {unit} (tienes {have})", msg.user.name));
                return true;
            }
            match self.request(core, arg, Some((&msg.user.name, msg.platform))).await {
                Ok((song, pos)) => {
                    reply(if pos == 0 { format!("🎵 Suena ahora: {} (pedida por {})", song.title, msg.user.name) } else { format!("🎵 Añadida: {} · puesto #{pos}", song.title) });
                }
                Err(e) => {
                    if cost > 0 {
                        core.loyalty.add(msg.platform, &msg.user.name, cost);
                    }
                    reply(format!("@{} {e}", msg.user.name))
                }
            }
            return true;
        }
        if is("cancion") || is("song") {
            let q = self.state();
            reply(match q.current {
                Some(s) if s.requested_by.is_empty() => format!("🎵 {} · {}", s.title, s.author),
                Some(s) => format!("🎵 {} · pedida por {}", s.title, s.requested_by),
                None => "No suena nada ahora".into(),
            });
            return true;
        }
        if is("cola") || is("queue") {
            let q = self.state();
            let next: Vec<String> = q.queue.iter().take(3).enumerate().map(|(i, s)| format!("{}. {}", i + 1, s.title)).collect();
            reply(if next.is_empty() { "La cola está vacía".into() } else { format!("Siguientes: {} ({} en total)", next.join(" · "), q.queue.len()) });
            return true;
        }
        if is("skip") && role >= 3 {
            self.next(core);
            return true;
        }
        if is("quitar") || is("wrongsong") {
            let mine = self.q.lock().queue.iter().rev().find(|s| s.requested_by.eq_ignore_ascii_case(&msg.user.name) && s.platform == Some(msg.platform)).map(|s| (s.id.clone(), s.title.clone()));
            match mine {
                Some((id, title)) => {
                    self.remove(core, &id);
                    reply(format!("@{} quitada: {title}", msg.user.name));
                }
                None => reply(format!("@{} no tienes canciones en la cola", msg.user.name)),
            }
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn youtube_ids() {
        assert_eq!(video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("https://youtu.be/dQw4w9WgXcQ?si=abc").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("youtube.com/shorts/dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("https://music.youtube.com/watch?v=dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("https://vimeo.com/123"), None);
        assert_eq!(video_id("una canción bonita"), None);
        // Characters whose lowercase has another byte length must not panic.
        assert_eq!(video_id("İ"), None);
        assert_eq!(video_id("https://youtu.be/\u{212A}dQw4w9WgXc"), None);
        assert_eq!(video_id("HTTPS://YOUTU.BE/dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
    }
}

