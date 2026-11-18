//! Alerts: queueing, TTS, sounds, donation goal tracking and Ko-fi webhooks.

use crate::core::Core;
use crate::model::*;
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::sync::{mpsc, Notify};

pub struct Alerts {
    core: Weak<Core>,
    tx: mpsc::UnboundedSender<AlertEvent>,
    rx: parking_lot::Mutex<Option<mpsc::UnboundedReceiver<AlertEvent>>>,
    skip: Notify,
    pub recent: parking_lot::Mutex<std::collections::VecDeque<AlertEvent>>,
    /// Design forced by the next test alert (designer's "Probar").
    forced_design: parking_lot::Mutex<Option<String>>,
    /// Alerts queued and not shown yet.
    pending: std::sync::atomic::AtomicUsize,
    /// Last follow per viewer (lowercase name → ms), to ignore follow/unfollow spam.
    follows: parking_lot::Mutex<std::collections::HashMap<String, i64>>,
}

impl Alerts {
    pub fn new(core: Weak<Core>) -> Arc<Self> {
        let (tx, rx) = mpsc::unbounded_channel();
        let a = Arc::new(Self { core, tx, rx: parking_lot::Mutex::new(Some(rx)), skip: Notify::new(), recent: Default::default(), forced_design: Default::default(), pending: Default::default(), follows: Default::default() });
        let worker = a.clone();
        tokio::spawn(async move { worker.run().await });
        a
    }

    /// Queue an alert.
    #[allow(clippy::too_many_arguments)]
    pub async fn push(&self, kind: AlertType, platform: ChatPlatform, user: &str, amount: Option<f64>, currency: Option<String>, message: Option<String>, test: bool) {
        // Same viewer following again (follow/unfollow spam).
        if kind == AlertType::Follow && !test {
            let minutes = self.core.upgrade().map(|c| c.read(|s| s.widgets.alert_box.repeat_follow_minutes)).unwrap_or(0);
            if minutes > 0 {
                let now = now_ms();
                let mut f = self.follows.lock();
                let key = user.to_lowercase();
                if f.get(&key).is_some_and(|&t| now.saturating_sub(t) < minutes as i64 * 60_000) {
                    return;
                }
                f.retain(|_, t| now.saturating_sub(*t) < 24 * 3_600_000);
                f.insert(key, now);
            }
        }
        let design = if test { self.forced_design.lock().take() } else { None };
        let ev = AlertEvent { id: new_id(), kind, platform, user: user.to_string(), amount, currency, message, ts: now_ms(), tts_url: None, test, design };
        // Labels (latest follower, top donation, session totals…).
        if !test {
            if let Some(core) = self.core.upgrade() {
                core.update(|s| {
                    let started = s.stream_started_at;
                    s.labels.record(kind, user, ev.amount, ev.currency.clone(), ev.ts, started);
                });
                core.loyalty.on_alert(&core, kind, platform, user, ev.amount);
                crate::counters::on_alert(&core, kind, ev.amount);
            }
        }
        // Goals: donations, followers, subs and bits move on their own.
        if let Some(core) = self.core.upgrade().filter(|_| !test) {
            let a = amount.unwrap_or(0.0);
            let (goal, add) = match kind {
                AlertType::Donation | AlertType::Kofi | AlertType::Superchat => ("donations", a),
                AlertType::Follow => ("followers", 1.0),
                AlertType::Subscription | AlertType::Member => ("subs", 1.0),
                AlertType::GiftSub => ("subs", a.max(1.0)),
                AlertType::Bits => ("bits", a),
                _ => ("", 0.0),
            };
            if add > 0.0 {
                core.update(|s| {
                    let g = if goal == "donations" { Some(&mut s.widgets.goal) } else { s.widgets.goals.get_mut(goal) };
                    if let Some(g) = g.filter(|g| g.auto_track) {
                        g.current = ((g.current + add) * 100.0).round() / 100.0;
                    }
                });
            }
        }
        self.pending.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let _ = self.tx.send(ev);
    }

    /// Alerts waiting to be shown.
    pub fn queued(&self) -> usize {
        self.pending.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn skip(&self) {
        self.skip.notify_waiters();
        if let Some(core) = self.core.upgrade() {
            core.engine.skip_audio();
            core.emit(ServerEvent::AlertSkip);
        }
    }

    pub async fn test(&self, kind: AlertType) {
        self.test_design(kind, None).await
    }

    /// Test alert; `design` forces one of the user-made designs (from the designer).
    pub async fn test_design(&self, kind: AlertType, design: Option<String>) {
        *self.forced_design.lock() = design;
        let names = ["Luna", "PixelKnight", "Sofi_gg", "ElProfe", "NovaCat", "Mateo_Dev"];
        let user = names[rand::random::<usize>() % names.len()];
        let (amount, currency, message) = match kind {
            AlertType::Donation | AlertType::Kofi | AlertType::Superchat => (Some(5.0), Some("USD".into()), Some("¡Sigue así, me encanta el stream!".to_string())),
            AlertType::Bits => (Some(500.0), None, Some("¡Toma bits!".to_string())),
            AlertType::Raid | AlertType::Host => (Some(42.0), None, None),
            AlertType::GiftSub => (Some(5.0), None, None),
            AlertType::Subscription => (Some(3.0), None, Some("¡Tres meses ya!".to_string())),
            _ => (None, None, None),
        };
        let platform = match kind {
            AlertType::Kofi => ChatPlatform::Kofi,
            AlertType::Superchat | AlertType::Member => ChatPlatform::Youtube,
            _ => ChatPlatform::Twitch,
        };
        self.push(kind, platform, user, amount, currency, message, true).await;
    }

    async fn run(self: Arc<Self>) {
        let Some(mut rx) = self.rx.lock().take() else { return };
        while let Some(mut ev) = rx.recv().await {
            let waiting = self.pending.fetch_sub(1, std::sync::atomic::Ordering::Relaxed).saturating_sub(1);
            let Some(core) = self.core.upgrade() else { break };
            let (settings, tts_on) = core.read(|s| (s.widgets.alert_box.clone(), s.ai.tts.provider != "none"));
            if !settings.enabled {
                continue;
            }
            // Clean the message before it is shown or read.
            ev.message = ev.message.as_deref().and_then(|m| clean_message(m, &settings));
            // Too many waiting: drop the oldest (this one) but keep it in the recent list.
            if settings.max_queue > 0 && waiting >= settings.max_queue as usize && !ev.test {
                let mut r = self.recent.lock();
                r.push_front(ev);
                r.truncate(50);
                continue;
            }
            // A user-made design (forced by a test, or the one whose condition matches)
            // replaces the built-in look and brings its own sound and duration.
            let design = match ev.design.as_deref() {
                Some(id) => settings.designs.iter().find(|d| d.id == id).cloned(),
                None => pick_design(&settings.designs, &ev),
            };
            ev.design = design.as_ref().map(|d| d.id.clone());
            let (tts_mode, sound_url, play_sound, sound_volume, duration_ms) = if let Some(d) = &design {
                let video = d.layers.iter().find(|l| l.visible && l.kind == "video" && !l.muted && !l.src.trim().is_empty());
                let sound = if !d.sound.trim().is_empty() { Some(d.sound.clone()) } else { video.map(|l| l.src.clone()) };
                (d.tts.clone(), sound.clone(), sound.is_some(), d.sound_volume, d.duration_ms.max(1000))
            } else {
                // Per-type variation: off, or below its minimum amount → no alert.
                let var = settings.variations.get(&ev.kind).cloned().unwrap_or_default();
                // (Test alerts from the editor always show.)
                if !ev.test && (!var.enabled || (var.min_amount > 0.0 && ev.amount.unwrap_or(0.0) < var.min_amount)) {
                    continue;
                }
                let sound: Option<String> = if !var.sound.trim().is_empty() {
                    Some(var.sound.clone())
                } else if is_video(&var.media) {
                    // Theme alert videos carry their own sound.
                    Some(var.media.clone())
                } else {
                    settings.sound_url.clone()
                };
                let vol = if var.sound_volume >= 0.0 { var.sound_volume } else { settings.sound_volume };
                let dur = if var.duration_ms > 0 { var.duration_ms } else { settings.duration_ms };
                (var.tts.clone(), sound, true, vol, dur)
            };
            let tts_enabled = match tts_mode.as_str() {
                "on" => true,
                "off" => false,
                _ => settings.tts_enabled,
            };
            // TTS: title + message (message only if amount >= min).
            let title = render_template(settings.templates.get(&ev.kind).map(String::as_str).unwrap_or("{user}"), &ev);
            let read_msg = ev.message.is_some() && ev.amount.unwrap_or(0.0) >= settings.tts_min_amount;
            let mut clip: Option<Vec<u8>> = None;
            if tts_enabled && tts_on {
                let mut text = title.clone();
                if read_msg {
                    if let Some(m) = &ev.message {
                        text.push_str(". ");
                        text.push_str(m);
                    }
                }
                match core.tts.synthesize(&text).await {
                    Ok((id, wav)) => {
                        ev.tts_url = Some(format!("/api/v1/tts/audio/{id}"));
                        clip = Some(wav);
                    }
                    Err(e) => tracing::warn!("alert tts: {e}"),
                }
            }
            {
                let mut r = self.recent.lock();
                r.push_front(ev.clone());
                r.truncate(50);
            }
            core.emit(ServerEvent::Alert(ev.clone()));
            core.sessions.on_alert(&ev);
            // Sound then voice, into the stream mix.
            let vol = sound_volume.clamp(0.0, 1.0) as f32;
            let mut audio_ms = 0u64;
            let sound = if play_sound { load_sound(&core, sound_url.as_deref(), vol).await } else { None };
            if let Some((bytes, ext)) = sound {
                audio_ms += wav_duration_ms(&bytes).unwrap_or(1500);
                let _ = core.engine.play_audio(&bytes, &ext);
            }
            if let Some(c) = clip {
                audio_ms += wav_duration_ms(&c).unwrap_or(4000);
                let ext = if c.starts_with(b"RIFF") { "wav" } else { "mp3" };
                let _ = core.engine.play_audio(&c, ext);
            }
            let wait = Duration::from_millis((duration_ms as u64).max(audio_ms + 500).min(60_000));
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = self.skip.notified() => {}
            }
            tokio::time::sleep(Duration::from_millis(settings.gap_ms.min(30_000) as u64)).await;
        }
    }
}

/// Alert message after the filters (blocked words, links, length); None when nothing is left.
pub fn clean_message(m: &str, s: &AlertBoxSettings) -> Option<String> {
    let mut out: String = m.to_string();
    if s.strip_links {
        out = out
            .split_whitespace()
            .filter(|w| {
                let l = w.to_lowercase();
                !(l.starts_with("http://") || l.starts_with("https://") || l.starts_with("www.") || {
                    let host = l.split('/').next().unwrap_or("").trim_end_matches(|c: char| !c.is_alphanumeric());
                    host.contains('.') && ["com", "net", "org", "tv", "gg", "io", "ly", "me", "es", "xyz"].iter().any(|t| host.ends_with(&format!(".{t}")))
                })
            })
            .collect::<Vec<_>>()
            .join(" ");
    }
    for w in s.blocked_words.iter().map(|w| w.trim()).filter(|w| !w.is_empty()) {
        out = replace_ci(&out, w);
    }
    if s.max_message_length > 0 && out.chars().count() > s.max_message_length as usize {
        out = out.chars().take(s.max_message_length as usize).collect::<String>().trim_end().to_string() + "…";
    }
    let out = out.trim().to_string();
    (!out.is_empty()).then_some(out)
}

/// Replace every case-insensitive occurrence of `word` with asterisks.
fn replace_ci(text: &str, word: &str) -> String {
    let lw: Vec<char> = word.to_lowercase().chars().collect();
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = text.chars().map(|c| c.to_lowercase().next().unwrap_or(c)).collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if i + lw.len() <= chars.len() && lower[i..i + lw.len()] == lw[..] {
            out.push_str(&"*".repeat(lw.len()));
            i += lw.len();
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

/// The user-made design for an event: enabled, same type, amount within its range;
/// highest priority wins, ties picked at random by weight.
pub fn pick_design(designs: &[AlertDesign], ev: &AlertEvent) -> Option<AlertDesign> {
    let amount = ev.amount.unwrap_or(0.0);
    let matching: Vec<&AlertDesign> = designs
        .iter()
        .filter(|d| d.enabled && d.kind == ev.kind && amount >= d.min_amount && (d.max_amount <= 0.0 || amount <= d.max_amount))
        .collect();
    let top = matching.iter().map(|d| d.priority).max()?;
    let best: Vec<&&AlertDesign> = matching.iter().filter(|d| d.priority == top).collect();
    let total: f64 = best.iter().map(|d| d.weight.max(0.0)).sum();
    if total <= 0.0 {
        return best.first().map(|d| (**d).clone());
    }
    let mut r = rand::random::<f64>() * total;
    for d in &best {
        r -= d.weight.max(0.0);
        if r <= 0.0 {
            return Some((**d).clone());
        }
    }
    best.last().map(|d| (**d).clone())
}

/// Video files (alert media whose audio is played when there's no separate sound).
pub fn is_video(path: &str) -> bool {
    let p = path.to_lowercase();
    [".webm", ".mp4", ".mov", ".mkv"].iter().any(|e| p.split('?').next().unwrap_or(&p).ends_with(e))
}

pub fn render_template(t: &str, ev: &AlertEvent) -> String {
    let amount = match (ev.amount, &ev.currency) {
        (Some(a), Some(c)) => format_money(a, c),
        (Some(a), None) => {
            if a.fract() == 0.0 {
                format!("{}", a as i64)
            } else {
                format!("{a:.2}")
            }
        }
        _ => String::new(),
    };
    t.replace("{user}", &ev.user)
        .replace("{amount}", &amount)
        .replace("{currency}", ev.currency.as_deref().unwrap_or(""))
        .replace("{message}", ev.message.as_deref().unwrap_or(""))
}

pub fn format_money(a: f64, currency: &str) -> String {
    let sym = match currency.to_uppercase().as_str() {
        "USD" => "$",
        "EUR" => "€",
        "GBP" => "£",
        "MXN" => "MX$",
        "ARS" => "AR$",
        "CLP" => "CLP$",
        "COP" => "COL$",
        "BRL" => "R$",
        "JPY" => "¥",
        _ => "",
    };
    if sym.is_empty() {
        format!("{a:.2} {currency}")
    } else {
        format!("{sym}{a:.2}")
    }
}

/// Alert sound bytes + file extension (the built-in chime when no sound is configured).
pub(crate) async fn load_sound(core: &Arc<Core>, url: Option<&str>, volume: f32) -> Option<(Vec<u8>, String)> {
    let url = url.map(str::trim).filter(|u| !u.is_empty());
    let Some(url) = url else { return Some((samples_to_wav(&default_chime(), volume), "wav".into())) };
    let ext = url.rsplit('.').next().filter(|e| e.len() <= 4).unwrap_or("mp3").to_lowercase();
    let bytes = if url.starts_with("http://") || url.starts_with("https://") {
        core.http.get(url).send().await.ok()?.bytes().await.ok()?.to_vec()
    } else {
        tokio::fs::read(url).await.ok()?
    };
    Some((bytes, ext))
}

/// Interleaved stereo f32 (48 kHz) -> 16-bit WAV bytes.
pub fn samples_to_wav(samples: &[f32], volume: f32) -> Vec<u8> {
    let spec = hound::WavSpec { channels: 2, sample_rate: 48_000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut cur = std::io::Cursor::new(Vec::new());
    if let Ok(mut w) = hound::WavWriter::new(&mut cur, spec) {
        for s in samples {
            let _ = w.write_sample(((s * volume).clamp(-1.0, 1.0) * 32767.0) as i16);
        }
        let _ = w.finalize();
    }
    cur.into_inner()
}

pub fn wav_duration_ms(bytes: &[u8]) -> Option<u64> {
    let r = hound::WavReader::new(std::io::Cursor::new(bytes)).ok()?;
    let spec = r.spec();
    Some(r.duration() as u64 * 1000 / spec.sample_rate.max(1) as u64)
}

/// A short, pleasant synthesized chime (no asset files needed).
pub fn default_chime() -> Vec<f32> {
    let sr = 48_000.0f32;
    let notes = [(659.25f32, 0.0f32), (783.99, 0.09), (1046.5, 0.18)];
    let len = (sr * 0.9) as usize;
    let mut out = vec![0f32; len * 2];
    for (freq, start) in notes {
        let s0 = (start * sr) as usize;
        for i in s0..len {
            let t = (i - s0) as f32 / sr;
            let env = (-t * 5.0).exp() * (1.0 - (-t * 200.0).exp());
            let v = (2.0 * std::f32::consts::PI * freq * t).sin() * 0.18 * env + (2.0 * std::f32::consts::PI * freq * 2.0 * t).sin() * 0.04 * env;
            out[i * 2] += v;
            out[i * 2 + 1] += v;
        }
    }
    out
}

/// Parse a Ko-fi webhook `data` field and queue the alert.
pub async fn handle_kofi(core: &Arc<Core>, data: &str) -> Result<(), String> {
    let v: serde_json::Value = serde_json::from_str(data).map_err(|_| "JSON inválido".to_string())?;
    let expected = core.read(|s| s.general.kofi_verification_token.clone());
    if expected.is_empty() || v["verification_token"].as_str() != Some(expected.as_str()) {
        return Err("Token de verificación de Ko-fi incorrecto".into());
    }
    let user = v["from_name"].as_str().unwrap_or("Alguien").to_string();
    let amount = v["amount"].as_str().and_then(|a| a.parse::<f64>().ok()).or_else(|| v["amount"].as_f64());
    let currency = v["currency"].as_str().map(String::from);
    let public = v["is_public"].as_bool().unwrap_or(true);
    let message = if public { v["message"].as_str().filter(|m| !m.is_empty()).map(String::from) } else { None };
    core.alerts.push(AlertType::Kofi, ChatPlatform::Kofi, &user, amount, currency, message, false).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_track_latest_top_and_session() {
        let mut l = LabelData::default();
        l.record(AlertType::Donation, "Ana", Some(5.0), Some("EUR".into()), 1, Some(100));
        l.record(AlertType::Kofi, "Leo", Some(3.0), Some("EUR".into()), 2, Some(100));
        l.record(AlertType::Follow, "Sol", None, None, 3, Some(100));
        assert_eq!(l.latest["donation"].user, "Leo");
        assert_eq!(l.top["donation"].user, "Ana");
        assert_eq!(l.session["donations"], 8.0);
        assert_eq!(l.session["follows"], 1.0);
        // A new stream resets the session values but keeps latest / top.
        l.record(AlertType::Bits, "Max", Some(100.0), None, 4, Some(200));
        assert!(!l.session.contains_key("donations"));
        assert_eq!(l.session["bits"], 100.0);
        assert_eq!(l.top["donation"].user, "Ana");
        assert_eq!(l.latest["follow"].user, "Sol");
    }
    #[test]
    fn cleans_messages() {
        let s = AlertBoxSettings { blocked_words: vec!["tonto".into()], max_message_length: 20, ..Default::default() };
        assert_eq!(clean_message("Eres TONTO jaja", &s).as_deref(), Some("Eres ***** jaja"));
        assert_eq!(clean_message("mira https://spam.example y twitch.tv/x", &s).as_deref(), Some("mira y"));
        assert_eq!(clean_message("https://solo-un-link.com", &s), None);
        assert_eq!(clean_message("uno dos tres cuatro cinco seis", &s).as_deref(), Some("uno dos tres cuatro…"));
        let keep = AlertBoxSettings { strip_links: false, max_message_length: 0, ..Default::default() };
        assert_eq!(clean_message("ver www.web.com", &keep).as_deref(), Some("ver www.web.com"));
    }
    #[test]
    fn templates() {
        let ev = AlertEvent { id: "x".into(), kind: AlertType::Donation, platform: ChatPlatform::Kofi, user: "Ana".into(), amount: Some(5.0), currency: Some("USD".into()), message: None, ts: 0, tts_url: None, test: true, design: None };
        assert_eq!(render_template("¡{user} donó {amount}!", &ev), "¡Ana donó $5.00!");
    }
    #[test]
    fn migrates_old_variations_to_designs() {
        let mut ab = AlertBoxSettings::default();
        ab.variations.insert(AlertType::Follow, AlertVariation { media: "C:/x/Cyber Follower.webm".into(), layout: "background".into(), media_scale: 1.65, ..Default::default() });
        ab.variations.insert(AlertType::Raid, AlertVariation { enabled: false, ..Default::default() });
        migrate_alert_variations(&mut ab);
        assert_eq!(ab.designs.len(), 1);
        let d = &ab.designs[0];
        assert_eq!(d.kind, AlertType::Follow);
        assert_eq!(d.layers[0].kind, "video");
        assert_eq!(d.layers[0].w, 1920.0, "the theme video fills the canvas (scaled to the alert box), not 165%");
        assert_eq!(ab.variations[&AlertType::Follow], AlertVariation::default());
        assert!(!ab.variations[&AlertType::Raid].enabled, "a disabled type stays disabled");
        // Running it again changes nothing.
        migrate_alert_variations(&mut ab);
        assert_eq!(ab.designs.len(), 1);
    }

    #[test]
    fn picks_designs_by_amount_and_priority() {
        let ev = |a: f64| AlertEvent { id: "x".into(), kind: AlertType::Bits, platform: ChatPlatform::Twitch, user: "A".into(), amount: Some(a), currency: None, message: None, ts: 0, tts_url: None, test: false, design: None };
        let d = |id: &str, min: f64, max: f64, prio: i32| AlertDesign { id: id.into(), kind: AlertType::Bits, min_amount: min, max_amount: max, priority: prio, ..Default::default() };
        let designs = vec![d("small", 0.0, 99.0, 0), d("big", 100.0, 0.0, 0), d("huge", 1000.0, 0.0, 5), AlertDesign { id: "follow".into(), kind: AlertType::Follow, ..Default::default() }];
        assert_eq!(pick_design(&designs, &ev(50.0)).unwrap().id, "small");
        assert_eq!(pick_design(&designs, &ev(500.0)).unwrap().id, "big");
        assert_eq!(pick_design(&designs, &ev(5000.0)).unwrap().id, "huge");
        let off = vec![AlertDesign { enabled: false, kind: AlertType::Bits, ..Default::default() }];
        assert!(pick_design(&off, &ev(1.0)).is_none());
    }
    #[test]
    fn chime() {
        let c = default_chime();
        assert!(c.iter().any(|s| s.abs() > 0.05));
        assert!(c.iter().all(|s| s.abs() <= 1.0));
    }
}
