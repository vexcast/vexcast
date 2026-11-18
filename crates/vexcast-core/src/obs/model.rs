//! Rust mirror of `packages/protocol/src/obs.ts`. Always compiled (also without the `obs` feature).

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type Uuid = String;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
pub struct Crop {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListItem {
    pub name: String,
    pub value: Value,
    pub disabled: bool,
}

/// Generic OBS property (see protocol docs). Optional fields depend on `type`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Property {
    pub name: String,
    pub description: String,
    pub long_description: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub enabled: bool,
    pub visible: bool,
    pub value: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suffix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slider: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monospace: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub info_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub list_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<ListItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub editable_list_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub button_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<Vec<Property>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceType {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub video: bool,
    pub audio: bool,
    #[serde(rename = "async")]
    pub is_async: bool,
    pub interactive: bool,
    pub controllable_media: bool,
    pub deprecated: bool,
    pub icon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FilterInfo {
    pub uuid: Uuid,
    pub name: String,
    pub kind: String,
    pub kind_name: String,
    pub enabled: bool,
    pub settings: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub uuid: Uuid,
    pub name: String,
    pub kind: String,
    pub kind_name: String,
    pub base_kind: String,
    pub settings: Value,
    pub video: bool,
    pub audio: bool,
    #[serde(rename = "async")]
    pub is_async: bool,
    pub interactive: bool,
    pub controllable_media: bool,
    pub width: u32,
    pub height: u32,
    pub enabled: bool,
    pub volume: f64,
    pub volume_db: f64,
    pub muted: bool,
    pub monitoring: String,
    pub sync_offset_ms: i64,
    pub balance: f64,
    pub mixers: u32,
    pub force_mono: bool,
    pub push_to_mute: bool,
    pub push_to_mute_delay_ms: u64,
    pub push_to_talk: bool,
    pub push_to_talk_delay_ms: u64,
    pub filters: Vec<FilterInfo>,
    pub global_slot: Option<String>,
    pub media_state: Option<String>,
    pub refs: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ItemTransition {
    pub kind: Option<String>,
    pub duration_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SceneItem {
    pub id: i64,
    pub source_uuid: Uuid,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub pos: Vec2,
    pub rot: f64,
    pub scale: Vec2,
    pub alignment: u32,
    pub bounds_type: String,
    pub bounds_alignment: u32,
    pub bounds: Vec2,
    pub crop_to_bounds: bool,
    pub crop: Crop,
    pub blend_mode: String,
    pub blend_method: String,
    pub scale_filter: String,
    pub source_width: u32,
    pub source_height: u32,
    pub is_group: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<SceneItem>>,
    pub show_transition: ItemTransition,
    pub hide_transition: ItemTransition,
}

/// Partial update for a scene item (all optional).
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SceneItemPatch {
    pub visible: Option<bool>,
    pub locked: Option<bool>,
    pub pos: Option<Vec2>,
    pub rot: Option<f64>,
    pub scale: Option<Vec2>,
    pub alignment: Option<u32>,
    pub bounds_type: Option<String>,
    pub bounds_alignment: Option<u32>,
    pub bounds: Option<Vec2>,
    pub crop_to_bounds: Option<bool>,
    pub crop: Option<Crop>,
    pub blend_mode: Option<String>,
    pub blend_method: Option<String>,
    pub scale_filter: Option<String>,
    pub show_transition: Option<ItemTransition>,
    pub hide_transition: Option<ItemTransition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SceneInfo {
    pub uuid: Uuid,
    pub name: String,
    pub items: Vec<SceneItem>,
    pub filters: Vec<FilterInfo>,
    pub vertical_scene_uuid: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransitionInfo {
    pub uuid: Uuid,
    pub name: String,
    pub kind: String,
    pub kind_name: String,
    pub fixed: bool,
    pub settings: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SceneCollection {
    pub name: String,
    pub current: bool,
}

// ---------------------------------------------------------------- settings

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct VideoSettings {
    pub base_width: u32,
    pub base_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub fps_num: u32,
    pub fps_den: u32,
    pub downscale_filter: String,
    pub color_format: String,
    pub color_space: String,
    pub color_range: String,
    pub sdr_white_level: u32,
    pub hdr_nominal_peak_level: u32,
    pub vertical_enabled: bool,
    pub vertical_width: u32,
    pub vertical_height: u32,
}

impl Default for VideoSettings {
    fn default() -> Self {
        Self {
            base_width: 1920,
            base_height: 1080,
            output_width: 1920,
            output_height: 1080,
            fps_num: 60,
            fps_den: 1,
            downscale_filter: "lanczos".into(),
            color_format: "NV12".into(),
            color_space: "709".into(),
            color_range: "partial".into(),
            sdr_white_level: 300,
            hdr_nominal_peak_level: 1000,
            vertical_enabled: false,
            vertical_width: 1080,
            vertical_height: 1920,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AudioSettings {
    pub sample_rate: u32,
    pub channels: String,
    pub desktop1: String,
    pub desktop2: String,
    pub mic1: String,
    pub mic2: String,
    pub mic3: String,
    pub mic4: String,
    pub monitoring_device_id: String,
    pub monitoring_device_name: String,
    pub meter_decay_rate: String,
    pub peak_meter_type: String,
    pub low_latency_buffering: bool,
    pub track_names: Vec<String>,
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            sample_rate: 48000,
            channels: "stereo".into(),
            desktop1: "default".into(),
            desktop2: "disabled".into(),
            mic1: "default".into(),
            mic2: "disabled".into(),
            mic3: "disabled".into(),
            mic4: "disabled".into(),
            monitoring_device_id: "default".into(),
            monitoring_device_name: "Default".into(),
            meter_decay_rate: "fast".into(),
            peak_meter_type: "sample".into(),
            low_latency_buffering: false,
            track_names: (1..=6).map(|i| format!("Pista {i}")).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EncoderType {
    pub id: String,
    pub name: String,
    pub codec: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub hardware: bool,
    pub deprecated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Rescale {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SplitFile {
    pub mode: String,
    pub minutes: u32,
    pub megabytes: u32,
}

impl Default for SplitFile {
    fn default() -> Self {
        Self { mode: "off".into(), minutes: 15, megabytes: 2048 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct OutputSettings {
    pub mode: String,
    pub stream_encoder: String,
    pub stream_encoder_settings: Value,
    pub stream_audio_encoder: String,
    pub stream_audio_bitrate: u32,
    pub stream_audio_track: u32,
    pub recording_path: String,
    pub recording_format: String,
    pub recording_filename_format: String,
    pub recording_encoder: String,
    pub recording_encoder_settings: Value,
    pub recording_tracks: u32,
    pub recording_rescale: Option<Rescale>,
    pub overwrite_if_exists: bool,
    pub auto_remux: bool,
    pub split_file: SplitFile,
    pub replay_buffer_enabled: bool,
    pub replay_buffer_seconds: u32,
    pub replay_buffer_max_mb: u32,
    pub reconnect: bool,
    pub reconnect_retry_delay_sec: u32,
    pub reconnect_max_retries: u32,
    pub stream_delay_sec: u32,
    pub stream_delay_preserve: bool,
    pub bind_ip: String,
    pub dynamic_bitrate: bool,
    pub low_latency_mode: bool,
}

impl Default for OutputSettings {
    fn default() -> Self {
        Self {
            mode: "simple".into(),
            stream_encoder: String::new(), // chosen at startup (best hardware encoder)
            stream_encoder_settings: serde_json::json!({ "rate_control": "CBR", "bitrate": 6000, "keyint_sec": 2 }),
            stream_audio_encoder: "ffmpeg_aac".into(),
            stream_audio_bitrate: 160,
            stream_audio_track: 1,
            recording_path: String::new(),
            recording_format: "hybrid_mp4".into(),
            recording_filename_format: "%CCYY-%MM-%DD %hh-%mm-%ss".into(),
            recording_encoder: String::new(),
            recording_encoder_settings: serde_json::json!({}),
            recording_tracks: 1,
            recording_rescale: None,
            overwrite_if_exists: false,
            auto_remux: true,
            split_file: SplitFile::default(),
            replay_buffer_enabled: false,
            replay_buffer_seconds: 30,
            replay_buffer_max_mb: 512,
            reconnect: true,
            reconnect_retry_delay_sec: 2,
            reconnect_max_retries: 25,
            stream_delay_sec: 0,
            stream_delay_preserve: true,
            bind_ip: "default".into(),
            dynamic_bitrate: false,
            low_latency_mode: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerEntry {
    pub name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Recommended {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_video_bitrate: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_audio_bitrate: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyint: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamService {
    pub name: String,
    pub servers: Vec<ServerEntry>,
    pub recommended: Option<Recommended>,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AdvancedSettings {
    pub process_priority: String,
    pub renderer: String,
    pub browser_hw_accel: bool,
    pub hotkey_focus_behavior: String,
    pub auto_remux: bool,
    pub confirm_on_exit: bool,
}

impl Default for AdvancedSettings {
    fn default() -> Self {
        Self {
            process_priority: "normal".into(),
            renderer: if cfg!(windows) { "d3d11" } else if cfg!(target_os = "macos") { "metal" } else { "opengl" }.into(),
            browser_hw_accel: true,
            hotkey_focus_behavior: "never".into(),
            auto_remux: true,
            confirm_on_exit: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HotkeyBinding {
    pub key: String,
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub command: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Hotkey {
    pub id: u64,
    pub name: String,
    pub description: String,
    pub owner: String,
    pub bindings: Vec<HotkeyBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EncoderOverride {
    pub encoder: String,
    pub settings: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    #[serde(default)]
    pub id: Uuid,
    pub name: String,
    pub service: String,
    #[serde(default)]
    pub server: String,
    #[serde(default)]
    pub stream_key: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default = "horizontal")]
    pub canvas: String,
    #[serde(default)]
    pub encoder_override: Option<EncoderOverride>,
}

fn yes() -> bool {
    true
}
fn horizontal() -> String {
    "horizontal".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OutputStatus {
    pub id: String,
    pub state: String,
    pub kbps: f64,
    pub total_bytes: u64,
    pub dropped_frames: i64,
    pub total_frames: i64,
    pub congestion: f64,
    pub duration_ms: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub fps: f64,
    pub target_fps: f64,
    pub cpu: f64,
    pub memory_mb: f64,
    pub disk_free_gb: Option<f64>,
    pub average_render_ms: f64,
    pub render_skipped: u64,
    pub render_total: u64,
    pub encoding_skipped: u64,
    pub encoding_total: u64,
    pub outputs: Vec<OutputStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineStatus {
    pub ready: bool,
    pub obs_version: Option<String>,
    pub error: Option<String>,
    pub streaming: bool,
    pub stream_started_at: Option<i64>,
    pub recording: bool,
    pub recording_paused: bool,
    pub recording_started_at: Option<i64>,
    pub last_recording_path: Option<String>,
    pub replay_buffer_active: bool,
    pub virtual_cam_active: bool,
    pub studio_mode: bool,
    /// Rehearsal: streaming to Twitch without publishing (bandwidth test mode).
    pub rehearsal: bool,
    pub server_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AudioLevel {
    pub source_uuid: Uuid,
    pub magnitude: Vec<f32>,
    pub peak: Vec<f32>,
    pub input_peak: Vec<f32>,
}

/// Engine part of the app state (scenes, sources, transitions, collections).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineSnapshot {
    pub scene_collection: String,
    pub scene_collections: Vec<SceneCollection>,
    pub scenes: Vec<SceneInfo>,
    pub vertical_scenes: Vec<SceneInfo>,
    pub sources: Vec<SourceInfo>,
    pub program_scene_uuid: Option<Uuid>,
    pub preview_scene_uuid: Option<Uuid>,
    pub transitions: Vec<TransitionInfo>,
    pub current_transition_uuid: Option<Uuid>,
    pub transition_duration_ms: u32,
}
