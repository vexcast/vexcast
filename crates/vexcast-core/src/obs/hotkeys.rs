//! Hotkeys: frontend hotkeys (stream/record/replay/scenes…) plus every source hotkey, with
//! bindings persisted to hotkeys.json. libobs polls the keyboard globally.

use super::ffi::*;
use super::model::{Hotkey, HotkeyBinding};
use super::Engine;
use libobs as sys;
use serde_json::{json, Value};
use std::os::raw::c_void;
use std::sync::{Arc, Weak};

// obs-interaction.h modifier flags.
const SHIFT: u32 = 1 << 1;
const CONTROL: u32 = 1 << 2;
const ALT: u32 = 1 << 3;
const COMMAND: u32 = 1 << 7;

struct Action {
    engine: Weak<Engine>,
    action: &'static str,
}

const FRONTEND: [(&str, &str, &str); 12] = [
    ("Vexcast.StartStreaming", "Iniciar transmisión", "stream_start"),
    ("Vexcast.StopStreaming", "Detener transmisión", "stream_stop"),
    ("Vexcast.StartRecording", "Iniciar grabación", "record_start"),
    ("Vexcast.StopRecording", "Detener grabación", "record_stop"),
    ("Vexcast.PauseRecording", "Pausar grabación", "record_pause"),
    ("Vexcast.UnpauseRecording", "Reanudar grabación", "record_unpause"),
    ("Vexcast.StartReplayBuffer", "Iniciar búfer de repetición", "replay_start"),
    ("Vexcast.StopReplayBuffer", "Detener búfer de repetición", "replay_stop"),
    ("Vexcast.SaveReplay", "Guardar repetición", "replay_save"),
    ("Vexcast.StartVirtualCam", "Iniciar cámara virtual", "vcam_start"),
    ("Vexcast.StopVirtualCam", "Detener cámara virtual", "vcam_stop"),
    ("Vexcast.Transition", "Transición (modo estudio)", "transition"),
];

unsafe extern "C" fn on_hotkey(data: *mut c_void, _id: sys::obs_hotkey_id, _hk: *mut sys::obs_hotkey_t, pressed: bool) {
    if !pressed {
        return;
    }
    let a = &*(data as *const Action);
    let Some(engine) = a.engine.upgrade() else { return };
    let action = a.action;
    std::thread::spawn(move || {
        let r: anyhow::Result<()> = match action {
            "stream_start" => engine.start_stream().map(|_| ()),
            "stream_stop" => {
                engine.stop_stream();
                Ok(())
            }
            "record_start" => engine.start_recording().map(|_| ()),
            "record_stop" => {
                engine.stop_recording();
                Ok(())
            }
            "record_pause" => engine.outputs.pause_recording(true),
            "record_unpause" => engine.outputs.pause_recording(false),
            "replay_start" => engine.start_replay(),
            "replay_stop" => {
                engine.outputs.stop_replay();
                Ok(())
            }
            "replay_save" => engine.outputs.save_replay(),
            "vcam_start" => engine.outputs.start_virtualcam(),
            "vcam_stop" => {
                engine.outputs.stop_virtualcam();
                Ok(())
            }
            "transition" => engine.transition_to_program(),
            _ => Ok(()),
        };
        if let (Err(e), Some(c)) = (r, engine.core()) {
            c.notify("warning", e.to_string());
        }
        engine.changed();
    });
}

struct MacroAction {
    engine: Weak<Engine>,
    id: String,
}

unsafe extern "C" fn on_macro(data: *mut c_void, _id: sys::obs_hotkey_id, _hk: *mut sys::obs_hotkey_t, pressed: bool) {
    if !pressed {
        return;
    }
    let a = &*(data as *const MacroAction);
    let Some(core) = a.engine.upgrade().and_then(|e| e.core()) else { return };
    let id = a.id.clone();
    let c = core.clone();
    core.rt.spawn(async move {
        if let Err(e) = crate::macros::run_by_id(&c, &id).await {
            c.notify("warning", e.to_string());
        }
    });
}

fn key_name(k: sys::obs_key) -> String {
    unsafe { string(sys::obs_key_to_name(k)) }
}

impl Engine {
    /// Register frontend hotkeys and load saved bindings.
    pub(crate) fn register_hotkeys(self: &Arc<Self>) {
        unsafe {
            for (name, desc, action) in FRONTEND {
                let data = Box::into_raw(Box::new(Action { engine: Arc::downgrade(self), action }));
                sys::obs_hotkey_register_frontend(cstr(name).as_ptr(), cstr(desc).as_ptr(), Some(on_hotkey), data as *mut c_void);
            }
            sys::obs_hotkey_enable_background_press(true);
        }
        self.load_hotkey_bindings();
    }

    /// One hotkey per macro ("Macro: <name>"), rebuilt when macros change. Bindings are saved
    /// with the other hotkeys, by macro id.
    pub fn sync_macro_hotkeys(self: &Arc<Self>, macros: &[(String, String)]) {
        if !self.is_ready() {
            return;
        }
        {
            let mut reg = self.macro_hotkeys.lock();
            for (_, hid) in reg.drain(..) {
                // The callback data is leaked on purpose: a press may still be running.
                unsafe { sys::obs_hotkey_unregister(hid as sys::obs_hotkey_id) };
            }
            for (id, name) in macros {
                let data = Box::into_raw(Box::new(MacroAction { engine: Arc::downgrade(self), id: id.clone() }));
                let hid = unsafe {
                    sys::obs_hotkey_register_frontend(cstr(&format!("Vexcast.Macro.{id}")).as_ptr(), cstr(&format!("Macro: {name}")).as_ptr(), Some(on_macro), data as *mut c_void)
                };
                reg.push((id.clone(), hid as u64));
            }
        }
        self.load_hotkey_bindings();
    }

    fn hotkeys_file(&self) -> std::path::PathBuf {
        self.data_dir.join("hotkeys.json")
    }

    fn load_hotkey_bindings(&self) {
        let saved: Value = std::fs::read_to_string(self.hotkeys_file()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
        if !saved.is_object() {
            return;
        }
        for hk in self.hotkeys() {
            if hk.owner != "frontend" {
                continue;
            }
            if let Some(b) = saved.get(&hk.name) {
                if let Ok(bindings) = serde_json::from_value::<Vec<HotkeyBinding>>(b.clone()) {
                    let _ = self.set_hotkey_internal(hk.id, &bindings);
                }
            }
        }
    }

    fn save_hotkey_bindings(&self) {
        let mut m = serde_json::Map::new();
        for hk in self.hotkeys() {
            if hk.owner == "frontend" {
                m.insert(hk.name.clone(), json!(hk.bindings));
            }
        }
        let _ = std::fs::write(self.hotkeys_file(), serde_json::to_string_pretty(&Value::Object(m)).unwrap_or_default());
    }

    pub fn hotkeys(&self) -> Vec<Hotkey> {
        let mut out: Vec<Hotkey> = vec![];
        if !self.is_ready() {
            return out;
        }
        unsafe extern "C" fn each(data: *mut c_void, id: sys::obs_hotkey_id, key: *mut sys::obs_hotkey_t) -> bool {
            let v = &mut *(data as *mut Vec<Hotkey>);
            let owner = match sys::obs_hotkey_get_registerer_type(key) {
                sys::obs_hotkey_registerer_type_OBS_HOTKEY_REGISTERER_FRONTEND => "frontend".to_string(),
                sys::obs_hotkey_registerer_type_OBS_HOTKEY_REGISTERER_SOURCE => {
                    let w = sys::obs_hotkey_get_registerer(key) as *mut sys::obs_weak_source_t;
                    let s = sys::obs_weak_source_get_source(w);
                    if s.is_null() {
                        return true;
                    }
                    let n = string(sys::obs_source_get_name(s));
                    sys::obs_source_release(s);
                    n
                }
                sys::obs_hotkey_registerer_type_OBS_HOTKEY_REGISTERER_OUTPUT => "output".into(),
                sys::obs_hotkey_registerer_type_OBS_HOTKEY_REGISTERER_ENCODER => "encoder".into(),
                _ => "other".into(),
            };
            v.push(Hotkey { id: id as u64, name: string(sys::obs_hotkey_get_name(key)), description: string(sys::obs_hotkey_get_description(key)), owner, bindings: vec![] });
            true
        }
        unsafe extern "C" fn each_binding(data: *mut c_void, _idx: usize, b: *mut sys::obs_hotkey_binding_t) -> bool {
            let v = &mut *(data as *mut Vec<Hotkey>);
            let id = sys::obs_hotkey_binding_get_hotkey_id(b) as u64;
            let combo = sys::obs_hotkey_binding_get_key_combination(b);
            if let Some(h) = v.iter_mut().find(|h| h.id == id) {
                let m = combo.modifiers;
                h.bindings.push(HotkeyBinding {
                    key: key_name(combo.key),
                    ctrl: m & CONTROL != 0,
                    shift: m & SHIFT != 0,
                    alt: m & ALT != 0,
                    command: m & COMMAND != 0,
                });
            }
            true
        }
        unsafe {
            sys::obs_enum_hotkeys(Some(each), &mut out as *mut _ as *mut c_void);
            sys::obs_enum_hotkey_bindings(Some(each_binding), &mut out as *mut _ as *mut c_void);
        }
        out.retain(|h| !h.name.is_empty());
        out
    }

    fn set_hotkey_internal(&self, id: u64, bindings: &[HotkeyBinding]) -> anyhow::Result<()> {
        let combos: Vec<sys::obs_key_combination_t> = bindings
            .iter()
            .filter_map(|b| {
                let key = unsafe { sys::obs_key_from_name(cstr(&b.key).as_ptr()) };
                if key == sys::obs_key_OBS_KEY_NONE {
                    return None;
                }
                let mut m = 0u32;
                if b.ctrl {
                    m |= CONTROL;
                }
                if b.shift {
                    m |= SHIFT;
                }
                if b.alt {
                    m |= ALT;
                }
                if b.command {
                    m |= COMMAND;
                }
                Some(sys::obs_key_combination_t { modifiers: m, key })
            })
            .collect();
        unsafe { sys::obs_hotkey_load_bindings(id as sys::obs_hotkey_id, combos.as_ptr() as *mut _, combos.len()) };
        Ok(())
    }

    pub fn set_hotkey(&self, id: u64, bindings: &[HotkeyBinding]) -> anyhow::Result<()> {
        self.require_ready()?;
        self.set_hotkey_internal(id, bindings)?;
        self.save_hotkey_bindings();
        // Source hotkeys are saved inside the collection.
        self.changed();
        Ok(())
    }
}
