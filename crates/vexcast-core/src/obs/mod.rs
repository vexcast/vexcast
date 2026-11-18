//! The Vexcast video engine, built on libobs (the OBS Studio core).

pub mod model;

#[cfg(feature = "obs")]
pub mod audio;
#[cfg(feature = "obs")]
mod catalog;
#[cfg(feature = "obs")]
mod hotkeys;
#[cfg(feature = "obs")]
mod collection;
#[cfg(feature = "obs")]
pub mod slobs;
#[cfg(feature = "obs")]
pub mod theme;
#[cfg(feature = "obs")]
pub mod fonts;
#[cfg(feature = "obs")]
pub mod ffi;
#[cfg(feature = "obs")]
mod devices;
#[cfg(feature = "obs")]
mod ops;
#[cfg(feature = "obs")]
mod outputs;
#[cfg(feature = "obs")]
mod vertical;
#[cfg(feature = "obs")]
pub mod vertical_layout;
#[cfg(feature = "obs")]
pub mod preview;
#[cfg(feature = "obs")]
pub mod props;
#[cfg(feature = "obs")]
pub mod runtime;
#[cfg(feature = "obs")]
pub mod snapshot;

#[cfg(feature = "obs")]
pub use engine::*;
#[cfg(feature = "obs")]
pub use outputs::format_filename as outputs_filename;
#[cfg(feature = "obs")]
pub use catalog::best_video_encoder;
#[cfg(not(feature = "obs"))]
pub use stub::*;

pub use preview_key::PreviewKey;

mod preview_key {
    #[derive(Clone, Debug, PartialEq, Eq, Hash)]
    pub enum PreviewKey {
        Program,
        /// The vertical (9:16) canvas output.
        Vertical,
        Scene(String),
        Source(String),
    }
}

#[cfg(feature = "obs")]
mod engine {
    use super::ffi::*;
    use super::model::*;
    use super::*;
    use crate::core::Core;
    use libobs as sys;
    use parking_lot::Mutex;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Weak};
    use std::time::{Duration, Instant};

    pub(crate) struct Inner {
        pub collection: String,
        /// Scene uuids in user order.
        pub scene_order: Vec<String>,
        /// Strong refs keeping scenes alive (libobs frees unreferenced sources).
        pub scene_refs: std::collections::HashMap<String, Source>,
        /// Inputs created without a scene (kept alive until added or deleted).
        pub orphans: Vec<Source>,
        pub program: Option<String>,
        pub preview: Option<String>,
        pub studio: bool,
        pub transitions: Vec<Source>,
        pub current_transition: Option<String>,
        pub duration_ms: u32,
        pub clipboard: Option<(sys::obs_transform_info, sys::obs_sceneitem_crop)>,
        pub had_globals: bool,
        pub vertical: Option<vertical::Vertical>,
        /// Twin layouts read from the collection, applied when the vertical canvas is enabled.
        pub vertical_saved: Vec<serde_json::Value>,
    }

    unsafe impl Send for Inner {}

    pub struct Engine {
        pub(crate) core: Weak<Core>,
        pub(crate) data_dir: PathBuf,
        pub(crate) inner: Mutex<Inner>,
        ready: AtomicBool,
        version: Mutex<Option<String>>,
        error: Mutex<Option<String>>,
        dirty: AtomicBool,
        last_save: Mutex<Instant>,
        cache: Mutex<Option<EngineSnapshot>>,
        pub(crate) previews: preview::Previews,
        pub(crate) meters: audio::Meters,
        pub(crate) fx: Arc<audio::Fx>,
        pub(crate) outputs: outputs::Outputs,
        pub(crate) rehearsal: AtomicBool,
        /// Registered macro hotkeys: (macro id, libobs hotkey id).
        pub(crate) macro_hotkeys: Mutex<Vec<(String, u64)>>,
    }

    impl Engine {
        pub fn new(core: Weak<Core>, data_dir: PathBuf) -> Arc<Self> {
            Arc::new(Self {
                core,
                data_dir,
                inner: Mutex::new(Inner {
                    collection: String::new(),
                    scene_order: vec![],
                    scene_refs: Default::default(),
                    orphans: vec![],
                    program: None,
                    preview: None,
                    studio: false,
                    transitions: vec![],
                    current_transition: None,
                    duration_ms: 300,
                    clipboard: None,
                    had_globals: false,
                    vertical: None,
                    vertical_saved: vec![],
                }),
                ready: AtomicBool::new(false),
                version: Mutex::new(None),
                error: Mutex::new(None),
                dirty: AtomicBool::new(false),
                last_save: Mutex::new(Instant::now()),
                cache: Mutex::new(None),
                previews: preview::Previews::default(),
                meters: audio::Meters::default(),
                fx: Arc::new(audio::Fx::default()),
                outputs: outputs::Outputs::default(),
                rehearsal: AtomicBool::new(false),
                macro_hotkeys: Mutex::new(vec![]),
            })
        }

        pub fn is_ready(&self) -> bool {
            self.ready.load(Ordering::Acquire)
        }

        pub(crate) fn require_ready(&self) -> anyhow::Result<()> {
            if self.is_ready() {
                Ok(())
            } else {
                anyhow::bail!(self.error.lock().clone().unwrap_or_else(|| "El motor de video aún se está iniciando".into()))
            }
        }

        pub(crate) fn core(&self) -> Option<Arc<Core>> {
            self.core.upgrade()
        }

        pub(crate) fn last_save_mut(&self) -> parking_lot::MutexGuard<'_, Instant> {
            self.last_save.lock()
        }

        pub(crate) fn clear_dirty(&self) {
            self.dirty.store(false, Ordering::Release);
        }

        /// Mark the engine state as changed: invalidates the snapshot, schedules a save and broadcasts.
        pub(crate) fn changed(&self) {
            self.dirty.store(true, Ordering::Release);
            *self.cache.lock() = None;
            if let Some(core) = self.core() {
                core.broadcast_state();
            }
        }

        /// Saved later with the collection, without telling clients (volatile changes).
        pub(crate) fn mark_dirty(&self) {
            self.dirty.store(true, Ordering::Release);
            *self.cache.lock() = None;
        }

        /// Start libobs on a background thread and load the last scene collection.
        pub fn start(self: Arc<Self>) {
            let me = self.clone();
            std::thread::Builder::new()
                .name("obs-init".into())
                .spawn(move || {
                    if let Err(e) = me.init() {
                        tracing::error!("libobs init failed: {e:#}");
                        *me.error.lock() = Some(format!("No se pudo iniciar el motor de OBS: {e}"));
                        if let Some(c) = me.core() {
                            c.notify("error", format!("No se pudo iniciar el motor de video: {e}"));
                            c.broadcast_state();
                        }
                    }
                })
                .ok();

            // Background: periodic snapshot refresh (sizes, media state...) and debounced save.
            let me = self.clone();
            tokio::spawn(async move {
                let mut iv = tokio::time::interval(Duration::from_millis(1000));
                let mut last_json = String::new();
                loop {
                    iv.tick().await;
                    let Some(core) = me.core() else { break };
                    if core.is_stopping() {
                        break;
                    }
                    if !me.is_ready() {
                        continue;
                    }
                    // Refresh snapshot and broadcast when something changed outside our API (sizes, media).
                    *me.cache.lock() = None;
                    let snap = me.snapshot();
                    let json = serde_json::to_string(&snap).unwrap_or_default();
                    if json != last_json {
                        last_json = json;
                        core.broadcast_state();
                    }
                    if me.dirty.load(Ordering::Acquire) && me.last_save.lock().elapsed() > Duration::from_secs(2) {
                        me.save_collection();
                    }
                    me.meters.reconcile(&snap.sources);
                    me.outputs.poll(&me);
                }
            });
            self.meters.spawn_emitter(self.core.clone());
        }

        fn init(self: &Arc<Self>) -> anyhow::Result<()> {
            let core = self.core().ok_or_else(|| anyhow::anyhow!("core stopped"))?;
            let (video, audio, advanced, lang, collection) = core.read(|s| (s.video.clone(), s.audio.clone(), s.advanced.clone(), s.general.language.clone(), s.scene_collection.clone()));
            let version = unsafe { runtime::startup(&self.data_dir.join("obs-config"), runtime::locale_for(&lang))? };
            tracing::info!("libobs {version} started");
            unsafe {
                let r = runtime::reset_video(&video, &advanced.renderer);
                if r != 0 {
                    anyhow::bail!("obs_reset_video falló (código {r}). ¿Tu GPU soporta {}?", runtime::graphics_module(&advanced.renderer));
                }
                if !runtime::reset_audio(&audio) {
                    anyhow::bail!("obs_reset_audio falló");
                }
                runtime::load_modules();
                if audio.monitoring_device_id != "default" {
                    sys::obs_set_audio_monitoring_device(cstr(&audio.monitoring_device_name).as_ptr(), cstr(&audio.monitoring_device_id).as_ptr());
                }
            }
            *self.version.lock() = Some(version);
            // Pick a default stream encoder the first time.
            let has_encoder = core.read(|s| !s.output.stream_encoder.is_empty());
            if !has_encoder {
                let best = catalog::best_video_encoder();
                core.update(|s| s.output.stream_encoder = best);
            }
            self.load_collection(if collection.is_empty() { "Escenas".into() } else { collection })?;
            self.ready.store(true, Ordering::Release);
            self.sync_global_audio(&audio);
            self.fx.init();
            self.register_hotkeys();
            if let Some(c) = self.core() {
                let macros: Vec<(String, String)> = c.read(|s| s.macros.iter().map(|m| (m.id.clone(), m.name.clone())).collect());
                self.sync_macro_hotkeys(&macros);
            }
            if video.vertical_enabled {
                if let Err(e) = self.apply_vertical(&video) {
                    core.notify("warning", format!("Lienzo vertical: {e}"));
                }
            }
            self.changed();
            core.notify("success", "Motor de video listo");
            Ok(())
        }

        pub fn shutdown(&self) {
            if !self.is_ready() {
                return;
            }
            self.save_collection();
            self.outputs.stop_all();
            self.previews.clear();
            self.meters.clear();
            self.fx.clear();
            self.ready.store(false, Ordering::Release);
            *self.cache.lock() = None;
            unsafe {
                for ch in 0..64 {
                    sys::obs_set_output_source(ch, std::ptr::null_mut());
                }
                // Release every reference we hold before libobs frees its context.
                {
                    let mut inner = self.inner.lock();
                    inner.transitions.clear();
                    inner.scene_refs.clear();
                    inner.orphans.clear();
                    inner.clipboard = None;
                    inner.vertical = None;
                }
                let mut all: Vec<Source> = vec![];
                sys::obs_enum_sources(Some(collect_sources), &mut all as *mut _ as *mut std::os::raw::c_void);
                sys::obs_enum_scenes(Some(collect_sources), &mut all as *mut _ as *mut std::os::raw::c_void);
                for src in &all {
                    sys::obs_source_remove(src.ptr());
                }
                drop(all);
                runtime::shutdown();
            }
        }

        pub fn status(&self) -> EngineStatus {
            let inner = self.inner.lock();
            let o = self.outputs.status();
            EngineStatus {
                ready: self.is_ready(),
                obs_version: self.version.lock().clone(),
                error: self.error.lock().clone(),
                streaming: o.streaming,
                stream_started_at: o.stream_started_at,
                recording: o.recording,
                recording_paused: o.recording_paused,
                recording_started_at: o.recording_started_at,
                last_recording_path: o.last_recording_path,
                replay_buffer_active: o.replay_active,
                virtual_cam_active: o.virtualcam_active,
                studio_mode: inner.studio,
                rehearsal: o.streaming && self.rehearsal.load(Ordering::Acquire),
                server_time: crate::model::now_ms(),
            }
        }

        /// Current engine snapshot (cached until something changes).
        pub fn snapshot(&self) -> EngineSnapshot {
            if !self.is_ready() {
                return EngineSnapshot { transition_duration_ms: 300, ..Default::default() };
            }
            if let Some(c) = self.cache.lock().clone() {
                return c;
            }
            let snap = unsafe { self.build_snapshot() };
            *self.cache.lock() = Some(snap.clone());
            snap
        }

        unsafe fn build_snapshot(&self) -> EngineSnapshot {
            let mut inner = self.inner.lock();
            let twin_uuids: Vec<String> = inner.vertical.as_ref().map(|v| v.twins.values().map(|t| t.uuid()).collect()).unwrap_or_default();
            let mut scenes_src = snapshot::all_scenes();
            scenes_src.retain(|s| !twin_uuids.contains(&s.uuid()));
            // Keep scene order in sync with what exists.
            let uuids: Vec<String> = scenes_src.iter().map(|s| s.uuid()).collect();
            inner.scene_order.retain(|u| uuids.contains(u));
            for u in &uuids {
                if !inner.scene_order.contains(u) {
                    inner.scene_order.push(u.clone());
                }
            }
            let mut scenes: Vec<SceneInfo> = vec![];
            for u in inner.scene_order.clone() {
                if let Some(s) = scenes_src.iter().find(|s| s.uuid() == u) {
                    let twin = inner.vertical.as_ref().and_then(|v| v.twins.get(&u)).map(|t| t.uuid());
                    scenes.push(SceneInfo { uuid: u, name: s.name(), items: snapshot::scene_items(s.scene()), filters: snapshot::filters_of(s), vertical_scene_uuid: twin });
                }
            }
            let mut vertical_scenes: Vec<SceneInfo> = vec![];
            if let Some(v) = inner.vertical.as_ref() {
                for u in &inner.scene_order {
                    if let Some(t) = v.twins.get(u) {
                        vertical_scenes.push(SceneInfo { uuid: t.uuid(), name: t.name(), items: snapshot::scene_items(t.scene()), filters: snapshot::filters_of(t), vertical_scene_uuid: None });
                    }
                }
            }
            let refs = snapshot::reference_counts(&scenes);
            let slots = snapshot::global_slots();
            let mut sources: Vec<SourceInfo> = snapshot::all_inputs().iter().map(|s| snapshot::source_info(s, &slots, &refs)).collect();
            sources.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            let transitions = inner.transitions.iter().map(|t| snapshot::transition_info(t)).collect();
            EngineSnapshot {
                scene_collection: inner.collection.clone(),
                scene_collections: collection::list(&self.data_dir, &inner.collection),
                scenes,
                vertical_scenes,
                sources,
                program_scene_uuid: inner.program.clone(),
                preview_scene_uuid: if inner.studio { inner.preview.clone() } else { None },
                transitions,
                current_transition_uuid: inner.current_transition.clone(),
                transition_duration_ms: inner.duration_ms,
            }
        }

        pub fn stats(&self) -> Stats {
            self.outputs.stats(self)
        }

        /// Play an audio file (bytes) into the stream mix and local monitor.
        pub fn play_audio(&self, bytes: &[u8], ext: &str) -> anyhow::Result<()> {
            self.require_ready()?;
            let dir = self.data_dir.join("tts");
            std::fs::create_dir_all(&dir)?;
            let path = dir.join(format!("fx-{}.{ext}", crate::model::new_id()));
            std::fs::write(&path, bytes)?;
            self.fx.play(path);
            Ok(())
        }

        pub fn skip_audio(&self) {
            self.fx.skip();
        }

        /// Tap a source's audio for captions (interleaved stereo f32) + its sample rate.
        pub fn tap_audio(&self, uuid: &str) -> Option<(std::sync::mpsc::Receiver<Arc<Vec<f32>>>, audio::AudioTap, u32)> {
            if !self.is_ready() {
                return None;
            }
            audio::tap(uuid).map(|(rx, t)| (rx, t, audio::sample_rate()))
        }

        pub fn subscribe_preview(&self, key: PreviewKey, fps: u32) -> anyhow::Result<(tokio::sync::watch::Receiver<Option<bytes::Bytes>>, preview::PreviewGuard)> {
            self.require_ready()?;
            let canvas = if key == PreviewKey::Vertical {
                Some(self.vertical_canvas_ref().ok_or_else(|| anyhow::anyhow!("El lienzo vertical está desactivado"))?)
            } else {
                None
            };
            self.previews.subscribe(key, fps, canvas)
        }

        pub fn obs_collections_list(&self) -> Vec<(String, PathBuf, &'static str)> {
            self.obs_collections()
        }
    }
}

/// Engine stub used when Vexcast is built without libobs (`--no-default-features`).
#[cfg(not(feature = "obs"))]
mod stub {
    use super::model::*;
    use crate::core::Core;
    use std::path::PathBuf;
    use std::sync::{Arc, Weak};

    pub struct Engine;

    impl Engine {
        pub fn new(_core: Weak<Core>, _data_dir: PathBuf) -> Arc<Self> {
            Arc::new(Engine)
        }
        pub fn start(self: Arc<Self>) {}
        pub fn shutdown(&self) {}
        pub fn is_ready(&self) -> bool {
            false
        }
        pub fn status(&self) -> EngineStatus {
            EngineStatus { error: Some("Compilado sin el motor de OBS".into()), server_time: crate::model::now_ms(), ..Default::default() }
        }
        pub fn snapshot(&self) -> EngineSnapshot {
            EngineSnapshot { transition_duration_ms: 300, ..Default::default() }
        }
        pub fn stats(&self) -> Stats {
            Stats::default()
        }
        pub fn play_audio(&self, _bytes: &[u8], _ext: &str) -> anyhow::Result<()> {
            anyhow::bail!("Motor de video no disponible")
        }
        pub fn set_source_fields(&self, _uuid: &str, _fields: &serde_json::Value, _persist: bool) -> anyhow::Result<()> {
            anyhow::bail!("Motor de video no disponible")
        }
        pub fn skip_audio(&self) {}
        pub fn tap_audio(&self, _uuid: &str) -> Option<(std::sync::mpsc::Receiver<Arc<Vec<f32>>>, AudioTap, u32)> {
            None
        }
    }

    pub struct AudioTap;
}
