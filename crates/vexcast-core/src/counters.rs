//! Counters (deaths, wins…) and a countdown / subathon timer. Both live in the app state
//! (so they survive restarts and reach every client and overlay) and can be changed from
//! the app, chat commands, macros (hotkeys) and, for the timer, alerts.

use crate::core::Core;
use crate::model::*;
use std::sync::Arc;

/// Chat command for a counter: "!muertes" shows it; mods: "!muertes+", "!muertes-", "!muertes=5".
pub enum CounterOp {
    Show,
    Add(i64),
    Set(i64),
}

pub fn parse_counter(text: &str, prefix: &str, command: &str) -> Option<CounterOp> {
    let cmd = command.trim().trim_start_matches(prefix).to_lowercase();
    if cmd.is_empty() {
        return None;
    }
    let t = text.trim().to_lowercase();
    let rest = t.strip_prefix(prefix)?.strip_prefix(cmd.as_str())?;
    let rest = rest.trim();
    if rest.is_empty() {
        return Some(CounterOp::Show);
    }
    if let Some(v) = rest.strip_prefix('=') {
        return v.trim().parse().ok().map(CounterOp::Set);
    }
    if let Some(v) = rest.strip_prefix('+') {
        let v = v.trim();
        return Some(CounterOp::Add(if v.is_empty() { 1 } else { v.parse().ok()? }));
    }
    if let Some(v) = rest.strip_prefix('-') {
        let v = v.trim();
        return Some(CounterOp::Add(-(if v.is_empty() { 1 } else { v.parse::<i64>().ok()? })));
    }
    None
}

/// Change a counter (by id or name). Returns the new value.
pub fn add(core: &Arc<Core>, key: &str, delta: i64) -> Option<i64> {
    core.update(|s| {
        let c = s.counters.iter_mut().find(|c| c.id == key || c.name.eq_ignore_ascii_case(key))?;
        c.value = c.value.saturating_add(delta);
        Some(c.value)
    })
}

pub fn set(core: &Arc<Core>, key: &str, value: i64) -> Option<i64> {
    core.update(|s| {
        let c = s.counters.iter_mut().find(|c| c.id == key || c.name.eq_ignore_ascii_case(key))?;
        c.value = value;
        Some(c.value)
    })
}

/// Counter commands in chat. Returns true when the message was one.
pub fn on_message(core: &Arc<Core>, msg: &ChatMessage) -> bool {
    let (counters, prefix, enabled) = core.read(|s| (s.counters.clone(), s.bot.prefix.clone(), s.bot.enabled));
    if !enabled || msg.is_bot {
        return false;
    }
    for c in &counters {
        let Some(op) = parse_counter(&msg.text, &prefix, &c.command) else { continue };
        let is_mod = crate::bot::role(msg) >= 3;
        let value = match op {
            CounterOp::Show => Some(c.value),
            CounterOp::Add(d) if is_mod => add(core, &c.id, d),
            CounterOp::Set(v) if is_mod => set(core, &c.id, v),
            _ => return true,
        };
        if let Some(v) = value {
            let t = format!("{}: {v}", c.name);
            core.chat.send(&t, Some(vec![msg.platform]));
            core.chat.local_echo(core, "Vexcast Bot", &t, true);
        }
        return true;
    }
    false
}

/// Countdown actions: start (seconds), add (seconds, may be negative), pause, resume, stop.
pub fn countdown(core: &Arc<Core>, action: &str, seconds: i64) -> Countdown {
    core.update(|s| {
        let c = &mut s.countdown;
        let now = now_ms();
        match action {
            "start" => {
                c.ends_at = Some(now.saturating_add(seconds.clamp(0, 100 * 24 * 3600) * 1000));
                c.paused_left_ms = None;
            }
            "add" => {
                let ms = seconds.clamp(-100 * 24 * 3600, 100 * 24 * 3600) * 1000;
                if let Some(left) = c.paused_left_ms.as_mut() {
                    *left = left.saturating_add(ms).max(0);
                } else if let Some(end) = c.ends_at.as_mut() {
                    *end = (*end).max(now).saturating_add(ms);
                    if *end < now {
                        *end = now;
                    }
                }
            }
            "pause" => {
                if let Some(end) = c.ends_at.take() {
                    c.paused_left_ms = Some((end - now).max(0));
                }
            }
            "resume" => {
                if let Some(left) = c.paused_left_ms.take() {
                    c.ends_at = Some(now + left);
                }
            }
            _ => {
                c.ends_at = None;
                c.paused_left_ms = None;
            }
        }
        c.clone()
    })
}

/// Subathon: alerts add time to a running (or paused) countdown.
pub fn on_alert(core: &Arc<Core>, kind: AlertType, amount: Option<f64>) {
    let (c, running) = core.read(|s| (s.countdown.clone(), s.countdown.ends_at.is_some_and(|e| e > now_ms()) || s.countdown.paused_left_ms.is_some()));
    if !running || !c.subathon {
        return;
    }
    let a = amount.unwrap_or(0.0);
    let secs = match kind {
        AlertType::Follow => c.add_follow_sec as f64,
        AlertType::Subscription | AlertType::Member => c.add_sub_sec as f64,
        AlertType::GiftSub => c.add_sub_sec as f64 * a.max(1.0),
        AlertType::Bits => c.add_per_100_bits_sec as f64 * a / 100.0,
        AlertType::Donation | AlertType::Kofi | AlertType::Superchat => c.add_per_currency_sec as f64 * a,
        AlertType::Raid | AlertType::Host => 0.0,
    }
    .round() as i64;
    if secs > 0 {
        countdown(core, "add", secs);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counter_commands() {
        assert!(matches!(parse_counter("!muertes", "!", "muertes"), Some(CounterOp::Show)));
        assert!(matches!(parse_counter("!Muertes+", "!", "!muertes"), Some(CounterOp::Add(1))));
        assert!(matches!(parse_counter("!muertes -2", "!", "muertes"), Some(CounterOp::Add(-2))));
        assert!(matches!(parse_counter("!muertes=10", "!", "muertes"), Some(CounterOp::Set(10))));
        assert!(parse_counter("!muertesxd", "!", "muertes").is_none());
        assert!(parse_counter("muertes", "!", "muertes").is_none());
    }
}
