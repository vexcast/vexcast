//! Phone camera over the local network: a tiny WebRTC signalling relay.
//!
//! The phone app (sender) and the `phonecam.html` widget inside a browser source (viewer)
//! meet in a room (`id`) and swap offers, answers and ICE candidates through this WebSocket;
//! the video itself then flows directly between them on the LAN, never through the core.
//!
//! `GET /api/v1/phonecam/ws?id=<room>&role=send|view`
//! - viewer joins  -> sender gets `{"type":"join","peer":N}`
//! - viewer leaves -> sender gets `{"type":"leave","peer":N}`
//! - sender leaves -> viewers get `{"type":"bye"}`
//! - sender message `{"to":N,...}` -> viewer N gets it with `"from":0`
//! - viewer message `{...}` -> sender gets it with `"from":N`

use crate::core::Core;
use crate::model::{now_ms, PhoneCam, ServerEvent};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

/// Offers with many candidates are a few KB; anything bigger isn't signalling.
const MAX_MESSAGE: usize = 64 * 1024;

type Tx = UnboundedSender<String>;

struct Sender {
    conn: u64,
    tx: Tx,
    device: String,
    since: i64,
}

#[derive(Default)]
struct Room {
    /// The phone sending the camera.
    sender: Option<Sender>,
    viewers: HashMap<u64, Tx>,
}

fn rooms() -> &'static Mutex<HashMap<String, Room>> {
    static ROOMS: OnceLock<Mutex<HashMap<String, Room>>> = OnceLock::new();
    ROOMS.get_or_init(|| Mutex::new(HashMap::new()))
}

static NEXT: AtomicU64 = AtomicU64::new(1);

#[derive(Deserialize)]
pub struct Params {
    id: String,
    role: String,
}

fn valid_room(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Phones sending their camera right now (oldest first).
pub fn active() -> Vec<PhoneCam> {
    let mut v: Vec<PhoneCam> = rooms()
        .lock()
        .iter()
        .filter_map(|(room, r)| r.sender.as_ref().map(|s| PhoneCam { room: room.clone(), device: s.device.clone(), since: s.since }))
        .collect();
    v.sort_by_key(|c| c.since);
    v
}

pub async fn list() -> axum::Json<Vec<PhoneCam>> {
    axum::Json(active())
}

pub async fn ws(
    State(core): State<Arc<Core>>,
    device: Option<axum::Extension<crate::remote::DeviceId>>,
    Query(p): Query<Params>,
    ws: WebSocketUpgrade,
) -> Response {
    if !valid_room(&p.id) || !matches!(p.role.as_str(), "send" | "view") {
        return (StatusCode::BAD_REQUEST, "Sala o rol no válidos").into_response();
    }
    let sender = p.role == "send";
    let name = device
        .and_then(|d| core.read(|s| s.remote_devices.iter().find(|x| x.id == d.0 .0).map(|x| x.name.clone())))
        .unwrap_or_else(|| "Móvil".into());
    ws.max_message_size(MAX_MESSAGE).on_upgrade(move |socket| async move {
        session(socket, p.id, sender, name, &core).await;
    })
}

async fn session(mut socket: WebSocket, room: String, sender: bool, device: String, core: &Core) {
    let me = NEXT.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx) = unbounded_channel::<String>();
    join(&room, me, sender, tx, &device);
    if sender {
        core.emit(ServerEvent::PhoneCams(active()));
    }

    let mut ping = tokio::time::interval(std::time::Duration::from_secs(20));
    loop {
        tokio::select! {
            out = rx.recv() => match out {
                Some(text) => if socket.send(Message::Text(text.into())).await.is_err() { break },
                // Our channel was dropped: another phone took over the room.
                None => { let _ = socket.send(Message::Close(None)).await; break }
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Text(text))) => relay(&room, me, sender, text.as_str()),
                Some(Ok(_)) => {}
                _ => break,
            },
            _ = ping.tick() => if socket.send(Message::Ping(Vec::new().into())).await.is_err() { break },
        }
    }
    leave(&room, me, sender);
    if sender {
        core.emit(ServerEvent::PhoneCams(active()));
    }
}

fn send(tx: &Tx, v: Value) {
    let _ = tx.send(v.to_string());
}

fn join(room: &str, me: u64, sender: bool, tx: Tx, device: &str) {
    let mut rooms = rooms().lock();
    let r = rooms.entry(room.to_string()).or_default();
    if sender {
        // A new connection from the phone replaces the old one (reconnects, a second phone).
        for peer in r.viewers.keys() {
            send(&tx, json!({ "type": "join", "peer": peer }));
        }
        r.sender = Some(Sender { conn: me, tx, device: device.to_string(), since: now_ms() });
    } else {
        if let Some(s) = &r.sender {
            send(&s.tx, json!({ "type": "join", "peer": me }));
        }
        r.viewers.insert(me, tx);
    }
}

fn leave(room: &str, me: u64, sender: bool) {
    let mut rooms = rooms().lock();
    let Some(r) = rooms.get_mut(room) else { return };
    if sender {
        if r.sender.as_ref().is_some_and(|s| s.conn == me) {
            r.sender = None;
            for v in r.viewers.values() {
                send(v, json!({ "type": "bye" }));
            }
        }
    } else if r.viewers.remove(&me).is_some() {
        if let Some(s) = &r.sender {
            send(&s.tx, json!({ "type": "leave", "peer": me }));
        }
    }
    if r.sender.is_none() && r.viewers.is_empty() {
        rooms.remove(room);
    }
}

fn relay(room: &str, me: u64, sender: bool, text: &str) {
    let Ok(Value::Object(mut msg)) = serde_json::from_str::<Value>(text) else { return };
    let rooms = rooms().lock();
    let Some(r) = rooms.get(room) else { return };
    if sender {
        // Only the current phone may talk to the viewers.
        if !r.sender.as_ref().is_some_and(|s| s.conn == me) {
            return;
        }
        let Some(to) = msg.remove("to").and_then(|v| v.as_u64()) else { return };
        msg.insert("from".into(), json!(0));
        if let Some(v) = r.viewers.get(&to) {
            send(v, Value::Object(msg));
        }
    } else if let Some(s) = &r.sender {
        msg.insert("from".into(), json!(me));
        send(&s.tx, Value::Object(msg));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::UnboundedReceiver;

    fn take(rx: &mut UnboundedReceiver<String>) -> Vec<Value> {
        let mut v = vec![];
        while let Ok(m) = rx.try_recv() {
            v.push(serde_json::from_str(&m).unwrap());
        }
        v
    }

    #[test]
    fn relays_between_phone_and_viewers() {
        let room = "test-room-relay";
        let (vtx, mut vrx) = unbounded_channel();
        join(room, 101, false, vtx, "");
        let (stx, mut srx) = unbounded_channel();
        join(room, 100, true, stx, "Pixel");
        assert!(active().iter().any(|c| c.room == room && c.device == "Pixel"));
        // The phone learns about the viewer that was already there.
        assert_eq!(take(&mut srx), vec![json!({ "type": "join", "peer": 101 })]);

        relay(room, 100, true, r#"{"to":101,"type":"offer","sdp":"x"}"#);
        assert_eq!(take(&mut vrx), vec![json!({ "type": "offer", "sdp": "x", "from": 0 })]);
        relay(room, 101, false, r#"{"type":"answer","sdp":"y"}"#);
        assert_eq!(take(&mut srx), vec![json!({ "type": "answer", "sdp": "y", "from": 101 })]);

        // A stale phone connection can't talk once replaced.
        let (s2, mut s2rx) = unbounded_channel();
        join(room, 102, true, s2, "Pixel");
        assert_eq!(take(&mut s2rx).len(), 1);
        relay(room, 100, true, r#"{"to":101,"type":"offer"}"#);
        assert!(take(&mut vrx).is_empty());
        leave(room, 100, true);
        assert!(take(&mut vrx).is_empty(), "the old phone leaving doesn't end the new one's stream");

        leave(room, 101, false);
        assert_eq!(take(&mut s2rx), vec![json!({ "type": "leave", "peer": 101 })]);
        leave(room, 102, true);
        assert!(rooms().lock().get(room).is_none());
        assert!(!active().iter().any(|c| c.room == room));
    }

    #[test]
    fn rejects_bad_rooms() {
        assert!(valid_room("vxcam_abc-12"));
        assert!(!valid_room(""));
        assert!(!valid_room("a/b"));
        assert!(!valid_room(&"a".repeat(65)));
    }
}
