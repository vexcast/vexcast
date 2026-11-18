//! Read the libobs object graph into serializable structs.

use super::ffi::*;
use super::model::*;
use libobs as sys;
use std::collections::HashMap;
use std::os::raw::c_void;

pub fn bounds_name(t: sys::obs_bounds_type) -> &'static str {
    match t {
        sys::obs_bounds_type_OBS_BOUNDS_STRETCH => "stretch",
        sys::obs_bounds_type_OBS_BOUNDS_SCALE_INNER => "scale_inner",
        sys::obs_bounds_type_OBS_BOUNDS_SCALE_OUTER => "scale_outer",
        sys::obs_bounds_type_OBS_BOUNDS_SCALE_TO_WIDTH => "scale_to_width",
        sys::obs_bounds_type_OBS_BOUNDS_SCALE_TO_HEIGHT => "scale_to_height",
        sys::obs_bounds_type_OBS_BOUNDS_MAX_ONLY => "max_only",
        _ => "none",
    }
}

pub fn bounds_from(s: &str) -> sys::obs_bounds_type {
    match s {
        "stretch" => sys::obs_bounds_type_OBS_BOUNDS_STRETCH,
        "scale_inner" => sys::obs_bounds_type_OBS_BOUNDS_SCALE_INNER,
        "scale_outer" => sys::obs_bounds_type_OBS_BOUNDS_SCALE_OUTER,
        "scale_to_width" => sys::obs_bounds_type_OBS_BOUNDS_SCALE_TO_WIDTH,
        "scale_to_height" => sys::obs_bounds_type_OBS_BOUNDS_SCALE_TO_HEIGHT,
        "max_only" => sys::obs_bounds_type_OBS_BOUNDS_MAX_ONLY,
        _ => sys::obs_bounds_type_OBS_BOUNDS_NONE,
    }
}

pub fn blend_name(t: sys::obs_blending_type) -> &'static str {
    match t {
        sys::obs_blending_type_OBS_BLEND_ADDITIVE => "additive",
        sys::obs_blending_type_OBS_BLEND_SUBTRACT => "subtract",
        sys::obs_blending_type_OBS_BLEND_SCREEN => "screen",
        sys::obs_blending_type_OBS_BLEND_MULTIPLY => "multiply",
        sys::obs_blending_type_OBS_BLEND_LIGHTEN => "lighten",
        sys::obs_blending_type_OBS_BLEND_DARKEN => "darken",
        _ => "normal",
    }
}

pub fn blend_from(s: &str) -> sys::obs_blending_type {
    match s {
        "additive" => sys::obs_blending_type_OBS_BLEND_ADDITIVE,
        "subtract" => sys::obs_blending_type_OBS_BLEND_SUBTRACT,
        "screen" => sys::obs_blending_type_OBS_BLEND_SCREEN,
        "multiply" => sys::obs_blending_type_OBS_BLEND_MULTIPLY,
        "lighten" => sys::obs_blending_type_OBS_BLEND_LIGHTEN,
        "darken" => sys::obs_blending_type_OBS_BLEND_DARKEN,
        _ => sys::obs_blending_type_OBS_BLEND_NORMAL,
    }
}

pub fn scale_filter_name(t: sys::obs_scale_type) -> &'static str {
    match t {
        sys::obs_scale_type_OBS_SCALE_POINT => "point",
        sys::obs_scale_type_OBS_SCALE_BICUBIC => "bicubic",
        sys::obs_scale_type_OBS_SCALE_BILINEAR => "bilinear",
        sys::obs_scale_type_OBS_SCALE_LANCZOS => "lanczos",
        sys::obs_scale_type_OBS_SCALE_AREA => "area",
        _ => "disable",
    }
}

pub fn scale_filter_from(s: &str) -> sys::obs_scale_type {
    match s {
        "point" => sys::obs_scale_type_OBS_SCALE_POINT,
        "bicubic" => sys::obs_scale_type_OBS_SCALE_BICUBIC,
        "bilinear" => sys::obs_scale_type_OBS_SCALE_BILINEAR,
        "lanczos" => sys::obs_scale_type_OBS_SCALE_LANCZOS,
        "area" => sys::obs_scale_type_OBS_SCALE_AREA,
        _ => sys::obs_scale_type_OBS_SCALE_DISABLE,
    }
}

pub fn monitoring_name(t: sys::obs_monitoring_type) -> &'static str {
    match t {
        sys::obs_monitoring_type_OBS_MONITORING_TYPE_MONITOR_ONLY => "monitor_only",
        sys::obs_monitoring_type_OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT => "monitor_and_output",
        _ => "none",
    }
}

pub fn monitoring_from(s: &str) -> sys::obs_monitoring_type {
    match s {
        "monitor_only" => sys::obs_monitoring_type_OBS_MONITORING_TYPE_MONITOR_ONLY,
        "monitor_and_output" => sys::obs_monitoring_type_OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT,
        _ => sys::obs_monitoring_type_OBS_MONITORING_TYPE_NONE,
    }
}

pub fn media_state_name(t: sys::obs_media_state) -> &'static str {
    match t {
        sys::obs_media_state_OBS_MEDIA_STATE_PLAYING => "playing",
        sys::obs_media_state_OBS_MEDIA_STATE_OPENING => "opening",
        sys::obs_media_state_OBS_MEDIA_STATE_BUFFERING => "buffering",
        sys::obs_media_state_OBS_MEDIA_STATE_PAUSED => "paused",
        sys::obs_media_state_OBS_MEDIA_STATE_STOPPED => "stopped",
        sys::obs_media_state_OBS_MEDIA_STATE_ENDED => "ended",
        sys::obs_media_state_OBS_MEDIA_STATE_ERROR => "error",
        _ => "none",
    }
}

/// Icon hint for a source type id (unversioned).
pub fn icon_for(id: &str, flags: u32) -> &'static str {
    match id {
        "image_source" => "image",
        "color_source" => "color",
        "slideshow" => "slideshow",
        "ffmpeg_source" | "vlc_source" => "media",
        "text_gdiplus" | "text_ft2_source" => "text",
        "monitor_capture" | "xshm_input" | "screen_capture" | "display_capture" | "pipewire-desktop-capture-source" => "desktop",
        "window_capture" | "xcomposite_input" | "pipewire-window-capture-source" => "window",
        "game_capture" => "game",
        "dshow_input" | "av_capture_input" | "v4l2_input" | "macos-avcapture" => "camera",
        "wasapi_input_capture" | "pulse_input_capture" | "coreaudio_input_capture" | "alsa_input_capture" => "audio_input",
        "wasapi_output_capture" | "pulse_output_capture" | "coreaudio_output_capture" => "audio_output",
        "wasapi_process_output_capture" | "sck_audio_capture" => "process_audio",
        "browser_source" => "browser",
        "scene" | "group" => "scene",
        _ => {
            if flags & sys::OBS_SOURCE_VIDEO == 0 && flags & sys::OBS_SOURCE_AUDIO != 0 {
                "audio_input"
            } else {
                "custom"
            }
        }
    }
}

pub unsafe fn display_name(id: &str) -> String {
    string(sys::obs_source_get_display_name(cstr(id).as_ptr()))
}

pub unsafe fn filters_of(src: &Source) -> Vec<FilterInfo> {
    let mut list: Vec<Source> = vec![];
    unsafe extern "C" fn cb(_parent: *mut sys::obs_source_t, child: *mut sys::obs_source_t, param: *mut c_void) {
        let v = &mut *(param as *mut Vec<Source>);
        if let Some(s) = Source::borrow(child) {
            v.push(s);
        }
    }
    sys::obs_source_enum_filters(src.ptr(), Some(cb), &mut list as *mut _ as *mut c_void);
    list.iter()
        .map(|f| {
            let id = f.id();
            FilterInfo { uuid: f.uuid(), name: f.name(), kind_name: display_name(&id), kind: id, enabled: sys::obs_source_enabled(f.ptr()), settings: f.settings().to_json() }
        })
        .collect()
}

/// Which global audio slot (output channel 1..6) a source occupies.
pub unsafe fn global_slots() -> HashMap<String, String> {
    let mut m = HashMap::new();
    for (ch, slot) in [(1u32, "desktop1"), (2, "desktop2"), (3, "mic1"), (4, "mic2"), (5, "mic3"), (6, "mic4")] {
        if let Some(s) = Source::own(sys::obs_get_output_source(ch)) {
            m.insert(s.uuid(), slot.to_string());
        }
    }
    m
}

pub unsafe fn source_info(src: &Source, slots: &HashMap<String, String>, refs: &HashMap<String, u32>) -> SourceInfo {
    let p = src.ptr();
    let id = src.id();
    let flags = sys::obs_source_get_output_flags(p);
    let vol = sys::obs_source_get_volume(p);
    let uuid = src.uuid();
    let src_flags = sys::obs_source_get_flags(p);
    let controllable = flags & sys::OBS_SOURCE_CONTROLLABLE_MEDIA != 0;
    SourceInfo {
        name: src.name(),
        kind_name: display_name(&id),
        base_kind: string(sys::obs_source_get_unversioned_id(p)),
        settings: src.settings().to_json(),
        video: flags & sys::OBS_SOURCE_VIDEO != 0,
        audio: flags & sys::OBS_SOURCE_AUDIO != 0,
        is_async: flags & (sys::OBS_SOURCE_ASYNC | sys::OBS_SOURCE_VIDEO) == (sys::OBS_SOURCE_ASYNC | sys::OBS_SOURCE_VIDEO),
        interactive: flags & sys::OBS_SOURCE_INTERACTION != 0,
        controllable_media: controllable,
        width: sys::obs_source_get_width(p),
        height: sys::obs_source_get_height(p),
        enabled: sys::obs_source_enabled(p),
        volume: vol as f64,
        volume_db: mul_to_db(vol),
        muted: sys::obs_source_muted(p),
        monitoring: monitoring_name(sys::obs_source_get_monitoring_type(p)).into(),
        sync_offset_ms: sys::obs_source_get_sync_offset(p) / 1_000_000,
        balance: sys::obs_source_get_balance_value(p) as f64,
        mixers: sys::obs_source_get_audio_mixers(p),
        force_mono: src_flags & sys::OBS_SOURCE_FLAG_FORCE_MONO != 0,
        push_to_mute: sys::obs_source_push_to_mute_enabled(p),
        push_to_mute_delay_ms: sys::obs_source_get_push_to_mute_delay(p),
        push_to_talk: sys::obs_source_push_to_talk_enabled(p),
        push_to_talk_delay_ms: sys::obs_source_get_push_to_talk_delay(p),
        filters: filters_of(src),
        global_slot: slots.get(&uuid).cloned(),
        media_state: if controllable { Some(media_state_name(sys::obs_source_media_get_state(p)).into()) } else { None },
        refs: refs.get(&uuid).copied().unwrap_or(0),
        kind: id,
        uuid,
    }
}

pub unsafe fn transition_info(src: &Source) -> TransitionInfo {
    let id = src.id();
    TransitionInfo {
        uuid: src.uuid(),
        name: src.name(),
        kind_name: display_name(&id),
        fixed: sys::obs_transition_fixed(src.ptr()),
        settings: src.settings().to_json(),
        kind: id,
    }
}

unsafe fn item_transition(item: *mut sys::obs_sceneitem_t, show: bool) -> ItemTransition {
    let t = sys::obs_sceneitem_get_transition(item, show);
    ItemTransition {
        kind: if t.is_null() { None } else { Some(string(sys::obs_source_get_id(t))) },
        duration_ms: sys::obs_sceneitem_get_transition_duration(item, show),
    }
}

pub unsafe fn item_info(item: *mut sys::obs_sceneitem_t) -> SceneItem {
    let src = sys::obs_sceneitem_get_source(item);
    let mut info: sys::obs_transform_info = std::mem::zeroed();
    sys::obs_sceneitem_get_info2(item, &mut info);
    let mut crop: sys::obs_sceneitem_crop = std::mem::zeroed();
    sys::obs_sceneitem_get_crop(item, &mut crop);
    let (px, py) = vec2_xy(&info.pos);
    let (sx, sy) = vec2_xy(&info.scale);
    let (bx, by) = vec2_xy(&info.bounds);
    let is_group = sys::obs_sceneitem_is_group(item);
    let mut children = None;
    if is_group {
        let mut v: Vec<SceneItem> = vec![];
        unsafe extern "C" fn cb(_s: *mut sys::obs_scene_t, it: *mut sys::obs_sceneitem_t, param: *mut c_void) -> bool {
            let v = &mut *(param as *mut Vec<SceneItem>);
            v.push(item_info(it));
            true
        }
        sys::obs_sceneitem_group_enum_items(item, Some(cb), &mut v as *mut _ as *mut c_void);
        children = Some(v);
    }
    SceneItem {
        id: sys::obs_sceneitem_get_id(item),
        source_uuid: string(sys::obs_source_get_uuid(src)),
        name: string(sys::obs_source_get_name(src)),
        visible: sys::obs_sceneitem_visible(item),
        locked: sys::obs_sceneitem_locked(item),
        pos: Vec2 { x: px as f64, y: py as f64 },
        rot: info.rot as f64,
        scale: Vec2 { x: sx as f64, y: sy as f64 },
        alignment: info.alignment,
        bounds_type: bounds_name(info.bounds_type).into(),
        bounds_alignment: info.bounds_alignment,
        bounds: Vec2 { x: bx as f64, y: by as f64 },
        crop_to_bounds: info.crop_to_bounds,
        crop: Crop { left: crop.left, top: crop.top, right: crop.right, bottom: crop.bottom },
        blend_mode: blend_name(sys::obs_sceneitem_get_blending_mode(item)).into(),
        blend_method: if sys::obs_sceneitem_get_blending_method(item) == sys::obs_blending_method_OBS_BLEND_METHOD_SRGB_OFF { "srgb_off" } else { "default" }.into(),
        scale_filter: scale_filter_name(sys::obs_sceneitem_get_scale_filter(item)).into(),
        source_width: sys::obs_source_get_width(src),
        source_height: sys::obs_source_get_height(src),
        is_group,
        items: children,
        show_transition: item_transition(item, true),
        hide_transition: item_transition(item, false),
    }
}

pub unsafe fn scene_items(scene: *mut sys::obs_scene_t) -> Vec<SceneItem> {
    let mut v: Vec<SceneItem> = vec![];
    unsafe extern "C" fn cb(_s: *mut sys::obs_scene_t, it: *mut sys::obs_sceneitem_t, param: *mut c_void) -> bool {
        let v = &mut *(param as *mut Vec<SceneItem>);
        v.push(item_info(it));
        true
    }
    sys::obs_scene_enum_items(scene, Some(cb), &mut v as *mut _ as *mut c_void);
    v
}

/// All scenes (not groups), unordered.
pub unsafe fn all_scenes() -> Vec<Source> {
    let mut v: Vec<Source> = vec![];
    sys::obs_enum_scenes(Some(collect_sources), &mut v as *mut _ as *mut c_void);
    v.retain(|s| !s.is_group());
    v
}

/// All inputs (excludes scenes, groups, transitions, filters; includes private? no).
pub unsafe fn all_inputs() -> Vec<Source> {
    let mut v: Vec<Source> = vec![];
    sys::obs_enum_sources(Some(collect_sources), &mut v as *mut _ as *mut c_void);
    // Removed sources linger until their last reference is released (meters, previews…).
    v.retain(|s| sys::obs_source_get_type(s.ptr()) == sys::obs_source_type_OBS_SOURCE_TYPE_INPUT && !sys::obs_source_removed(s.ptr()));
    v
}

/// Count, for each source uuid, how many scenes reference it.
pub unsafe fn reference_counts(scenes: &[SceneInfo]) -> HashMap<String, u32> {
    fn walk(items: &[SceneItem], m: &mut HashMap<String, u32>) {
        for i in items {
            *m.entry(i.source_uuid.clone()).or_insert(0) += 1;
            if let Some(c) = &i.items {
                walk(c, m);
            }
        }
    }
    let mut m = HashMap::new();
    for s in scenes {
        walk(&s.items, &mut m);
    }
    m
}

/// Find a scene item by id in a scene (searching groups too).
pub unsafe fn find_item(scene: *mut sys::obs_scene_t, id: i64) -> *mut sys::obs_sceneitem_t {
    let it = sys::obs_scene_find_sceneitem_by_id(scene, id);
    if !it.is_null() {
        return it;
    }
    // Search inside groups.
    struct Ctx {
        id: i64,
        found: *mut sys::obs_sceneitem_t,
    }
    unsafe extern "C" fn cb(_s: *mut sys::obs_scene_t, it: *mut sys::obs_sceneitem_t, param: *mut c_void) -> bool {
        let c = &mut *(param as *mut Ctx);
        if sys::obs_sceneitem_is_group(it) {
            let g = sys::obs_sceneitem_group_get_scene(it);
            let f = sys::obs_scene_find_sceneitem_by_id(g, c.id);
            if !f.is_null() {
                c.found = f;
                return false;
            }
        }
        true
    }
    let mut ctx = Ctx { id, found: std::ptr::null_mut() };
    sys::obs_scene_enum_items(scene, Some(cb), &mut ctx as *mut _ as *mut c_void);
    ctx.found
}
