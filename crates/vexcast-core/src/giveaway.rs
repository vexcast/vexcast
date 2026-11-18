//! Giveaways across every platform: viewers join with a keyword (!participar), optionally
//! paying loyalty points; subscribers can get extra tickets; the winner is drawn at random
//! (and can be re-drawn) and revealed by the giveaway overlay.

use crate::core::Core;
use crate::model::*;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Weak};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GiveawayWinner {
    pub name: String,
    pub platform: ChatPlatform,
}

/// What clients and the overlay see.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Giveaway {
    pub id: Id,
    pub title: String,
    /// What viewers type to join ("!participar").
    pub keyword: String,
    /// Loyalty points to join (0 = free).
    pub cost: u64,
    /// Subscribers / members get this many tickets.
    pub sub_tickets: u32,
    pub open: bool,
    pub entries: usize,
    /// Latest people who joined (for the overlay).
    pub recent: Vec<String>,
    /// Some names to spin through before the winner (overlay animation).
    pub sample: Vec<String>,
    pub winner: Option<GiveawayWinner>,
    /// Bumps on every draw (the overlay plays the reveal again).
    pub draws: u32,
    pub started_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewGiveaway {
    pub title: String,
    #[serde(default)]
    pub keyword: String,
    #[serde(default)]
    pub cost: u64,
    #[serde(default = "one")]
    pub sub_tickets: u32,
    #[serde(default = "yes_")]
    pub announce: bool,
}
fn one() -> u32 {
    1
}
fn yes_() -> bool {
    true
}

struct Entry {
    platform: ChatPlatform,
    name: String,
    tickets: u32,
    won: bool,
}

#[derive(Default)]
struct Current {
    g: Option<Giveaway>,
    entries: Vec<Entry>,
    announce: bool,
}

pub struct Giveaways {
    _core: Weak<Core>,
    cur: Mutex<Current>,
}

/// Index of the ticket-weighted random pick among entries that haven't won (r in [0,1)).
pub fn pick(tickets: &[(u32, bool)], r: f64) -> Option<usize> {
    let total: u32 = tickets.iter().filter(|(_, won)| !won).map(|(t, _)| *t).sum();
    if total == 0 {
        return None;
    }
    let mut x = (r * total as f64).floor() as u32;
    for (i, (t, won)) in tickets.iter().enumerate() {
        if *won {
            continue;
        }
        if x < *t {
            return Some(i);
        }
        x -= t;
    }
    None
}

impl Giveaways {
    pub fn new(core: Weak<Core>) -> Self {
        Self { _core: core, cur: Mutex::new(Current::default()) }
    }

    pub fn current(&self) -> Option<Giveaway> {
        self.cur.lock().g.clone()
    }

    fn emit(&self, core: &Arc<Core>) {
        core.emit(ServerEvent::Giveaway(self.current()));
    }

    pub fn start(&self, core: &Arc<Core>, n: NewGiveaway) -> Result<Giveaway, String> {
        if n.title.trim().is_empty() {
            return Err("Pon qué sorteas".into());
        }
        if n.cost > 0 && !core.read(|s| s.bot.enabled && s.bot.loyalty.enabled) {
            return Err("Para cobrar puntos, activa los puntos en Bot → Puntos".into());
        }
        let prefix = core.read(|s| s.bot.prefix.clone());
        let kw = n.keyword.trim().to_lowercase();
        let keyword = if kw.is_empty() { format!("{prefix}participar") } else { kw };
        let g = Giveaway {
            id: new_id(),
            title: n.title.trim().to_string(),
            keyword,
            cost: n.cost,
            sub_tickets: n.sub_tickets.clamp(1, 10),
            open: true,
            entries: 0,
            recent: vec![],
            sample: vec![],
            winner: None,
            draws: 0,
            started_at: now_ms(),
        };
        self.refund(core);
        *self.cur.lock() = Current { g: Some(g.clone()), entries: vec![], announce: n.announce };
        self.emit(core);
        if n.announce {
            let unit = core.read(|s| s.bot.loyalty.name.clone());
            let cost = if g.cost > 0 { format!(" (cuesta {} {unit})", g.cost) } else { String::new() };
            say(core, &format!("🎁 Sorteo: {} · Escribe {} para participar{cost}", g.title, g.keyword));
        }
        Ok(g)
    }

    /// Stop taking entries.
    pub fn close(&self, core: &Arc<Core>) -> Option<Giveaway> {
        let (g, announce) = {
            let mut c = self.cur.lock();
            let announce = c.announce;
            let g = c.g.as_mut()?;
            g.open = false;
            (g.clone(), announce)
        };
        self.emit(core);
        if announce {
            say(core, &format!("🎁 Inscripciones cerradas: {} participantes", g.entries));
        }
        Some(g)
    }

    /// Draw a winner among those who haven't won yet (closes the entries).
    pub fn draw(&self, core: &Arc<Core>) -> Result<Giveaway, String> {
        let (g, announce) = {
            let mut c = self.cur.lock();
            let announce = c.announce;
            let tickets: Vec<(u32, bool)> = c.entries.iter().map(|e| (e.tickets, e.won)).collect();
            let i = pick(&tickets, rand::random::<f64>()).ok_or("No queda nadie por sortear")?;
            c.entries[i].won = true;
            let w = GiveawayWinner { name: c.entries[i].name.clone(), platform: c.entries[i].platform };
            // Names to spin through in the overlay (random order, winner excluded).
            let mut sample: Vec<String> = c.entries.iter().filter(|e| e.name != w.name).map(|e| e.name.clone()).collect();
            for k in (1..sample.len()).rev() {
                sample.swap(k, rand::random::<usize>() % (k + 1));
            }
            sample.truncate(24);
            let g = c.g.as_mut().ok_or("No hay ningún sorteo")?;
            g.open = false;
            g.winner = Some(w);
            g.sample = sample;
            g.draws += 1;
            (g.clone(), announce)
        };
        self.emit(core);
        if announce {
            if let Some(w) = &g.winner {
                let core = core.clone();
                let text = format!("🎉 ¡{} gana el sorteo «{}»!", w.name, g.title);
                // After the overlay's spin.
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(4500)).await;
                    say(&core, &text);
                });
            }
        }
        Ok(g)
    }

    /// Give back entry fees when the giveaway ends without a winner.
    pub fn refund(&self, core: &Arc<Core>) {
        self.refund_to(&core.loyalty);
    }

    pub fn refund_to(&self, loyalty: &crate::loyalty::Loyalty) {
        let mut c = self.cur.lock();
        let cost = c.g.as_ref().filter(|g| g.winner.is_none()).map(|g| g.cost).unwrap_or(0);
        if cost > 0 {
            for e in std::mem::take(&mut c.entries) {
                loyalty.add(e.platform, &e.name, cost as i64);
            }
        }
    }

    pub fn clear(&self, core: &Arc<Core>) {
        self.refund(core);
        *self.cur.lock() = Current::default();
        self.emit(core);
    }

    /// A chat message: joins the giveaway when it's the keyword. Returns true if it was.
    pub fn on_message(&self, core: &Arc<Core>, msg: &ChatMessage) -> bool {
        if msg.is_bot {
            return false;
        }
        let (keyword, cost) = match self.cur.lock().g.as_ref().filter(|g| g.open) {
            Some(g) => (g.keyword.clone(), g.cost),
            None => return false,
        };
        if msg.text.trim().to_lowercase() != keyword {
            return false;
        }
        let name = msg.user.name.clone();
        if self.cur.lock().entries.iter().any(|e| e.platform == msg.platform && e.name.eq_ignore_ascii_case(&name)) {
            return true;
        }
        if cost > 0 && !core.loyalty.try_spend(msg.platform, &name, cost as i64) {
            let (have, _) = core.loyalty.points(msg.platform, &name);
            let unit = core.read(|s| s.bot.loyalty.name.clone());
            let t = format!("@{name} necesitas {cost} {unit} para participar (tienes {have})");
            core.chat.send(&t, Some(vec![msg.platform]));
            core.chat.local_echo(core, "Vexcast Bot", &t, true);
            return true;
        }
        {
            let mut c = self.cur.lock();
            let sub_tickets = c.g.as_ref().map(|g| g.sub_tickets).unwrap_or(1);
            let tickets = if crate::bot::role(msg) >= 1 { sub_tickets } else { 1 };
            c.entries.push(Entry { platform: msg.platform, name: name.clone(), tickets, won: false });
            let n = c.entries.len();
            if let Some(g) = c.g.as_mut() {
                g.entries = n;
                g.recent.insert(0, name);
                g.recent.truncate(8);
            }
        }
        self.emit(core);
        true
    }
}

fn say(core: &Arc<Core>, text: &str) {
    core.chat.send(text, None);
    core.chat.local_echo(core, "Vexcast Bot", text, true);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weighted_pick_skips_winners() {
        let t = [(1, false), (3, false), (1, true)];
        assert_eq!(pick(&t, 0.0), Some(0));
        assert_eq!(pick(&t, 0.3), Some(1), "the sub with 3 tickets covers 1..4 of 4");
        assert_eq!(pick(&t, 0.99), Some(1));
        assert_eq!(pick(&[(1, true)], 0.5), None);
        assert_eq!(pick(&[], 0.5), None);
    }
}
