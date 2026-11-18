//! Live text sources: any text source can show a live value (latest follower, top donation,
//! this stream's totals, a counter, the countdown…). The value it shows is stored in the
//! source's own settings (`vexcast_label`, optional `vexcast_label_template`), so it travels
//! with the scene collection; Vexcast keeps the text up to date.
//!
//! Themes imported from Streamlabs come with their "stream labels" already linked, and text
//! sources from older imports (static "Último seguidor"…) are linked by their name.

use crate::core::Core;
use crate::model::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

pub const KEY: &str = "vexcast_label";
pub const TEMPLATE_KEY: &str = "vexcast_label_template";

/// Every value a text source can show: (id, default template).
pub const LABELS: &[(&str, &str)] = &[
    ("latest_follower", "{user}"),
    ("latest_subscriber", "{user}"),
    ("latest_gift", "{user} · {amount}"),
    ("latest_bits", "{user} · {amount} bits"),
    ("latest_donation", "{user} · {amount}"),
    ("latest_raid", "{user} ({amount})"),
    ("top_donation", "{user} · {amount}"),
    ("top_bits", "{user} · {amount} bits"),
    ("top_raid", "{user} ({amount})"),
    ("session_top_donation", "{user} · {amount}"),
    ("session_top_bits", "{user} · {amount} bits"),
    ("session_follows", "{count}"),
    ("session_subs", "{count}"),
    ("session_bits", "{count}"),
    ("session_donations", "{amount}"),
    ("session_raids", "{count}"),
    ("total_followers", "{count}"),
    ("total_subs", "{count}"),
    ("countdown", "{time}"),
];

/// Streamlabs stream label type → Vexcast value.
pub fn from_streamlabs(kind: &str) -> Option<&'static str> {
    Some(match kind {
        "most_recent_follower" | "session_most_recent_follower" => "latest_follower",
        "most_recent_subscriber" | "session_most_recent_subscriber" | "most_recent_resub" => "latest_subscriber",
        "most_recent_donator" | "session_most_recent_donator" => "latest_donation",
        "most_recent_cheerer" | "session_most_recent_cheerer" => "latest_bits",
        "most_recent_gifter" | "most_recent_sub_gifter" => "latest_gift",
        "most_recent_raider" | "most_recent_host" => "latest_raid",
        "all_time_top_donator" | "all_time_top_donation" | "monthly_top_donator" | "weekly_top_donator" => "top_donation",
        "all_time_top_cheerer" | "all_time_top_cheer" | "monthly_top_cheerer" | "weekly_top_cheerer" => "top_bits",
        "session_top_donator" | "session_top_donation" => "session_top_donation",
        "session_top_cheerer" | "session_top_cheer" => "session_top_bits",
        "session_follower_count" | "session_followers" => "session_follows",
        "session_subscriber_count" | "session_subscribers" => "session_subs",
        "session_cheer_amount" | "session_bits" => "session_bits",
        "session_donation_amount" | "session_donations" => "session_donations",
        _ => return None,
    })
}

/// Old imports and hand-made sources: guess from the name, only when the text is still a
/// placeholder (so a real text the streamer typed is never replaced).
pub fn guess(name: &str, text: &str) -> Option<&'static str> {
    let t = text.trim().to_lowercase();
    let placeholder = ["último", "ultimo", "latest", "recent", "most recent", "top ", "mayor", "seguidores (", "suscriptores ("].iter().any(|p| t.starts_with(p)) || t.contains('{');
    if !placeholder {
        return None;
    }
    // What it shows is decided by the source's name only (the text is just a placeholder),
    // matching whole words ("sub" ≠ "subtítulos", "tip" ≠ "tipo").
    let words: Vec<String> = name.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect();
    let has = |w: &[&str]| {
        w.iter().any(|x| {
            let (stem, exact) = x.strip_suffix('=').map(|s| (s, true)).unwrap_or((*x, false));
            words.iter().any(|word| if exact { word == stem } else { word.starts_with(stem) })
        })
    };
    let top = has(&["top=", "mayor=", "biggest", "best="]);
    let session = has(&["session", "sesión", "sesion", "directo=", "stream="]) && has(&["count", "total", "contador"]);
    Some(if has(&["follow", "seguidor"]) {
        if session { "session_follows" } else { "latest_follower" }
    } else if has(&["gift", "regal"]) {
        "latest_gift"
    } else if has(&["subscri", "suscrip", "sub=", "subs=", "miembro", "member"]) {
        if session { "session_subs" } else { "latest_subscriber" }
    } else if has(&["donat", "donac", "donador", "tip=", "tips="]) {
        if top { "top_donation" } else { "latest_donation" }
    } else if has(&["cheer", "bits"]) {
        if top { "top_bits" } else { "latest_bits" }
    } else if has(&["raid", "host"]) {
        "latest_raid"
    } else {
        return None;
    })
}

fn money(amount: f64, currency: &str) -> String {
    let n = if (amount - amount.round()).abs() < 0.005 { format!("{}", amount.round() as i64) } else { format!("{amount:.2}") };
    match currency.to_uppercase().as_str() {
        "EUR" => format!("{} €", n.replace('.', ",")),
        "USD" | "MXN" | "ARS" | "COP" | "CLP" | "CAD" | "AUD" => format!("${n}"),
        "GBP" => format!("£{n}"),
        "BRL" => format!("R${}", n.replace('.', ",")),
        "" => n,
        c => format!("{n} {c}"),
    }
}

fn number(v: f64) -> String {
    if (v - v.round()).abs() < 0.005 {
        format!("{}", v.round() as i64)
    } else {
        format!("{v:.2}")
    }
}

fn clock(ms: i64) -> String {
    let s = (ms.max(0) + 999) / 1000;
    let (h, m, x) = (s / 3600, (s % 3600) / 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{x:02}")
    } else {
        format!("{m}:{x:02}")
    }
}

/// The text a value shows (None: nothing to show yet).
pub fn render(label: &str, template: &str, s: &AppState) -> Option<String> {
    let d = &s.labels;
    let currency = d.latest.get("donation").and_then(|e| e.currency.clone()).unwrap_or_else(|| s.widgets.goal.currency.clone());
    let tpl = if template.trim().is_empty() { s.widgets.labels.templates.get(label).cloned().unwrap_or_else(|| default_template(label).to_string()) } else { template.to_string() };
    if let Some(id) = label.strip_prefix("counter:") {
        let c = s.counters.iter().find(|c| c.id == id || c.name.eq_ignore_ascii_case(id))?;
        let tpl = if template.trim().is_empty() { "{value}".to_string() } else { template.to_string() };
        return Some(tpl.replace("{name}", &c.name).replace("{value}", &c.value.to_string()));
    }
    if label == "countdown" {
        let c = &s.countdown;
        let left = c.paused_left_ms.or_else(|| c.ends_at.map(|e| e - now_ms()))?;
        if left <= 0 {
            return Some(c.end_text.clone());
        }
        return Some(tpl.replace("{time}", &clock(left)).replace("{label}", &c.label));
    }
    let (group, key) = match label {
        "latest_follower" => ("latest", "follow"),
        "latest_subscriber" => ("latest", "subscription"),
        "latest_gift" => ("latest", "gift_sub"),
        "latest_bits" => ("latest", "bits"),
        "latest_donation" => ("latest", "donation"),
        "latest_raid" => ("latest", "raid"),
        "top_donation" => ("top", "donation"),
        "top_bits" => ("top", "bits"),
        "top_raid" => ("top", "raid"),
        "session_top_donation" => ("session_top", "donation"),
        "session_top_bits" => ("session_top", "bits"),
        "session_follows" => ("session", "follows"),
        "session_subs" => ("session", "subs"),
        "session_bits" => ("session", "bits"),
        "session_donations" => ("session", "donations"),
        "session_raids" => ("session", "raids"),
        "total_followers" => ("totals", "followers"),
        "total_subs" => ("totals", "subs"),
        _ => return None,
    };
    let (user, amount, count) = if group == "session" || group == "totals" {
        let v = *(if group == "totals" { &d.totals } else { &d.session }).get(key)?;
        ("".to_string(), if key == "donations" { money(v, &currency) } else { number(v) }, number(v))
    } else {
        let map = match group {
            "latest" => &d.latest,
            "top" => &d.top,
            _ => &d.session_top,
        };
        let e = map.get(key)?;
        let amt = e.amount.map(|a| if key == "donation" { money(a, e.currency.as_deref().unwrap_or(&currency)) } else { number(a) }).unwrap_or_default();
        (e.user.clone(), amt.clone(), amt)
    };
    Some(tpl.replace("{user}", &user).replace("{amount}", &amount).replace("{count}", &count))
}

pub fn default_template(label: &str) -> &'static str {
    LABELS.iter().find(|(id, _)| *id == label).map(|(_, t)| *t).unwrap_or("{user}")
}

struct Bound {
    uuid: String,
    label: String,
    template: String,
}

/// Keep every linked text source up to date (once a second; new links found every few seconds).
pub async fn run(core: Arc<Core>) {
    let mut bound: Vec<Bound> = vec![];
    let mut shown: HashMap<String, String> = HashMap::new();
    let mut tick: u64 = 0;
    loop {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if core.is_stopping() {
            return;
        }
        if !core.engine.is_ready() {
            continue;
        }
        if tick.is_multiple_of(4) {
            let snap = core.engine.snapshot();
            bound.clear();
            for src in snap.sources.iter().filter(|s| s.kind.starts_with("text_")) {
                let st = &src.settings;
                // Safety net: a theme font Windows can't draw leaves the text invisible (no
                // width): go back to Arial so it's always readable.
                let face = st["font"]["face"].as_str().unwrap_or_default();
                let has_text = !st["text"].as_str().unwrap_or_default().trim().is_empty();
                if st["custom_font"].as_str().is_some_and(|c| !c.is_empty()) && !face.eq_ignore_ascii_case("arial") && has_text && src.width <= 4 {
                    let mut font = st["font"].clone();
                    font["face"] = json!("Arial");
                    let _ = core.engine.set_source_fields(&src.uuid.to_string(), &json!({ "font": font }), true);
                    tracing::warn!("«{}»: la fuente «{face}» no se puede dibujar todavía; se usa Arial", src.name);
                }
                let label = match st.get(KEY) {
                    Some(Value::String(l)) => l.clone(),
                    Some(_) => continue,
                    None => {
                        // Not decided yet: link placeholders by their name, once.
                        let text = st["text"].as_str().unwrap_or_default();
                        match guess(&src.name, text) {
                            Some(l) => {
                                let _ = core.engine.set_source_fields(&src.uuid.to_string(), &json!({ KEY: l }), true);
                                l.to_string()
                            }
                            None => continue,
                        }
                    }
                };
                if label.is_empty() {
                    continue;
                }
                shown.entry(src.uuid.to_string()).or_insert_with(|| st["text"].as_str().unwrap_or_default().to_string());
                bound.push(Bound { uuid: src.uuid.to_string(), label, template: st[TEMPLATE_KEY].as_str().unwrap_or_default().to_string() });
            }
        }
        tick += 1;
        if bound.is_empty() {
            continue;
        }
        let texts: Vec<(String, String)> = core.read(|s| {
            let empty = s.widgets.labels.empty_text.clone();
            bound.iter().map(|b| (b.uuid.clone(), render(&b.label, &b.template, s).unwrap_or_else(|| empty.clone()))).collect()
        });
        for (uuid, text) in texts {
            if shown.get(&uuid) != Some(&text) && core.engine.set_source_fields(&uuid, &json!({ "text": text }), false).is_ok() {
                shown.insert(uuid, text);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guesses_only_placeholders() {
        assert_eq!(guess("Latest Follower 2", "Último seguidor"), Some("latest_follower"));
        assert_eq!(guess("Recent Subscriber 2", "Último suscriptor"), Some("latest_subscriber"));
        assert_eq!(guess("Recent Donator 2", "Último donador"), Some("latest_donation"));
        assert_eq!(guess("Recent Cheer 2", "Último cheer"), Some("latest_bits"));
        assert_eq!(guess("Top Donator", "Mayor donador"), Some("top_donation"));
        assert_eq!(guess("Latest Follower", "¡Gracias a todos!"), None, "a real text stays");
        assert_eq!(guess("Título", "Último vídeo"), None);
        assert_eq!(guess("Info", "Último seguidor"), None, "the name decides, not the text");
        assert_eq!(guess("Subtítulos", "Último"), None, "whole words: sub ≠ subtítulos");
        assert_eq!(guess("Texto tipo", "Top"), None, "tip ≠ tipo");
        assert_eq!(guess("Latest Sub", "Último sub"), Some("latest_subscriber"));
        assert_eq!(guess("Latest Follower", ""), None, "an empty text is not a placeholder");
    }

    #[test]
    fn renders_values() {
        let mut s = AppState::default();
        assert_eq!(render("latest_follower", "", &s), None);
        s.labels.record(AlertType::Follow, "Ana", None, None, 1, Some(5));
        s.labels.record(AlertType::Donation, "Leo", Some(5.5), Some("EUR".into()), 2, Some(5));
        assert_eq!(render("latest_follower", "", &s).as_deref(), Some("Ana"));
        assert_eq!(render("latest_donation", "", &s).as_deref(), Some("Leo · 5,50 €"));
        assert_eq!(render("latest_follower", "Gracias {user}!", &s).as_deref(), Some("Gracias Ana!"));
        assert_eq!(render("session_follows", "", &s).as_deref(), Some("1"));
        s.counters.push(Counter { id: "c1".into(), name: "Muertes".into(), value: 3, ..Default::default() });
        assert_eq!(render("counter:c1", "", &s).as_deref(), Some("3"));
        assert_eq!(render("counter:muertes", "{name}: {value}", &s).as_deref(), Some("Muertes: 3"));
        assert_eq!(from_streamlabs("most_recent_follower"), Some("latest_follower"));
    }
}
