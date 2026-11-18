//! Stream reports: while live (not in rehearsal), a sample every minute (viewers per platform,
//! chat messages, scene on screen, bitrate, dropped frames) plus the events (follows, subs, bits,
//! raids, donations) and chatters. Saved to sessions/<id>.json when the stream ends (and every
//! few minutes meanwhile, in case of a crash).

use crate::core::Core;
use crate::model::*;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Sample {
    pub ts: i64,
    /// Viewers per platform ("twitch", "kick").
    pub viewers: BTreeMap<String, u64>,
    /// Chat messages during this minute.
    pub chat: u32,
    pub scene: String,
    pub kbps: f64,
    /// Dropped frames during this minute (%).
    pub dropped: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionEvent {
    pub ts: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub user: String,
    pub amount: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Summary {
    pub duration_ms: i64,
    pub peak_viewers: u64,
    pub avg_viewers: f64,
    pub chat_messages: u32,
    pub chatters: u32,
    pub new_chatters: u32,
    pub follows: u32,
    pub subs: u32,
    pub bits: f64,
    pub donations: f64,
    pub raids: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub title: String,
    pub category: String,
    pub destinations: Vec<String>,
    pub samples: Vec<Sample>,
    pub events: Vec<SessionEvent>,
    pub summary: Summary,
    /// AI analysis (on demand).
    pub insights: Option<String>,
}

#[derive(Default)]
struct Live {
    session: Session,
    chat_minute: u32,
    chatters: HashSet<String>,
    /// Messages per viewer (for the credits): key → (name, count).
    talkers: std::collections::HashMap<String, (String, u32)>,
    last_dropped: (i64, i64),
}

pub struct Sessions {
    dir: PathBuf,
    live: Mutex<Option<Live>>,
}

impl Sessions {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Self { dir, live: Mutex::new(None) }
    }

    fn path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{}.json", id.replace(['/', '\\', '.'], "")))
    }

    pub fn on_chat(&self, msg: &ChatMessage) {
        if msg.is_bot {
            return;
        }
        if let Some(l) = self.live.lock().as_mut() {
            l.chat_minute += 1;
            l.session.summary.chat_messages += 1;
            let key = format!("{:?}:{}", msg.platform, msg.user.id);
            l.talkers.entry(key.clone()).or_insert_with(|| (msg.user.name.clone(), 0)).1 += 1;
            if l.chatters.insert(key) {
                l.session.summary.chatters += 1;
            }
            if msg.viewer.as_ref().is_some_and(|v| v.first_time) {
                l.session.summary.new_chatters += 1;
            }
        }
    }

    pub fn on_alert(&self, ev: &AlertEvent) {
        if ev.test {
            return;
        }
        if let Some(l) = self.live.lock().as_mut() {
            let kind = serde_json::to_value(ev.kind).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
            let s = &mut l.session.summary;
            match kind.as_str() {
                "follow" => s.follows += 1,
                "subscription" | "gift_sub" | "member" => s.subs += 1,
                "bits" => s.bits += ev.amount.unwrap_or(0.0),
                "donation" | "kofi" | "superchat" => s.donations += ev.amount.unwrap_or(0.0),
                "raid" => s.raids += 1,
                _ => {}
            }
            l.session.events.push(SessionEvent { ts: ev.ts, kind, user: ev.user.clone(), amount: ev.amount });
        }
    }

    fn save(&self, s: &Session) {
        if let Ok(data) = serde_json::to_vec_pretty(s) {
            let _ = std::fs::write(self.path(&s.id), data);
        }
    }

    fn finish(&self, mut l: Live) {
        let s = &mut l.session;
        s.ended_at = Some(now_ms());
        compute(s);
        // Too short to mean anything (a test or a false start).
        if s.summary.duration_ms < 60_000 && s.samples.len() < 2 {
            let _ = std::fs::remove_file(self.path(&s.id));
            return;
        }
        self.save(s);
    }

    pub fn list(&self) -> Vec<Value> {
        let mut out: Vec<Value> = std::fs::read_dir(&self.dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| serde_json::from_slice::<Session>(&std::fs::read(e.path()).ok()?).ok())
            .map(|s| json!({ "id": s.id, "startedAt": s.started_at, "endedAt": s.ended_at, "title": s.title, "category": s.category, "summary": s.summary }))
            .collect();
        out.sort_by_key(|v| -v["startedAt"].as_i64().unwrap_or(0));
        out
    }

    pub fn get(&self, id: &str) -> Option<Session> {
        if let Some(l) = self.live.lock().as_ref().filter(|l| l.session.id == id) {
            let mut s = l.session.clone();
            compute(&mut s);
            return Some(s);
        }
        serde_json::from_slice(&std::fs::read(self.path(id)).ok()?).ok()
    }

    /// Every alert of the saved streams, oldest first (to fill the labels the first time).
    pub fn past_events(&self) -> Vec<SessionEvent> {
        let mut out: Vec<SessionEvent> = std::fs::read_dir(&self.dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| serde_json::from_slice::<Session>(&std::fs::read(e.path()).ok()?).ok())
            .flat_map(|s| s.events)
            .collect();
        out.sort_by_key(|e| e.ts);
        out
    }

    /// End-of-stream credits: who followed, subscribed, gifted, cheered, donated, raided and
    /// chatted the most. From the stream running now, or the last one saved.
    pub fn credits(&self) -> Value {
        let (events, talkers, live) = match self.live.lock().as_ref() {
            Some(l) => (l.session.events.clone(), l.talkers.values().cloned().collect::<Vec<_>>(), true),
            None => {
                let last = self.list().first().and_then(|v| v["id"].as_str().map(String::from)).and_then(|id| self.get(&id));
                (last.map(|s| s.events).unwrap_or_default(), vec![], false)
            }
        };
        let names = |kinds: &[&str]| {
            let mut out: Vec<String> = vec![];
            for e in events.iter().filter(|e| kinds.contains(&e.kind.as_str())) {
                if !out.iter().any(|n| n.eq_ignore_ascii_case(&e.user)) {
                    out.push(e.user.clone());
                }
            }
            out
        };
        let sums = |kinds: &[&str]| {
            let mut out: Vec<(String, f64)> = vec![];
            for e in events.iter().filter(|e| kinds.contains(&e.kind.as_str())) {
                match out.iter_mut().find(|(n, _)| n.eq_ignore_ascii_case(&e.user)) {
                    Some(x) => x.1 += e.amount.unwrap_or(0.0),
                    None => out.push((e.user.clone(), e.amount.unwrap_or(0.0))),
                }
            }
            out.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            out.into_iter().map(|(user, amount)| json!({ "user": user, "amount": amount })).collect::<Vec<_>>()
        };
        let mut chat = talkers;
        chat.sort_by_key(|c| std::cmp::Reverse(c.1));
        json!({
            "live": live,
            "follows": names(&["follow"]),
            "subs": names(&["subscription", "member"]),
            "gifts": sums(&["gift_sub"]),
            "bits": sums(&["bits"]),
            "donations": sums(&["donation", "kofi", "superchat"]),
            "raids": sums(&["raid", "host"]),
            "chatters": chat.into_iter().take(15).map(|(n, c)| json!({ "user": n, "amount": c })).collect::<Vec<_>>(),
        })
    }

    pub fn delete(&self, id: &str) -> bool {
        std::fs::remove_file(self.path(id)).is_ok()
    }

    pub fn set_insights(&self, id: &str, text: &str) {
        if let Some(mut s) = self.get(id) {
            s.insights = Some(text.to_string());
            self.save(&s);
        }
    }
}

fn compute(s: &mut Session) {
    let totals: Vec<u64> = s.samples.iter().map(|x| x.viewers.values().sum()).collect();
    s.summary.duration_ms = s.ended_at.unwrap_or_else(now_ms) - s.started_at;
    s.summary.peak_viewers = totals.iter().copied().max().unwrap_or(0);
    let with = totals.iter().filter(|v| **v > 0).count();
    s.summary.avg_viewers = if with > 0 { totals.iter().sum::<u64>() as f64 / with as f64 } else { 0.0 };
}

/// Follow the stream: start a session when going live, sample every minute, save at the end.
pub async fn run(core: Arc<Core>) {
    let mut tick: u64 = 0;
    loop {
        tokio::time::sleep(Duration::from_secs(5)).await;
        if core.is_stopping() {
            if let Some(l) = core.sessions.live.lock().take() {
                core.sessions.finish(l);
            }
            return;
        }
        tick += 1;
        let st = core.engine.status();
        let live = st.streaming && !st.rehearsal;
        let active = core.sessions.live.lock().is_some();
        if live && !active {
            let dests = core.read(|s| s.destinations.iter().filter(|d| d.enabled).map(|d| d.name.clone()).collect());
            let started = st.stream_started_at.unwrap_or_else(now_ms);
            let mut session = Session { id: format!("{started}"), started_at: started, destinations: dests, ..Default::default() };
            if let Ok(info) = core.oauth.get_stream_info("twitch").await.or(core.oauth.get_stream_info("kick").await) {
                session.title = info.title;
                session.category = info.category.map(|c| c.name).unwrap_or_default();
            }
            *core.sessions.live.lock() = Some(Live { session, ..Default::default() });
            tick = 0;
            continue;
        }
        if !live && active {
            if let Some(l) = core.sessions.live.lock().take() {
                core.sessions.finish(l);
            }
            continue;
        }
        if !live || tick % 12 != 0 {
            continue;
        }
        // One sample a minute.
        let mut viewers = BTreeMap::new();
        for a in core.oauth.accounts(&core.read(|s| s.account_tokens.clone())).iter().filter(|a| a.connected) {
            if let Ok(Some(n)) = core.oauth.viewer_count(&a.platform).await {
                viewers.insert(a.platform.clone(), n);
            }
        }
        let e = core.engine.clone();
        let stats = tokio::task::spawn_blocking(move || e.stats()).await.unwrap_or_default();
        let snap = core.engine.snapshot();
        let scene = snap.scenes.iter().find(|s| Some(s.uuid.to_string()) == snap.program_scene_uuid.as_ref().map(|u| u.to_string())).map(|s| s.name.clone()).unwrap_or_default();
        let streams: Vec<_> = stats.outputs.iter().filter(|o| o.id != "record" && o.id != "replay" && o.id != "virtualcam").collect();
        let kbps: f64 = streams.iter().map(|o| o.kbps).sum();
        let (dropped, total) = streams.iter().fold((0i64, 0i64), |a, o| (a.0 + o.dropped_frames, a.1 + o.total_frames));
        let mut guard = core.sessions.live.lock();
        let Some(l) = guard.as_mut() else { continue };
        let (pd, pt) = l.last_dropped;
        let dpct = if total - pt > 0 { (dropped - pd) as f64 * 100.0 / (total - pt) as f64 } else { 0.0 };
        l.last_dropped = (dropped, total);
        l.session.samples.push(Sample { ts: now_ms(), viewers, chat: std::mem::take(&mut l.chat_minute), scene, kbps, dropped: (dpct * 10.0).round() / 10.0 });
        // Every 5 minutes, keep a copy on disk in case Vexcast closes unexpectedly.
        if l.session.samples.len() % 5 == 0 {
            let mut s = l.session.clone();
            compute(&mut s);
            drop(guard);
            core.sessions.save(&s);
        }
    }
}

/// Ask the text engine for takeaways about a stream.
pub async fn insights(core: &Arc<Core>, id: &str) -> anyhow::Result<String> {
    let s = core.sessions.get(id).ok_or_else(|| anyhow::anyhow!("No existe ese directo"))?;
    // Compact timeline: one line every 5 minutes.
    let start = s.started_at;
    let mut lines = vec![];
    for chunk in s.samples.chunks(5) {
        let ts = chunk[0].ts;
        let viewers = chunk.iter().map(|x| x.viewers.values().sum::<u64>()).max().unwrap_or(0);
        let chat: u32 = chunk.iter().map(|x| x.chat).sum();
        let scene = &chunk[chunk.len() - 1].scene;
        let dropped = chunk.iter().map(|x| x.dropped).fold(0.0, f64::max);
        lines.push(format!("min {}: {viewers} espectadores, {chat} mensajes, escena «{scene}», pérdidas {dropped}%", (ts - start) / 60_000));
    }
    let events: Vec<String> = s.events.iter().map(|e| format!("min {}: {} de {}{}", (e.ts - start) / 60_000, e.kind, e.user, e.amount.map(|a| format!(" ({a})")).unwrap_or_default())).collect();
    let lang = if core.read(|st| st.general.language.clone()) == "en" { "inglés" } else { "español" };
    let data = format!(
        "Título: {}\\nCategoría: {}\\nDuración: {} min\\nResumen: {}\\n\\nCronología:\\n{}\\n\\nEventos:\\n{}",
        s.title,
        s.category,
        s.summary.duration_ms / 60_000,
        serde_json::to_string(&s.summary).unwrap_or_default(),
        lines.join("\\n"),
        if events.is_empty() { "(ninguno)".into() } else { events.join("\\n") }
    );
    let text = core
        .ai
        .chat(
            &format!("Eres analista de streams. Con los datos de un directo, da en {lang} de 3 a 5 observaciones concretas y accionables: cuándo subió o bajó la audiencia y qué estaba pasando (escena, eventos), qué funcionó, qué conviene repetir o evitar. Viñetas breves, con minutos. Sin introducción."),
            &data,
            700,
        )
        .await?;
    core.sessions.set_insights(id, &text);
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(twitch: u64, kick: u64) -> Sample {
        Sample { viewers: BTreeMap::from([("twitch".into(), twitch), ("kick".into(), kick)]), ..Default::default() }
    }

    #[test]
    fn summary_and_short_streams() {
        let dir = std::env::temp_dir().join(format!("vx-sessions-{}", new_id()));
        let s = Sessions::new(dir.clone());
        let now = now_ms();
        let long = Session { id: "a".into(), started_at: now - 3_600_000, samples: vec![sample(10, 5), sample(20, 10), sample(0, 0)], ..Default::default() };
        s.finish(Live { session: long, ..Default::default() });
        let saved = s.get("a").unwrap();
        assert_eq!(saved.summary.peak_viewers, 30);
        assert!((saved.summary.avg_viewers - 22.5).abs() < 1e-9);
        let short = Session { id: "b".into(), started_at: now - 10_000, ..Default::default() };
        s.finish(Live { session: short, ..Default::default() });
        assert!(s.get("b").is_none());
        assert_eq!(s.list().len(), 1);
        let _ = std::fs::remove_dir_all(dir);
    }
}
