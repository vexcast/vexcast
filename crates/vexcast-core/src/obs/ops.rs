//! Mutations: scenes, scene items, sources, filters, transitions and global audio devices.

use super::ffi::*;
use super::model::*;
use super::props;
use super::snapshot::{self, *};
use super::Engine;
use libobs as sys;
use serde_json::Value;
use std::os::raw::c_void;

const ALIGN_LEFT: u32 = 1;
const ALIGN_TOP: u32 = 4;

fn err<T>(msg: &str) -> anyhow::Result<T> {
    Err(anyhow::anyhow!(msg.to_string()))
}

pub(crate) fn unique_name(base: &str) -> String {
    let base = if base.trim().is_empty() { "Fuente" } else { base.trim() };
    if Source::by_name(base).is_none() {
        return base.to_string();
    }
    for i in 2.. {
        let n = format!("{base} {i}");
        if Source::by_name(&n).is_none() {
            return n;
        }
    }
    unreachable!()
}

fn scene_of(uuid: &str) -> anyhow::Result<Source> {
    Source::by_uuid(uuid).filter(|s| s.is_scene() || s.is_group()).ok_or_else(|| anyhow::anyhow!("Escena no encontrada"))
}

fn source_of(uuid: &str) -> anyhow::Result<Source> {
    Source::by_uuid(uuid).ok_or_else(|| anyhow::anyhow!("Fuente no encontrada"))
}

pub(crate) unsafe fn canvas_size() -> (f32, f32) {
    let mut ovi: sys::obs_video_info = std::mem::zeroed();
    sys::obs_get_video_info(&mut ovi);
    (ovi.base_width as f32, ovi.base_height as f32)
}

/// Axis-aligned bounding box of an item in canvas coordinates (handles rotation, bounds, crop, flips).
unsafe fn item_bbox(item: *mut sys::obs_sceneitem_t) -> (f32, f32, f32, f32) {
    sys::obs_sceneitem_force_update_transform(item);
    #[repr(C, align(16))]
    struct Matrix4 {
        x: [f32; 4],
        y: [f32; 4],
        z: [f32; 4],
        t: [f32; 4],
    }
    let mut m: Matrix4 = std::mem::zeroed();
    sys::obs_sceneitem_get_box_transform(item, &mut m as *mut Matrix4 as *mut sys::matrix4);
    let (xx, xy) = (m.x[0], m.x[1]);
    let (yx, yy) = (m.y[0], m.y[1]);
    let (tx, ty) = (m.t[0], m.t[1]);
    let _ = m.z;
    let mut minx = f32::MAX;
    let mut miny = f32::MAX;
    let mut maxx = f32::MIN;
    let mut maxy = f32::MIN;
    for (u, v) in [(0.0f32, 0.0f32), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)] {
        let x = xx * u + yx * v + tx;
        let y = xy * u + yy * v + ty;
        minx = minx.min(x);
        miny = miny.min(y);
        maxx = maxx.max(x);
        maxy = maxy.max(y);
    }
    (minx, miny, maxx, maxy)
}

/// Run `f` and then move the item so its bounding box keeps the same top-left corner (OBS behaviour).
unsafe fn keep_top_left(item: *mut sys::obs_sceneitem_t, f: impl FnOnce()) {
    let (x0, y0, _, _) = item_bbox(item);
    f();
    let (x1, y1, _, _) = item_bbox(item);
    let mut pos = std::mem::zeroed();
    sys::obs_sceneitem_get_pos(item, &mut pos);
    let (px, py) = vec2_xy(&pos);
    sys::obs_sceneitem_set_pos(item, &vec2(px + (x0 - x1), py + (y0 - y1)));
}

impl Engine {
    // ------------------------------------------------------------ scenes

    /// Canvas size of a scene: the vertical canvas for twins, the main canvas otherwise.
    pub(crate) fn scene_canvas_size(&self, scene_uuid: &str) -> (f32, f32) {
        let inner = self.inner.lock();
        if let Some(v) = inner.vertical.as_ref() {
            if v.twins.values().any(|t| t.uuid() == scene_uuid) {
                return (v.width as f32, v.height as f32);
            }
        }
        drop(inner);
        unsafe { canvas_size() }
    }

    pub(crate) unsafe fn create_scene_internal(&self, name: &str) -> String {
        let name = unique_name(name);
        let scene = sys::obs_scene_create(cstr(&name).as_ptr());
        let src = Source::own(sys::obs_scene_get_source(scene)).expect("scene source");
        // obs_scene_get_source doesn't add a ref; the scene's own ref is held by `src` now.
        let uuid = src.uuid();
        let mut inner = self.inner.lock();
        inner.scene_order.push(uuid.clone());
        inner.scene_refs.insert(uuid.clone(), src);
        uuid
    }

    pub fn create_scene(&self, name: &str) -> anyhow::Result<String> {
        self.require_ready()?;
        let uuid = unsafe { self.create_scene_internal(if name.trim().is_empty() { "Escena" } else { name }) };
        self.vertical_on_scene_created(&uuid, false);
        self.changed();
        Ok(uuid)
    }

    pub fn rename_source_or_scene(&self, uuid: &str, name: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        let s = source_of(uuid)?;
        let name = name.trim();
        if name.is_empty() {
            return err("El nombre no puede estar vacío");
        }
        if s.name() != name {
            if Source::by_name(name).is_some() {
                return err("Ya existe una fuente o escena con ese nombre");
            }
            unsafe { sys::obs_source_set_name(s.ptr(), cstr(name).as_ptr()) };
        }
        self.changed();
        Ok(())
    }

    pub fn duplicate_scene(&self, uuid: &str, name: &str) -> anyhow::Result<String> {
        self.require_ready()?;
        let s = scene_of(uuid)?;
        let current = s.name();
        let name = unique_name(if name.trim().is_empty() { &current } else { name });
        let uuid = unsafe {
            let dup = sys::obs_scene_duplicate(s.scene(), cstr(&name).as_ptr(), sys::obs_scene_duplicate_type_OBS_SCENE_DUP_REFS);
            let src = Source::own(sys::obs_scene_get_source(dup)).expect("dup source");
            let u = src.uuid();
            let mut inner = self.inner.lock();
            let pos = inner.scene_order.iter().position(|x| x == uuid).map(|p| p + 1).unwrap_or(inner.scene_order.len());
            inner.scene_order.insert(pos, u.clone());
            inner.scene_refs.insert(u.clone(), src);
            u
        };
        self.vertical_on_scene_created(&uuid, true);
        self.changed();
        Ok(uuid)
    }

    pub fn delete_scene(&self, uuid: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        let s = scene_of(uuid)?;
        {
            let inner = self.inner.lock();
            if inner.scene_order.len() <= 1 {
                return err("Debe quedar al menos una escena");
            }
        }
        let next = {
            let inner = self.inner.lock();
            inner.scene_order.iter().find(|u| *u != uuid).cloned()
        };
        let was_program = self.inner.lock().program.as_deref() == Some(uuid);
        if was_program {
            if let Some(n) = &next {
                self.set_program_scene(n, true)?;
            }
        }
        {
            let mut inner = self.inner.lock();
            if inner.preview.as_deref() == Some(uuid) {
                inner.preview = next.clone();
            }
            inner.scene_order.retain(|u| u != uuid);
            inner.scene_refs.remove(uuid);
        }
        self.vertical_on_scene_removed(uuid);
        unsafe { sys::obs_source_remove(s.ptr()) };
        drop(s);
        self.changed();
        Ok(())
    }

    pub fn reorder_scenes(&self, uuids: &[String]) -> anyhow::Result<()> {
        let mut inner = self.inner.lock();
        let mut order: Vec<String> = uuids.iter().filter(|u| inner.scene_order.contains(u)).cloned().collect();
        for u in inner.scene_order.clone() {
            if !order.contains(&u) {
                order.push(u);
            }
        }
        inner.scene_order = order;
        drop(inner);
        self.changed();
        Ok(())
    }

    /// Switch program (with the current transition). In studio mode, unless `force`, sets the preview.
    pub fn set_program_scene(&self, uuid: &str, force: bool) -> anyhow::Result<()> {
        self.require_ready()?;
        let scene = scene_of(uuid)?;
        let (studio, tr, duration) = {
            let inner = self.inner.lock();
            let tr = inner.current_transition.as_ref().and_then(|u| inner.transitions.iter().find(|t| &t.uuid() == u)).cloned();
            (inner.studio, tr, inner.duration_ms)
        };
        if studio && !force {
            self.inner.lock().preview = Some(uuid.to_string());
            self.changed();
            return Ok(());
        }
        unsafe {
            match tr {
                Some(t) if !sys::obs_transition_fixed(t.ptr()) || t.id() != "cut_transition" => {
                    if !sys::obs_transition_start(t.ptr(), sys::obs_transition_mode_OBS_TRANSITION_MODE_AUTO, duration, scene.ptr()) {
                        sys::obs_transition_set(t.ptr(), scene.ptr());
                    }
                }
                Some(t) => sys::obs_transition_set(t.ptr(), scene.ptr()),
                None => sys::obs_set_output_source(0, scene.ptr()),
            }
        }
        self.inner.lock().program = Some(uuid.to_string());
        self.sync_vertical_program();
        self.changed();
        Ok(())
    }

    pub fn set_preview_scene(&self, uuid: &str) -> anyhow::Result<()> {
        scene_of(uuid)?;
        self.inner.lock().preview = Some(uuid.to_string());
        self.changed();
        Ok(())
    }

    pub fn set_studio_mode(&self, enabled: bool) -> anyhow::Result<()> {
        let mut inner = self.inner.lock();
        inner.studio = enabled;
        if enabled && inner.preview.is_none() {
            inner.preview = inner.program.clone();
        }
        drop(inner);
        self.changed();
        Ok(())
    }

    pub fn transition_to_program(&self) -> anyhow::Result<()> {
        let preview = self.inner.lock().preview.clone().ok_or_else(|| anyhow::anyhow!("No hay escena en vista previa"))?;
        self.set_program_scene(&preview, true)
    }

    // ------------------------------------------------------------ scene items

    fn item_op<R>(&self, scene_uuid: &str, id: i64, f: impl FnOnce(*mut sys::obs_scene_t, *mut sys::obs_sceneitem_t) -> anyhow::Result<R>) -> anyhow::Result<R> {
        self.require_ready()?;
        let scene = scene_of(scene_uuid)?;
        let item = unsafe { find_item(scene.scene(), id) };
        if item.is_null() {
            return err("Elemento no encontrado");
        }
        let r = f(scene.scene(), item)?;
        self.changed();
        Ok(r)
    }

    pub fn add_source_to_scene(&self, scene_uuid: &str, source_uuid: &str) -> anyhow::Result<SceneItem> {
        self.require_ready()?;
        let scene = scene_of(scene_uuid)?;
        let src = source_of(source_uuid)?;
        if src.uuid() == scene.uuid() {
            return err("No puedes añadir una escena dentro de sí misma");
        }
        let info = unsafe {
            let item = sys::obs_scene_add(scene.scene(), src.ptr());
            if item.is_null() {
                return err("No se pudo añadir (¿referencia circular?)");
            }
            item_info(item)
        };
        self.changed();
        Ok(info)
    }

    pub fn update_item(&self, scene_uuid: &str, id: i64, p: SceneItemPatch) -> anyhow::Result<SceneItem> {
        self.item_op(scene_uuid, id, |_s, item| unsafe {
            sys::obs_sceneitem_defer_update_begin(item);
            if let Some(v) = p.visible {
                sys::obs_sceneitem_set_visible(item, v);
            }
            if let Some(v) = p.locked {
                sys::obs_sceneitem_set_locked(item, v);
            }
            if let Some(v) = p.pos {
                sys::obs_sceneitem_set_pos(item, &vec2(v.x as f32, v.y as f32));
            }
            if let Some(v) = p.rot {
                sys::obs_sceneitem_set_rot(item, v as f32);
            }
            if let Some(v) = p.scale {
                sys::obs_sceneitem_set_scale(item, &vec2(v.x as f32, v.y as f32));
            }
            if let Some(v) = p.alignment {
                sys::obs_sceneitem_set_alignment(item, v);
            }
            if let Some(v) = &p.bounds_type {
                sys::obs_sceneitem_set_bounds_type(item, bounds_from(v));
            }
            if let Some(v) = p.bounds_alignment {
                sys::obs_sceneitem_set_bounds_alignment(item, v);
            }
            if let Some(v) = p.bounds {
                sys::obs_sceneitem_set_bounds(item, &vec2(v.x as f32, v.y as f32));
            }
            if let Some(v) = p.crop_to_bounds {
                sys::obs_sceneitem_set_bounds_crop(item, v);
            }
            if let Some(c) = p.crop {
                let crop = sys::obs_sceneitem_crop { left: c.left.max(0), top: c.top.max(0), right: c.right.max(0), bottom: c.bottom.max(0) };
                sys::obs_sceneitem_set_crop(item, &crop);
            }
            if let Some(v) = &p.blend_mode {
                sys::obs_sceneitem_set_blending_mode(item, blend_from(v));
            }
            if let Some(v) = &p.blend_method {
                sys::obs_sceneitem_set_blending_method(item, if v == "srgb_off" { sys::obs_blending_method_OBS_BLEND_METHOD_SRGB_OFF } else { sys::obs_blending_method_OBS_BLEND_METHOD_DEFAULT });
            }
            if let Some(v) = &p.scale_filter {
                sys::obs_sceneitem_set_scale_filter(item, scale_filter_from(v));
            }
            for (show, t) in [(true, &p.show_transition), (false, &p.hide_transition)] {
                if let Some(t) = t {
                    match &t.kind {
                        Some(k) if !k.is_empty() => {
                            let name = format!("{} transition", if show { "Show" } else { "Hide" });
                            let tr = sys::obs_source_create_private(cstr(k).as_ptr(), cstr(&name).as_ptr(), std::ptr::null_mut());
                            sys::obs_sceneitem_set_transition(item, show, tr);
                            sys::obs_source_release(tr);
                        }
                        _ => sys::obs_sceneitem_set_transition(item, show, std::ptr::null_mut()),
                    }
                    sys::obs_sceneitem_set_transition_duration(item, show, t.duration_ms);
                }
            }
            sys::obs_sceneitem_defer_update_end(item);
            Ok(item_info(item))
        })
    }

    pub fn transform_item(&self, scene_uuid: &str, id: i64, action: &str) -> anyhow::Result<SceneItem> {
        let (cw, ch) = self.scene_canvas_size(scene_uuid);
        self.item_op(scene_uuid, id, |_s, item| unsafe {
            match action {
                "reset" => {
                    let mut info: sys::obs_transform_info = std::mem::zeroed();
                    info.pos = vec2(0.0, 0.0);
                    info.scale = vec2(1.0, 1.0);
                    info.rot = 0.0;
                    info.alignment = ALIGN_LEFT | ALIGN_TOP;
                    info.bounds_type = sys::obs_bounds_type_OBS_BOUNDS_NONE;
                    info.bounds_alignment = 0;
                    info.bounds = vec2(0.0, 0.0);
                    info.crop_to_bounds = false;
                    sys::obs_sceneitem_set_info2(item, &info);
                    let crop: sys::obs_sceneitem_crop = std::mem::zeroed();
                    sys::obs_sceneitem_set_crop(item, &crop);
                }
                "fit" | "stretch" => {
                    let mut info: sys::obs_transform_info = std::mem::zeroed();
                    sys::obs_sceneitem_get_info2(item, &mut info);
                    info.pos = vec2(0.0, 0.0);
                    info.scale = vec2(1.0, 1.0);
                    info.rot = 0.0;
                    info.alignment = ALIGN_LEFT | ALIGN_TOP;
                    info.bounds = vec2(cw, ch);
                    info.bounds_type = if action == "fit" { sys::obs_bounds_type_OBS_BOUNDS_SCALE_INNER } else { sys::obs_bounds_type_OBS_BOUNDS_STRETCH };
                    info.bounds_alignment = 0;
                    sys::obs_sceneitem_set_info2(item, &info);
                }
                "center" | "center_h" | "center_v" => {
                    let (x0, y0, x1, y1) = item_bbox(item);
                    let dx = if action != "center_v" { cw / 2.0 - (x0 + x1) / 2.0 } else { 0.0 };
                    let dy = if action != "center_h" { ch / 2.0 - (y0 + y1) / 2.0 } else { 0.0 };
                    let mut pos = std::mem::zeroed();
                    sys::obs_sceneitem_get_pos(item, &mut pos);
                    let (px, py) = vec2_xy(&pos);
                    sys::obs_sceneitem_set_pos(item, &vec2(px + dx, py + dy));
                }
                "flip_h" | "flip_v" => {
                    keep_top_left(item, || {
                        let mut s = std::mem::zeroed();
                        sys::obs_sceneitem_get_scale(item, &mut s);
                        let (sx, sy) = vec2_xy(&s);
                        let ns = if action == "flip_h" { vec2(-sx, sy) } else { vec2(sx, -sy) };
                        sys::obs_sceneitem_set_scale(item, &ns);
                    });
                }
                "rotate_cw" | "rotate_ccw" | "rotate_180" => {
                    let delta = match action {
                        "rotate_cw" => 90.0,
                        "rotate_ccw" => -90.0,
                        _ => 180.0,
                    };
                    keep_top_left(item, || {
                        let mut r = sys::obs_sceneitem_get_rot(item) + delta;
                        r = r.rem_euclid(360.0);
                        sys::obs_sceneitem_set_rot(item, r);
                    });
                }
                _ => return err("Acción desconocida"),
            }
            Ok(item_info(item))
        })
    }

    pub fn order_item(&self, scene_uuid: &str, id: i64, action: &str) -> anyhow::Result<()> {
        self.item_op(scene_uuid, id, |_s, item| unsafe {
            let m = match action {
                "up" => sys::obs_order_movement_OBS_ORDER_MOVE_UP,
                "down" => sys::obs_order_movement_OBS_ORDER_MOVE_DOWN,
                "top" => sys::obs_order_movement_OBS_ORDER_MOVE_TOP,
                _ => sys::obs_order_movement_OBS_ORDER_MOVE_BOTTOM,
            };
            sys::obs_sceneitem_set_order(item, m);
            Ok(())
        })
    }

    /// `ids` bottom-most first (top-level items only).
    pub fn reorder_items(&self, scene_uuid: &str, ids: &[i64]) -> anyhow::Result<()> {
        self.require_ready()?;
        let scene = scene_of(scene_uuid)?;
        unsafe {
            let mut items: Vec<*mut sys::obs_sceneitem_t> = ids.iter().map(|id| sys::obs_scene_find_sceneitem_by_id(scene.scene(), *id)).filter(|p| !p.is_null()).collect();
            // Append any missing top-level items at the top to keep a complete order.
            for it in snapshot::scene_items(scene.scene()) {
                if !ids.contains(&it.id) {
                    let p = sys::obs_scene_find_sceneitem_by_id(scene.scene(), it.id);
                    if !p.is_null() {
                        items.push(p);
                    }
                }
            }
            sys::obs_scene_reorder_items(scene.scene(), items.as_ptr(), items.len());
        }
        self.changed();
        Ok(())
    }

    pub fn remove_item(&self, scene_uuid: &str, id: i64) -> anyhow::Result<()> {
        self.item_op(scene_uuid, id, |_s, item| unsafe {
            sys::obs_sceneitem_remove(item);
            Ok(())
        })
    }

    pub fn copy_transform(&self, scene_uuid: &str, id: i64) -> anyhow::Result<()> {
        let data = self.item_op(scene_uuid, id, |_s, item| unsafe {
            let mut info: sys::obs_transform_info = std::mem::zeroed();
            sys::obs_sceneitem_get_info2(item, &mut info);
            let mut crop: sys::obs_sceneitem_crop = std::mem::zeroed();
            sys::obs_sceneitem_get_crop(item, &mut crop);
            Ok((info, crop))
        })?;
        self.inner.lock().clipboard = Some(data);
        Ok(())
    }

    pub fn paste_transform(&self, scene_uuid: &str, id: i64) -> anyhow::Result<SceneItem> {
        let clip = {
            let inner = self.inner.lock();
            let c = inner.clipboard.as_ref().ok_or_else(|| anyhow::anyhow!("No hay transformación copiada"))?;
            unsafe { (std::ptr::read(&c.0), c.1) }
        };
        self.item_op(scene_uuid, id, |_s, item| unsafe {
            sys::obs_sceneitem_set_info2(item, &clip.0);
            sys::obs_sceneitem_set_crop(item, &clip.1);
            Ok(item_info(item))
        })
    }

    pub fn group_items(&self, scene_uuid: &str, ids: &[i64], name: &str) -> anyhow::Result<SceneItem> {
        self.require_ready()?;
        let scene = scene_of(scene_uuid)?;
        let info = unsafe {
            let mut items: Vec<*mut sys::obs_sceneitem_t> = ids.iter().map(|id| sys::obs_scene_find_sceneitem_by_id(scene.scene(), *id)).filter(|p| !p.is_null()).collect();
            if items.is_empty() {
                return err("Selecciona elementos para agrupar");
            }
            let name = unique_name(if name.trim().is_empty() { "Grupo" } else { name });
            let g = sys::obs_scene_insert_group(scene.scene(), cstr(&name).as_ptr(), items.as_mut_ptr(), items.len());
            if g.is_null() {
                return err("No se pudo crear el grupo");
            }
            item_info(g)
        };
        self.changed();
        Ok(info)
    }

    pub fn ungroup_item(&self, scene_uuid: &str, id: i64) -> anyhow::Result<()> {
        self.item_op(scene_uuid, id, |_s, item| unsafe {
            if !sys::obs_sceneitem_is_group(item) {
                return err("No es un grupo");
            }
            sys::obs_sceneitem_group_ungroup(item);
            Ok(())
        })
    }

    // ------------------------------------------------------------ sources

    pub fn create_source(self: &std::sync::Arc<Self>, name: &str, kind: &str, settings: Option<Value>, scene_uuid: Option<&str>) -> anyhow::Result<SourceInfo> {
        self.require_ready()?;
        let name = unique_name(name);
        let data = settings.map(|s| Data::from_json(&s)).unwrap_or_default();
        let src = unsafe { Source::own(sys::obs_source_create(cstr(kind).as_ptr(), cstr(&name).as_ptr(), data.ptr(), std::ptr::null_mut())) }
            .ok_or_else(|| anyhow::anyhow!("No se pudo crear la fuente «{kind}» (¿plugin no disponible?)"))?;
        let mut item_id = None;
        if let Some(su) = scene_uuid {
            let scene = scene_of(su)?;
            unsafe {
                let item = sys::obs_scene_add(scene.scene(), src.ptr());
                if !item.is_null() {
                    item_id = Some((su.to_string(), sys::obs_sceneitem_get_id(item)));
                }
            }
            self.vertical_on_source_added(su, &src);
        }
        let info = unsafe { snapshot::source_info(&src, &snapshot::global_slots(), &Default::default()) };
        // Keep a ref until the item exists; inputs not in any scene would be destroyed otherwise.
        if item_id.is_none() {
            self.inner.lock().orphans.push(src.clone());
        }
        drop(src);
        // Like OBS's "fit if bigger than canvas" convenience once the size is known.
        if let Some((su, id)) = item_id {
            let me = self.clone();
            std::thread::spawn(move || {
                for _ in 0..30 {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let done = unsafe {
                        let Some(scene) = Source::by_uuid(&su) else { return };
                        let item = sys::obs_scene_find_sceneitem_by_id(scene.scene(), id);
                        if item.is_null() {
                            return;
                        }
                        let s = sys::obs_sceneitem_get_source(item);
                        let (w, h) = (sys::obs_source_get_width(s) as f32, sys::obs_source_get_height(s) as f32);
                        if w > 0.0 && h > 0.0 {
                            let (cw, ch) = me.scene_canvas_size(&su);
                            if w > cw || h > ch {
                                drop(scene);
                                let _ = me.transform_item(&su, id, "fit");
                            }
                            true
                        } else {
                            false
                        }
                    };
                    if done {
                        me.changed();
                        return;
                    }
                }
            });
        }
        self.changed();
        Ok(info)
    }

    pub fn update_source(&self, uuid: &str, patch: &Value) -> anyhow::Result<SourceInfo> {
        self.require_ready()?;
        let s = source_of(uuid)?;
        let p = s.ptr();
        unsafe {
            if let Some(n) = patch["name"].as_str() {
                if n.trim() != s.name() {
                    if n.trim().is_empty() {
                        return err("El nombre no puede estar vacío");
                    }
                    if Source::by_name(n.trim()).is_some() {
                        return err("Ya existe una fuente con ese nombre");
                    }
                    sys::obs_source_set_name(p, cstr(n.trim()).as_ptr());
                }
            }
            if let Some(v) = patch["enabled"].as_bool() {
                sys::obs_source_set_enabled(p, v);
            }
            if let Some(v) = patch["volumeDb"].as_f64() {
                sys::obs_source_set_volume(p, db_to_mul(v));
            } else if let Some(v) = patch["volume"].as_f64() {
                sys::obs_source_set_volume(p, v.max(0.0) as f32);
            }
            if let Some(v) = patch["muted"].as_bool() {
                sys::obs_source_set_muted(p, v);
            }
            if let Some(v) = patch["monitoring"].as_str() {
                sys::obs_source_set_monitoring_type(p, monitoring_from(v));
            }
            if let Some(v) = patch["syncOffsetMs"].as_i64() {
                sys::obs_source_set_sync_offset(p, v * 1_000_000);
            }
            if let Some(v) = patch["balance"].as_f64() {
                sys::obs_source_set_balance_value(p, v.clamp(0.0, 1.0) as f32);
            }
            if let Some(v) = patch["mixers"].as_u64() {
                sys::obs_source_set_audio_mixers(p, (v & 0x3f) as u32);
            }
            if let Some(v) = patch["forceMono"].as_bool() {
                let mut f = sys::obs_source_get_flags(p);
                if v {
                    f |= sys::OBS_SOURCE_FLAG_FORCE_MONO;
                } else {
                    f &= !sys::OBS_SOURCE_FLAG_FORCE_MONO;
                }
                sys::obs_source_set_flags(p, f);
            }
            if let Some(v) = patch["pushToMute"].as_bool() {
                sys::obs_source_enable_push_to_mute(p, v);
            }
            if let Some(v) = patch["pushToMuteDelayMs"].as_u64() {
                sys::obs_source_set_push_to_mute_delay(p, v);
            }
            if let Some(v) = patch["pushToTalk"].as_bool() {
                sys::obs_source_enable_push_to_talk(p, v);
            }
            if let Some(v) = patch["pushToTalkDelayMs"].as_u64() {
                sys::obs_source_set_push_to_talk_delay(p, v);
            }
        }
        let info = unsafe { snapshot::source_info(&s, &snapshot::global_slots(), &Default::default()) };
        self.changed();
        Ok(info)
    }

    pub fn delete_source(&self, uuid: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        let s = source_of(uuid)?;
        unsafe {
            // Take it out of every scene (and group) first, like OBS's "Remove" on an input.
            unsafe fn remove_refs(scene: *mut sys::obs_scene_t, uuid: &str) {
                for it in snapshot::scene_items(scene) {
                    if it.source_uuid == uuid {
                        let si = sys::obs_scene_find_sceneitem_by_id(scene, it.id);
                        if !si.is_null() {
                            sys::obs_sceneitem_remove(si);
                        }
                    } else if it.is_group {
                        if let Ok(g) = source_of(&it.source_uuid) {
                            let gs = sys::obs_group_from_source(g.ptr());
                            if !gs.is_null() {
                                remove_refs(gs, uuid);
                            }
                        }
                    }
                }
            }
            for sc in snapshot::all_scenes() {
                remove_refs(sc.scene(), uuid);
            }
            for ch in 1..=6u32 {
                if let Some(g) = Source::own(sys::obs_get_output_source(ch)) {
                    if g.uuid() == uuid {
                        sys::obs_set_output_source(ch, std::ptr::null_mut());
                    }
                }
            }
            // A removed source keeps its name until its last reference goes away;
            // free the name now so a new source (or an undo) can use it.
            sys::obs_source_set_name(s.ptr(), cstr(&format!("__removed {uuid}")).as_ptr());
            sys::obs_source_remove(s.ptr());
        }
        self.inner.lock().orphans.retain(|o| o.uuid() != uuid);
        drop(s);
        self.changed();
        Ok(())
    }

    pub fn duplicate_source(&self, uuid: &str, name: &str, scene_uuid: Option<&str>) -> anyhow::Result<SourceInfo> {
        self.require_ready()?;
        let s = source_of(uuid)?;
        let current = s.name();
        let name = unique_name(if name.trim().is_empty() { &current } else { name });
        let dup = unsafe { Source::own(sys::obs_source_duplicate(s.ptr(), cstr(&name).as_ptr(), false)) }.ok_or_else(|| anyhow::anyhow!("No se pudo duplicar"))?;
        if let Some(su) = scene_uuid {
            let scene = scene_of(su)?;
            unsafe {
                sys::obs_scene_add(scene.scene(), dup.ptr());
            }
        } else {
            self.inner.lock().orphans.push(dup.clone());
        }
        let info = unsafe { snapshot::source_info(&dup, &snapshot::global_slots(), &Default::default()) };
        self.changed();
        Ok(info)
    }

    unsafe fn props_of_source(src: &Source) -> Vec<Property> {
        let p = sys::obs_source_properties(src.ptr());
        let settings = src.settings();
        props::apply_modified(p, settings.ptr());
        let out = props::convert(p, &settings.to_json_with_defaults());
        sys::obs_properties_destroy(p);
        out
    }

    pub fn source_properties(&self, uuid: &str) -> anyhow::Result<Vec<Property>> {
        self.require_ready()?;
        let s = source_of(uuid)?;
        Ok(unsafe { Self::props_of_source(&s) })
    }

    pub fn update_source_settings(&self, uuid: &str, settings: &Value) -> anyhow::Result<Vec<Property>> {
        self.require_ready()?;
        let s = source_of(uuid)?;
        let d = Data::from_json(settings);
        unsafe { sys::obs_source_update(s.ptr(), d.ptr()) };
        let out = unsafe { Self::props_of_source(&s) };
        self.changed();
        Ok(out)
    }

    /// Merge a few settings into a source. `persist` saves the collection and broadcasts
    /// the change; without it (text that updates every second) it's only applied.
    pub fn set_source_fields(&self, uuid: &str, fields: &Value, persist: bool) -> anyhow::Result<()> {
        self.require_ready()?;
        let s = source_of(uuid)?;
        let d = Data::from_json(fields);
        unsafe { sys::obs_source_update(s.ptr(), d.ptr()) };
        if persist {
            self.changed();
        } else {
            self.mark_dirty();
        }
        Ok(())
    }

    pub fn reset_source_settings(&self, uuid: &str) -> anyhow::Result<Vec<Property>> {
        self.require_ready()?;
        let s = source_of(uuid)?;
        let d = Data::new();
        unsafe { sys::obs_source_reset_settings(s.ptr(), d.ptr()) };
        let out = unsafe { Self::props_of_source(&s) };
        self.changed();
        Ok(out)
    }

    pub fn click_source_button(&self, uuid: &str, prop: &str) -> anyhow::Result<Vec<Property>> {
        self.require_ready()?;
        let s = source_of(uuid)?;
        unsafe {
            let p = sys::obs_source_properties(s.ptr());
            props::click(p, prop, s.ptr() as *mut c_void);
            sys::obs_properties_destroy(p);
        }
        let out = unsafe { Self::props_of_source(&s) };
        self.changed();
        Ok(out)
    }

    pub fn media_action(&self, uuid: &str, action: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        let s = source_of(uuid)?;
        unsafe {
            match action {
                "play" => sys::obs_source_media_play_pause(s.ptr(), false),
                "pause" => sys::obs_source_media_play_pause(s.ptr(), true),
                "restart" => sys::obs_source_media_restart(s.ptr()),
                "stop" => sys::obs_source_media_stop(s.ptr()),
                "next" => sys::obs_source_media_next(s.ptr()),
                "previous" => sys::obs_source_media_previous(s.ptr()),
                _ => return err("Acción desconocida"),
            }
        }
        self.changed();
        Ok(())
    }

    /// Mouse/keyboard interaction with interactive sources (browser source).
    pub fn interact(&self, uuid: &str, ev: &Value) -> anyhow::Result<()> {
        self.require_ready()?;
        let s = source_of(uuid)?;
        unsafe {
            let mut me: sys::obs_mouse_event = std::mem::zeroed();
            me.x = ev["x"].as_i64().unwrap_or(0) as i32;
            me.y = ev["y"].as_i64().unwrap_or(0) as i32;
            match ev["type"].as_str().unwrap_or("") {
                "click" => {
                    let button = match ev["button"].as_str() {
                        Some("right") => sys::obs_mouse_button_type_MOUSE_RIGHT,
                        Some("middle") => sys::obs_mouse_button_type_MOUSE_MIDDLE,
                        _ => sys::obs_mouse_button_type_MOUSE_LEFT,
                    };
                    // The button type is u32 on Windows' bindings and i32 on Linux'.
                    #[allow(clippy::unnecessary_cast)]
                    sys::obs_source_send_mouse_click(s.ptr(), &me, button as _, ev["up"].as_bool().unwrap_or(false), ev["count"].as_u64().unwrap_or(1) as u32);
                }
                "move" => sys::obs_source_send_mouse_move(s.ptr(), &me, ev["leave"].as_bool().unwrap_or(false)),
                "wheel" => sys::obs_source_send_mouse_wheel(s.ptr(), &me, ev["dx"].as_i64().unwrap_or(0) as i32, ev["dy"].as_i64().unwrap_or(0) as i32),
                "key" => {
                    let mut ke: sys::obs_key_event = std::mem::zeroed();
                    let text = cstr(ev["text"].as_str().unwrap_or(""));
                    ke.text = text.as_ptr() as *mut _;
                    ke.native_vkey = ev["keyCode"].as_u64().unwrap_or(0) as u32;
                    sys::obs_source_send_key_click(s.ptr(), &ke, ev["up"].as_bool().unwrap_or(false));
                }
                "focus" => sys::obs_source_send_focus(s.ptr(), ev["focus"].as_bool().unwrap_or(true)),
                _ => return err("Evento desconocido"),
            }
        }
        Ok(())
    }

    // ------------------------------------------------------------ filters

    fn filter_of(parent: &Source, uuid: &str) -> anyhow::Result<Source> {
        let f = Source::by_uuid(uuid).ok_or_else(|| anyhow::anyhow!("Filtro no encontrado"))?;
        unsafe {
            if sys::obs_filter_get_parent(f.ptr()) != parent.ptr() {
                return err("El filtro no pertenece a esta fuente");
            }
        }
        Ok(f)
    }

    pub fn add_filter(&self, source_uuid: &str, kind: &str, name: &str) -> anyhow::Result<String> {
        self.require_ready()?;
        let parent = source_of(source_uuid)?;
        let base = if name.trim().is_empty() { unsafe { display_name(kind) } } else { name.trim().to_string() };
        let mut name = base.clone();
        let mut i = 2;
        unsafe {
            while !sys::obs_source_get_filter_by_name(parent.ptr(), cstr(&name).as_ptr()).is_null() {
                let existing = sys::obs_source_get_filter_by_name(parent.ptr(), cstr(&name).as_ptr());
                sys::obs_source_release(existing);
                name = format!("{base} {i}");
                i += 1;
            }
        }
        let f = unsafe { Source::own(sys::obs_source_create(cstr(kind).as_ptr(), cstr(&name).as_ptr(), std::ptr::null_mut(), std::ptr::null_mut())) }
            .ok_or_else(|| anyhow::anyhow!("No se pudo crear el filtro"))?;
        unsafe { sys::obs_source_filter_add(parent.ptr(), f.ptr()) };
        let u = f.uuid();
        self.changed();
        Ok(u)
    }

    pub fn update_filter(&self, source_uuid: &str, filter_uuid: &str, patch: &Value) -> anyhow::Result<()> {
        self.require_ready()?;
        let parent = source_of(source_uuid)?;
        let f = Self::filter_of(&parent, filter_uuid)?;
        unsafe {
            if let Some(n) = patch["name"].as_str() {
                if !n.trim().is_empty() {
                    sys::obs_source_set_name(f.ptr(), cstr(n.trim()).as_ptr());
                }
            }
            if let Some(e) = patch["enabled"].as_bool() {
                sys::obs_source_set_enabled(f.ptr(), e);
            }
        }
        self.changed();
        Ok(())
    }

    pub fn filter_properties(&self, source_uuid: &str, filter_uuid: &str) -> anyhow::Result<Vec<Property>> {
        self.require_ready()?;
        let parent = source_of(source_uuid)?;
        let f = Self::filter_of(&parent, filter_uuid)?;
        Ok(unsafe { Self::props_of_source(&f) })
    }

    pub fn update_filter_settings(&self, source_uuid: &str, filter_uuid: &str, settings: &Value) -> anyhow::Result<Vec<Property>> {
        self.require_ready()?;
        let parent = source_of(source_uuid)?;
        let f = Self::filter_of(&parent, filter_uuid)?;
        let d = Data::from_json(settings);
        unsafe { sys::obs_source_update(f.ptr(), d.ptr()) };
        let out = unsafe { Self::props_of_source(&f) };
        self.changed();
        Ok(out)
    }

    pub fn click_filter_button(&self, source_uuid: &str, filter_uuid: &str, prop: &str) -> anyhow::Result<Vec<Property>> {
        self.require_ready()?;
        let parent = source_of(source_uuid)?;
        let f = Self::filter_of(&parent, filter_uuid)?;
        unsafe {
            let p = sys::obs_source_properties(f.ptr());
            props::click(p, prop, f.ptr() as *mut c_void);
            sys::obs_properties_destroy(p);
        }
        Ok(unsafe { Self::props_of_source(&f) })
    }

    pub fn remove_filter(&self, source_uuid: &str, filter_uuid: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        let parent = source_of(source_uuid)?;
        let f = Self::filter_of(&parent, filter_uuid)?;
        unsafe { sys::obs_source_filter_remove(parent.ptr(), f.ptr()) };
        self.changed();
        Ok(())
    }

    pub fn reorder_filters(&self, source_uuid: &str, uuids: &[String]) -> anyhow::Result<()> {
        self.require_ready()?;
        let parent = source_of(source_uuid)?;
        for (i, u) in uuids.iter().enumerate() {
            if let Ok(f) = Self::filter_of(&parent, u) {
                unsafe { sys::obs_source_filter_set_index(parent.ptr(), f.ptr(), i) };
            }
        }
        self.changed();
        Ok(())
    }

    // ------------------------------------------------------------ transitions

    fn transition_of(&self, uuid: &str) -> anyhow::Result<Source> {
        self.inner.lock().transitions.iter().find(|t| t.uuid() == uuid).cloned().ok_or_else(|| anyhow::anyhow!("Transición no encontrada"))
    }

    pub fn add_transition(&self, kind: &str, name: &str) -> anyhow::Result<TransitionInfo> {
        self.require_ready()?;
        let base = if name.trim().is_empty() { unsafe { display_name(kind) } } else { name.trim().to_string() };
        let t = unsafe { Source::own(sys::obs_source_create_private(cstr(kind).as_ptr(), cstr(&base).as_ptr(), std::ptr::null_mut())) }
            .ok_or_else(|| anyhow::anyhow!("No se pudo crear la transición"))?;
        let info = unsafe { snapshot::transition_info(&t) };
        self.inner.lock().transitions.push(t);
        self.changed();
        Ok(info)
    }

    pub fn set_current_transition(&self, uuid: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        let new = self.transition_of(uuid)?;
        let old = { self.inner.lock().current_transition.clone() }.and_then(|u| self.transition_of(&u).ok());
        unsafe {
            if let Some(old) = &old {
                sys::obs_transition_swap_begin(new.ptr(), old.ptr());
                sys::obs_set_output_source(0, new.ptr());
                sys::obs_transition_swap_end(new.ptr(), old.ptr());
            } else {
                sys::obs_set_output_source(0, new.ptr());
            }
        }
        self.inner.lock().current_transition = Some(uuid.to_string());
        self.changed();
        Ok(())
    }

    pub fn set_transition_duration(&self, ms: u32) {
        self.inner.lock().duration_ms = ms.clamp(50, 20_000);
        self.changed();
    }

    pub fn transition_properties(&self, uuid: &str) -> anyhow::Result<Vec<Property>> {
        let t = self.transition_of(uuid)?;
        Ok(unsafe { Self::props_of_source(&t) })
    }

    pub fn update_transition_settings(&self, uuid: &str, settings: &Value) -> anyhow::Result<Vec<Property>> {
        let t = self.transition_of(uuid)?;
        let d = Data::from_json(settings);
        unsafe { sys::obs_source_update(t.ptr(), d.ptr()) };
        let out = unsafe { Self::props_of_source(&t) };
        self.changed();
        Ok(out)
    }

    pub fn rename_transition(&self, uuid: &str, name: &str) -> anyhow::Result<()> {
        let t = self.transition_of(uuid)?;
        if name.trim().is_empty() {
            return err("El nombre no puede estar vacío");
        }
        unsafe { sys::obs_source_set_name(t.ptr(), cstr(name.trim()).as_ptr()) };
        self.changed();
        Ok(())
    }

    pub fn remove_transition(&self, uuid: &str) -> anyhow::Result<()> {
        let t = self.transition_of(uuid)?;
        if matches!(t.id().as_str(), "cut_transition" | "fade_transition") {
            return err("Las transiciones Corte y Fundido no se pueden borrar");
        }
        let current = self.inner.lock().current_transition.as_deref() == Some(uuid);
        if current {
            let fade = self.inner.lock().transitions.iter().find(|t| t.id() == "fade_transition").map(|t| t.uuid());
            if let Some(f) = fade {
                self.set_current_transition(&f)?;
            }
        }
        self.inner.lock().transitions.retain(|x| x.uuid() != uuid);
        self.changed();
        Ok(())
    }

    // ------------------------------------------------------------ global audio devices

    /// Create/update/remove the global audio sources (Desktop Audio 1/2, Mic/Aux 1–4).
    pub fn audio_devices_apply(&self, a: &AudioSettings) {
        if !self.is_ready() {
            return;
        }
        let (out_kind, in_kind) = super::catalog::audio_kinds();
        let wants = [
            (1u32, a.desktop1.as_str(), out_kind, "Audio del escritorio"),
            (2, a.desktop2.as_str(), out_kind, "Audio del escritorio 2"),
            (3, a.mic1.as_str(), in_kind, "Mic/Aux"),
            (4, a.mic2.as_str(), in_kind, "Mic/Aux 2"),
            (5, a.mic3.as_str(), in_kind, "Mic/Aux 3"),
            (6, a.mic4.as_str(), in_kind, "Mic/Aux 4"),
        ];
        unsafe {
            for (ch, device, kind, name) in wants {
                let current = Source::own(sys::obs_get_output_source(ch));
                if device == "disabled" || device.is_empty() {
                    if current.is_some() {
                        sys::obs_set_output_source(ch, std::ptr::null_mut());
                    }
                    continue;
                }
                match current {
                    Some(s) if s.id() == kind => {
                        let settings = s.settings();
                        if settings.get_string("device_id") != device {
                            let d = Data::new();
                            d.set_string("device_id", device);
                            sys::obs_source_update(s.ptr(), d.ptr());
                        }
                    }
                    _ => {
                        let d = Data::new();
                        d.set_string("device_id", device);
                        let name = unique_name(name);
                        if let Some(src) = Source::own(sys::obs_source_create(cstr(kind).as_ptr(), cstr(&name).as_ptr(), d.ptr(), std::ptr::null_mut())) {
                            sys::obs_set_output_source(ch, src.ptr());
                        }
                    }
                }
            }
        }
        self.changed();
    }

    /// Read the current global device ids (after loading a collection).
    pub fn global_audio_devices(&self) -> Vec<(String, String)> {
        let mut out = vec![];
        if !self.is_ready() {
            return out;
        }
        unsafe {
            for (_, ch, slot) in super::collection::GLOBAL_SLOTS {
                let v = match Source::own(sys::obs_get_output_source(ch)) {
                    Some(s) => {
                        let id = s.settings().get_string("device_id");
                        if id.is_empty() {
                            "default".into()
                        } else {
                            id
                        }
                    }
                    None => "disabled".into(),
                };
                out.push((slot.to_string(), v));
            }
        }
        out
    }

    pub fn set_monitoring_device(&self, name: &str, id: &str) {
        if self.is_ready() {
            unsafe {
                sys::obs_set_audio_monitoring_device(cstr(name).as_ptr(), cstr(id).as_ptr());
            }
        }
    }

    /// Change base/output resolution, fps, colors (only when no output is active).
    pub fn apply_video(&self, v: &VideoSettings, renderer: &str) -> anyhow::Result<()> {
        self.require_ready()?;
        if self.outputs.any_active() {
            return err("Detén la transmisión, la grabación, el búfer de repetición y la cámara virtual antes de cambiar el video");
        }
        self.previews.clear();
        let r = unsafe { super::runtime::reset_video(v, renderer) };
        if r != 0 {
            anyhow::bail!("OBS rechazó la configuración de video (código {r})");
        }
        self.changed();
        Ok(())
    }
}
