//! Data model shared with every client. Mirrors `packages/protocol/src/types.ts`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub type Id = String;

pub fn new_id() -> Id {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------- chat

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ChatPlatform {
    Twitch,
    Youtube,
    Kick,
    Tiktok,
    Vexcast,
    Kofi,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChatBadge {
    pub id: String,
    pub label: String,
    /// Badge picture from the platform (Twitch global/channel badges, Kick subscriber badges).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatUser {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub badges: Vec<ChatBadge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: Id,
    pub platform: ChatPlatform,
    pub channel: String,
    pub user: ChatUser,
    pub text: String,
    pub ts: i64,
    pub is_bot: bool,
    pub flagged: bool,
    /// What's notable about the author (first time, back after a while…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewer: Option<ViewerTag>,
    /// Asks something (questions queue).
    #[serde(default)]
    pub question: bool,
    /// Translation to the streamer's language, when it was in another one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translated: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ViewerTag {
    /// Never wrote in this channel before.
    pub first_time: bool,
    /// First message since Vexcast started, after earlier visits.
    pub returning: bool,
    /// Messages written so far (all streams).
    pub messages: u32,
    /// Days since the previous visit (when returning after at least a day).
    pub days_away: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum AlertType {
    Follow,
    Subscription,
    GiftSub,
    Raid,
    Bits,
    Superchat,
    Donation,
    Kofi,
    Member,
    Host,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlertEvent {
    pub id: Id,
    #[serde(rename = "type")]
    pub kind: AlertType,
    pub platform: ChatPlatform,
    pub user: String,
    pub amount: Option<f64>,
    pub currency: Option<String>,
    pub message: Option<String>,
    pub ts: i64,
    pub tts_url: Option<String>,
    pub test: bool,
    /// Id of the user-made design picked for this alert (see AlertBoxSettings::designs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub design: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnState {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatConnection {
    pub platform: ChatPlatform,
    #[serde(default)]
    pub channel: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub token: String,
    #[serde(default = "disconnected")]
    pub state: ConnState,
    #[serde(default)]
    pub error: Option<String>,
}

fn disconnected() -> ConnState {
    ConnState::Disconnected
}

// ---------------------------------------------------------------- widgets

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertBoxSettings {
    pub enabled: bool,
    pub duration_ms: u32,
    pub templates: BTreeMap<AlertType, String>,
    pub sound_url: Option<String>,
    pub sound_volume: f64,
    pub tts_enabled: bool,
    pub tts_min_amount: f64,
    pub animation: String,
    pub accent_color: String,
    /// Per-type look and behaviour (Streamlabs-style alert variations). Missing
    /// types use the global settings above.
    pub variations: BTreeMap<AlertType, AlertVariation>,
    /// User-made alerts (StreamElements-style designer). When one matches an event it
    /// replaces the built-in look entirely.
    pub designs: Vec<AlertDesign>,
    /// Alert groups: one browser source (alerts.html?group=<id>) that shows several alerts.
    pub groups: Vec<AlertGroup>,
    /// Pause between two alerts (ms).
    pub gap_ms: u32,
    /// Alerts waiting at most (older ones are dropped when exceeded; 0 = no limit).
    pub max_queue: u32,
    /// Words hidden (***) in alert messages and in what TTS reads; case-insensitive.
    pub blocked_words: Vec<String>,
    /// Remove links from alert messages.
    pub strip_links: bool,
    /// Longest message shown / read (characters, 0 = no limit).
    pub max_message_length: u32,
    /// Ignore a second follow from the same viewer within this many minutes (0 = never).
    pub repeat_follow_minutes: u32,
}

/// Several alert designs shown by a single browser source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertGroup {
    pub id: String,
    pub name: String,
    /// Design ids.
    pub designs: Vec<String>,
    /// Size of the browser source (the alerts are scaled to fit it).
    pub width: u32,
    pub height: u32,
}

impl Default for AlertGroup {
    fn default() -> Self {
        Self { id: new_id(), name: "Grupo de alertas".into(), designs: vec![], width: 1920, height: 1080 }
    }
}

/// A user-made alert: layers on a canvas, shown for one alert type when its condition matches.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertDesign {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: AlertType,
    pub enabled: bool,
    /// Shown when min ≤ amount (≤ max, if max > 0). Events without amount count as 0.
    pub min_amount: f64,
    pub max_amount: f64,
    /// Among matching designs the highest priority wins; ties are picked at random by weight.
    pub priority: i32,
    pub weight: f64,
    /// Canvas size (the browser source is scaled to fit it).
    pub width: u32,
    pub height: u32,
    pub duration_ms: u32,
    /// Sound (path or URL). Empty: the audio of the first unmuted video layer, if any.
    pub sound: String,
    pub sound_volume: f64,
    /// "default" (alert box setting), "on", "off".
    pub tts: String,
    pub layers: Vec<AlertLayer>,
    /// Custom code mode: HTML/CSS/JS rendered instead of the layers.
    pub custom_enabled: bool,
    pub custom_html: String,
    pub custom_css: String,
    pub custom_js: String,
    /// Shown only by its own browser source ("alerts.html?design=<id>"), not by the general alert box.
    pub own_source: bool,
}

impl Default for AlertDesign {
    fn default() -> Self {
        Self {
            id: new_id(),
            name: "Alerta".into(),
            kind: AlertType::Follow,
            enabled: true,
            min_amount: 0.0,
            max_amount: 0.0,
            priority: 0,
            weight: 1.0,
            width: 1920,
            height: 1080,
            duration_ms: 8000,
            sound: String::new(),
            sound_volume: 0.8,
            tts: "default".into(),
            layers: vec![],
            custom_enabled: false,
            custom_html: String::new(),
            custom_css: String::new(),
            custom_js: String::new(),
            own_source: false,
        }
    }
}

/// Default {user}/{amount} sentence for an alert type (Spanish, like the built-in templates).
pub fn default_alert_text(kind: AlertType) -> &'static str {
    match kind {
        AlertType::Follow => "¡{user} te sigue!",
        AlertType::Subscription => "¡{user} se suscribió!",
        AlertType::GiftSub => "¡{user} regaló {amount} subs!",
        AlertType::Raid => "¡Raid de {user} con {amount}!",
        AlertType::Bits => "¡{user} envió {amount} bits!",
        AlertType::Superchat => "¡Superchat de {user}: {amount}!",
        AlertType::Donation => "¡{user} donó {amount}!",
        AlertType::Kofi => "¡{user} invitó {amount} en Ko-fi!",
        AlertType::Member => "¡{user} ahora es miembro!",
        AlertType::Host => "¡{user} te hostea!",
    }
}

/// Alert design for a theme pack's alert video: the video fills the canvas (its banner is
/// centered) and the text sits inside the banner, with the viewer's message below.
pub fn theme_alert_design(theme: &str, kind: AlertType, video: &str) -> AlertDesign {
    let video = AlertLayer { name: "Vídeo".into(), kind: "video".into(), src: video.into(), x: 0.0, y: 0.0, w: 1920.0, h: 1080.0, anim_in: "none".into(), anim_out: "fadeOut".into(), ..Default::default() };
    let title = AlertLayer {
        name: "Título".into(),
        kind: "text".into(),
        text: default_alert_text(kind).into(),
        x: 560.0,
        y: 470.0,
        w: 800.0,
        h: 110.0,
        font_family: "Orbitron".into(),
        font_size: 52.0,
        highlight: "#5ce1e6".into(),
        anim_in: "zoomIn".into(),
        anim_in_delay: 350,
        ..Default::default()
    };
    let message = AlertLayer {
        name: "Mensaje".into(),
        kind: "text".into(),
        text: "{message}".into(),
        show_when: "message".into(),
        x: 460.0,
        y: 700.0,
        w: 1000.0,
        h: 120.0,
        font_size: 36.0,
        font_weight: 600,
        anim_in: "slideUp".into(),
        anim_in_delay: 700,
        ..Default::default()
    };
    AlertDesign { name: format!("{theme} · {}", alert_type_label(kind)), kind, duration_ms: 8000, layers: vec![video, title, message], ..Default::default() }
}

/// Old per-type "variations" with custom media become alert designs (editable in the
/// designer) and the variation is reset, so there is only one way to customize alerts.
pub fn migrate_alert_variations(ab: &mut AlertBoxSettings) {
    let kinds: Vec<AlertType> = ab.variations.iter().filter(|(_, v)| !v.media.trim().is_empty()).map(|(k, _)| *k).collect();
    for kind in kinds {
        let v = ab.variations.get(&kind).cloned().unwrap_or_default();
        if !v.media.trim().is_empty() && !ab.designs.iter().any(|d| d.kind == kind) {
            let text = ab.templates.get(&kind).cloned().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| default_alert_text(kind).to_string());
            let is_video = crate::alerts::is_video(&v.media);
            let mut d = if is_video && v.layout == "background" {
                // Theme alert video: full canvas with the text inside its banner.
                let mut d = theme_alert_design("Tema", kind, &v.media);
                d.name = alert_type_label(kind).to_string();
                d
            } else {
                let media = AlertLayer { name: "Imagen".into(), kind: if is_video { "video".into() } else { "image".into() }, src: v.media.clone(), x: 660.0, y: 120.0, w: 600.0, h: 420.0, anim_in: "bounceIn".into(), ..Default::default() };
                let title = AlertLayer { name: "Título".into(), kind: "text".into(), text: text.clone(), x: 260.0, y: 580.0, w: 1400.0, h: 130.0, font_size: 68.0, anim_in: "pop".into(), anim_in_delay: 250, ..Default::default() };
                let msg = AlertLayer { name: "Mensaje".into(), kind: "text".into(), text: "{message}".into(), show_when: "message".into(), x: 460.0, y: 730.0, w: 1000.0, h: 110.0, font_size: 36.0, font_weight: 600, anim_in: "slideUp".into(), anim_in_delay: 500, ..Default::default() };
                AlertDesign { name: alert_type_label(kind).into(), kind, layers: vec![media, title, msg], ..Default::default() }
            };
            if let Some(t) = d.layers.iter_mut().find(|l| l.name == "Título") {
                t.text = text;
            }
            if !v.sound.trim().is_empty() {
                d.sound = v.sound.clone();
            }
            if v.sound_volume >= 0.0 {
                d.sound_volume = v.sound_volume;
            }
            if v.duration_ms > 0 {
                d.duration_ms = v.duration_ms;
            }
            d.min_amount = v.min_amount;
            d.enabled = v.enabled;
            ab.designs.push(d);
        }
        ab.variations.insert(kind, AlertVariation::default());
    }
}

/// Spanish name of an alert type (design names).
pub fn alert_type_label(kind: AlertType) -> &'static str {
    match kind {
        AlertType::Follow => "Seguidor",
        AlertType::Subscription => "Suscripción",
        AlertType::GiftSub => "Sub regalada",
        AlertType::Raid => "Raid",
        AlertType::Bits => "Bits",
        AlertType::Superchat => "Super Chat",
        AlertType::Donation => "Donación",
        AlertType::Kofi => "Ko-fi",
        AlertType::Member => "Miembro",
        AlertType::Host => "Host",
    }
}

/// One element of an alert design. A single struct for every kind keeps the format flat
/// and easy to edit; fields that don't apply to a kind are ignored.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertLayer {
    pub id: String,
    pub name: String,
    /// "text" | "image" | "video" | "shape" | "particles" | "progress"
    pub kind: String,
    pub visible: bool,
    pub locked: bool,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rotation: f64,
    pub opacity: f64,
    /// "always" | "message" (only with a viewer message) | "amount" (only with an amount)
    pub show_when: String,
    // text
    pub text: String,
    pub font_family: String,
    pub font_size: f64,
    pub font_weight: u32,
    pub italic: bool,
    pub uppercase: bool,
    pub color: String,
    /// Color of {user} / {amount} inside the text.
    pub highlight: String,
    pub align: String,
    pub valign: String,
    pub line_height: f64,
    pub letter_spacing: f64,
    pub stroke_color: String,
    pub stroke_width: f64,
    pub shadow_color: String,
    pub shadow_blur: f64,
    pub shadow_x: f64,
    pub shadow_y: f64,
    // image / video
    pub src: String,
    /// "contain" | "cover" | "fill"
    pub fit: String,
    pub loop_media: bool,
    pub muted: bool,
    // shape
    pub fill: String,
    pub border_color: String,
    pub border_width: f64,
    pub radius: f64,
    // animation
    pub anim_in: String,
    pub anim_in_ms: u32,
    pub anim_in_delay: u32,
    pub anim_out: String,
    pub anim_out_ms: u32,
    pub anim_loop: String,
    /// Per-letter text loop: none | wave | bounce | jelly | rainbow | flicker | shake
    pub text_effect: String,
    // particles
    /// confetti | sparkles | hearts | stars | snow | bubbles | emoji
    pub particle_type: String,
    /// burst | fountain | rain
    pub particle_mode: String,
    /// Emojis used by the "emoji" type.
    pub particle_emoji: String,
    pub particle_count: u32,
    pub particle_size: f64,
    pub particle_speed: f64,
    /// Comma-separated colors ("" = festive palette).
    pub particle_colors: String,
    /// How long fountain / rain keep emitting (0 = the whole alert).
    pub particle_duration_ms: u32,
    // progress bar (goal designs)
    pub bar_color2: String,
    pub track_color: String,
    pub bar_stripes: bool,
    pub bar_glow: bool,
    pub bar_vertical: bool,
}

impl Default for AlertLayer {
    fn default() -> Self {
        Self {
            id: new_id(),
            name: String::new(),
            kind: "text".into(),
            visible: true,
            locked: false,
            x: 0.0,
            y: 0.0,
            w: 400.0,
            h: 120.0,
            rotation: 0.0,
            opacity: 1.0,
            show_when: "always".into(),
            text: String::new(),
            font_family: "Inter".into(),
            font_size: 64.0,
            font_weight: 800,
            italic: false,
            uppercase: false,
            color: "#ffffff".into(),
            highlight: "#a78bfa".into(),
            align: "center".into(),
            valign: "middle".into(),
            line_height: 1.15,
            letter_spacing: 0.0,
            stroke_color: String::new(),
            stroke_width: 0.0,
            shadow_color: "rgba(0,0,0,0.6)".into(),
            shadow_blur: 8.0,
            shadow_x: 0.0,
            shadow_y: 3.0,
            src: String::new(),
            fit: "contain".into(),
            loop_media: false,
            muted: false,
            fill: "#7c5cff".into(),
            border_color: String::new(),
            border_width: 0.0,
            radius: 16.0,
            anim_in: "fadeIn".into(),
            anim_in_ms: 600,
            anim_in_delay: 0,
            anim_out: "fadeOut".into(),
            anim_out_ms: 500,
            anim_loop: "none".into(),
            text_effect: "none".into(),
            particle_type: "confetti".into(),
            particle_mode: "burst".into(),
            particle_emoji: "🎉✨".into(),
            particle_count: 120,
            particle_size: 18.0,
            particle_speed: 1.0,
            particle_colors: String::new(),
            particle_duration_ms: 0,
            bar_color2: "#22d3ee".into(),
            track_color: "rgba(255,255,255,0.12)".into(),
            bar_stripes: true,
            bar_glow: true,
            bar_vertical: false,
        }
    }
}

/// How one alert type looks and sounds. Empty strings / zeros mean "use the global setting".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AlertVariation {
    pub enabled: bool,
    /// Only show it when the amount (bits, money, raid viewers, months…) is at least this.
    pub min_amount: f64,
    /// Image / GIF / video (path in the data folder or URL). Empty: the animated emblem.
    pub media: String,
    /// "above" (media over the text), "side" (media left of the text), "background" (text over the media).
    pub layout: String,
    pub media_scale: f64,
    /// Sound (path or URL). Empty: the global sound; for a video without its own sound, the video's audio.
    pub sound: String,
    /// 0..1; negative: the global volume.
    pub sound_volume: f64,
    pub duration_ms: u32,
    pub animation: String,
    pub font_family: String,
    /// Title size in percent of the default (100 = default).
    pub font_size: f64,
    pub text_color: String,
    pub highlight_color: String,
    pub show_message: bool,
    /// "default" (global), "on", "off".
    pub tts: String,
}

impl Default for AlertVariation {
    fn default() -> Self {
        Self {
            enabled: true,
            min_amount: 0.0,
            media: String::new(),
            layout: "above".into(),
            media_scale: 1.0,
            sound: String::new(),
            sound_volume: -1.0,
            duration_ms: 0,
            animation: String::new(),
            font_family: String::new(),
            font_size: 100.0,
            text_color: String::new(),
            highlight_color: String::new(),
            show_message: true,
            tts: "default".into(),
        }
    }
}

impl Default for AlertBoxSettings {
    fn default() -> Self {
        let mut templates = BTreeMap::new();
        templates.insert(AlertType::Follow, "¡{user} te sigue!".to_string());
        templates.insert(AlertType::Subscription, "¡{user} se suscribió!".to_string());
        templates.insert(AlertType::GiftSub, "¡{user} regaló {amount} subs!".to_string());
        templates.insert(AlertType::Raid, "¡Raid de {user} con {amount} espectadores!".to_string());
        templates.insert(AlertType::Bits, "¡{user} envió {amount} bits!".to_string());
        templates.insert(AlertType::Superchat, "¡Superchat de {user}: {amount}!".to_string());
        templates.insert(AlertType::Donation, "¡{user} donó {amount}!".to_string());
        templates.insert(AlertType::Kofi, "¡{user} invitó {amount} en Ko-fi!".to_string());
        templates.insert(AlertType::Member, "¡{user} ahora es miembro!".to_string());
        Self {
            enabled: true,
            duration_ms: 7000,
            templates,
            sound_url: None,
            sound_volume: 0.7,
            tts_enabled: true,
            tts_min_amount: 0.0,
            animation: "pop".into(),
            accent_color: "#8B5CF6".into(),
            variations: BTreeMap::new(),
            designs: vec![],
            groups: vec![],
            gap_ms: 400,
            max_queue: 0,
            blocked_words: vec![],
            strip_links: true,
            max_message_length: 250,
            repeat_follow_minutes: 60,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatBoxSettings {
    pub max_messages: u32,
    pub fade_after_sec: u32,
    pub show_platform_icons: bool,
    pub show_badges: bool,
    pub font_size: u32,
    /// glass | solid | minimal | bubble | neon
    pub theme: String,
    /// Google font or system font ("" = default).
    pub font_family: String,
    pub text_color: String,
    /// "user" (each viewer's color) | "custom" (`name_color` for everyone)
    pub name_color_mode: String,
    pub name_color: String,
    pub bg_color: String,
    pub bg_opacity: f64,
    /// Corner radius (em).
    pub radius: f64,
    /// Space between messages (em).
    pub spacing: f64,
    /// slide | fade | pop | none
    pub animation: String,
    /// "up": newest at the bottom · "down": newest at the top
    pub direction: String,
    /// left | right
    pub align: String,
    pub hide_commands: bool,
    pub hide_bots: bool,
    /// Viewers whose messages are never shown (bots, trolls…), case-insensitive.
    pub hidden_users: Vec<String>,
    pub show_time: bool,
    /// "Nuevo" tag for first-time chatters.
    pub show_new_badge: bool,
}

impl Default for ChatBoxSettings {
    fn default() -> Self {
        Self {
            max_messages: 30,
            fade_after_sec: 0,
            show_platform_icons: true,
            show_badges: true,
            font_size: 18,
            theme: "glass".into(),
            font_family: String::new(),
            text_color: "#ffffff".into(),
            name_color_mode: "user".into(),
            name_color: "#9b87ff".into(),
            bg_color: "#16161f".into(),
            bg_opacity: 0.72,
            radius: 0.8,
            spacing: 0.42,
            animation: "slide".into(),
            direction: "up".into(),
            align: "left".into(),
            hide_commands: false,
            hide_bots: false,
            hidden_users: vec![],
            show_time: false,
            show_new_badge: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GoalSettings {
    pub title: String,
    pub current: f64,
    pub target: f64,
    pub currency: String,
    pub auto_track: bool,
    /// glass | solid | minimal | neon
    pub style: String,
    /// Bar gradient.
    pub color: String,
    pub color2: String,
    pub text_color: String,
    pub font_family: String,
    pub bg_opacity: f64,
    /// Bar thickness (em).
    pub bar_height: f64,
    pub rounded: bool,
    pub stripes: bool,
    pub show_icon: bool,
    pub show_amounts: bool,
    pub show_percent: bool,
    /// Confetti and badge when the goal is reached.
    pub celebrate: bool,
    /// Badge text when reached ("" = default).
    pub reached_text: String,
    /// Use the layer editor design instead of the classic look.
    pub design_enabled: bool,
    pub design: Option<AlertDesign>,
}

impl Default for GoalSettings {
    fn default() -> Self {
        Self {
            title: "Meta del stream".into(),
            current: 0.0,
            target: 100.0,
            currency: "USD".into(),
            auto_track: true,
            style: "glass".into(),
            color: "#7c5cff".into(),
            color2: "#22d3ee".into(),
            text_color: "#ffffff".into(),
            font_family: String::new(),
            bg_opacity: 0.75,
            bar_height: 2.1,
            rounded: true,
            stripes: true,
            show_icon: true,
            show_amounts: true,
            show_percent: true,
            celebrate: true,
            reached_text: String::new(),
            design_enabled: false,
            design: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptionsSettings {
    pub enabled: bool,
    pub translate_to: String,
    pub font_size: u32,
    /// bottom | top | center
    pub position: String,
    /// box | outline | banner
    pub theme: String,
    pub font_family: String,
    pub text_color: String,
    /// Translation and cursor color.
    pub accent_color: String,
    pub bg_color: String,
    pub bg_opacity: f64,
    pub max_lines: u32,
    /// Seconds without speech before hiding.
    pub hide_after_sec: f64,
    /// Keep the previous sentence in small above the current one.
    pub show_previous: bool,
    pub uppercase: bool,
}

impl Default for CaptionsSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            translate_to: String::new(),
            font_size: 36,
            position: "bottom".into(),
            theme: "box".into(),
            font_family: String::new(),
            text_color: "#ffffff".into(),
            accent_color: "#5ce1e6".into(),
            bg_color: "#08080e".into(),
            bg_opacity: 0.72,
            max_lines: 3,
            hide_after_sec: 4.0,
            show_previous: true,
            uppercase: false,
        }
    }
}

/// Recent events list / ticker overlay.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct EventListSettings {
    /// list | ticker
    pub layout: String,
    pub max_events: u32,
    pub show_title: bool,
    /// "" = "Eventos recientes"
    pub title_text: String,
    pub font_size: u32,
    pub font_family: String,
    pub text_color: String,
    /// glass | solid | minimal
    pub theme: String,
    pub bg_color: String,
    pub bg_opacity: f64,
    /// Corner radius (em).
    pub radius: f64,
    /// Header dot / ticker label gradient.
    pub color: String,
    pub color2: String,
    pub show_time: bool,
    pub show_icons: bool,
    pub show_platform: bool,
    /// Older events fade out a little.
    pub fade_old: bool,
    /// Alert types shown ([] = all).
    pub types: Vec<String>,
    /// Ticker speed (px per second).
    pub speed: f64,
    /// Load the latest events when the overlay (re)loads.
    pub keep_history: bool,
}

impl Default for EventListSettings {
    fn default() -> Self {
        Self {
            layout: "list".into(),
            max_events: 10,
            show_title: true,
            title_text: String::new(),
            font_size: 18,
            font_family: String::new(),
            text_color: "#ffffff".into(),
            theme: "glass".into(),
            bg_color: "#1a1828".into(),
            bg_opacity: 0.7,
            radius: 0.8,
            color: "#7c5cff".into(),
            color2: "#22d3ee".into(),
            show_time: true,
            show_icons: true,
            show_platform: true,
            fade_old: true,
            types: vec![],
            speed: 90.0,
            keep_history: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetSettings {
    pub alert_box: AlertBoxSettings,
    pub chat_box: ChatBoxSettings,
    pub goal: GoalSettings,
    /// Follower, subscriber and bits goals (goal.html?type=followers|subs|bits); `goal` is the donation one.
    pub goals: BTreeMap<String, GoalSettings>,
    pub captions: CaptionsSettings,
    pub events: EventListSettings,
    pub highlight: HighlightSettings,
    pub labels: LabelSettings,
    pub poll: PollSettings,
    pub giveaway: GiveawaySettings,
    pub songs: SongsWidgetSettings,
    pub credits: CreditsSettings,
}

/// End-of-stream credits (credits.html).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CreditsSettings {
    pub title: String,
    pub subtitle: String,
    /// Shown at the end ("" = none).
    pub outro: String,
    /// Scroll speed (px per second).
    pub speed: u32,
    /// Start again after the end.
    pub repeat: bool,
    pub font_family: String,
    pub font_size: u32,
    pub text_color: String,
    pub accent_color: String,
    /// Behind the text (transparent by default).
    pub bg_color: String,
    pub bg_opacity: f64,
    /// Sections in order: follows, subs, gifts, bits, donations, raids, chatters.
    pub sections: Vec<String>,
    pub show_amounts: bool,
}

impl Default for CreditsSettings {
    fn default() -> Self {
        Self {
            title: "¡Gracias por ver el directo!".into(),
            subtitle: String::new(),
            outro: "¡Nos vemos en el próximo!".into(),
            speed: 60,
            repeat: true,
            font_family: String::new(),
            font_size: 34,
            text_color: "#ffffff".into(),
            accent_color: "#a78bfa".into(),
            bg_color: "#0b0b12".into(),
            bg_opacity: 0.0,
            sections: ["donations", "subs", "gifts", "bits", "follows", "raids", "chatters"].iter().map(|s| s.to_string()).collect(),
            show_amounts: true,
        }
    }
}

/// Look of the song requests player card (songs.html).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SongsWidgetSettings {
    pub show_card: bool,
    /// Show the YouTube video (else audio only).
    pub show_video: bool,
    /// glass | solid | neon | minimal
    pub theme: String,
    pub font_family: String,
    pub font_size: u32,
    pub text_color: String,
    pub accent_color: String,
    pub bg_color: String,
    pub bg_opacity: f64,
}

impl Default for SongsWidgetSettings {
    fn default() -> Self {
        Self {
            show_card: true,
            show_video: false,
            theme: "glass".into(),
            font_family: String::new(),
            font_size: 24,
            text_color: "#ffffff".into(),
            accent_color: "#22d3ee".into(),
            bg_color: "#14121f".into(),
            bg_opacity: 0.85,
        }
    }
}

/// Look of the giveaway overlay (giveaway.html).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GiveawaySettings {
    /// glass | solid | neon | minimal
    pub theme: String,
    pub font_family: String,
    pub font_size: u32,
    pub text_color: String,
    pub accent_color: String,
    pub bg_color: String,
    pub bg_opacity: f64,
    pub confetti: bool,
}

impl Default for GiveawaySettings {
    fn default() -> Self {
        Self {
            theme: "glass".into(),
            font_family: String::new(),
            font_size: 28,
            text_color: "#ffffff".into(),
            accent_color: "#f59e0b".into(),
            bg_color: "#14121f".into(),
            bg_opacity: 0.88,
            confetti: true,
        }
    }
}

/// Look of the chat poll overlay (poll.html).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PollSettings {
    /// glass | solid | neon | minimal
    pub theme: String,
    pub font_family: String,
    pub font_size: u32,
    pub text_color: String,
    /// Bar gradient.
    pub color: String,
    pub color2: String,
    pub bg_color: String,
    pub bg_opacity: f64,
    pub show_votes: bool,
    pub show_percent: bool,
    /// "Escribe el número para votar".
    pub show_hint: bool,
    /// Seconds the result stays on screen after closing (0 = until removed).
    pub hide_after_sec: u32,
}

impl Default for PollSettings {
    fn default() -> Self {
        Self {
            theme: "glass".into(),
            font_family: String::new(),
            font_size: 26,
            text_color: "#ffffff".into(),
            color: "#7c5cff".into(),
            color2: "#22d3ee".into(),
            bg_color: "#14121f".into(),
            bg_opacity: 0.85,
            show_votes: true,
            show_percent: true,
            show_hint: true,
            hide_after_sec: 20,
        }
    }
}

/// Text labels (latest follower, top donation, session totals…) shown by labels.html.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LabelSettings {
    pub font_family: String,
    pub font_size: u32,
    pub font_weight: u32,
    pub text_color: String,
    /// Color for {user} ("" = same as the text).
    pub user_color: String,
    pub stroke_color: String,
    pub stroke_width: f64,
    pub shadow: bool,
    /// left | center | right
    pub align: String,
    pub uppercase: bool,
    /// Animation when the value changes: none | fade | slide | pop
    pub animation: String,
    /// Shown when there's nothing yet.
    pub empty_text: String,
    /// Text per label (key: label id), with {user} {amount} {count}.
    pub templates: BTreeMap<String, String>,
}

impl Default for LabelSettings {
    fn default() -> Self {
        Self {
            font_family: String::new(),
            font_size: 32,
            font_weight: 800,
            text_color: "#ffffff".into(),
            user_color: String::new(),
            stroke_color: "#000000".into(),
            stroke_width: 0.0,
            shadow: true,
            align: "center".into(),
            uppercase: false,
            animation: "slide".into(),
            empty_text: "—".into(),
            templates: BTreeMap::new(),
        }
    }
}

/// One remembered event for the labels.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LabelEvent {
    pub user: String,
    pub amount: Option<f64>,
    pub currency: Option<String>,
    pub ts: i64,
}

/// A number shown on stream (deaths, wins…) and changed from chat, macros or the app.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Counter {
    pub id: Id,
    pub name: String,
    pub value: i64,
    /// Chat command: !muertes shows it, mods use !muertes+ / !muertes- / !muertes=5 ("" = none).
    pub command: String,
    /// Overlay text: {name} {value}.
    pub template: String,
}

impl Default for Counter {
    fn default() -> Self {
        Self { id: new_id(), name: "Muertes".into(), value: 0, command: "muertes".into(), template: "{name}: {value}".into() }
    }
}

/// Countdown / subathon timer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Countdown {
    /// Running: when it reaches zero (ms).
    pub ends_at: Option<i64>,
    /// Paused: time left (ms).
    pub paused_left_ms: Option<i64>,
    /// Overlay text before the time ("Empezamos en", "Subathon"…).
    pub label: String,
    /// Shown at zero.
    pub end_text: String,
    /// Alerts add time while it runs.
    pub subathon: bool,
    pub add_follow_sec: u32,
    pub add_sub_sec: u32,
    pub add_per_100_bits_sec: u32,
    /// Per unit of money donated.
    pub add_per_currency_sec: u32,
}

impl Default for Countdown {
    fn default() -> Self {
        Self {
            ends_at: None,
            paused_left_ms: None,
            label: "Empezamos en".into(),
            end_text: "¡Ya estamos!".into(),
            subathon: false,
            add_follow_sec: 10,
            add_sub_sec: 120,
            add_per_100_bits_sec: 60,
            add_per_currency_sec: 60,
        }
    }
}

/// What the labels show; kept across restarts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LabelData {
    /// Latest per kind: follow | subscription | gift_sub | bits | donation | raid
    pub latest: BTreeMap<String, LabelEvent>,
    /// Biggest ever: donation | bits | raid
    pub top: BTreeMap<String, LabelEvent>,
    /// Biggest this stream: donation | bits
    pub session_top: BTreeMap<String, LabelEvent>,
    /// This stream: follows | subs | bits | donations | raids
    pub session: BTreeMap<String, f64>,
    /// Stream the session values belong to (its start time).
    pub session_started: Option<i64>,
    /// Channel totals from the platform: followers | subs
    pub totals: BTreeMap<String, f64>,
}

impl LabelData {
    /// Remember a (real) alert. `stream_started` resets the session values when a new stream began.
    pub fn record(&mut self, kind: AlertType, user: &str, amount: Option<f64>, currency: Option<String>, ts: i64, stream_started: Option<i64>) {
        if stream_started.is_some() && stream_started != self.session_started {
            self.session.clear();
            self.session_top.clear();
            self.session_started = stream_started;
        }
        let (key, counter, add) = match kind {
            AlertType::Follow => ("follow", "follows", 1.0),
            AlertType::Subscription | AlertType::Member => ("subscription", "subs", 1.0),
            AlertType::GiftSub => ("gift_sub", "subs", amount.unwrap_or(1.0).max(1.0)),
            AlertType::Bits => ("bits", "bits", amount.unwrap_or(0.0)),
            AlertType::Donation | AlertType::Kofi | AlertType::Superchat => ("donation", "donations", amount.unwrap_or(0.0)),
            AlertType::Raid | AlertType::Host => ("raid", "raids", 1.0),
        };
        let ev = LabelEvent { user: user.to_string(), amount, currency, ts };
        self.latest.insert(key.into(), ev.clone());
        *self.session.entry(counter.into()).or_default() += add;
        if matches!(key, "donation" | "bits" | "raid") {
            let bigger = |old: Option<&LabelEvent>| old.is_none_or(|o| amount.unwrap_or(0.0) > o.amount.unwrap_or(0.0));
            if bigger(self.top.get(key)) {
                self.top.insert(key.into(), ev.clone());
            }
            if key != "raid" && bigger(self.session_top.get(key)) {
                self.session_top.insert(key.into(), ev);
            }
        }
    }
}

/// "Destacar en pantalla": a chat message shown big on stream.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct HighlightSettings {
    /// Seconds on screen (0 = until removed).
    pub duration_sec: u32,
    /// glass | solid | neon | minimal
    pub theme: String,
    pub font_family: String,
    pub font_size: u32,
    pub text_color: String,
    pub accent_color: String,
    pub bg_color: String,
    pub bg_opacity: f64,
    /// slide | pop | fade
    pub animation: String,
    pub show_platform: bool,
    pub show_badges: bool,
}

impl Default for HighlightSettings {
    fn default() -> Self {
        Self {
            duration_sec: 15,
            theme: "glass".into(),
            font_family: String::new(),
            font_size: 34,
            text_color: "#ffffff".into(),
            accent_color: "#7c5cff".into(),
            bg_color: "#14121f".into(),
            bg_opacity: 0.85,
            animation: "slide".into(),
            show_platform: true,
            show_badges: true,
        }
    }
}

/// The message currently highlighted on stream.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatHighlight {
    pub message: ChatMessage,
    /// When it was highlighted (ms).
    pub at: i64,
}

// ---------------------------------------------------------------- AI

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct TtsSettings {
    pub provider: String,
    pub voice: String,
    pub endpoint: String,
    pub piper_path: String,
    pub speed: f64,
    pub read_chat: bool,
    pub read_chat_prefix: String,
}

impl Default for TtsSettings {
    fn default() -> Self {
        Self {
            provider: "system".into(),
            voice: String::new(),
            endpoint: "http://localhost:8880/v1".into(),
            piper_path: "piper".into(),
            speed: 1.0,
            read_chat: false,
            read_chat_prefix: "!tts".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LlmSettings {
    /// none | local (llama.cpp run by Vexcast) | anthropic (Claude API) | ollama | openai_compatible
    pub provider: String,
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
    /// GGUF file in the AI hub's models folder (provider "local").
    pub local_model: String,
    pub local_context: u32,
    pub local_gpu: bool,
}

impl Default for LlmSettings {
    fn default() -> Self {
        Self {
            provider: "none".into(),
            endpoint: "http://localhost:11434".into(),
            model: "llama3.2".into(),
            api_key: String::new(),
            local_model: String::new(),
            local_context: 4096,
            local_gpu: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CohostSettings {
    pub enabled: bool,
    pub name: String,
    pub persona: String,
    pub speak: bool,
    pub reply_in_chat: bool,
    pub cooldown_sec: u32,
}

impl Default for CohostSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            name: "Vex".into(),
            persona: "Eres Vex, el co-host divertido y amable de este stream. Respondes en una o dos frases cortas, en el idioma del espectador, sin groserías.".into(),
            speak: true,
            reply_in_chat: true,
            cooldown_sec: 20,
        }
    }
}

/// Chat helpers powered by the text engine.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ChatAssistSettings {
    /// Translate messages written in another language.
    pub auto_translate: bool,
    /// Language code to translate to ("" = the app's language).
    pub translate_to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ModerationSettings {
    pub enabled: bool,
    pub use_ai: bool,
    pub blocked_words: Vec<String>,
    pub auto_delete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SttSettings {
    /// local (whisper.cpp run by Vexcast) | openai_compatible (any /audio/transcriptions server, OpenAI included)
    pub provider: String,
    pub endpoint: String,
    pub model: String,
    pub api_key: String,
    /// Whisper .bin file in the AI hub's models folder (provider "local").
    pub local_model: String,
    pub source_id: Option<Id>,
    pub language: String,
}

impl Default for SttSettings {
    fn default() -> Self {
        Self {
            provider: "openai_compatible".into(),
            endpoint: "http://localhost:8000/v1".into(),
            model: "Systran/faster-whisper-small".into(),
            api_key: String::new(),
            local_model: String::new(),
            source_id: None,
            language: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    pub assist: ChatAssistSettings,
    pub tts: TtsSettings,
    pub llm: LlmSettings,
    pub cohost: CohostSettings,
    pub moderation: ModerationSettings,
    pub stt: SttSettings,
}

// ---------------------------------------------------------------- bot

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotCommand {
    #[serde(default = "new_id")]
    pub id: Id,
    pub trigger: String,
    pub response: String,
    #[serde(default)]
    pub cooldown_sec: u32,
    #[serde(default = "yes")]
    pub enabled: bool,
    /// "command" (!trigger) | "keyword" (the words appear anywhere in a message)
    #[serde(default = "command_kind")]
    pub kind: String,
    /// Other triggers for the same command.
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Who can use it: everyone | subscriber | vip | moderator | broadcaster
    #[serde(default = "everyone")]
    pub permission: String,
    /// Per-viewer cooldown (seconds).
    #[serde(default)]
    pub user_cooldown_sec: u32,
    /// Where it works ([] = every platform).
    #[serde(default)]
    pub platforms: Vec<ChatPlatform>,
    /// One response line picked at random (else every line is sent).
    #[serde(default)]
    pub random: bool,
    /// Start the reply with @user.
    #[serde(default)]
    pub reply: bool,
    /// Uses so far ({count}).
    #[serde(default)]
    pub count: u64,
}

impl BotCommand {
    pub fn new(trigger: &str, response: &str, cooldown_sec: u32) -> Self {
        Self {
            id: new_id(),
            trigger: trigger.into(),
            response: response.into(),
            cooldown_sec,
            enabled: true,
            kind: command_kind(),
            aliases: vec![],
            permission: everyone(),
            user_cooldown_sec: 0,
            platforms: vec![],
            random: false,
            reply: false,
            count: 0,
        }
    }
}

fn command_kind() -> String {
    "command".into()
}
fn everyone() -> String {
    "everyone".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BotTimer {
    #[serde(default = "new_id")]
    pub id: Id,
    pub message: String,
    pub interval_min: u32,
    #[serde(default = "yes")]
    pub enabled: bool,
    /// Only post when at least this many chat messages arrived since the last time.
    #[serde(default)]
    pub min_chat_lines: u32,
    /// Where it's posted ([] = every platform).
    #[serde(default)]
    pub platforms: Vec<ChatPlatform>,
}

/// Automatic chat moderation by the bot (mods and the streamer are never moderated).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BotModeration {
    pub links: bool,
    /// Domains always allowed (clips.twitch.tv, youtube.com…).
    pub allowed_domains: Vec<String>,
    pub caps: bool,
    /// Only messages at least this long are checked for caps.
    pub caps_min_length: u32,
    /// Uppercase letters (%) above which a message is removed.
    pub caps_percent: u32,
    /// Repeated characters / words and symbol walls.
    pub spam: bool,
    /// Longest message allowed (characters, 0 = no limit).
    pub max_length: u32,
    pub exempt_subscribers: bool,
    pub exempt_vip: bool,
    /// Say why in chat ("{user}, …").
    pub warn: bool,
    pub warn_links: String,
    pub warn_caps: String,
    pub warn_spam: String,
    pub warn_length: String,
}

impl Default for BotModeration {
    fn default() -> Self {
        Self {
            links: false,
            allowed_domains: vec!["clips.twitch.tv".into(), "youtube.com/clip".into()],
            caps: false,
            caps_min_length: 15,
            caps_percent: 70,
            spam: false,
            max_length: 0,
            exempt_subscribers: true,
            exempt_vip: true,
            warn: true,
            warn_links: "{user}, no se permiten enlaces en el chat.".into(),
            warn_caps: "{user}, sin tantas mayúsculas, por favor.".into(),
            warn_spam: "{user}, nada de spam, por favor.".into(),
            warn_length: "{user}, ese mensaje es demasiado largo.".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BotSettings {
    pub enabled: bool,
    pub prefix: String,
    pub commands: Vec<BotCommand>,
    pub timers: Vec<BotTimer>,
    pub moderation: BotModeration,
    /// Answer !comandos / !commands with the list of commands everyone can use.
    pub list_command: bool,
    pub loyalty: LoyaltySettings,
    pub songs: SongSettings,
}

/// Song requests (!sr <YouTube link>).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SongSettings {
    pub enabled: bool,
    pub command: String,
    /// Songs waiting at most (0 = no limit).
    pub max_queue: u32,
    /// Songs per viewer in the queue (0 = no limit).
    pub max_per_user: u32,
    /// Longer songs are skipped (0 = no limit).
    pub max_minutes: u32,
    /// Loyalty points per request (0 = free).
    pub cost: u64,
    pub subs_only: bool,
}

impl Default for SongSettings {
    fn default() -> Self {
        Self { enabled: false, command: "sr".into(), max_queue: 30, max_per_user: 2, max_minutes: 8, cost: 0, subs_only: false }
    }
}

/// Loyalty points (shared by every platform).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LoyaltySettings {
    pub enabled: bool,
    /// What they're called in chat ("puntos", "monedas"…).
    pub name: String,
    /// Points every `interval_min` minutes for viewers who wrote in the last `active_minutes`.
    pub per_interval: u32,
    pub interval_min: u32,
    pub active_minutes: u32,
    /// Subscribers / members / VIPs earn this many times more.
    pub sub_multiplier: f64,
    pub bonus_follow: u32,
    pub bonus_sub: u32,
    pub bonus_per_100_bits: u32,
    /// Per unit of money donated (1 €, 1 $…).
    pub bonus_per_currency: u32,
    pub bonus_raid: u32,
    pub command: String,
    pub top_command: String,
    pub give_command: String,
    /// Viewers can give their points to others.
    pub allow_give: bool,
    pub redeem_command: String,
    pub rewards: Vec<LoyaltyReward>,
}

impl Default for LoyaltySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            name: "puntos".into(),
            per_interval: 10,
            interval_min: 5,
            active_minutes: 15,
            sub_multiplier: 2.0,
            bonus_follow: 50,
            bonus_sub: 500,
            bonus_per_100_bits: 50,
            bonus_per_currency: 100,
            bonus_raid: 200,
            command: "puntos".into(),
            top_command: "top".into(),
            give_command: "dar".into(),
            allow_give: true,
            redeem_command: "canjear".into(),
            rewards: vec![
                LoyaltyReward { id: new_id(), name: "hidratate".into(), cost: 200, kind: "chat".into(), value: "💧 {user} recuerda al streamer que beba agua".into(), needs_input: false, cooldown_sec: 300, enabled: true },
                LoyaltyReward { id: new_id(), name: "tts".into(), cost: 500, kind: "tts".into(), value: String::new(), needs_input: true, cooldown_sec: 60, enabled: true },
                LoyaltyReward { id: new_id(), name: "destacar".into(), cost: 300, kind: "highlight".into(), value: String::new(), needs_input: true, cooldown_sec: 30, enabled: true },
            ],
        }
    }
}

/// Something viewers buy with points.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LoyaltyReward {
    pub id: Id,
    /// Name used in chat: !canjear <name> [text].
    pub name: String,
    pub cost: u64,
    /// chat | tts | sound | highlight | macro
    pub kind: String,
    /// chat/tts: text ({user} {input}) · sound: file or URL · highlight: text when there's no input · macro: macro id.
    pub value: String,
    /// The viewer must write a text after the name.
    pub needs_input: bool,
    pub cooldown_sec: u32,
    pub enabled: bool,
}

impl Default for LoyaltyReward {
    fn default() -> Self {
        Self { id: new_id(), name: String::new(), cost: 100, kind: "chat".into(), value: String::new(), needs_input: false, cooldown_sec: 0, enabled: true }
    }
}

impl Default for BotSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            prefix: "!".into(),
            commands: vec![
                BotCommand::new("uptime", "{channel} lleva en directo {uptime}", 10),
                BotCommand::new("vexcast", "Este stream usa Vexcast, el estudio de streaming libre y gratuito: github.com/vexcast/vexcast", 30),
            ],
            timers: vec![],
            moderation: BotModeration::default(),
            list_command: true,
            loyalty: LoyaltySettings::default(),
            songs: SongSettings::default(),
        }
    }
}

// ---------------------------------------------------------------- general

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub release_url: Option<String>,
    pub release_notes: Option<String>,
    pub checked_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneralSettings {
    pub language: String,
    pub theme: String,
    pub check_for_updates: bool,
    pub remote_control_enabled: bool,
    /// New (unknown) remote devices may connect with the pairing code.
    pub remote_allow_new: bool,
    /// MCP endpoint for AI assistants (only reachable from this PC).
    pub mcp_enabled: bool,
    pub kofi_verification_token: String,
    /// After a crash or power cut while live, go live again on the next start.
    pub resume_after_crash: bool,
    /// Free-form UI preferences (dock layout, snapping, confirmations...).
    pub ui_prefs: Value,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self { language: "es".into(), theme: "dark".into(), check_for_updates: true, remote_control_enabled: true, remote_allow_new: true, mcp_enabled: true, kofi_verification_token: String::new(), resume_after_crash: true, ui_prefs: Value::Object(Default::default()) }
    }
}


pub use crate::obs::model::{
    AdvancedSettings, AudioLevel, AudioSettings, Destination, EngineSnapshot, EngineStatus, OutputSettings, Stats, VideoSettings,
};

// ---------------------------------------------------------------- macros

/// One action of a macro. `kind`: scene {scene} · stream {action: start|stop} · record
/// {action: start|stop} · replay (save the replay buffer) · clip (Twitch clip) · chat {text} · title {title, category?}
/// · tts {text} · mute {source, muted?: bool (omitted = toggle)} · visibility {scene, item,
/// visible?} · alert {type} · wait {ms}.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MacroStep {
    pub kind: String,
    pub value: Value,
}

/// A named sequence of actions, run from a button, a hotkey, the phone or MCP.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Macro {
    pub id: Id,
    pub name: String,
    pub color: String,
    pub steps: Vec<MacroStep>,
}

impl Default for Macro {
    fn default() -> Self {
        Self { id: new_id(), name: String::new(), color: String::new(), steps: vec![] }
    }
}

/// A phone/tablet/browser that used the remote API.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteDevice {
    /// Sent by the remote app ("X-Vexcast-Device"), or "ip-<address>" for clients that don't.
    pub id: String,
    pub name: String,
    pub ip: String,
    pub first_seen: i64,
    pub last_seen: i64,
    pub blocked: bool,
    /// "admin" (or empty: everything), "moderator" (scenes, alerts, chat, audio, macros, title)
    /// or "viewer" (look only).
    pub role: String,
    /// Runtime: open live connections (not saved).
    #[serde(skip_deserializing)]
    pub connected: bool,
}

/// Everything persisted to config.json (the OBS scene graph lives in scene collections).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AppState {
    pub version: String,
    pub scene_collection: String,
    pub video: VideoSettings,
    pub audio: AudioSettings,
    pub output: OutputSettings,
    pub advanced: AdvancedSettings,
    pub destinations: Vec<Destination>,
    pub chat: Vec<ChatConnection>,
    pub widgets: WidgetSettings,
    pub ai: AiSettings,
    pub bot: BotSettings,
    pub general: GeneralSettings,
    /// Latest / top events and session totals for the label widgets.
    pub labels: LabelData,
    pub counters: Vec<Counter>,
    pub countdown: Countdown,
    #[serde(skip)]
    pub update: UpdateInfo,
    /// OAuth tokens of connected accounts (never sent to clients).
    pub account_tokens: Vec<crate::oauth::AccountToken>,
    /// Remote devices (phones, tablets…) that have connected, with their blocked flag.
    pub remote_devices: Vec<RemoteDevice>,
    pub macros: Vec<Macro>,
    /// Runtime: stream start time (for the bot's {uptime}).
    #[serde(skip)]
    pub stream_started_at: Option<i64>,
    /// Not part of the public protocol; persisted API token.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub api_token: String,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            version: String::new(),
            scene_collection: "Escenas".into(),
            video: VideoSettings::default(),
            audio: AudioSettings::default(),
            output: OutputSettings::default(),
            advanced: AdvancedSettings::default(),
            destinations: vec![],
            chat: vec![
                ChatConnection { platform: ChatPlatform::Twitch, channel: String::new(), enabled: false, token: String::new(), state: ConnState::Disconnected, error: None },
                ChatConnection { platform: ChatPlatform::Youtube, channel: String::new(), enabled: false, token: String::new(), state: ConnState::Disconnected, error: None },
                ChatConnection { platform: ChatPlatform::Kick, channel: String::new(), enabled: false, token: String::new(), state: ConnState::Disconnected, error: None },
            ],
            widgets: WidgetSettings::default(),
            ai: AiSettings::default(),
            bot: BotSettings::default(),
            general: GeneralSettings::default(),
            labels: LabelData::default(),
            counters: vec![],
            countdown: Countdown::default(),
            update: UpdateInfo::default(),
            stream_started_at: None,
            account_tokens: vec![],
            remote_devices: vec![],
            macros: vec![],
            api_token: String::new(),
        }
    }
}

/// State sent to clients: settings + live engine snapshot + status.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicState {
    pub version: String,
    pub status: EngineStatus,
    #[serde(flatten)]
    pub engine: EngineSnapshot,
    pub video: VideoSettings,
    pub audio: AudioSettings,
    pub output: OutputSettings,
    pub advanced: AdvancedSettings,
    pub destinations: Vec<Destination>,
    pub chat: Vec<ChatConnection>,
    pub widgets: WidgetSettings,
    pub ai: AiSettings,
    pub bot: BotSettings,
    pub general: GeneralSettings,
    pub labels: LabelData,
    pub counters: Vec<Counter>,
    pub countdown: Countdown,
    pub update: UpdateInfo,
    pub accounts: Vec<crate::oauth::ConnectedAccount>,
    pub macros: Vec<Macro>,
}

/// Events pushed to WebSocket clients.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ServerEvent {
    State(Box<PublicState>),
    Status(EngineStatus),
    Stats(Stats),
    Levels(Vec<AudioLevel>),
    /// A chat message got its translation.
    ChatTranslated { id: Id, text: String },
    /// Stream health report: {level: ok|warn|error, issues: [{id, level, title, detail, fixes}]}.
    Health(Value),
    Chat(ChatMessage),
    ChatDeleted { id: Id },
    /// Message highlighted on stream (None: removed).
    ChatHighlight(Option<ChatHighlight>),
    /// Chat poll changed (None: removed from screen).
    Poll(Option<crate::polls::Poll>),
    /// Giveaway changed (None: removed from screen).
    Giveaway(Option<crate::giveaway::Giveaway>),
    /// Song request queue changed.
    Songs(crate::songs::SongQueue),
    Alert(AlertEvent),
    /// `played`: already playing in the stream mix (widgets must not play it again).
    Tts { id: Id, url: String, text: String, played: bool },
    Caption(Caption),
    Notification { level: String, message: String },
    AlertSkip,
    /// Phones sending their camera over the local network right now.
    PhoneCams(Vec<PhoneCam>),
    /// A stream just ended and its report was saved.
    SessionEnded { id: String, title: String, summary: crate::sessions::Summary, dropped_pct: f64 },
}

/// A phone sending its camera to Vexcast over the local network (`/phonecam/ws`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PhoneCam {
    /// Room id; the browser source showing it has `phonecam.html?id=<room>` in its URL.
    pub room: String,
    /// Name of the phone (as it identifies itself to the remote API).
    pub device: String,
    /// When it started sending (unix ms).
    pub since: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Caption {
    pub id: Id,
    pub text: String,
    pub translated: Option<String>,
    #[serde(rename = "final")]
    pub is_final: bool,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairingInfo {
    pub name: String,
    pub addresses: Vec<String>,
    pub port: u16,
    pub token: String,
    pub qr_payload: String,
}


fn yes() -> bool {
    true
}

/// Mask a secret for API output: keep last 4 chars.
pub fn mask(secret: &str) -> String {
    if secret.is_empty() {
        return String::new();
    }
    let tail: String = secret.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("••••{tail}")
}

pub fn is_masked(v: &str) -> bool {
    v.starts_with("••••")
}

impl AppState {
    /// Copy of the settings with secrets masked, for clients.
    pub fn masked(&self) -> AppState {
        let mut s = self.clone();
        s.api_token = String::new();
        for d in &mut s.destinations {
            d.stream_key = mask(&d.stream_key);
        }
        for c in &mut s.chat {
            c.token = mask(&c.token);
        }
        s.ai.llm.api_key = mask(&s.ai.llm.api_key);
        s.ai.stt.api_key = mask(&s.ai.stt.api_key);
        s.general.kofi_verification_token = mask(&s.general.kofi_verification_token);
        s
    }
}

/// Deep-merge `patch` JSON into `target` JSON (objects merged, everything else replaced).
pub fn merge_json(target: &mut Value, patch: Value) {
    match (target, patch) {
        (Value::Object(t), Value::Object(p)) => {
            for (k, v) in p {
                merge_json(t.entry(k).or_insert(Value::Null), v);
            }
        }
        (t, p) => *t = p,
    }
}
