//! Who is chatting: first-time chatters, people coming back, message counts. Kept in
//! viewers.json so it lasts across streams.

use crate::model::{now_ms, ChatMessage, ViewerTag};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Viewer {
    name: String,
    first_seen: i64,
    last_seen: i64,
    messages: u32,
}

pub struct Viewers {
    path: PathBuf,
    book: Mutex<HashMap<String, Viewer>>,
    /// Who already spoke since Vexcast started (one "welcome back" per session).
    session: Mutex<HashSet<String>>,
    session_start: i64,
    dirty: AtomicBool,
}

const DAY: i64 = 24 * 3600 * 1000;

impl Viewers {
    pub fn new(path: PathBuf) -> Self {
        let book = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Self { path, book: Mutex::new(book), session: Mutex::new(HashSet::new()), session_start: now_ms(), dirty: AtomicBool::new(false) }
    }

    fn key(msg: &ChatMessage) -> String {
        let id = if msg.user.id.is_empty() { msg.user.name.to_lowercase() } else { msg.user.id.clone() };
        format!("{}:{id}", serde_json::to_value(msg.platform).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default())
    }

    /// Record a message and tell what's notable about its author.
    pub fn observe(&self, msg: &ChatMessage) -> ViewerTag {
        let key = Self::key(msg);
        let now = now_ms();
        let first_in_session = self.session.lock().insert(key.clone());
        let mut book = self.book.lock();
        let existed = book.get(&key).cloned();
        let v = book.entry(key).or_insert_with(|| Viewer { first_seen: now, ..Default::default() });
        v.name = msg.user.name.clone();
        v.messages += 1;
        let prev_seen = v.last_seen;
        v.last_seen = now;
        self.dirty.store(true, Ordering::Release);
        match existed {
            None => ViewerTag { first_time: true, returning: false, messages: 1, days_away: None },
            Some(old) => {
                let away = first_in_session && prev_seen < self.session_start;
                let days = ((now - prev_seen) / DAY) as u32;
                ViewerTag { first_time: false, returning: away, messages: old.messages + 1, days_away: (away && days >= 1).then_some(days) }
            }
        }
    }

    pub fn save_if_dirty(&self) {
        if !self.dirty.swap(false, Ordering::AcqRel) {
            return;
        }
        let data = serde_json::to_vec(&*self.book.lock()).unwrap_or_default();
        let tmp = self.path.with_extension("json.tmp");
        if std::fs::write(&tmp, data).is_ok() {
            let _ = std::fs::rename(&tmp, &self.path);
        }
    }
}

/// A message that asks something (for the questions queue).
pub fn is_question(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    if t.chars().filter(|c| c.is_alphabetic()).count() < 6 || t.starts_with('!') {
        return false;
    }
    if t.contains('?') || t.contains('¿') {
        return true;
    }
    const STARTS: [&str; 26] = [
        "qué ", "que ", "cómo ", "como ", "cuándo ", "cuando ", "dónde ", "donde ", "por qué", "porque ", "cuál", "cual ", "quién", "quien ", "cuánto", "cuanto", "what ", "how ", "why ", "when ", "where ", "who ", "which ", "can you", "do you", "are you",
    ];
    STARTS.iter().any(|s| t.starts_with(s))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{ChatPlatform, ChatUser};

    fn msg(name: &str, text: &str) -> ChatMessage {
        ChatMessage {
            id: "1".into(),
            platform: ChatPlatform::Twitch,
            channel: "c".into(),
            user: ChatUser { id: name.into(), name: name.into(), color: None, badges: vec![] },
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
    fn tags_first_time_and_counts() {
        let v = Viewers::new(std::env::temp_dir().join(format!("vx-viewers-{}.json", crate::model::new_id())));
        let a = v.observe(&msg("ana", "hola"));
        assert!(a.first_time);
        let b = v.observe(&msg("ana", "qué tal"));
        assert!(!b.first_time && !b.returning && b.messages == 2);
    }

    #[test]
    fn detects_questions() {
        assert!(is_question("¿qué teclado usas?"));
        assert!(is_question("como se llama el juego"));
        assert!(is_question("what game is this"));
        assert!(!is_question("jajaja"));
        assert!(!is_question("!uptime"));
        assert!(!is_question("buen directo"));
    }
}
