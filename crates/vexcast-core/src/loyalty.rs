//! Loyalty points shared by every platform: viewers earn points while they take part in
//! the chat during a stream (and as a thank-you for follows, subs, bits and donations),
//! check them with !puntos, give them away and spend them on rewards (a chat message,
//! TTS, a sound, their message on screen or one of the streamer's macros).

use crate::core::Core;
use crate::model::*;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LoyaltyViewer {
    pub name: String,
    pub platform: Option<ChatPlatform>,
    pub points: i64,
    /// Points earned in total (spending doesn't lower it).
    pub earned: i64,
    pub redeemed: u32,
    pub last_seen: i64,
}

/// A viewer in the leaderboard.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoyaltyRow {
    pub key: String,
    pub rank: usize,
    #[serde(flatten)]
    pub viewer: LoyaltyViewer,
}

pub struct Loyalty {
    core: Weak<Core>,
    path: PathBuf,
    data: Mutex<HashMap<String, LoyaltyViewer>>,
    /// Viewer key → (last message, role) for the activity window.
    active: Mutex<HashMap<String, (i64, u8)>>,
    cooldowns: Mutex<HashMap<String, Instant>>,
    dirty: AtomicBool,
}

fn platform_str(p: ChatPlatform) -> String {
    serde_json::to_value(p).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default()
}

/// One key per viewer and platform ("twitch:ana").
pub fn key(platform: ChatPlatform, name: &str) -> String {
    format!("{}:{}", platform_str(platform), name.trim().trim_start_matches('@').to_lowercase())
}

/// Viewers sorted by points (ties: earned, then name).
pub fn ranked(data: &HashMap<String, LoyaltyViewer>) -> Vec<(String, LoyaltyViewer)> {
    let mut v: Vec<(String, LoyaltyViewer)> = data.iter().map(|(k, x)| (k.clone(), x.clone())).collect();
    v.sort_by(|a, b| b.1.points.cmp(&a.1.points).then(b.1.earned.cmp(&a.1.earned)).then(a.1.name.to_lowercase().cmp(&b.1.name.to_lowercase())));
    v
}

impl Loyalty {
    pub fn new(core: Weak<Core>, path: PathBuf) -> Arc<Self> {
        let data = match std::fs::read(&path) {
            Ok(b) => serde_json::from_slice(&b).unwrap_or_else(|e| {
                // Never overwrite balances we couldn't read: keep the file aside.
                tracing::warn!("loyalty.json no se pudo leer ({e}); se guarda como loyalty.invalid.json");
                let _ = std::fs::copy(&path, path.with_file_name("loyalty.invalid.json"));
                HashMap::new()
            }),
            Err(_) => HashMap::new(),
        };
        Arc::new(Self { core, path, data: Mutex::new(data), active: Default::default(), cooldowns: Default::default(), dirty: AtomicBool::new(false) })
    }

    pub fn save(&self) {
        if !self.dirty.swap(false, Ordering::AcqRel) {
            return;
        }
        let bytes = serde_json::to_vec(&*self.data.lock()).unwrap_or_default();
        let tmp = self.path.with_extension("json.tmp");
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(&tmp, &self.path);
        }
    }

    fn changed(&self) {
        self.dirty.store(true, Ordering::Release);
    }

    /// Add (or remove, with a negative amount) points. Returns the new balance.
    pub fn add(&self, platform: ChatPlatform, name: &str, delta: i64) -> i64 {
        let k = key(platform, name);
        let mut d = self.data.lock();
        let v = d.entry(k).or_insert_with(|| LoyaltyViewer { name: name.trim_start_matches('@').to_string(), platform: Some(platform), ..Default::default() });
        v.points = v.points.saturating_add(delta).max(0);
        if delta > 0 {
            v.earned = v.earned.saturating_add(delta);
        }
        let p = v.points;
        drop(d);
        self.changed();
        p
    }

    /// Take `n` points only if the viewer has them (check and subtract at once, so two
    /// messages at the same time can't spend the same points).
    pub fn try_spend(&self, platform: ChatPlatform, name: &str, n: i64) -> bool {
        if n <= 0 {
            return true;
        }
        let mut d = self.data.lock();
        match d.get_mut(&key(platform, name)) {
            Some(v) if v.points >= n => {
                v.points -= n;
                drop(d);
                self.changed();
                true
            }
            _ => false,
        }
    }

    pub fn points(&self, platform: ChatPlatform, name: &str) -> (i64, usize) {
        let d = self.data.lock();
        let k = key(platform, name);
        let pts = d.get(&k).map(|v| v.points).unwrap_or(0);
        let rank = ranked(&d).iter().position(|(x, _)| *x == k).map(|i| i + 1).unwrap_or(0);
        (pts, rank)
    }

    pub fn leaderboard(&self, limit: usize, query: &str) -> (Vec<LoyaltyRow>, usize) {
        let d = self.data.lock();
        let q = query.trim().to_lowercase();
        let all = ranked(&d);
        let total = all.len();
        let rows = all
            .into_iter()
            .enumerate()
            .filter(|(_, (_, v))| q.is_empty() || v.name.to_lowercase().contains(&q))
            .take(limit)
            .map(|(i, (key, viewer))| LoyaltyRow { key, rank: i + 1, viewer })
            .collect();
        (rows, total)
    }

    /// Set a viewer's balance (from the app).
    pub fn set(&self, key_: &str, points: i64) -> bool {
        let mut d = self.data.lock();
        let Some(v) = d.get_mut(key_) else { return false };
        if points > v.points {
            v.earned = v.earned.saturating_add(points - v.points);
        }
        v.points = points.max(0);
        drop(d);
        self.changed();
        true
    }

    pub fn reset(&self) {
        self.data.lock().clear();
        self.changed();
        self.save();
    }

    /// Every minute: award the viewers who chatted recently, and save.
    pub fn start(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_secs(60));
            let mut minutes = 0u32;
            loop {
                iv.tick().await;
                let Some(core) = self.core.upgrade() else { return };
                if core.is_stopping() {
                    self.save();
                    return;
                }
                let (cfg, enabled, live) = core.read(|s| (s.bot.loyalty.clone(), s.bot.enabled, s.stream_started_at.is_some()));
                if enabled && cfg.enabled && live && cfg.interval_min > 0 {
                    minutes += 1;
                    if minutes >= cfg.interval_min {
                        minutes = 0;
                        let window = cfg.active_minutes.max(1) as i64 * 60_000;
                        let now = now_ms();
                        let mut act = self.active.lock();
                        act.retain(|_, (t, _)| now - *t < window);
                        let award: Vec<(String, u8)> = act.iter().map(|(k, (_, r))| (k.clone(), *r)).collect();
                        drop(act);
                        let mut d = self.data.lock();
                        for (k, role) in award {
                            if let Some(v) = d.get_mut(&k) {
                                let mult = if role >= 1 { cfg.sub_multiplier.max(1.0) } else { 1.0 };
                                let n = (cfg.per_interval as f64 * mult).round() as i64;
                                v.points += n;
                                v.earned += n;
                            }
                        }
                        drop(d);
                        self.changed();
                    }
                } else {
                    minutes = 0;
                }
                self.save();
            }
        });
    }

    /// Thank-you points for follows, subs, bits, donations and raids.
    pub fn on_alert(&self, core: &Arc<Core>, kind: AlertType, platform: ChatPlatform, user: &str, amount: Option<f64>) {
        let (cfg, enabled) = core.read(|s| (s.bot.loyalty.clone(), s.bot.enabled));
        if !enabled || !cfg.enabled || user.trim().is_empty() {
            return;
        }
        let a = amount.unwrap_or(0.0);
        let n = match kind {
            AlertType::Follow => cfg.bonus_follow as f64,
            AlertType::Subscription | AlertType::Member => cfg.bonus_sub as f64,
            AlertType::GiftSub => cfg.bonus_sub as f64 * a.max(1.0),
            AlertType::Bits => cfg.bonus_per_100_bits as f64 * a / 100.0,
            AlertType::Donation | AlertType::Kofi | AlertType::Superchat => cfg.bonus_per_currency as f64 * a,
            AlertType::Raid | AlertType::Host => cfg.bonus_raid as f64,
        }
        .round() as i64;
        if n > 0 {
            self.add(platform, user, n);
        }
    }

    /// Chat message: activity + loyalty commands. Returns true when it was a loyalty command.
    pub async fn on_message(&self, core: &Arc<Core>, msg: &ChatMessage) -> bool {
        let (bot, live) = core.read(|s| (s.bot.clone(), s.stream_started_at.is_some()));
        let cfg = &bot.loyalty;
        if !bot.enabled || !cfg.enabled || msg.is_bot || msg.platform == ChatPlatform::Vexcast {
            return false;
        }
        let me = key(msg.platform, &msg.user.name);
        let role = crate::bot::role(msg);
        {
            let mut d = self.data.lock();
            let v = d.entry(me.clone()).or_insert_with(|| LoyaltyViewer { name: msg.user.name.clone(), platform: Some(msg.platform), ..Default::default() });
            v.name = msg.user.name.clone();
            v.last_seen = now_ms();
        }
        if live {
            self.active.lock().insert(me.clone(), (now_ms(), role));
        }
        self.changed();

        let text = msg.text.trim();
        let Some(rest) = text.strip_prefix(bot.prefix.as_str()) else { return false };
        let mut parts = rest.split_whitespace();
        let cmd = parts.next().unwrap_or("").to_lowercase();
        let args: Vec<&str> = parts.collect();
        let is = |c: &str| !c.trim().is_empty() && cmd == c.trim().trim_start_matches(&bot.prefix).to_lowercase();
        let unit = &cfg.name;
        let reply = |t: String| {
            core.chat.send(&t, Some(vec![msg.platform]));
            core.chat.local_echo(core, "Vexcast Bot", &t, true);
        };

        if is(&cfg.command) {
            let who = args.first().map(|a| a.trim_start_matches('@')).unwrap_or(&msg.user.name);
            let (pts, rank) = self.points(msg.platform, who);
            reply(if rank > 0 { format!("{who} tiene {pts} {unit} (puesto #{rank})") } else { format!("{who} aún no tiene {unit}") });
            return true;
        }
        if is(&cfg.top_command) {
            if !self.cool("__top", 15) {
                return true;
            }
            let (rows, _) = self.leaderboard(5, "");
            let list: Vec<String> = rows.iter().map(|r| format!("{}. {} ({})", r.rank, r.viewer.name, r.viewer.points)).collect();
            if !list.is_empty() {
                reply(format!("🏆 {}", list.join(" · ")));
            }
            return true;
        }
        if is(&cfg.give_command) && cfg.allow_give {
            let (Some(target), Some(n)) = (args.first(), args.get(1).and_then(|n| n.parse::<i64>().ok())) else {
                reply(format!("Uso: {}{} @usuario cantidad", bot.prefix, cfg.give_command));
                return true;
            };
            let target = target.trim_start_matches('@');
            if n <= 0 || target.eq_ignore_ascii_case(&msg.user.name) {
                return true;
            }
            // Mods and the streamer create points; everyone else gives their own.
            if role < 3 && !self.try_spend(msg.platform, &msg.user.name, n) {
                let (mine, _) = self.points(msg.platform, &msg.user.name);
                reply(format!("@{} no tienes suficientes {unit} ({mine})", msg.user.name));
                return true;
            }
            let total = self.add(msg.platform, target, n);
            reply(format!("{} → {target}: {n} {unit} (ahora tiene {total})", msg.user.name));
            return true;
        }
        if is(&cfg.redeem_command) {
            let rewards: Vec<&LoyaltyReward> = cfg.rewards.iter().filter(|r| r.enabled).collect();
            if args.is_empty() {
                if self.cool("__list", 20) {
                    let list: Vec<String> = rewards.iter().map(|r| format!("{} ({})", r.name, r.cost)).collect();
                    reply(if list.is_empty() { "Todavía no hay canjes".into() } else { format!("Canjes ({}{} nombre): {}", bot.prefix, cfg.redeem_command, list.join(" · ")) });
                }
                return true;
            }
            // Longest reward name that the arguments start with; the rest is the viewer's text.
            let joined = args.join(" ");
            let lower = joined.to_lowercase();
            let mut best: Option<&LoyaltyReward> = None;
            for r in &rewards {
                let n = r.name.trim().to_lowercase();
                if !n.is_empty() && (lower == n || lower.starts_with(&format!("{n} "))) && best.is_none_or(|b| b.name.len() < r.name.len()) {
                    best = Some(r);
                }
            }
            let Some(r) = best else {
                reply(format!("@{} ese canje no existe; escribe {}{} para verlos", msg.user.name, bot.prefix, cfg.redeem_command));
                return true;
            };
            let input = args.iter().skip(r.name.split_whitespace().count()).copied().collect::<Vec<_>>().join(" ");
            if r.needs_input && input.is_empty() {
                reply(format!("@{} escribe el texto: {}{} {} <texto>", msg.user.name, bot.prefix, cfg.redeem_command, r.name));
                return true;
            }
            let cool_key = format!("reward:{}", r.id);
            if r.cooldown_sec > 0 && self.cooling(&cool_key, r.cooldown_sec) {
                reply(format!("@{} «{}» está en espera, prueba en un rato", msg.user.name, r.name));
                return true;
            }
            if !self.try_spend(msg.platform, &msg.user.name, r.cost as i64) {
                let (mine, _) = self.points(msg.platform, &msg.user.name);
                reply(format!("@{} te faltan {} {unit} para «{}»", msg.user.name, r.cost as i64 - mine, r.name));
                return true;
            }
            match redeem(core, r, msg, &input).await {
                Ok(()) => {
                    if r.cooldown_sec > 0 {
                        self.cooldowns.lock().insert(cool_key, Instant::now());
                    }
                    if let Some(v) = self.data.lock().get_mut(&me) {
                        v.redeemed += 1;
                    }
                    reply(format!("✅ {} canjeó «{}» (-{} {unit})", msg.user.name, r.name, r.cost));
                    core.notify("info", format!("{} canjeó «{}»", msg.user.name, r.name));
                }
                Err(e) => {
                    self.add(msg.platform, &msg.user.name, r.cost as i64);
                    reply(format!("@{} no se pudo canjear «{}»; te devuelvo los {unit}", msg.user.name, r.name));
                    tracing::warn!("loyalty reward {}: {e}", r.name);
                }
            }
            return true;
        }
        false
    }

    /// Still cooling down (doesn't start a new cooldown).
    fn cooling(&self, k: &str, secs: u32) -> bool {
        self.cooldowns.lock().get(k).is_some_and(|t| t.elapsed() < Duration::from_secs(secs as u64))
    }

    fn cool(&self, k: &str, secs: u32) -> bool {
        let mut c = self.cooldowns.lock();
        if c.get(k).is_some_and(|t| t.elapsed() < Duration::from_secs(secs as u64)) {
            return false;
        }
        c.insert(k.to_string(), Instant::now());
        true
    }
}

/// Run a reward.
async fn redeem(core: &Arc<Core>, r: &LoyaltyReward, msg: &ChatMessage, input: &str) -> anyhow::Result<()> {
    let fill = |s: &str| s.replace("{user}", &msg.user.name).replace("{input}", input);
    match r.kind.as_str() {
        "chat" => {
            let t = fill(&r.value);
            if !t.trim().is_empty() {
                core.chat.send(&t, Some(vec![msg.platform]));
                core.chat.local_echo(core, "Vexcast Bot", &t, true);
            }
        }
        "tts" => {
            let t = if r.value.trim().is_empty() { format!("{} dice: {input}", msg.user.name) } else { fill(&r.value) };
            if core.read(|s| s.ai.tts.provider == "none") {
                anyhow::bail!("TTS desactivado");
            }
            core.tts.speak(&t).await?;
        }
        "sound" => {
            let (bytes, ext) = crate::alerts::load_sound(core, Some(r.value.as_str()), 1.0).await.ok_or_else(|| anyhow::anyhow!("no se pudo cargar el sonido"))?;
            core.engine.play_audio(&bytes, &ext)?;
        }
        "highlight" => {
            let mut m = msg.clone();
            m.id = new_id();
            m.text = if input.is_empty() { fill(&r.value) } else { input.to_string() };
            core.chat.highlight_message(core, m);
        }
        #[cfg(feature = "obs")]
        "macro" => crate::macros::run_by_id(core, r.value.trim()).await?,
        #[cfg(not(feature = "obs"))]
        "macro" => anyhow::bail!("las macros necesitan el motor de vídeo"),
        _ => anyhow::bail!("tipo de canje desconocido"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spending_is_all_or_nothing() {
        let dir = std::env::temp_dir().join(format!("vx-loyalty-{}", std::process::id()));
        let l = Loyalty::new(std::sync::Weak::new(), dir.join("loyalty.json"));
        l.add(ChatPlatform::Twitch, "Ana", 100);
        assert!(l.try_spend(ChatPlatform::Twitch, "ana", 100));
        assert!(!l.try_spend(ChatPlatform::Twitch, "Ana", 1), "the same points can't be spent twice");
        assert!(!l.try_spend(ChatPlatform::Kick, "Nadie", 5));
        assert_eq!(l.points(ChatPlatform::Twitch, "Ana").0, 0);
        assert_eq!(l.add(ChatPlatform::Twitch, "Ana", i64::MAX), i64::MAX);
        assert_eq!(l.add(ChatPlatform::Twitch, "Ana", 1), i64::MAX, "no overflow");
    }

    #[test]
    fn keys_and_ranking() {
        assert_eq!(key(ChatPlatform::Twitch, "@Ana"), "twitch:ana");
        let mut d = HashMap::new();
        d.insert("twitch:ana".into(), LoyaltyViewer { name: "Ana".into(), points: 50, earned: 80, ..Default::default() });
        d.insert("kick:leo".into(), LoyaltyViewer { name: "Leo".into(), points: 120, earned: 120, ..Default::default() });
        d.insert("youtube:sol".into(), LoyaltyViewer { name: "Sol".into(), points: 50, earned: 60, ..Default::default() });
        let r: Vec<String> = ranked(&d).into_iter().map(|(_, v)| v.name).collect();
        assert_eq!(r, vec!["Leo", "Ana", "Sol"], "ties go to whoever earned more");
    }
}
