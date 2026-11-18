//! Chat polls counted across every connected platform at once (Twitch + YouTube + Kick):
//! viewers vote by typing the option number (or !vote N). One vote per viewer per platform.

use crate::core::Core;
use crate::model::*;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Arc, Weak};
use std::time::Duration;

/// What clients and the overlay see.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Poll {
    pub id: Id,
    pub question: String,
    pub options: Vec<String>,
    pub votes: Vec<u32>,
    pub started_at: i64,
    /// When voting closes (None: until ended by hand).
    pub ends_at: Option<i64>,
    /// Voting is open.
    pub open: bool,
    /// Winning option indexes once closed (several on a tie).
    pub winners: Vec<usize>,
    /// Prediction: viewers bet loyalty points instead of voting.
    #[serde(default)]
    pub prediction: bool,
    /// Points bet on each option (predictions).
    #[serde(default)]
    pub bets: Vec<i64>,
    /// Prediction settled: the right option (None while pending, or refunded).
    #[serde(default)]
    pub result: Option<usize>,
    /// Prediction cancelled and refunded.
    #[serde(default)]
    pub refunded: bool,
}

impl Poll {
    pub fn total(&self) -> u32 {
        self.votes.iter().sum()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPoll {
    pub question: String,
    pub options: Vec<String>,
    /// Seconds of voting (0 = until ended by hand).
    #[serde(default)]
    pub duration_sec: u32,
    /// Announce it (and the result) in chat through the bot.
    #[serde(default = "yes_")]
    pub announce: bool,
    /// Viewers bet loyalty points ("!apostar 2 100").
    #[serde(default)]
    pub prediction: bool,
}
fn yes_() -> bool {
    true
}

#[derive(Default)]
struct Current {
    poll: Option<Poll>,
    voters: HashSet<String>,
    announce: bool,
    /// Predictions: (platform, viewer, option, points).
    stakes: Vec<(ChatPlatform, String, usize, i64)>,
}

pub struct Polls {
    _core: Weak<Core>,
    cur: Mutex<Current>,
}

/// A bet: "!apostar 2 100" / "!bet 2 100" / "!apuesta 2 todo" → (option 0-based, points or -1 for all).
pub fn parse_bet(text: &str, options: usize) -> Option<(usize, i64)> {
    let t = text.trim().to_lowercase();
    let rest = t.strip_prefix("!apostar").or_else(|| t.strip_prefix("!apuesta")).or_else(|| t.strip_prefix("!bet"))?;
    let mut it = rest.split_whitespace();
    let n: usize = it.next()?.trim_start_matches('#').parse().ok()?;
    let amt = it.next()?;
    let pts = if matches!(amt, "todo" | "all" | "allin") { -1 } else { amt.parse::<i64>().ok().filter(|p| *p > 0)? };
    (n >= 1 && n <= options).then_some((n - 1, pts))
}

/// Option a message votes for (0-based), if it's a vote: "2", "!2", "!vote 2", "!votar 2".
pub fn parse_vote(text: &str, options: usize) -> Option<usize> {
    let t = text.trim().to_lowercase();
    let t = t.strip_prefix("!vote").or_else(|| t.strip_prefix("!votar")).or_else(|| t.strip_prefix("!voto")).unwrap_or(&t);
    let t = t.trim().trim_start_matches('!').trim().trim_start_matches('#');
    let n: usize = t.parse().ok()?;
    (n >= 1 && n <= options).then(|| n - 1)
}

impl Polls {
    pub fn new(core: Weak<Core>) -> Self {
        Self { _core: core, cur: Mutex::new(Current::default()) }
    }

    pub fn current(&self) -> Option<Poll> {
        self.cur.lock().poll.clone()
    }

    fn emit(&self, core: &Arc<Core>) {
        core.emit(ServerEvent::Poll(self.current()));
    }

    pub fn start(self: &Arc<Self>, core: &Arc<Core>, p: NewPoll) -> Result<Poll, String> {
        let options: Vec<String> = p.options.iter().map(|o| o.trim().to_string()).filter(|o| !o.is_empty()).take(6).collect();
        if p.question.trim().is_empty() || options.len() < 2 {
            return Err("La encuesta necesita una pregunta y al menos dos opciones".into());
        }
        if p.prediction && !core.read(|s| s.bot.enabled && s.bot.loyalty.enabled) {
            return Err("Las predicciones usan los puntos de fidelidad: actívalos en Bot → Puntos".into());
        }
        // A pending prediction is refunded before replacing it.
        self.cancel(core);
        let now = now_ms();
        let poll = Poll {
            id: new_id(),
            question: p.question.trim().to_string(),
            votes: vec![0; options.len()],
            options,
            started_at: now,
            ends_at: (p.duration_sec > 0).then(|| now + p.duration_sec as i64 * 1000),
            open: true,
            winners: vec![],
            prediction: p.prediction,
            bets: vec![0; options_len(&p)],
            result: None,
            refunded: false,
        };
        *self.cur.lock() = Current { poll: Some(poll.clone()), voters: HashSet::new(), announce: p.announce, stakes: vec![] };
        self.emit(core);
        if p.announce {
            let opts: Vec<String> = poll.options.iter().enumerate().map(|(i, o)| format!("{} = {}", i + 1, o)).collect();
            if poll.prediction {
                let unit = core.read(|s| s.bot.loyalty.name.clone());
                say(core, &format!("🔮 {} · Apuesta tus {unit}: !apostar <número> <cantidad> · {}", poll.question, opts.join(" · ")));
            } else {
                say(core, &format!("📊 {} · Vota escribiendo el número: {}", poll.question, opts.join(" · ")));
            }
        }
        if p.duration_sec > 0 {
            let me = self.clone();
            let id = poll.id.clone();
            let c = core.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(p.duration_sec as u64)).await;
                if me.current().is_some_and(|x| x.id == id && x.open) {
                    me.end(&c);
                }
            });
        }
        Ok(poll)
    }

    /// Close voting and work out the winner(s).
    pub fn end(&self, core: &Arc<Core>) -> Option<Poll> {
        let (poll, announce) = {
            let mut c = self.cur.lock();
            let announce = c.announce;
            let p = c.poll.as_mut()?;
            if !p.open {
                return Some(p.clone());
            }
            p.open = false;
            p.ends_at = Some(now_ms());
            if p.prediction {
                // Bets are closed; the streamer picks the result afterwards.
                let x = p.clone();
                drop(c);
                self.emit(core);
                if announce {
                    say(core, &format!("🔮 Apuestas cerradas: {}", x.question));
                }
                return Some(x);
            }
            let max = p.votes.iter().copied().max().unwrap_or(0);
            p.winners = if max == 0 { vec![] } else { p.votes.iter().enumerate().filter(|(_, v)| **v == max).map(|(i, _)| i).collect() };
            (p.clone(), announce)
        };
        self.emit(core);
        if announce {
            let total = poll.total();
            let text = if poll.winners.is_empty() {
                format!("📊 Encuesta cerrada: {} · Nadie ha votado.", poll.question)
            } else {
                let names: Vec<&str> = poll.winners.iter().map(|&i| poll.options[i].as_str()).collect();
                let pct = poll.votes[poll.winners[0]] as f64 * 100.0 / total.max(1) as f64;
                format!("📊 Resultado: {} → {} ({:.0}%, {} votos en total)", poll.question, names.join(" / "), pct, total)
            };
            say(core, &text);
        }
        Some(poll)
    }

    /// Settle a prediction: whoever bet on `winner` gets their stake back plus a share of the
    /// other bets, proportional to what they bet.
    pub fn resolve(&self, core: &Arc<Core>, winner: usize) -> Result<Poll, String> {
        let (poll, stakes, announce) = {
            let mut c = self.cur.lock();
            let announce = c.announce;
            let stakes = c.stakes.clone();
            let p = c.poll.as_mut().filter(|p| p.prediction && p.result.is_none() && !p.refunded).ok_or("No hay ninguna predicción pendiente")?;
            if winner >= p.options.len() {
                return Err("Esa opción no existe".into());
            }
            p.open = false;
            p.result = Some(winner);
            p.winners = vec![winner];
            (p.clone(), stakes, announce)
        };
        let pool: i64 = stakes.iter().map(|s| s.3).sum();
        let won: i64 = stakes.iter().filter(|s| s.2 == winner).map(|s| s.3).sum();
        let mut best: Option<(String, i64)> = None;
        for (pf, name, _, bet) in stakes.iter().filter(|s| s.2 == winner) {
            let pay = payout(*bet, won, pool);
            core.loyalty.add(*pf, name, pay);
            if best.as_ref().is_none_or(|b| pay > b.1) {
                best = Some((name.clone(), pay));
            }
        }
        core.loyalty.save();
        self.emit(core);
        if announce {
            let unit = core.read(|s| s.bot.loyalty.name.clone());
            let n = stakes.iter().filter(|s| s.2 == winner).count();
            let extra = best.map(|(u, p)| format!(" · Mayor premio: {u} (+{p})")).unwrap_or_default();
            say(core, &format!("🔮 Resultado: {} → {} · {n} ganadores se reparten {pool} {unit}{extra}", poll.question, poll.options[winner]));
        }
        Ok(poll)
    }

    /// Cancel a pending prediction and give everyone their points back.
    pub fn cancel(&self, core: &Arc<Core>) {
        let (stakes, announce, q) = {
            let mut c = self.cur.lock();
            let Some(p) = c.poll.as_mut().filter(|p| p.prediction && p.result.is_none() && !p.refunded) else { return };
            p.open = false;
            p.refunded = true;
            let q = p.question.clone();
            let announce = c.announce;
            (std::mem::take(&mut c.stakes), announce, q)
        };
        for (pf, name, _, bet) in &stakes {
            core.loyalty.add(*pf, name, *bet);
        }
        core.loyalty.save();
        self.emit(core);
        if announce && !stakes.is_empty() {
            say(core, &format!("🔮 Predicción cancelada ({q}): se han devuelto todas las apuestas"));
        }
    }

    /// Closing Vexcast: give back the points of a prediction that wasn't settled.
    pub fn refund_on_exit(&self, loyalty: &crate::loyalty::Loyalty) {
        let mut c = self.cur.lock();
        if c.poll.as_ref().is_some_and(|p| p.prediction && p.result.is_none() && !p.refunded) {
            for (pf, name, _, bet) in std::mem::take(&mut c.stakes) {
                loyalty.add(pf, &name, bet);
            }
        }
    }

    /// Remove it from the screen (a pending prediction is refunded).
    pub fn clear(&self, core: &Arc<Core>) {
        self.cancel(core);
        *self.cur.lock() = Current::default();
        self.emit(core);
    }

    /// A chat message: counts it when it's a vote. Returns true if it was.
    pub fn on_message(&self, core: &Arc<Core>, msg: &ChatMessage) -> bool {
        if msg.is_bot {
            return false;
        }
        let prediction = self.cur.lock().poll.as_ref().is_some_and(|p| p.open && p.prediction);
        if prediction {
            return self.bet(core, msg);
        }
        {
            let mut c = self.cur.lock();
            let Some(p) = c.poll.as_ref().filter(|p| p.open) else { return false };
            let Some(i) = parse_vote(&msg.text, p.options.len()) else { return false };
            let who = format!("{:?}:{}", msg.platform, msg.user.name.to_lowercase());
            if !c.voters.insert(who) {
                return false;
            }
            if let Some(p) = c.poll.as_mut() {
                p.votes[i] += 1;
            }
        }
        self.emit(core);
        true
    }
}

impl Polls {
    fn bet(&self, core: &Arc<Core>, msg: &ChatMessage) -> bool {
        let (poll_id, options) = match self.cur.lock().poll.as_ref() {
            Some(p) => (p.id.clone(), p.options.len()),
            None => return false,
        };
        let Some((i, want)) = parse_bet(&msg.text, options) else { return false };
        let who = format!("{:?}:{}", msg.platform, msg.user.name.to_lowercase());
        let unit = core.read(|s| s.bot.loyalty.name.clone());
        let reply = |t: String| {
            core.chat.send(&t, Some(vec![msg.platform]));
            core.chat.local_echo(core, "Vexcast Bot", &t, true);
        };
        if self.cur.lock().voters.contains(&who) {
            reply(format!("@{} ya has apostado en esta predicción", msg.user.name));
            return true;
        }
        let (have, _) = core.loyalty.points(msg.platform, &msg.user.name);
        let amount = if want < 0 { have } else { want };
        if amount <= 0 || !core.loyalty.try_spend(msg.platform, &msg.user.name, amount) {
            reply(format!("@{} no tienes suficientes {unit} ({have})", msg.user.name));
            return true;
        }
        let placed = {
            let mut c = self.cur.lock();
            // Still the same open prediction (not cancelled or replaced meanwhile)?
            let ok = c.poll.as_ref().is_some_and(|p| p.id == poll_id && p.open && !p.refunded && i < p.votes.len() && i < p.bets.len()) && !c.voters.contains(&who);
            if ok {
                c.voters.insert(who);
                c.stakes.push((msg.platform, msg.user.name.clone(), i, amount));
                if let Some(p) = c.poll.as_mut() {
                    p.votes[i] += 1;
                    p.bets[i] += amount;
                }
            }
            ok
        };
        if !placed {
            core.loyalty.add(msg.platform, &msg.user.name, amount);
            return true;
        }
        self.emit(core);
        true
    }
}

/// What a winning bet pays: the stake back plus its share of the losing bets.
pub fn payout(bet: i64, winning_pool: i64, total_pool: i64) -> i64 {
    if winning_pool <= 0 {
        return bet;
    }
    bet + ((total_pool - winning_pool) as f64 * bet as f64 / winning_pool as f64).floor() as i64
}

fn options_len(p: &NewPoll) -> usize {
    p.options.iter().filter(|o| !o.trim().is_empty()).take(6).count()
}

fn say(core: &Arc<Core>, text: &str) {
    core.chat.send(text, None);
    core.chat.local_echo(core, "Vexcast Bot", text, true);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bets_and_payouts() {
        assert_eq!(parse_bet("!apostar 2 100", 3), Some((1, 100)));
        assert_eq!(parse_bet("!bet #1 todo", 2), Some((0, -1)));
        assert_eq!(parse_bet("!apostar 3 50", 2), None);
        assert_eq!(parse_bet("!apostar 1 -5", 2), None);
        // 300 on the winner (100 + 200), 600 on the loser: 900 total.
        assert_eq!(payout(100, 300, 900), 300);
        assert_eq!(payout(200, 300, 900), 600);
        assert_eq!(payout(50, 0, 0), 50);
    }

    #[test]
    fn votes() {
        assert_eq!(parse_vote("2", 3), Some(1));
        assert_eq!(parse_vote(" !1 ", 3), Some(0));
        assert_eq!(parse_vote("!vote 3", 3), Some(2));
        assert_eq!(parse_vote("!votar #2", 3), Some(1));
        assert_eq!(parse_vote("4", 3), None);
        assert_eq!(parse_vote("0", 3), None);
        assert_eq!(parse_vote("2 veces", 3), None, "a normal message is not a vote");
    }
}
