//! Central state container: persistence, change notification and event bus.

use crate::model::*;
use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, watch};

pub struct Core {
    state: RwLock<AppState>,
    events: broadcast::Sender<Arc<str>>,
    change_tx: watch::Sender<u64>,
    dirty: AtomicBool,
    stopping: AtomicBool,
    pub data_dir: PathBuf,
    pub port: u16,
    pub http: reqwest::Client,
    pub engine: Arc<crate::obs::Engine>,
    pub chat: Arc<crate::chat::ChatManager>,
    pub alerts: Arc<crate::alerts::Alerts>,
    pub tts: Arc<crate::ai::tts::TtsService>,
    pub ai: Arc<crate::ai::AiService>,
    pub hub: Arc<crate::ai::hub::Hub>,
    pub viewers: crate::viewers::Viewers,
    pub sessions: crate::sessions::Sessions,
    pub bot: Arc<crate::bot::Bot>,
    pub polls: Arc<crate::polls::Polls>,
    pub loyalty: Arc<crate::loyalty::Loyalty>,
    pub giveaways: crate::giveaway::Giveaways,
    pub songs: crate::songs::Songs,
    pub oauth: Arc<crate::oauth::OAuth>,
    pub remote: crate::remote::RemoteRegistry,
    /// Async runtime, for work started from libobs threads (hotkeys).
    pub rt: tokio::runtime::Handle,
}

impl Core {
    pub fn new(data_dir: PathBuf, version: String, port: u16) -> anyhow::Result<Arc<Self>> {
        let path = data_dir.join("config.json");
        let mut state: AppState = match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                tracing::error!("config.json is invalid ({e}); keeping a backup and starting fresh");
                let _ = std::fs::copy(&path, data_dir.join("config.invalid.json"));
                AppState::default()
            }),
            Err(_) => AppState::default(),
        };
        state.version = version.clone();
        state.update.current_version = version;
        if state.api_token.is_empty() {
            state.api_token = crate::util::random_token(32);
        }
        for c in &mut state.chat {
            c.state = ConnState::Disconnected;
            c.error = None;
        }
        if state.scene_collection.trim().is_empty() {
            state.scene_collection = "Escenas".into();
        }
        crate::model::migrate_alert_variations(&mut state.widgets.alert_box);

        let (events, _) = broadcast::channel(1024);
        let (change_tx, _) = watch::channel(0u64);
        let http = reqwest::Client::builder()
            .user_agent(concat!("Vexcast/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(60))
            .build()?;

        let core = Arc::new_cyclic(|weak| Core {
            state: RwLock::new(state),
            events,
            change_tx,
            dirty: AtomicBool::new(true),
            stopping: AtomicBool::new(false),
            data_dir: data_dir.clone(),
            port,
            http: http.clone(),
            engine: crate::obs::Engine::new(weak.clone(), data_dir.clone()),
            chat: crate::chat::ChatManager::new(weak.clone()),
            alerts: crate::alerts::Alerts::new(weak.clone()),
            tts: crate::ai::tts::TtsService::new(weak.clone(), data_dir.join("tts")),
            ai: crate::ai::AiService::new(weak.clone()),
            hub: crate::ai::hub::Hub::new(weak.clone(), data_dir.join("ai")),
            viewers: crate::viewers::Viewers::new(data_dir.join("viewers.json")),
            sessions: crate::sessions::Sessions::new(data_dir.join("sessions")),
            bot: crate::bot::Bot::new(weak.clone()),
            polls: Arc::new(crate::polls::Polls::new(weak.clone())),
            giveaways: crate::giveaway::Giveaways::new(weak.clone()),
            songs: crate::songs::Songs::new(weak.clone()),
            loyalty: crate::loyalty::Loyalty::new(weak.clone(), data_dir.join("loyalty.json")),
            oauth: crate::oauth::OAuth::new(weak.clone()),
            remote: crate::remote::RemoteRegistry::new(),
            rt: tokio::runtime::Handle::current(),
        });
        core.save_now();
        Ok(core)
    }

    pub fn token(&self) -> String {
        self.state.read().api_token.clone()
    }

    /// Full internal snapshot (with secrets).
    pub fn snapshot(&self) -> AppState {
        self.state.read().clone()
    }

    pub fn read<R>(&self, f: impl FnOnce(&AppState) -> R) -> R {
        f(&self.state.read())
    }

    /// Settings with secrets masked + live engine snapshot + status.
    pub fn public_state(&self) -> PublicState {
        let s = self.state.read().masked();
        let accounts = self.oauth.accounts(&self.state.read().account_tokens);
        PublicState {
            accounts,
            version: s.version,
            status: self.engine.status(),
            engine: self.engine.snapshot(),
            video: s.video,
            audio: s.audio,
            output: s.output,
            advanced: s.advanced,
            destinations: s.destinations,
            chat: s.chat,
            widgets: s.widgets,
            ai: s.ai,
            bot: s.bot,
            general: s.general,
            labels: s.labels,
            counters: s.counters,
            countdown: s.countdown,
            update: s.update,
            macros: s.macros,
        }
    }

    /// Mutate persisted state: saves, notifies subsystems and broadcasts.
    pub fn update<R>(&self, f: impl FnOnce(&mut AppState) -> R) -> R {
        let r = {
            let mut s = self.state.write();
            f(&mut s)
        };
        self.dirty.store(true, Ordering::Release);
        self.changed();
        r
    }

    /// Mutate runtime-only fields (no save, still broadcast).
    pub fn update_runtime(&self, f: impl FnOnce(&mut AppState)) {
        {
            let mut s = self.state.write();
            f(&mut s);
        }
        self.broadcast_state();
    }

    fn changed(&self) {
        self.change_tx.send_modify(|v| *v += 1);
        self.broadcast_state();
    }

    pub fn subscribe_changes(&self) -> watch::Receiver<u64> {
        self.change_tx.subscribe()
    }

    pub fn broadcast_state(&self) {
        let s = self.public_state();
        self.emit(ServerEvent::State(Box::new(s)));
    }

    pub fn emit(&self, ev: ServerEvent) {
        if self.events.receiver_count() == 0 {
            return;
        }
        if let Ok(json) = serde_json::to_string(&ev) {
            let _ = self.events.send(Arc::from(json));
        }
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<Arc<str>> {
        self.events.subscribe()
    }

    pub fn notify(&self, level: &str, message: impl Into<String>) {
        let message = message.into();
        match level {
            "error" => tracing::error!("{message}"),
            "warning" => tracing::warn!("{message}"),
            _ => tracing::info!("{message}"),
        }
        self.emit(ServerEvent::Notification { level: level.into(), message });
    }

    pub fn save_now(&self) {
        if !self.dirty.swap(false, Ordering::AcqRel) {
            return;
        }
        let s = self.state.read().clone();
        let json = match serde_json::to_string_pretty(&s) {
            Ok(j) => j,
            Err(e) => {
                tracing::error!("serialize config: {e}");
                return;
            }
        };
        let path = self.data_dir.join("config.json");
        let tmp = self.data_dir.join("config.json.tmp");
        if let Err(e) = std::fs::write(&tmp, json).and_then(|_| std::fs::rename(&tmp, &path)) {
            tracing::error!("saving config: {e}");
        }
    }

    pub fn is_stopping(&self) -> bool {
        self.stopping.load(Ordering::Acquire)
    }

    pub fn shutdown(&self) {
        self.stopping.store(true, Ordering::Release);
        self.engine.shutdown();
        self.chat.shutdown();
        self.hub.kill_all();
        self.viewers.save_if_dirty();
        // Points in play go back to the viewers, then save the balances.
        self.polls.refund_on_exit(&self.loyalty);
        self.giveaways.refund_to(&self.loyalty);
        self.loyalty.save();
        // A clean exit is not a crash: don't resume next time.
        #[cfg(feature = "obs")]
        self.engine.clear_unfinished_stream();
        self.dirty.store(true, Ordering::Release);
        self.save_now();
    }

    /// Spawn all background loops.
    pub fn spawn_background(self: Arc<Self>) {
        tokio::spawn(crate::sessions::run(self.clone()));
        {
            let c = self.clone();
            tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    if c.is_stopping() {
                        return;
                    }
                    c.viewers.save_if_dirty();
                }
            });
        }
        #[cfg(feature = "obs")]
        tokio::spawn(crate::health::run(self.clone()));
        tokio::spawn(crate::live_text::run(self.clone()));
        tokio::spawn(crate::twitch_events::run(self.clone()));
        // Back on air after a crash or power cut while live.
        #[cfg(feature = "obs")]
        {
            let c = self.clone();
            tokio::spawn(async move {
                for _ in 0..120 {
                    if c.engine.is_ready() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
                let Some(started) = c.engine.unfinished_stream() else { return };
                let fresh = crate::model::now_ms() - started < 6 * 3600 * 1000;
                if !fresh || !c.read(|s| s.general.resume_after_crash) || !c.engine.is_ready() {
                    c.engine.clear_unfinished_stream();
                    return;
                }
                // Give sources (cameras, captures) a moment to come up.
                tokio::time::sleep(Duration::from_secs(3)).await;
                let e = c.engine.clone();
                match tokio::task::spawn_blocking(move || e.start_stream()).await {
                    Ok(Ok(_)) => c.notify("success", "Vexcast se cerró mientras estabas en directo: se ha reanudado la emisión".to_string()),
                    Ok(Err(err)) => c.notify("error", format!("No se pudo reanudar el directo tras el cierre inesperado: {err}")),
                    Err(_) => {}
                }
                c.broadcast_state();
            });
        }
        // Debounced saver.
        let c = self.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_millis(800));
            loop {
                iv.tick().await;
                if c.is_stopping() {
                    break;
                }
                c.save_now();
            }
        });

        // Status broadcaster (1 Hz).
        let c = self.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_secs(1));
            loop {
                iv.tick().await;
                if c.is_stopping() {
                    break;
                }
                let status = c.engine.status();
                let started = status.stream_started_at;
                c.state.write().stream_started_at = started;
                c.emit(ServerEvent::Status(status));
                let engine = c.engine.clone();
                if let Ok(stats) = tokio::task::spawn_blocking(move || engine.stats()).await {
                    c.emit(ServerEvent::Stats(stats));
                }
            }
        });

        // First run with labels: fill them from the streams already recorded.
        if self.read(|s| s.labels.latest.is_empty()) {
            let past = self.sessions.past_events();
            if !past.is_empty() {
                self.update(|s| {
                    for e in &past {
                        if let Ok(kind) = serde_json::from_value::<AlertType>(serde_json::Value::String(e.kind.clone())) {
                            s.labels.record(kind, &e.user, e.amount, None, e.ts, None);
                        }
                    }
                    // Totals are per stream: start clean.
                    s.labels.session.clear();
                    s.labels.session_top.clear();
                });
            }
        }
        self.engine.clone().start();
        self.chat.clone().start();
        self.bot.clone().start();
        self.loyalty.clone().start();
        self.ai.clone().start();
        crate::update::spawn_checker(self.clone());
    }
}
