//! Discovery: source/filter/transition types, encoders, streaming services, devices, hotkeys.

use super::ffi::*;
use super::model::*;
use super::props;
use super::snapshot::{display_name, icon_for};
use super::Engine;
use libobs as sys;
use serde_json::Value;
use std::os::raw::{c_char, c_void};

unsafe fn type_info(id: &str, kind: &str) -> SourceType {
    let flags = sys::obs_get_source_output_flags(cstr(id).as_ptr());
    let unversioned = id.trim_end_matches(|c: char| c.is_ascii_digit()).trim_end_matches("_v").to_string();
    SourceType {
        id: id.to_string(),
        name: display_name(id),
        kind: kind.into(),
        video: flags & sys::OBS_SOURCE_VIDEO != 0,
        audio: flags & sys::OBS_SOURCE_AUDIO != 0,
        is_async: flags & (sys::OBS_SOURCE_ASYNC | sys::OBS_SOURCE_VIDEO) == (sys::OBS_SOURCE_ASYNC | sys::OBS_SOURCE_VIDEO),
        interactive: flags & sys::OBS_SOURCE_INTERACTION != 0,
        controllable_media: flags & sys::OBS_SOURCE_CONTROLLABLE_MEDIA != 0,
        deprecated: flags & sys::OBS_SOURCE_DEPRECATED != 0,
        icon: icon_for(&unversioned, flags).into(),
    }
}

unsafe fn enum_ids(f: unsafe extern "C" fn(usize, *mut *const c_char) -> bool) -> Vec<String> {
    let mut out = vec![];
    let mut i = 0usize;
    let mut id: *const c_char = std::ptr::null();
    while f(i, &mut id) {
        out.push(string(id));
        i += 1;
    }
    out
}

pub fn audio_kinds() -> (&'static str, &'static str) {
    if cfg!(windows) {
        ("wasapi_output_capture", "wasapi_input_capture")
    } else if cfg!(target_os = "macos") {
        ("coreaudio_output_capture", "coreaudio_input_capture")
    } else {
        ("pulse_output_capture", "pulse_input_capture")
    }
}

/// Best available H.264 encoder (hardware first), like OBS's auto-config.
pub fn best_video_encoder() -> String {
    let available: Vec<String> = unsafe { enum_ids(sys::obs_enum_encoder_types) };
    for pref in ["obs_nvenc_h264_tex", "jim_nvenc", "h264_texture_amf", "obs_qsv11_v2", "obs_qsv11", "com.apple.videotoolbox.videoencoder.ave.avc", "obs_x264"] {
        if available.iter().any(|a| a == pref) {
            return pref.to_string();
        }
    }
    "obs_x264".into()
}

fn read_services_json(engine: &Engine) -> Value {
    // Prefer the auto-updated copy in our module config dir, then the bundled one.
    let rt = super::runtime::runtime_dir();
    let candidates = [
        engine.data_dir.join("obs-config").join("plugin_config").join("rtmp-services").join("services.json"),
        rt.join("data").join("obs-plugins").join("rtmp-services").join("services.json"),
        // macOS: plugin data lives inside the .plugin bundle (Contents/PlugIns in Vexcast.app).
        rt.join("../PlugIns/rtmp-services.plugin/Contents/Resources/services.json"),
        rt.join("PlugIns/rtmp-services.plugin/Contents/Resources/services.json"),
        std::path::PathBuf::from("/usr/share/obs/obs-plugins/rtmp-services/services.json"),
    ];
    for c in candidates {
        if let Ok(t) = std::fs::read_to_string(&c) {
            if let Ok(v) = serde_json::from_str::<Value>(&t) {
                return v;
            }
        }
    }
    Value::Null
}

impl Engine {
    pub fn source_types(&self) -> anyhow::Result<Vec<SourceType>> {
        self.require_ready()?;
        let mut out: Vec<SourceType> = unsafe {
            enum_ids(sys::obs_enum_input_types)
                .iter()
                .filter(|id| {
                    let f = sys::obs_get_source_output_flags(cstr(id).as_ptr());
                    f & sys::OBS_SOURCE_CAP_DISABLED == 0 && f & sys::OBS_SOURCE_CAP_OBSOLETE == 0
                })
                .map(|id| type_info(id, "input"))
                .collect()
        };
        out.push(SourceType { id: "scene".into(), name: "Escena".into(), kind: "scene".into(), video: true, icon: "scene".into(), ..Default::default() });
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }

    pub fn filter_types(&self, source_uuid: Option<&str>) -> anyhow::Result<Vec<SourceType>> {
        self.require_ready()?;
        let parent_flags = source_uuid.and_then(Source::by_uuid).map(|s| unsafe { sys::obs_source_get_output_flags(s.ptr()) });
        let mut out: Vec<SourceType> = unsafe {
            enum_ids(sys::obs_enum_filter_types)
                .iter()
                .filter(|id| {
                    let f = sys::obs_get_source_output_flags(cstr(id).as_ptr());
                    if f & sys::OBS_SOURCE_CAP_DISABLED != 0 || f & sys::OBS_SOURCE_CAP_OBSOLETE != 0 || f & sys::OBS_SOURCE_DEPRECATED != 0 {
                        return false;
                    }
                    match parent_flags {
                        None => true,
                        Some(pf) => {
                            let video_ok = f & sys::OBS_SOURCE_VIDEO == 0 || pf & sys::OBS_SOURCE_VIDEO != 0;
                            let audio_ok = f & sys::OBS_SOURCE_AUDIO == 0 || pf & sys::OBS_SOURCE_AUDIO != 0;
                            // Like OBS: only async *video* filters need an async source.
                            let async_video = sys::OBS_SOURCE_ASYNC | sys::OBS_SOURCE_VIDEO;
                            let async_ok = f & async_video != async_video || pf & sys::OBS_SOURCE_ASYNC != 0;
                            video_ok && audio_ok && async_ok
                        }
                    }
                })
                .map(|id| type_info(id, "filter"))
                .collect()
        };
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }

    pub fn transition_types(&self) -> anyhow::Result<Vec<SourceType>> {
        self.require_ready()?;
        let mut out: Vec<SourceType> = unsafe { enum_ids(sys::obs_enum_transition_types).iter().map(|id| type_info(id, "transition")).collect() };
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }

    pub fn type_defaults(&self, kind: &str) -> anyhow::Result<Value> {
        self.require_ready()?;
        unsafe {
            let d = Data::own(sys::obs_get_source_defaults(cstr(kind).as_ptr()));
            Ok(d.to_json_with_defaults())
        }
    }

    pub fn encoders(&self) -> anyhow::Result<Vec<EncoderType>> {
        self.require_ready()?;
        let mut out = vec![];
        unsafe {
            for id in enum_ids(sys::obs_enum_encoder_types) {
                let c = cstr(&id);
                let caps = sys::obs_get_encoder_caps(c.as_ptr());
                if caps & sys::OBS_ENCODER_CAP_INTERNAL != 0 {
                    continue;
                }
                let kind = if sys::obs_get_encoder_type(c.as_ptr()) == sys::obs_encoder_type_OBS_ENCODER_VIDEO { "video" } else { "audio" };
                let lower = id.to_lowercase();
                let hardware = caps & sys::OBS_ENCODER_CAP_PASS_TEXTURE != 0
                    || ["nvenc", "qsv", "amf", "videotoolbox", "vaapi"].iter().any(|h| lower.contains(h));
                out.push(EncoderType {
                    name: string(sys::obs_encoder_get_display_name(c.as_ptr())),
                    codec: string(sys::obs_get_encoder_codec(c.as_ptr())),
                    kind: kind.into(),
                    hardware,
                    deprecated: caps & sys::OBS_ENCODER_CAP_DEPRECATED != 0,
                    id,
                });
            }
        }
        Ok(out)
    }

    pub fn encoder_properties(&self, id: &str, settings: &Value) -> anyhow::Result<Vec<Property>> {
        self.require_ready()?;
        unsafe {
            let c = cstr(id);
            let p = sys::obs_get_encoder_properties(c.as_ptr());
            if p.is_null() {
                anyhow::bail!("Codificador desconocido: {id}");
            }
            let defaults = Data::own(sys::obs_encoder_defaults(c.as_ptr()));
            defaults.apply_json(settings);
            props::apply_modified(p, defaults.ptr());
            let out = props::convert(p, &defaults.to_json_with_defaults());
            sys::obs_properties_destroy(p);
            Ok(out)
        }
    }

    pub fn services(&self) -> anyhow::Result<Vec<StreamService>> {
        let v = read_services_json(self);
        let mut out = vec![StreamService { name: "Custom".into(), servers: vec![], recommended: None, protocol: "RTMP".into() }];
        for s in v["services"].as_array().cloned().unwrap_or_default() {
            let name = s["name"].as_str().unwrap_or_default().to_string();
            if name.is_empty() {
                continue;
            }
            let servers: Vec<ServerEntry> = s["servers"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|x| Some(ServerEntry { name: x["name"].as_str()?.to_string(), url: x["url"].as_str()?.to_string() }))
                .collect();
            let first = servers.first().map(|x| x.url.to_lowercase()).unwrap_or_default();
            let protocol = s["protocol"].as_str().map(String::from).unwrap_or_else(|| {
                if first.starts_with("rtmps") {
                    "RTMPS".into()
                } else if first.starts_with("srt") {
                    "SRT".into()
                } else if first.starts_with("rist") {
                    "RIST".into()
                } else if first.starts_with("https") || first.starts_with("http") {
                    "WHIP".into()
                } else {
                    "RTMP".into()
                }
            });
            let r = &s["recommended"];
            let recommended = if r.is_object() {
                Some(Recommended { max_video_bitrate: r["max video bitrate"].as_i64(), max_audio_bitrate: r["max audio bitrate"].as_i64(), keyint: r["keyint"].as_i64() })
            } else {
                None
            };
            out.push(StreamService { name, servers, recommended, protocol });
        }
        Ok(out)
    }

    pub fn audio_devices(&self, kind: &str) -> anyhow::Result<Vec<AudioDevice>> {
        self.require_ready()?;
        let (out_kind, in_kind) = audio_kinds();
        let source_kind = if kind == "output" { out_kind } else { in_kind };
        let mut out = vec![];
        unsafe {
            let p = sys::obs_get_source_properties(cstr(source_kind).as_ptr());
            if p.is_null() {
                return Ok(out);
            }
            let prop = sys::obs_properties_get(p, cstr("device_id").as_ptr());
            if !prop.is_null() {
                for i in 0..sys::obs_property_list_item_count(prop) {
                    out.push(AudioDevice { id: string(sys::obs_property_list_item_string(prop, i)), name: string(sys::obs_property_list_item_name(prop, i)) });
                }
            }
            sys::obs_properties_destroy(p);
        }
        Ok(out)
    }

    pub fn monitoring_devices(&self) -> Vec<AudioDevice> {
        let mut out = vec![AudioDevice { id: "default".into(), name: "Predeterminado".into() }];
        if !self.is_ready() {
            return out;
        }
        unsafe extern "C" fn cb(data: *mut c_void, name: *const c_char, id: *const c_char) -> bool {
            let v = &mut *(data as *mut Vec<AudioDevice>);
            v.push(AudioDevice { id: string(id), name: string(name) });
            true
        }
        unsafe { sys::obs_enum_audio_monitoring_devices(Some(cb), &mut out as *mut _ as *mut c_void) };
        out
    }
}
