//! Vertical (9:16) canvas: an OBS 32 canvas with its own video mix. Every main scene gets a
//! "twin" scene on that canvas (same sources, independent layout). The twin of the program
//! scene is shown on the canvas and can be streamed to vertical destinations.

use super::ffi::*;
use super::model::VideoSettings;
use super::snapshot;
use super::Engine;
use libobs as sys;
use serde_json::{json, Value};
use std::collections::HashMap;

pub struct Vertical {
    pub canvas: *mut sys::obs_canvas_t,
    /// main scene uuid -> twin scene source
    pub twins: HashMap<String, Source>,
    pub width: u32,
    pub height: u32,
}

unsafe impl Send for Vertical {}

impl Drop for Vertical {
    fn drop(&mut self) {
        unsafe {
            sys::obs_canvas_set_channel(self.canvas, 0, std::ptr::null_mut());
            for (_, t) in self.twins.drain() {
                sys::obs_source_remove(t.ptr());
            }
            sys::obs_canvas_remove(self.canvas);
            sys::obs_canvas_release(self.canvas);
        }
    }
}

unsafe fn canvas_ovi(w: u32, h: u32) -> sys::obs_video_info {
    let mut ovi: sys::obs_video_info = std::mem::zeroed();
    sys::obs_get_video_info(&mut ovi);
    ovi.base_width = w & !1;
    ovi.base_height = h & !1;
    ovi.output_width = w & !1;
    ovi.output_height = h & !1;
    ovi
}

/// Copy `item` of a main scene into `twin`, scaled to the vertical canvas width and centered.
unsafe fn copy_item_scaled(item: *mut sys::obs_sceneitem_t, twin: *mut sys::obs_scene_t, s: f32, yoff: f32) {
    let src = sys::obs_sceneitem_get_source(item);
    let new_item = sys::obs_scene_add(twin, src);
    if new_item.is_null() {
        return;
    }
    let mut info: sys::obs_transform_info = std::mem::zeroed();
    sys::obs_sceneitem_get_info2(item, &mut info);
    let (px, py) = vec2_xy(&info.pos);
    let (sx, sy) = vec2_xy(&info.scale);
    let (bx, by) = vec2_xy(&info.bounds);
    info.pos = vec2(px * s, py * s + yoff);
    info.scale = vec2(sx * s, sy * s);
    info.bounds = vec2(bx * s, by * s);
    sys::obs_sceneitem_set_info2(new_item, &info);
    let mut crop: sys::obs_sceneitem_crop = std::mem::zeroed();
    sys::obs_sceneitem_get_crop(item, &mut crop);
    sys::obs_sceneitem_set_crop(new_item, &crop);
    sys::obs_sceneitem_set_visible(new_item, sys::obs_sceneitem_visible(item));
}

impl Engine {
    unsafe fn main_size() -> (f32, f32) {
        let mut ovi: sys::obs_video_info = std::mem::zeroed();
        sys::obs_get_video_info(&mut ovi);
        (ovi.base_width as f32, ovi.base_height as f32)
    }

    /// Create the twin of a main scene; `populate` copies its items (scaled).
    pub(crate) unsafe fn create_twin(v: &mut Vertical, main: &Source, populate: bool) -> Option<String> {
        let name = format!("{} (vertical)", main.name());
        let scene = sys::obs_canvas_scene_create(v.canvas, cstr(&name).as_ptr());
        if scene.is_null() {
            return None;
        }
        let twin = Source::own(sys::obs_scene_get_source(scene))?;
        if populate {
            let (mw, mh) = Self::main_size();
            let s = v.width as f32 / mw.max(1.0);
            let yoff = (v.height as f32 - mh * s) / 2.0;
            struct Ctx {
                twin: *mut sys::obs_scene_t,
                s: f32,
                yoff: f32,
            }
            unsafe extern "C" fn cb(_s: *mut sys::obs_scene_t, it: *mut sys::obs_sceneitem_t, p: *mut std::os::raw::c_void) -> bool {
                let c = &*(p as *const Ctx);
                copy_item_scaled(it, c.twin, c.s, c.yoff);
                true
            }
            let ctx = Ctx { twin: scene, s, yoff };
            sys::obs_scene_enum_items(main.scene(), Some(cb), &ctx as *const Ctx as *mut _);
        }
        let u = twin.uuid();
        v.twins.insert(main.uuid(), twin);
        Some(u)
    }

    /// Enable/resize/disable the vertical canvas according to the video settings.
    pub fn apply_vertical(&self, video: &VideoSettings) -> anyhow::Result<()> {
        self.require_ready()?;
        let mut inner = self.inner.lock();
        if !video.vertical_enabled {
            inner.vertical = None;
            drop(inner);
            self.changed();
            return Ok(());
        }
        let (w, h) = (video.vertical_width.clamp(90, 4096), video.vertical_height.clamp(160, 4096));
        unsafe {
            match inner.vertical.as_mut() {
                Some(v) if (v.width, v.height) != (w, h) => {
                    let mut ovi = canvas_ovi(w, h);
                    if !sys::obs_canvas_reset_video(v.canvas, &mut ovi) {
                        anyhow::bail!("No se pudo cambiar el tamaño del lienzo vertical");
                    }
                    v.width = w;
                    v.height = h;
                }
                Some(_) => {}
                None => {
                    let mut ovi = canvas_ovi(w, h);
                    let flags = (sys::obs_canvas_flags_PROGRAM | sys::obs_canvas_flags_EPHEMERAL) as u32;
                    let canvas = sys::obs_canvas_create(cstr("Vexcast Vertical").as_ptr(), &mut ovi, flags);
                    if canvas.is_null() {
                        anyhow::bail!("No se pudo crear el lienzo vertical");
                    }
                    inner.vertical = Some(Vertical { canvas, twins: HashMap::new(), width: w, height: h });
                }
            }
            // Twins for every scene that lacks one (copying the current layout scaled).
            let order = inner.scene_order.clone();
            let saved = std::mem::take(&mut inner.vertical_saved);
            let v = inner.vertical.as_mut().unwrap();
            for u in order {
                if v.twins.contains_key(&u) {
                    continue;
                }
                let Some(main) = Source::by_uuid(&u) else { continue };
                match saved.iter().find(|e| e["main"].as_str() == Some(main.name().as_str())) {
                    Some(entry) => {
                        Self::create_twin(v, &main, false);
                        if let Some(twin) = v.twins.get(&u) {
                            restore_items(twin.scene(), entry);
                        }
                    }
                    None => {
                        Self::create_twin(v, &main, true);
                    }
                }
            }
        }
        drop(inner);
        self.sync_vertical_program();
        self.changed();
        Ok(())
    }

    /// Show the program scene's twin on the vertical canvas.
    pub(crate) fn sync_vertical_program(&self) {
        let inner = self.inner.lock();
        let Some(v) = inner.vertical.as_ref() else { return };
        let twin = inner.program.as_ref().and_then(|p| v.twins.get(p));
        unsafe { sys::obs_canvas_set_channel(v.canvas, 0, twin.map(|t| t.ptr()).unwrap_or(std::ptr::null_mut())) };
    }

    pub(crate) fn vertical_twin_uuids(&self) -> Vec<String> {
        self.inner.lock().vertical.as_ref().map(|v| v.twins.values().map(|t| t.uuid()).collect()).unwrap_or_default()
    }

    /// Serialize twin layouts for the collection file.
    pub(crate) unsafe fn vertical_json(&self) -> Value {
        let inner = self.inner.lock();
        let Some(v) = inner.vertical.as_ref() else { return Value::Array(inner.vertical_saved.clone()) };
        let mut out = vec![];
        for (main_uuid, twin) in &v.twins {
            let Some(main) = Source::by_uuid(main_uuid) else { continue };
            let items: Vec<Value> = snapshot::scene_items(twin.scene()).iter().map(|i| json!(i)).collect();
            out.push(json!({ "main": main.name(), "items": items }));
        }
        Value::Array(out)
    }

    /// Video encoder target for vertical outputs.
    pub(crate) fn vertical_video(&self) -> Option<*mut sys::video_t> {
        let inner = self.inner.lock();
        inner.vertical.as_ref().map(|v| unsafe { sys::obs_canvas_get_video(v.canvas) }).filter(|p| !p.is_null())
    }

    pub(crate) fn vertical_canvas_ref(&self) -> Option<(*mut sys::obs_canvas_t, u32, u32)> {
        let inner = self.inner.lock();
        inner.vertical.as_ref().map(|v| unsafe { (sys::obs_canvas_get_ref(v.canvas), v.width, v.height) })
    }

    /// Main scene created: give it an empty twin. Main scene duplicated: copy its layout.
    pub(crate) fn vertical_on_scene_created(&self, main_uuid: &str, populate: bool) {
        let mut inner = self.inner.lock();
        let Some(v) = inner.vertical.as_mut() else { return };
        if let Some(main) = Source::by_uuid(main_uuid) {
            unsafe { Self::create_twin(v, &main, populate) };
        }
    }

    pub(crate) fn vertical_on_scene_removed(&self, main_uuid: &str) {
        let mut inner = self.inner.lock();
        if let Some(v) = inner.vertical.as_mut() {
            if let Some(t) = v.twins.remove(main_uuid) {
                unsafe { sys::obs_source_remove(t.ptr()) };
            }
        }
    }

    /// A new source was added to a main scene: also add it to the twin, fitted to the vertical canvas.
    pub(crate) fn vertical_on_source_added(&self, main_uuid: &str, source: &Source) {
        let inner = self.inner.lock();
        let Some(v) = inner.vertical.as_ref() else { return };
        let Some(twin) = v.twins.get(main_uuid) else { return };
        unsafe {
            let item = sys::obs_scene_add(twin.scene(), source.ptr());
            if !item.is_null() {
                let mut info: sys::obs_transform_info = std::mem::zeroed();
                info.pos = vec2(0.0, 0.0);
                info.scale = vec2(1.0, 1.0);
                info.alignment = 1 | 4;
                info.bounds_type = sys::obs_bounds_type_OBS_BOUNDS_SCALE_INNER;
                info.bounds_alignment = 0;
                info.bounds = vec2(v.width as f32, v.height as f32);
                sys::obs_sceneitem_set_info2(item, &info);
            }
        }
    }
}

/// Recreate saved twin items (by source name) with their transforms.
unsafe fn restore_items(twin: *mut sys::obs_scene_t, entry: &Value) {
    for it in entry["items"].as_array().cloned().unwrap_or_default() {
        let Some(name) = it["name"].as_str() else { continue };
        let Some(src) = Source::by_name(name) else { continue };
        let item = sys::obs_scene_add(twin, src.ptr());
        if item.is_null() {
            continue;
        }
        let f = |k: &str, a: &str| it[k][a].as_f64().unwrap_or(0.0) as f32;
        let mut info: sys::obs_transform_info = std::mem::zeroed();
        info.pos = vec2(f("pos", "x"), f("pos", "y"));
        info.scale = vec2(f("scale", "x"), f("scale", "y"));
        info.rot = it["rot"].as_f64().unwrap_or(0.0) as f32;
        info.alignment = it["alignment"].as_u64().unwrap_or(5) as u32;
        info.bounds_type = snapshot::bounds_from(it["boundsType"].as_str().unwrap_or("none"));
        info.bounds_alignment = it["boundsAlignment"].as_u64().unwrap_or(0) as u32;
        info.bounds = vec2(f("bounds", "x"), f("bounds", "y"));
        info.crop_to_bounds = it["cropToBounds"].as_bool().unwrap_or(false);
        sys::obs_sceneitem_set_info2(item, &info);
        let c = &it["crop"];
        let crop = sys::obs_sceneitem_crop {
            left: c["left"].as_i64().unwrap_or(0) as i32,
            top: c["top"].as_i64().unwrap_or(0) as i32,
            right: c["right"].as_i64().unwrap_or(0) as i32,
            bottom: c["bottom"].as_i64().unwrap_or(0) as i32,
        };
        sys::obs_sceneitem_set_crop(item, &crop);
        sys::obs_sceneitem_set_visible(item, it["visible"].as_bool().unwrap_or(true));
        sys::obs_sceneitem_set_locked(item, it["locked"].as_bool().unwrap_or(false));
    }
}
