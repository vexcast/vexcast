//! Unified chat: connectors for Twitch, YouTube and Kick.

pub mod kick;
pub mod twitch;
pub mod youtube;

use crate::core::Core;
use crate::model::*;
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

/// Outgoing actions a connector can perform.
#[derive(Debug, Clone)]
pub enum Outgoing {
    Say(String),
    Delete(String),
}

struct Running {
    fingerprint: String,
    task: JoinHandle<()>,
    tx: mpsc::Sender<Outgoing>,
}

pub struct ChatManager {
    core: Weak<Core>,
    running: Mutex<HashMap<ChatPlatform, Running>>,
    pub history: Mutex<VecDeque<ChatMessage>>,
    /// Message shown on stream by the highlight widget.
    pub highlight: Mutex<Option<ChatHighlight>>,
    stopped: AtomicBool,
}

/// Context handed to each connector.
#[derive(Clone)]
pub struct ConnCtx {
    pub core: Weak<Core>,
    pub platform: ChatPlatform,
}

impl ConnCtx {
    pub fn set_state(&self, state: ConnState, error: Option<String>) {
        if let Some(core) = self.core.upgrade() {
            let p = self.platform;
            core.update_runtime(move |s| {
                if let Some(c) = s.chat.iter_mut().find(|c| c.platform == p) {
                    c.state = state;
                    c.error = error;
                }
            });
        }
    }

    pub fn message(&self, msg: ChatMessage) {
        if let Some(core) = self.core.upgrade() {
            core.chat.incoming(&core, msg);
        }
    }

    pub fn alert(&self, kind: AlertType, user: &str, amount: Option<f64>, currency: Option<String>, message: Option<String>) {
        if let Some(core) = self.core.upgrade() {
            let platform = self.platform;
            let user = user.to_string();
            let c = core.clone();
            tokio::spawn(async move {
                c.alerts.push(kind, platform, &user, amount, currency, message, false).await;
            });
        }
    }

    pub fn deleted(&self, id: &str) {
        if let Some(core) = self.core.upgrade() {
            core.chat.history.lock().retain(|m| m.id != id);
            core.emit(ServerEvent::ChatDeleted { id: id.to_string() });
        }
    }
}

impl ChatManager {
    pub fn new(core: Weak<Core>) -> Arc<Self> {
        Arc::new(Self { core, running: Mutex::new(HashMap::new()), history: Mutex::new(VecDeque::new()), highlight: Default::default(), stopped: AtomicBool::new(false) })
    }

    pub fn start(self: Arc<Self>) {
        tokio::spawn(async move {
            let Some(core) = self.core.upgrade() else { return };
            let mut rx = core.subscribe_changes();
            drop(core);
            loop {
                self.reconcile();
                tokio::select! {
                    r = rx.changed() => if r.is_err() { break },
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                }
                if self.stopped.load(Ordering::Acquire) {
                    break;
                }
            }
        });
    }

    pub fn shutdown(&self) {
        self.stopped.store(true, Ordering::Release);
        for (_, r) in self.running.lock().drain() {
            r.task.abort();
        }
    }

    fn reconcile(&self) {
        let Some(core) = self.core.upgrade() else { return };
        let conns = core.read(|s| s.chat.clone());
        let mut running = self.running.lock();
        for c in conns {
            let fp = format!("{}|{}|{}", c.enabled, c.channel.trim().to_lowercase(), c.token);
            let active = c.enabled && !c.channel.trim().is_empty();
            let same = running.get(&c.platform).map(|r| r.fingerprint == fp && !r.task.is_finished()).unwrap_or(false);
            if same {
                continue;
            }
            if let Some(r) = running.remove(&c.platform) {
                r.task.abort();
            }
            if !active {
                if c.state != ConnState::Disconnected {
                    let p = c.platform;
                    core.update_runtime(move |s| {
                        if let Some(x) = s.chat.iter_mut().find(|x| x.platform == p) {
                            x.state = ConnState::Disconnected;
                            x.error = None;
                        }
                    });
                }
                continue;
            }
            let (tx, rx) = mpsc::channel(64);
            let ctx = ConnCtx { core: self.core.clone(), platform: c.platform };
            let channel = c.channel.trim().to_string();
            let token = c.token.clone();
            let http = core.http.clone();
            let task = match c.platform {
                ChatPlatform::Twitch => tokio::spawn(twitch::run(ctx, channel, token, rx)),
                ChatPlatform::Youtube => tokio::spawn(youtube::run(ctx, channel, token, http, rx)),
                ChatPlatform::Kick => tokio::spawn(kick::run(ctx, channel, http, rx)),
                _ => continue,
            };
            running.insert(c.platform, Running { fingerprint: fp, task, tx });
        }
    }

    /// Handle a message from any platform: moderation, history, broadcast, bot, AI.
    pub fn incoming(&self, core: &Arc<Core>, mut msg: ChatMessage) {
        let (moderation, blocked) = core.read(|s| (s.ai.moderation.clone(), s.ai.moderation.blocked_words.clone()));
        if moderation.enabled && !msg.is_bot {
            let lower = msg.text.to_lowercase();
            if blocked.iter().any(|w| !w.trim().is_empty() && lower.contains(&w.trim().to_lowercase())) {
                msg.flagged = true;
            }
        }
        // The bot's own moderation (links, caps, spam).
        let bot = core.read(|s| s.bot.clone());
        let broke = core.bot.check(&bot, &msg);
        if broke.is_some() {
            msg.flagged = true;
        }
        if !msg.is_bot {
            msg.viewer = Some(core.viewers.observe(&msg));
            msg.question = crate::viewers::is_question(&msg.text);
        }
        {
            let mut h = self.history.lock();
            h.push_back(msg.clone());
            while h.len() > 500 {
                h.pop_front();
            }
        }
        core.emit(ServerEvent::Chat(msg.clone()));
        core.sessions.on_chat(&msg);
        if let Some(reason) = broke {
            self.delete(&msg.id);
            core.bot.warn(core, &bot, &msg, reason);
        } else if msg.flagged && moderation.auto_delete {
            self.delete(&msg.id);
        }
        if msg.is_bot {
            return;
        }
        // Bot commands, TTS from chat, AI co-host & AI moderation.
        let c = core.clone();
        // Poll votes don't trigger commands.
        if core.polls.on_message(core, &msg) || core.giveaways.on_message(core, &msg) {
            return;
        }
        tokio::spawn(async move {
            // Loyalty commands (!puntos, !canjear…) and activity.
            if c.loyalty.on_message(&c, &msg).await || crate::counters::on_message(&c, &msg) || c.songs.on_message(&c, &msg).await {
                return;
            }
            c.bot.on_message(&c, &msg).await;
            c.ai.on_message(&c, &msg).await;
        });
    }

    /// Show any message on stream (e.g. a loyalty reward's text).
    pub fn highlight_message(&self, core: &Arc<Core>, message: ChatMessage) {
        let h = Some(ChatHighlight { message, at: now_ms() });
        *self.highlight.lock() = h.clone();
        core.emit(ServerEvent::ChatHighlight(h));
    }

    /// Show a message on stream (from the history), or remove the current one (None).
    pub fn set_highlight(&self, core: &Arc<Core>, id: Option<&str>) -> bool {
        let next = match id {
            Some(id) => match self.history.lock().iter().find(|m| m.id == id).cloned() {
                Some(message) => Some(ChatHighlight { message, at: now_ms() }),
                None => return false,
            },
            None => None,
        };
        *self.highlight.lock() = next.clone();
        core.emit(ServerEvent::ChatHighlight(next));
        true
    }

    /// Send a message to the given platforms (all connected if None).
    pub fn send(&self, text: &str, platforms: Option<Vec<ChatPlatform>>) -> usize {
        let running = self.running.lock();
        let mut n = 0;
        for (p, r) in running.iter() {
            if platforms.as_ref().map(|ps| ps.contains(p)).unwrap_or(true) && r.tx.try_send(Outgoing::Say(text.to_string())).is_ok() {
                n += 1;
            }
        }
        n
    }

    pub fn delete(&self, id: &str) {
        let platform = self.history.lock().iter().find(|m| m.id == id).map(|m| m.platform);
        if let Some(p) = platform {
            if let Some(r) = self.running.lock().get(&p) {
                let _ = r.tx.try_send(Outgoing::Delete(id.to_string()));
            }
        }
        self.history.lock().retain(|m| m.id != id);
        if let Some(core) = self.core.upgrade() {
            core.emit(ServerEvent::ChatDeleted { id: id.to_string() });
        }
    }

    /// Echo a message we sent (bots, the streamer) into the local chat view.
    pub fn local_echo(&self, core: &Arc<Core>, name: &str, text: &str, is_bot: bool) {
        let msg = ChatMessage {
            id: new_id(),
            platform: ChatPlatform::Vexcast,
            channel: String::new(),
            user: ChatUser { id: name.to_lowercase(), name: name.to_string(), color: Some(if is_bot { "#22D3EE".into() } else { "#8B5CF6".into() }), badges: vec![] },
            text: text.to_string(),
            ts: now_ms(),
            is_bot: true,
            flagged: false,
            viewer: None,
            question: false,
            translated: None,
        };
        let _ = is_bot;
        self.history.lock().push_back(msg.clone());
        core.emit(ServerEvent::Chat(msg));
    }
}

/// Exponential backoff helper for reconnect loops.
pub async fn backoff(attempt: &mut u32) {
    *attempt += 1;
    let secs = [2u64, 4, 8, 15, 30][(*attempt as usize - 1).min(4)];
    tokio::time::sleep(Duration::from_secs(secs)).await;
}
