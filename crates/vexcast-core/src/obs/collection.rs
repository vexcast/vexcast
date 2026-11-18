//! Scene collections, stored in OBS Studio's own JSON format (so OBS collections import as-is).

use super::ffi::*;
use super::model::SceneCollection;
use super::Engine;
use libobs as sys;
use serde_json::{json, Value};
use std::os::raw::c_void;
use std::path::{Path, PathBuf};

/// OBS frontend output channels for global audio.
pub const GLOBAL_SLOTS: [(&str, u32, &str); 6] = [
    ("DesktopAudioDevice1", 1, "desktop1"),
    ("DesktopAudioDevice2", 2, "desktop2"),
    ("AuxAudioDevice1", 3, "mic1"),
    ("AuxAudioDevice2", 4, "mic2"),
    ("AuxAudioDevice3", 5, "mic3"),
    ("AuxAudioDevice4", 6, "mic4"),
];

fn extras_groups_mut(groups: &mut Value) -> impl Iterator<Item = &mut Value> {
    groups.as_array_mut().into_iter().flatten()
}

pub fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("scenes")
}

pub fn file_for(data_dir: &Path, name: &str) -> PathBuf {
    let safe: String = name.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { '_' }).collect();
    dir(data_dir).join(format!("{}.json", safe.trim()))
}

pub fn list(data_dir: &Path, current: &str) -> Vec<SceneCollection> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(dir(data_dir)) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let name = std::fs::read_to_string(&p)
                .ok()
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .and_then(|v| v["name"].as_str().map(String::from))
                .unwrap_or_else(|| p.file_stem().unwrap_or_default().to_string_lossy().to_string());
            out.push(SceneCollection { current: name == current, name });
        }
    }
    if !out.iter().any(|c| c.name == current) && !current.is_empty() {
        out.push(SceneCollection { name: current.to_string(), current: true });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// OBS Studio scene collections found on this machine.
pub fn obs_studio_collections() -> Vec<(String, PathBuf)> {
    let mut dirs: Vec<PathBuf> = vec![];
    if let Some(cfg) = dirs::config_dir() {
        dirs.push(cfg.join("obs-studio").join("basic").join("scenes"));
    }
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".config/obs-studio/basic/scenes"));
        dirs.push(home.join("Library/Application Support/obs-studio/basic/scenes"));
    }
    let mut out = vec![];
    for d in dirs {
        if let Ok(rd) = std::fs::read_dir(&d) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) == Some("json") {
                    let name = std::fs::read_to_string(&p)
                        .ok()
                        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                        .and_then(|v| v["name"].as_str().map(String::from))
                        .unwrap_or_else(|| p.file_stem().unwrap_or_default().to_string_lossy().to_string());
                    out.push((name, p));
                }
            }
        }
    }
    out
}

impl Engine {
    /// Remove every source, scene and transition from libobs.
    unsafe fn clear_all(&self) {
        self.previews.clear();
        self.meters.clear();
        for ch in 0..7 {
            sys::obs_set_output_source(ch, std::ptr::null_mut());
        }
        {
            let mut inner = self.inner.lock();
            inner.transitions.clear();
            inner.current_transition = None;
            inner.program = None;
            inner.preview = None;
            inner.scene_order.clear();
            inner.scene_refs.clear();
            inner.orphans.clear();
            inner.vertical = None;
        }
        let mut all: Vec<Source> = vec![];
        sys::obs_enum_sources(Some(collect_sources), &mut all as *mut _ as *mut c_void);
        sys::obs_enum_scenes(Some(collect_sources), &mut all as *mut _ as *mut c_void);
        for s in &all {
            sys::obs_source_remove(s.ptr());
        }
        drop(all);
    }

    unsafe fn default_transitions(&self) -> Vec<Source> {
        let mut v = vec![];
        for (id, name) in [("cut_transition", "Corte"), ("fade_transition", "Fundido")] {
            if let Some(s) = Source::own(sys::obs_source_create_private(cstr(id).as_ptr(), cstr(name).as_ptr(), std::ptr::null_mut())) {
                v.push(s);
            }
        }
        v
    }

    /// Load a collection by name (creates a default one if the file doesn't exist).
    pub(crate) fn load_collection(&self, name: String) -> anyhow::Result<()> {
        // Fonts installed with themes / imports (once per run).
        static FONTS: std::sync::Once = std::sync::Once::new();
        FONTS.call_once(|| super::fonts::load_dir(&super::fonts::fonts_dir(&self.data_dir)));
        let path = file_for(&self.data_dir, &name);
        let mut data: Value = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
        if !data.is_null() {
            let n = super::fonts::apply_installed(&mut data, &self.data_dir);
            if n > 0 {
                tracing::info!("{n} textos usan ya la fuente de su tema");
            }
        }
        unsafe {
            self.clear_all();
            if data.is_null() {
                self.create_default_collection(&name);
            } else {
                self.load_collection_data(&name, &data);
            }
        }
        if let Some(core) = self.core() {
            core.update(|s| s.scene_collection = name.clone());
            if self.is_ready() {
                let (audio, video) = core.read(|s| (s.audio.clone(), s.video.clone()));
                self.sync_global_audio(&audio);
                if video.vertical_enabled {
                    let _ = self.apply_vertical(&video);
                }
            }
        }
        self.inner.lock().collection = name;
        self.save_collection();
        self.changed();
        Ok(())
    }

    /// If the collection brought its own global audio devices, mirror them into the settings;
    /// otherwise create them from the settings.
    pub(crate) fn sync_global_audio(&self, settings: &super::model::AudioSettings) {
        let had = std::mem::take(&mut self.inner.lock().had_globals);
        if had {
            let devices = self.global_audio_devices();
            if let Some(core) = self.core() {
                core.update(|s| {
                    for (slot, id) in devices {
                        match slot.as_str() {
                            "desktop1" => s.audio.desktop1 = id,
                            "desktop2" => s.audio.desktop2 = id,
                            "mic1" => s.audio.mic1 = id,
                            "mic2" => s.audio.mic2 = id,
                            "mic3" => s.audio.mic3 = id,
                            "mic4" => s.audio.mic4 = id,
                            _ => {}
                        }
                    }
                });
            }
        } else {
            self.audio_devices_apply(settings);
        }
    }

    unsafe fn load_collection_data(&self, name: &str, data: &Value) {
        // Sources (+ groups) — obs_load_sources resolves scene items by name.
        let mut arr = data["sources"].as_array().cloned().unwrap_or_default();
        if let Some(groups) = data["groups"].as_array() {
            arr.extend(groups.iter().cloned());
        }
        let d = Data::from_json(&json!({ "sources": arr }));
        let sources = sys::obs_data_get_array(d.ptr(), cstr("sources").as_ptr());
        // Sources only used by vertical twins aren't in any main scene: libobs would free them
        // right after loading, so keep a reference to them.
        struct Ctx {
            scenes: Vec<Source>,
            keep: Vec<Source>,
            vertical_names: std::collections::HashSet<String>,
        }
        unsafe extern "C" fn loaded(p: *mut c_void, src: *mut sys::obs_source_t) {
            sys::obs_source_load2(src);
            let c = &mut *(p as *mut Ctx);
            if !sys::obs_scene_from_source(src).is_null() && !sys::obs_source_is_group(src) {
                if let Some(s) = Source::borrow(src) {
                    c.scenes.push(s);
                }
            } else if c.vertical_names.contains(&string(sys::obs_source_get_name(src))) {
                if let Some(s) = Source::borrow(src) {
                    c.keep.push(s);
                }
            }
        }
        let vertical_names = data["vexcast_vertical"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|e| e["items"].as_array().cloned().unwrap_or_default())
            .filter_map(|it| it["name"].as_str().map(String::from))
            .collect();
        let mut ctx = Ctx { scenes: vec![], keep: vec![], vertical_names };
        sys::obs_load_sources(sources, Some(loaded), &mut ctx as *mut _ as *mut c_void);
        {
            let mut inner = self.inner.lock();
            for s in ctx.scenes {
                inner.scene_refs.insert(s.uuid(), s);
            }
            inner.orphans.extend(ctx.keep);
        }
        sys::obs_data_array_release(sources);

        self.inner.lock().vertical_saved = data["vexcast_vertical"].as_array().cloned().unwrap_or_default();
        // Global audio devices.
        self.inner.lock().had_globals = GLOBAL_SLOTS.iter().any(|(k, _, _)| data[*k].is_object());
        for (key, ch, _) in GLOBAL_SLOTS {
            if data[key].is_object() {
                let sd = Data::from_json(&data[key]);
                if let Some(src) = Source::own(sys::obs_load_source(sd.ptr())) {
                    sys::obs_set_output_source(ch, src.ptr());
                }
            }
        }

        // Transitions.
        let mut transitions = self.default_transitions();
        if let Some(list) = data["transitions"].as_array() {
            for t in list {
                let td = Data::from_json(t);
                let id = td.get_string("id");
                let tname = td.get_string("name");
                if id.is_empty() || transitions.iter().any(|x| x.name() == tname) {
                    continue;
                }
                let settings = td.get_obj("settings").unwrap_or_default();
                if let Some(s) = Source::own(sys::obs_source_create_private(cstr(&id).as_ptr(), cstr(&tname).as_ptr(), settings.ptr())) {
                    transitions.push(s);
                }
            }
        }
        let current_name = data["current_transition"].as_str().unwrap_or("Fundido").to_string();
        let current = transitions.iter().find(|t| t.name() == current_name || (current_name == "Fade" && t.id() == "fade_transition")).or_else(|| transitions.iter().find(|t| t.id() == "fade_transition")).cloned();

        // Scene order + current scenes.
        let mut order = vec![];
        if let Some(list) = data["scene_order"].as_array() {
            for o in list {
                if let Some(n) = o["name"].as_str() {
                    if let Some(s) = Source::by_name(n) {
                        if s.is_scene() {
                            order.push(s.uuid());
                        }
                    }
                }
            }
        }
        let program_name = data["current_program_scene"].as_str().or_else(|| data["current_scene"].as_str()).unwrap_or("");
        let preview_name = data["current_scene"].as_str().unwrap_or("");
        let mut program = Source::by_name(program_name).filter(|s| s.is_scene()).map(|s| s.uuid());
        if program.is_none() {
            program = order.first().cloned().or_else(|| super::snapshot::all_scenes().first().map(|s| s.uuid()));
        }
        let preview = Source::by_name(preview_name).filter(|s| s.is_scene()).map(|s| s.uuid());
        let duration = data["transition_duration"].as_u64().unwrap_or(300) as u32;
        {
            let mut inner = self.inner.lock();
            inner.collection = name.to_string();
            inner.scene_order = order;
            inner.transitions = transitions;
            inner.current_transition = current.as_ref().map(|t| t.uuid());
            inner.duration_ms = duration;
            inner.preview = preview.or_else(|| program.clone());
            inner.program = program.clone();
        }
        if program.is_none() {
            self.create_scene_internal("Escena");
        }
        self.attach_program_output();
    }

    unsafe fn create_default_collection(&self, name: &str) {
        let transitions = self.default_transitions();
        {
            let mut inner = self.inner.lock();
            inner.collection = name.to_string();
            inner.current_transition = transitions.iter().find(|t| t.id() == "fade_transition").map(|t| t.uuid());
            inner.transitions = transitions;
            inner.duration_ms = 300;
        }
        let uuid = self.create_scene_internal("Escena");
        {
            let mut inner = self.inner.lock();
            inner.program = Some(uuid.clone());
            inner.preview = Some(uuid);
        }
        self.attach_program_output();
    }

    /// Put the current transition on output channel 0 showing the program scene.
    pub(crate) unsafe fn attach_program_output(&self) {
        let inner = self.inner.lock();
        let tr = inner.current_transition.as_ref().and_then(|u| inner.transitions.iter().find(|t| &t.uuid() == u)).cloned();
        let program = inner.program.as_ref().and_then(|u| Source::by_uuid(u));
        drop(inner);
        if let Some(tr) = tr {
            if let Some(p) = &program {
                sys::obs_transition_set(tr.ptr(), p.ptr());
            }
            sys::obs_set_output_source(0, tr.ptr());
        } else if let Some(p) = program {
            sys::obs_set_output_source(0, p.ptr());
        }
    }

    /// Serialize the current collection to disk (OBS format).
    pub(crate) fn save_collection(&self) {
        if !self.is_ready() {
            return;
        }
        let (name, value) = unsafe { self.collection_json() };
        if name.is_empty() {
            return;
        }
        let path = file_for(&self.data_dir, &name);
        let _ = std::fs::create_dir_all(dir(&self.data_dir));
        let tmp = path.with_extension("json.tmp");
        if std::fs::write(&tmp, serde_json::to_string_pretty(&value).unwrap_or_default()).and_then(|_| std::fs::rename(&tmp, &path)).is_ok() {
            self.dirty_saved();
        }
    }

    unsafe fn collection_json(&self) -> (String, Value) {
        unsafe extern "C" fn filter(d: *mut c_void, src: *mut sys::obs_source_t) -> bool {
            // Skip vertical twins (saved under "vexcast_vertical").
            let twins = &*(d as *const Vec<String>);
            if twins.contains(&string(sys::obs_source_get_uuid(src))) {
                return false;
            }
            // Skip global audio sources (saved under their own keys) and the fx player.
            for ch in 1..=6u32 {
                let s = sys::obs_get_output_source(ch);
                if !s.is_null() {
                    let same = s == src;
                    sys::obs_source_release(s);
                    if same {
                        return false;
                    }
                }
            }
            true
        }
        let twins = self.vertical_twin_uuids();
        let arr = sys::obs_save_sources_filtered(Some(filter), &twins as *const Vec<String> as *mut c_void);
        let holder = Data::new();
        sys::obs_data_set_array(holder.ptr(), cstr("sources").as_ptr(), arr);
        sys::obs_data_array_release(arr);
        let sources = holder.to_json()["sources"].clone();
        let vertical = self.vertical_json();

        let inner = self.inner.lock();
        let name_of = |u: &Option<String>| u.as_ref().and_then(|u| Source::by_uuid(u)).map(|s| s.name()).unwrap_or_default();
        let mut v = json!({
            "name": inner.collection,
            "sources": sources,
            "groups": [],
            "scene_order": inner.scene_order.iter().filter_map(|u| Source::by_uuid(u)).map(|s| json!({"name": s.name()})).collect::<Vec<_>>(),
            "current_program_scene": name_of(&inner.program),
            "current_scene": name_of(if inner.studio { &inner.preview } else { &inner.program }),
            "current_transition": inner.current_transition.as_ref().and_then(|u| inner.transitions.iter().find(|t| &t.uuid() == u)).map(|t| t.name()).unwrap_or_default(),
            "transition_duration": inner.duration_ms,
            "vexcast_vertical": vertical,
            "transitions": inner.transitions.iter().filter(|t| !matches!(t.id().as_str(), "cut_transition" | "fade_transition")).map(|t| json!({"id": t.id(), "name": t.name(), "settings": t.settings().to_json()})).collect::<Vec<_>>(),
        });
        let name = inner.collection.clone();
        drop(inner);
        for (key, ch, _) in GLOBAL_SLOTS {
            if let Some(s) = Source::own(sys::obs_get_output_source(ch)) {
                let d = Data::own(sys::obs_save_source(s.ptr()));
                v[key] = d.to_json();
            }
        }
        (name, v)
    }

    // ------------------------------------------------------------ public API

    pub fn create_collection(&self, name: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        let name = name.trim();
        if name.is_empty() {
            anyhow::bail!("El nombre no puede estar vacío");
        }
        if file_for(&self.data_dir, name).exists() {
            anyhow::bail!("Ya existe una colección con ese nombre");
        }
        self.save_collection();
        self.load_collection(name.to_string())
    }

    pub fn switch_collection(&self, name: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        if self.outputs.any_active() {
            anyhow::bail!("Detén la transmisión y la grabación antes de cambiar de colección");
        }
        self.save_collection();
        self.load_collection(name.to_string())
    }

    pub fn rename_collection(&self, name: &str, new_name: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        let new_name = new_name.trim();
        if new_name.is_empty() {
            anyhow::bail!("El nombre no puede estar vacío");
        }
        let from = file_for(&self.data_dir, name);
        let to = file_for(&self.data_dir, new_name);
        if to.exists() {
            anyhow::bail!("Ya existe una colección con ese nombre");
        }
        let current = self.inner.lock().collection == name;
        if current {
            self.inner.lock().collection = new_name.to_string();
            if let Some(core) = self.core() {
                core.update(|s| s.scene_collection = new_name.to_string());
            }
            self.save_collection();
            let _ = std::fs::remove_file(&from);
        } else {
            let mut v: Value = serde_json::from_str(&std::fs::read_to_string(&from)?)?;
            v["name"] = Value::String(new_name.to_string());
            std::fs::write(&to, serde_json::to_string_pretty(&v)?)?;
            std::fs::remove_file(&from)?;
        }
        self.changed();
        Ok(())
    }

    /// Copy a collection under a new name and switch to the copy (like OBS).
    pub fn duplicate_collection(&self, name: &str, new_name: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        let new_name = new_name.trim();
        if new_name.is_empty() {
            anyhow::bail!("El nombre no puede estar vacío");
        }
        if file_for(&self.data_dir, new_name).exists() {
            anyhow::bail!("Ya existe una colección con ese nombre");
        }
        if self.inner.lock().collection == name {
            self.save_collection();
        }
        let mut v: Value = serde_json::from_str(&std::fs::read_to_string(file_for(&self.data_dir, name))?)?;
        v["name"] = Value::String(new_name.to_string());
        std::fs::write(file_for(&self.data_dir, new_name), serde_json::to_string_pretty(&v)?)?;
        self.switch_collection(new_name)
    }

    pub fn delete_collection(&self, name: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        if self.inner.lock().collection == name {
            anyhow::bail!("No puedes borrar la colección activa; cambia a otra primero");
        }
        std::fs::remove_file(file_for(&self.data_dir, name))?;
        self.changed();
        Ok(())
    }

    /// Collections that can be imported: (name, path, app) with app "obs" or "streamlabs".
    pub fn obs_collections(&self) -> Vec<(String, PathBuf, &'static str)> {
        let mut v: Vec<_> = obs_studio_collections().into_iter().map(|(n, p)| (n, p, "obs")).collect();
        v.extend(super::slobs::list().into_iter().map(|(n, p)| (n, p, "streamlabs")));
        v
    }

    /// Import an OBS Studio or Streamlabs Desktop collection file as a new collection and switch to it.
    pub fn import_collection(&self, path: &str, name: Option<String>) -> anyhow::Result<String> {
        self.require_ready()?;
        let text = std::fs::read_to_string(path).map_err(|e| anyhow::anyhow!("No se pudo leer {path}: {e}"))?;
        let mut v: Value = serde_json::from_str(&text).map_err(|_| anyhow::anyhow!("El archivo no es una colección de escenas de OBS ni de Streamlabs válida"))?;
        if super::slobs::is_slobs(&v) {
            let n = name.clone().or_else(|| super::slobs::name_for(std::path::Path::new(path))).unwrap_or_else(|| "Streamlabs".into());
            v = super::slobs::convert(&v, &n)?;
        }
        if !v["sources"].is_array() {
            anyhow::bail!("El archivo no es una colección de escenas de OBS ni de Streamlabs válida");
        }
        // Fonts Streamlabs downloaded for its text sources (and a fallback for missing ones).
        let font_dirs: Vec<PathBuf> = super::slobs::collections_dir().and_then(|d| d.parent().map(|p| p.join("Fonts"))).into_iter().collect();
        super::fonts::prepare_collection(&mut v, &self.data_dir, &font_dirs);
        let mut base = name.unwrap_or_else(|| v["name"].as_str().unwrap_or("Importada").to_string());
        let mut n = 2;
        let original = base.clone();
        while file_for(&self.data_dir, &base).exists() {
            base = format!("{original} ({n})");
            n += 1;
        }
        v["name"] = Value::String(base.clone());
        let _ = std::fs::create_dir_all(dir(&self.data_dir));
        std::fs::write(file_for(&self.data_dir, &base), serde_json::to_string_pretty(&v)?)?;
        self.switch_collection(&base)?;
        Ok(base)
    }

    /// Install an overlay pack (`.overlay`, a pack `.json` or its folder) as a new collection and switch to it.
    /// Returns the new collection's name and the alert media found in the pack.
    pub fn install_theme(&self, path: &str, name: Option<String>, port: u16) -> anyhow::Result<(String, Vec<(crate::model::AlertType, PathBuf)>, Value)> {
        self.require_ready()?;
        let canvas = unsafe {
            let mut ovi: sys::obs_video_info = std::mem::zeroed();
            if sys::obs_get_video_info(&mut ovi) {
                (ovi.base_width, ovi.base_height)
            } else {
                (1920, 1080)
            }
        };
        let themes = self.data_dir.join("themes");
        std::fs::create_dir_all(&themes)?;
        let p = super::theme::prepare(std::path::Path::new(path.trim()), &themes, name, canvas, port)?;
        let mut v = p.collection;
        super::fonts::prepare_collection(&mut v, &self.data_dir, &p.font_dirs);
        let alerts = p.alerts;
        // Alert designs shipped in a .vxoverlay get new ids (the package may come from this PC);
        // the browser sources that show them are updated too.
        let mut extras = p.extras;
        let mut groups = extras["groups"].take();
        if let Some(list) = extras["designs"].as_array_mut() {
            for d in list.iter_mut() {
                let old = d["id"].as_str().unwrap_or_default().to_string();
                let new = crate::model::new_id();
                d["id"] = Value::String(new.clone());
                if !old.is_empty() {
                    super::theme::replace_in_strings(&mut v, &format!("design={old}"), &format!("design={new}"));
                    // Groups list design ids too.
                    for g in extras_groups_mut(&mut groups) {
                        if let Some(ids) = g["designs"].as_array_mut() {
                            for id in ids.iter_mut() {
                                if id.as_str() == Some(old.as_str()) {
                                    *id = Value::String(new.clone());
                                }
                            }
                        }
                    }
                }
            }
        }
        for g in extras_groups_mut(&mut groups) {
            let old = g["id"].as_str().unwrap_or_default().to_string();
            let new = crate::model::new_id();
            g["id"] = Value::String(new.clone());
            if !old.is_empty() {
                super::theme::replace_in_strings(&mut v, &format!("group={old}"), &format!("group={new}"));
            }
        }
        extras["groups"] = groups;
        let mut base = p.name.clone();
        let mut n = 2;
        while file_for(&self.data_dir, &base).exists() {
            base = format!("{} ({n})", p.name);
            n += 1;
        }
        v["name"] = Value::String(base.clone());
        let _ = std::fs::create_dir_all(dir(&self.data_dir));
        std::fs::write(file_for(&self.data_dir, &base), serde_json::to_string_pretty(&v)?)?;
        self.switch_collection(&base)?;
        Ok((base, alerts, extras))
    }

    /// Export the current collection (+ files, extras: alert designs and widget settings) as a .vxoverlay.
    pub fn export_overlay(&self, out: &std::path::Path, extras: Value) -> anyhow::Result<usize> {
        self.require_ready()?;
        let (name, v) = unsafe { self.collection_json() };
        super::theme::export_package(v, extras, &name, out)
    }

    /// Replace the old "all alerts" browser sources (alerts.html without ?design=) by one source per
    /// alert design, at the same position and size. designs: (id, name). Returns the sources created.
    pub fn split_alert_sources(self: &std::sync::Arc<Self>, designs: &[(String, String)], port: u16) -> anyhow::Result<usize> {
        self.require_ready()?;
        if designs.is_empty() {
            return Ok(0);
        }
        let snap = self.snapshot();
        let legacy: Vec<&super::model::SourceInfo> = snap
            .sources
            .iter()
            .filter(|s| s.kind.starts_with("browser_source") && s.settings["url"].as_str().is_some_and(|u| u.contains("/widgets/alerts.html") && !u.contains("design=")))
            .collect();
        let mut created = 0;
        for scene in &snap.scenes {
            for item in scene.items.iter().filter(|it| legacy.iter().any(|s| s.uuid == it.source_uuid)) {
                let src = legacy.iter().find(|s| s.uuid == item.source_uuid).unwrap();
                let (w, h) = (src.settings["width"].as_u64().unwrap_or(1920), src.settings["height"].as_u64().unwrap_or(1080));
                let patch: super::model::SceneItemPatch = serde_json::from_value(serde_json::to_value(item)?).unwrap_or_default();
                for (id, name) in designs {
                    let url = format!("http://127.0.0.1:{port}/widgets/alerts.html?design={id}");
                    let info = self.create_source(name, "browser_source", Some(json!({ "url": url, "width": w, "height": h })), Some(&scene.uuid))?;
                    let after = self.snapshot();
                    if let Some(new_item) = after.scenes.iter().find(|s| s.uuid == scene.uuid).and_then(|s| s.items.iter().rev().find(|i| i.source_uuid == info.uuid)) {
                        let _ = self.update_item(&scene.uuid, new_item.id, patch.clone());
                    }
                    created += 1;
                }
                let _ = self.remove_item(&scene.uuid, item.id);
            }
        }
        for s in legacy {
            let _ = self.delete_source(&s.uuid);
        }
        Ok(created)
    }

    fn dirty_saved(&self) {
        *self.last_save_mut() = std::time::Instant::now();
        self.clear_dirty();
    }
}
