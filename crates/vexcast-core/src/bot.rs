//! Chat bot: custom commands and keyword replies with variables, permissions and
//! cooldowns, timed messages, and automatic moderation (links, caps, spam).

use crate::core::Core;
use crate::model::*;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

pub struct Bot {
    core: Weak<Core>,
    /// Command id → last use.
    cooldowns: Mutex<HashMap<String, Instant>>,
    /// (command id, viewer) → last use.
    user_cooldowns: Mutex<HashMap<(String, String), Instant>>,
    /// Timer id → (last post, chat lines at that moment).
    timers: Mutex<HashMap<String, (Instant, u64)>>,
    /// Viewer → last moderation warning (to not flood the chat with warnings).
    warned: Mutex<HashMap<String, Instant>>,
    /// Chat messages from viewers seen so far.
    lines: AtomicU64,
}

/// Viewer role from the platform badges: 0 viewer · 1 subscriber/member · 2 VIP · 3 moderator · 4 streamer.
pub fn role(msg: &ChatMessage) -> u8 {
    if msg.platform == ChatPlatform::Vexcast {
        return 4;
    }
    msg.user
        .badges
        .iter()
        .map(|b| match b.id.as_str() {
            "broadcaster" | "owner" => 4,
            "moderator" | "mod" => 3,
            "vip" => 2,
            "subscriber" | "member" | "founder" | "sub_gifter" | "og" => 1,
            _ => 0,
        })
        .max()
        .unwrap_or(0)
}

fn needed(permission: &str) -> u8 {
    match permission {
        "subscriber" => 1,
        "vip" => 2,
        "moderator" => 3,
        "broadcaster" => 4,
        _ => 0,
    }
}

impl Bot {
    pub fn new(core: Weak<Core>) -> Arc<Self> {
        Arc::new(Self { core, cooldowns: Default::default(), user_cooldowns: Default::default(), timers: Default::default(), warned: Default::default(), lines: AtomicU64::new(0) })
    }

    pub fn start(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_secs(15));
            loop {
                iv.tick().await;
                let Some(core) = self.core.upgrade() else { return };
                if core.is_stopping() {
                    return;
                }
                let (bot, live) = core.read(|s| (s.bot.clone(), s.stream_started_at.is_some()));
                if !bot.enabled || !live {
                    self.timers.lock().clear();
                    continue;
                }
                let lines = self.lines.load(Ordering::Relaxed);
                for t in bot.timers.iter().filter(|t| t.enabled && t.interval_min > 0 && !t.message.trim().is_empty()) {
                    let due = {
                        let mut timers = self.timers.lock();
                        let last = timers.entry(t.id.clone()).or_insert_with(|| (Instant::now(), lines));
                        if last.0.elapsed() >= Duration::from_secs(t.interval_min as u64 * 60) && lines.saturating_sub(last.1) >= t.min_chat_lines as u64 {
                            *last = (Instant::now(), lines);
                            true
                        } else {
                            false
                        }
                    };
                    if due {
                        let ctx = Ctx { user: "", channel: "", platform: None, args: "", count: 0 };
                        let text = render(&core, &t.message, &ctx);
                        let targets = (!t.platforms.is_empty()).then(|| t.platforms.clone());
                        core.chat.send(&text, targets);
                        core.chat.local_echo(&core, "Vexcast Bot", &text, true);
                    }
                }
            }
        });
    }

    /// The command (or keyword) a message triggers, if any.
    fn find<'a>(bot: &'a BotSettings, msg: &ChatMessage) -> Option<(&'a BotCommand, String)> {
        let text = msg.text.trim();
        if let Some(rest) = text.strip_prefix(bot.prefix.as_str()) {
            let (trigger, args) = rest.split_once(' ').unwrap_or((rest, ""));
            let trigger = trigger.to_lowercase();
            let hit = bot.commands.iter().find(|c| {
                c.enabled && c.kind != "keyword" && std::iter::once(&c.trigger).chain(c.aliases.iter()).any(|t| t.trim().trim_start_matches(&bot.prefix).to_lowercase() == trigger)
            });
            if let Some(c) = hit {
                return Some((c, args.trim().to_string()));
            }
        }
        let lower = format!(" {} ", normalize(text));
        bot.commands
            .iter()
            .find(|c| c.enabled && c.kind == "keyword" && std::iter::once(&c.trigger).chain(c.aliases.iter()).any(|t| !t.trim().is_empty() && lower.contains(&format!(" {} ", normalize(t)))))
            .map(|c| (c, String::new()))
    }

    pub async fn on_message(&self, core: &Arc<Core>, msg: &ChatMessage) {
        let bot = core.read(|s| s.bot.clone());
        if !msg.is_bot {
            self.lines.fetch_add(1, Ordering::Relaxed);
        }
        if !bot.enabled || msg.flagged {
            return;
        }
        // Built-in !comandos / !commands (unless the user made their own).
        if bot.list_command {
            let t = msg.text.trim().to_lowercase();
            let own = bot.commands.iter().any(|c| c.enabled && ["comandos", "commands"].contains(&c.trigger.to_lowercase().as_str()));
            if !own && [format!("{}comandos", bot.prefix), format!("{}commands", bot.prefix)].contains(&t) {
                if self.cooled("__list", 20) {
                    let list: Vec<String> = bot.commands.iter().filter(|c| c.enabled && c.kind != "keyword" && needed(&c.permission) == 0).map(|c| format!("{}{}", bot.prefix, c.trigger)).collect();
                    if !list.is_empty() {
                        let text = list.join(" · ");
                        core.chat.send(&text, Some(vec![msg.platform]));
                        core.chat.local_echo(core, "Vexcast Bot", &text, true);
                    }
                }
                return;
            }
        }
        let Some((cmd, args)) = Self::find(&bot, msg) else { return };
        if !cmd.platforms.is_empty() && !cmd.platforms.contains(&msg.platform) {
            return;
        }
        let r = role(msg);
        if r < needed(&cmd.permission) {
            return;
        }
        // Mods and the streamer skip cooldowns.
        if r < 3 {
            if cmd.user_cooldown_sec > 0 {
                let key = (cmd.id.clone(), msg.user.name.to_lowercase());
                let mut cd = self.user_cooldowns.lock();
                if cd.get(&key).is_some_and(|t| t.elapsed() < Duration::from_secs(cmd.user_cooldown_sec as u64)) {
                    return;
                }
                cd.retain(|_, t| t.elapsed() < Duration::from_secs(3600));
                cd.insert(key, Instant::now());
            }
            if !self.cooled(&cmd.id, cmd.cooldown_sec) {
                return;
            }
        }
        // Count the use (kept in the settings).
        let id = cmd.id.clone();
        let count = core.update(|s| {
            s.bot.commands.iter_mut().find(|c| c.id == id).map(|c| {
                c.count += 1;
                c.count
            })
        });
        let count = count.unwrap_or(cmd.count + 1);
        let ctx = Ctx { user: &msg.user.name, channel: &msg.channel, platform: Some(msg.platform), args: &args, count };
        let lines: Vec<&str> = cmd.response.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
        let chosen: Vec<&str> = if cmd.random && !lines.is_empty() { vec![lines[rand::random::<usize>() % lines.len()]] } else { lines.into_iter().take(3).collect() };
        for line in chosen {
            let mut text = render(core, line, &ctx);
            if cmd.reply && !text.starts_with('@') {
                text = format!("@{} {}", msg.user.name, text);
            }
            core.chat.send(&text, Some(vec![msg.platform]));
            core.chat.local_echo(core, "Vexcast Bot", &text, true);
        }
    }

    /// Global cooldown check-and-set.
    fn cooled(&self, key: &str, secs: u32) -> bool {
        let mut cd = self.cooldowns.lock();
        if cd.get(key).is_some_and(|t| t.elapsed() < Duration::from_secs(secs as u64)) {
            return false;
        }
        cd.insert(key.to_string(), Instant::now());
        true
    }

    /// Automatic moderation: why the message should be removed (links, caps, spam, length).
    pub fn check(&self, bot: &BotSettings, msg: &ChatMessage) -> Option<&'static str> {
        if !bot.enabled || msg.is_bot {
            return None;
        }
        let m = &bot.moderation;
        let r = role(msg);
        if r >= 3 || (r == 2 && m.exempt_vip) || (r == 1 && m.exempt_subscribers) {
            return None;
        }
        moderation_reason(m, &msg.text)
    }

    /// Tell the viewer why their message was removed (at most once every 30 s per viewer).
    pub fn warn(&self, core: &Arc<Core>, bot: &BotSettings, msg: &ChatMessage, reason: &str) {
        let m = &bot.moderation;
        if !m.warn {
            return;
        }
        {
            let mut w = self.warned.lock();
            let key = msg.user.name.to_lowercase();
            if w.get(&key).is_some_and(|t| t.elapsed() < Duration::from_secs(30)) {
                return;
            }
            w.retain(|_, t| t.elapsed() < Duration::from_secs(600));
            w.insert(key, Instant::now());
        }
        let tpl = match reason {
            "links" => &m.warn_links,
            "caps" => &m.warn_caps,
            "length" => &m.warn_length,
            _ => &m.warn_spam,
        };
        if tpl.trim().is_empty() {
            return;
        }
        let text = tpl.replace("{user}", &format!("@{}", msg.user.name));
        core.chat.send(&text, Some(vec![msg.platform]));
        core.chat.local_echo(core, "Vexcast Bot", &text, true);
    }
}

/// Rule broken by a message, if any.
pub fn moderation_reason(m: &BotModeration, text: &str) -> Option<&'static str> {
    if m.max_length > 0 && text.chars().count() > m.max_length as usize {
        return Some("length");
    }
    if m.links && has_link(text, &m.allowed_domains) {
        return Some("links");
    }
    if m.caps {
        let letters: Vec<char> = text.chars().filter(|c| c.is_alphabetic()).collect();
        if letters.len() >= m.caps_min_length.max(1) as usize {
            let upper = letters.iter().filter(|c| c.is_uppercase()).count();
            if upper * 100 >= letters.len() * m.caps_percent.clamp(1, 100) as usize {
                return Some("caps");
            }
        }
    }
    if m.spam && is_spam(text) {
        return Some("spam");
    }
    None
}

fn has_link(text: &str, allowed: &[String]) -> bool {
    text.split_whitespace().any(|w| {
        let l = w.to_lowercase();
        let l = l.trim_matches(|c: char| !c.is_alphanumeric() && c != '/' && c != '.' && c != ':');
        let bare = l.trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.");
        let host = bare.split('/').next().unwrap_or("");
        let looks = l.starts_with("http://") || l.starts_with("https://") || l.starts_with("www.") || {
            let tld = host.rsplit('.').next().unwrap_or("");
            host.contains('.') && tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic()) && !host.starts_with('.') && host.split('.').all(|p| !p.is_empty())
        };
        looks && !allowed.iter().map(|a| a.trim().to_lowercase()).any(|a| !a.is_empty() && bare.starts_with(a.trim_start_matches("www.")))
    })
}

fn is_spam(text: &str) -> bool {
    // 10+ of the same character in a row.
    let mut run = 0;
    let mut prev = '\0';
    for c in text.chars() {
        run = if c == prev { run + 1 } else { 1 };
        prev = c;
        if run >= 10 && !c.is_whitespace() {
            return true;
        }
    }
    // The same word 6+ times.
    let words: Vec<String> = text.split_whitespace().map(|w| w.to_lowercase()).collect();
    if words.len() >= 6 {
        let mut counts: HashMap<&str, usize> = HashMap::new();
        for w in &words {
            *counts.entry(w.as_str()).or_default() += 1;
        }
        if counts.values().any(|&n| n >= 6 && n * 2 >= words.len()) {
            return true;
        }
    }
    // Symbol walls.
    let total = text.chars().filter(|c| !c.is_whitespace()).count();
    let symbols = text.chars().filter(|c| !c.is_alphanumeric() && !c.is_whitespace() && (*c as u32) < 0x2000).count();
    total >= 20 && symbols * 100 >= total * 60
}

/// Lowercase words separated by single spaces (for keyword matching).
fn normalize(s: &str) -> String {
    s.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect::<Vec<_>>().join(" ")
}

struct Ctx<'a> {
    user: &'a str,
    channel: &'a str,
    platform: Option<ChatPlatform>,
    args: &'a str,
    count: u64,
}

fn render(core: &Arc<Core>, template: &str, c: &Ctx) -> String {
    let started = core.read(|s| s.stream_started_at);
    let uptime = started.map(|t| crate::util::format_uptime(now_ms() - t)).unwrap_or_else(|| "offline".into());
    render_with(template, c, &uptime)
}

fn render_with(template: &str, c: &Ctx, uptime: &str) -> String {
    let channel = if c.channel.is_empty() { "El canal".to_string() } else { c.channel.to_string() };
    let args: Vec<&str> = c.args.split_whitespace().collect();
    let target = args.first().map(|a| a.trim_start_matches('@').to_string()).unwrap_or_else(|| c.user.to_string());
    let platform = match c.platform {
        Some(ChatPlatform::Twitch) => "Twitch",
        Some(ChatPlatform::Youtube) => "YouTube",
        Some(ChatPlatform::Kick) => "Kick",
        Some(ChatPlatform::Tiktok) => "TikTok",
        _ => "",
    };
    let mut out = template
        .replace("{user}", c.user)
        .replace("{target}", &target)
        .replace("{uptime}", uptime)
        .replace("{channel}", &channel)
        .replace("{platform}", platform)
        .replace("{count}", &c.count.to_string())
        .replace("{args}", c.args);
    for i in 1..=9 {
        out = out.replace(&format!("{{arg{i}}}"), args.get(i - 1).copied().unwrap_or(""));
    }
    // {random} (1-100) and {random:a-b}
    out = out.replace("{random}", &(1 + rand::random::<u32>() % 100).to_string());
    while let Some(start) = out.find("{random:") {
        let Some(end) = out[start..].find('}').map(|e| start + e) else { break };
        let spec = &out[start + 8..end];
        let (a, b) = spec.split_once('-').unwrap_or(("1", spec));
        let (a, b) = (a.trim().parse::<i64>().unwrap_or(1), b.trim().parse::<i64>().unwrap_or(100));
        let (lo, hi) = (a.min(b), a.max(b));
        let n = lo + (rand::random::<u64>() % ((hi - lo + 1).max(1) as u64)) as i64;
        out.replace_range(start..=end, &n.to_string());
    }
    // {pick:a|b|c}
    while let Some(start) = out.find("{pick:") {
        let Some(end) = out[start..].find('}').map(|e| start + e) else { break };
        let opts: Vec<String> = out[start + 6..end].split('|').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        let v = if opts.is_empty() { String::new() } else { opts[rand::random::<usize>() % opts.len()].clone() };
        out.replace_range(start..=end, &v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(text: &str, badges: &[&str]) -> ChatMessage {
        ChatMessage {
            id: "m".into(),
            platform: ChatPlatform::Twitch,
            channel: "canal".into(),
            user: ChatUser { id: "u".into(), name: "Ana".into(), color: None, badges: badges.iter().map(|b| ChatBadge { id: b.to_string(), label: b.to_string(), image: None }).collect() },
            text: text.into(),
            ts: 0,
            is_bot: false,
            flagged: false,
            viewer: None,
            question: false,
            translated: None,
        }
    }

    #[test]
    fn roles_and_triggers() {
        assert_eq!(role(&msg("x", &[])), 0);
        assert_eq!(role(&msg("x", &["subscriber", "vip"])), 2);
        assert_eq!(role(&msg("x", &["moderator"])), 3);
        let mut bot = BotSettings::default();
        let mut dc = BotCommand::new("discord", "discord.gg/x", 0);
        dc.aliases = vec!["dc".into()];
        let mut kw = BotCommand::new("buenas noches", "¡Descansa {user}!", 0);
        kw.kind = "keyword".into();
        bot.commands = vec![dc, kw];
        assert_eq!(Bot::find(&bot, &msg("!DC ahora", &[])).map(|(c, a)| (c.trigger.clone(), a)), Some(("discord".into(), "ahora".into())));
        assert_eq!(Bot::find(&bot, &msg("bueno, Buenas noches a todos!", &[])).map(|(c, _)| c.trigger.clone()), Some("buenas noches".into()));
        assert!(Bot::find(&bot, &msg("buenasnoches", &[])).is_none());
    }

    #[test]
    fn variables() {
        let c = Ctx { user: "Ana", channel: "", platform: Some(ChatPlatform::Kick), args: "@Leo hola", count: 7 };
        assert_eq!(render_with("{user} abraza a {target} ({count}) en {platform}: {arg2}", &c, "1h"), "Ana abraza a Leo (7) en Kick: hola");
        let n: i64 = render_with("{random:3-3}", &c, "").parse().unwrap();
        assert_eq!(n, 3);
        assert!(["a", "b"].contains(&render_with("{pick:a|b}", &c, "").as_str()));
        let c2 = Ctx { user: "Ana", channel: "", platform: None, args: "", count: 0 };
        assert_eq!(render_with("{target}", &c2, ""), "Ana", "no argument: the author");
    }

    #[test]
    fn moderation_rules() {
        let m = BotModeration { links: true, caps: true, spam: true, max_length: 200, ..Default::default() };
        assert_eq!(moderation_reason(&m, "mira esto www.spam.com"), Some("links"));
        assert_eq!(moderation_reason(&m, "entra a free-coins.xyz ya"), Some("links"));
        assert_eq!(moderation_reason(&m, "clip: https://clips.twitch.tv/abc"), None, "allowed domain");
        assert_eq!(moderation_reason(&m, "son las 3.5 horas jaja"), None, "a number is not a link");
        assert_eq!(moderation_reason(&m, "ESTO ES UNA LOCURA TOTAL"), Some("caps"));
        assert_eq!(moderation_reason(&m, "OK"), None, "short shouting is fine");
        assert_eq!(moderation_reason(&m, "jajajajajaaaaaaaaaaaaa"), Some("spam"));
        assert_eq!(moderation_reason(&m, "gg gg gg gg gg gg"), Some("spam"));
        assert_eq!(moderation_reason(&m, "buena partida, gg a todos"), None);
        assert_eq!(moderation_reason(&m, &"a b ".repeat(80)), Some("length"));
    }
}
