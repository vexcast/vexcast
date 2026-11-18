//! Remote devices (the phone app, tablets, browsers on the LAN): who is connected,
//! when they were last seen, and blocking / kicking them.
//!
//! Devices identify themselves with `X-Vexcast-Device` / `X-Vexcast-Device-Name`
//! headers (or `device` / `device_name` query parameters on WebSocket and image
//! URLs); clients that don't are tracked by IP address.

use crate::core::Core;
use crate::model::{now_ms, RemoteDevice};
use parking_lot::Mutex;
use std::collections::HashMap;
use tokio::sync::broadcast;

/// Request extension: the remote device that made the request.
#[derive(Clone, Debug)]
pub struct DeviceId(pub String);

pub struct RemoteRegistry {
    /// Open WebSocket sessions per device.
    live: Mutex<HashMap<String, usize>>,
    /// Last request time per device (saved to config only every few minutes).
    seen: Mutex<HashMap<String, i64>>,
    /// Device ids to disconnect now ("*" = everyone).
    kick: broadcast::Sender<String>,
}

/// How often `last_seen` is written to config.json.
const SAVE_EVERY_MS: i64 = 5 * 60 * 1000;

impl Default for RemoteRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl RemoteRegistry {
    pub fn new() -> Self {
        Self { live: Mutex::new(HashMap::new()), seen: Mutex::new(HashMap::new()), kick: broadcast::channel(32).0 }
    }

    /// Device id + name from the request (headers, then query, then the IP / user agent).
    pub fn identify(headers: &axum::http::HeaderMap, query: Option<&str>, ip: &str) -> (String, String) {
        let q: HashMap<String, String> = query.map(|q| url::form_urlencoded::parse(q.as_bytes()).into_owned().collect()).unwrap_or_default();
        let header = |k: &str| headers.get(k).and_then(|v| v.to_str().ok()).map(|v| url::form_urlencoded::parse(format!("x={v}").as_bytes()).next().map(|(_, v)| v.to_string()).unwrap_or_default());
        let id = header("x-vexcast-device").or_else(|| q.get("device").cloned()).filter(|s| !s.trim().is_empty()).map(|s| s.chars().take(64).collect::<String>());
        let name = header("x-vexcast-device-name").or_else(|| q.get("device_name").cloned()).filter(|s| !s.trim().is_empty()).map(|s| s.chars().take(80).collect::<String>());
        let ua = headers.get(axum::http::header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or_default();
        let guess = if ua.contains("iPhone") {
            "iPhone"
        } else if ua.contains("iPad") {
            "iPad"
        } else if ua.contains("Android") {
            "Android"
        } else if ua.contains("Windows") {
            "Navegador (Windows)"
        } else if ua.contains("Mac") {
            "Navegador (Mac)"
        } else if ua.contains("okhttp") || ua.contains("Expo") || ua.contains("Darwin") {
            "App móvil"
        } else {
            "Dispositivo"
        };
        (id.unwrap_or_else(|| format!("ip-{ip}")), name.unwrap_or_else(|| guess.to_string()))
    }

    /// Check and record a request. Err = refuse it (blocked device, or new devices not allowed).
    pub fn touch(&self, core: &Core, id: &str, name: &str, ip: &str) -> Result<(), String> {
        let now = now_ms();
        let (known, allow_new) = core.read(|s| (s.remote_devices.iter().find(|d| d.id == id).cloned(), s.general.remote_allow_new));
        match known {
            Some(d) if d.blocked => return Err("Este dispositivo está bloqueado en Vexcast".into()),
            Some(d) => {
                self.seen.lock().insert(id.to_string(), now);
                if now - d.last_seen > SAVE_EVERY_MS || d.ip != ip || (d.name != name && !name.is_empty()) {
                    core.update(|s| {
                        if let Some(x) = s.remote_devices.iter_mut().find(|x| x.id == id) {
                            x.last_seen = now;
                            x.ip = ip.to_string();
                            if !name.is_empty() {
                                x.name = name.to_string();
                            }
                        }
                    });
                }
            }
            None if !allow_new => return Err("Vexcast no acepta dispositivos nuevos ahora mismo".into()),
            None => {
                self.seen.lock().insert(id.to_string(), now);
                core.update(|s| {
                    let role = default_role(&s.remote_devices);
                    s.remote_devices.push(RemoteDevice { id: id.into(), name: name.into(), ip: ip.into(), first_seen: now, last_seen: now, blocked: false, role, connected: false })
                });
                core.notify("info", format!("Nuevo dispositivo conectado: {name}"));
            }
        }
        Ok(())
    }

    pub fn session_started(&self, id: &str) {
        *self.live.lock().entry(id.to_string()).or_default() += 1;
    }

    pub fn session_ended(&self, id: &str) {
        let mut live = self.live.lock();
        if let Some(n) = live.get_mut(id) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                live.remove(id);
            }
        }
        self.seen.lock().insert(id.to_string(), now_ms());
    }

    /// Close the live connections of `id` ("*" = all devices).
    pub fn kick(&self, id: &str) {
        let _ = self.kick.send(id.to_string());
    }

    pub fn subscribe_kick(&self) -> broadcast::Receiver<String> {
        self.kick.subscribe()
    }

    /// Saved devices with live status and the freshest "last seen".
    pub fn list(&self, core: &Core) -> Vec<RemoteDevice> {
        let live = self.live.lock();
        let seen = self.seen.lock();
        let mut v = core.read(|s| s.remote_devices.clone());
        for d in v.iter_mut() {
            d.connected = live.get(&d.id).copied().unwrap_or(0) > 0;
            if let Some(t) = seen.get(&d.id) {
                d.last_seen = d.last_seen.max(*t);
            }
        }
        v.sort_by(|a, b| b.connected.cmp(&a.connected).then(b.last_seen.cmp(&a.last_seen)));
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_by_header_query_or_ip() {
        let mut h = axum::http::HeaderMap::new();
        h.insert("x-vexcast-device", "abc".parse().unwrap());
        h.insert("x-vexcast-device-name", "Pixel%208".parse().unwrap());
        assert_eq!(RemoteRegistry::identify(&h, None, "1.2.3.4"), ("abc".into(), "Pixel 8".into()));
        let h = axum::http::HeaderMap::new();
        assert_eq!(RemoteRegistry::identify(&h, Some("token=x&device=q1&device_name=Tab"), "1.2.3.4"), ("q1".into(), "Tab".into()));
        assert_eq!(RemoteRegistry::identify(&h, None, "1.2.3.4").0, "ip-1.2.3.4");
    }
}


/// Role for a device seen for the first time: admin while nobody has a restricted role;
/// once the streamer restricts a device, new ones start as "viewer" (all devices share the
/// pairing token, so a restricted phone could otherwise present a new id to become admin).
pub fn default_role(devices: &[RemoteDevice]) -> String {
    if devices.iter().any(|d| d.role == "moderator" || d.role == "viewer") {
        "viewer".into()
    } else {
        String::new()
    }
}

/// What a remote device's role lets it do. `path` is the API path (with or without /api/v1).
pub fn allowed(role: &str, method: &str, path: &str) -> bool {
    let path = path.strip_prefix("/api/v1").unwrap_or(path);
    let read = matches!(method, "GET" | "HEAD" | "OPTIONS");
    // The device list (with every id) is for admins only.
    if !role.is_empty() && role != "admin" && path.trim_end_matches('/').ends_with("/remote/devices") {
        return false;
    }
    match role {
        "viewer" => read,
        "moderator" => {
            if read {
                return true;
            }
            let seg: Vec<&str> = path.trim_matches('/').split('/').collect();
            match (method, seg.as_slice()) {
                ("POST", ["scenes", _, "program" | "preview"]) => true,
                ("POST", ["studio-mode", "transition"]) => true,
                ("PATCH", ["scenes", _, "items", _]) => true,
                ("PATCH", ["sources", _]) => true,
                ("POST", ["alerts", "test" | "skip"]) => true,
                ("POST", ["chat", "send" | "delete" | "translate" | "summary" | "highlight"]) => true,
                ("DELETE", ["chat", "highlight"]) => true,
                ("POST", ["poll"] | ["poll", "end"] | ["poll", "resolve"]) | ("DELETE", ["poll"]) => true,
                ("POST", ["loyalty", "set"]) => true,
                ("POST", ["counters", _, "add" | "set"]) | ("POST", ["countdown"]) => true,
                ("POST", ["songs"] | ["songs", "next" | "pause" | "volume"]) | ("DELETE", ["songs", _]) => true,
                ("POST", ["giveaway"] | ["giveaway", "close" | "draw"]) | ("DELETE", ["giveaway"]) => true,
                ("POST", ["tts", "speak"]) => true,
                ("POST", ["macros", _, "run"]) => true,
                ("POST", ["replay", "save"]) => true,
                ("GET" | "POST", ["oauth", _, "stream-info"]) => true,
                _ => false,
            }
        }
        _ => true,
    }
}

#[cfg(test)]
mod role_tests {
    use super::allowed;

    #[test]
    fn roles() {
        assert!(allowed("", "POST", "/stream/start"));
        assert!(allowed("admin", "PUT", "/settings/video"));
        assert!(allowed("viewer", "GET", "/state"));
        assert!(!allowed("viewer", "POST", "/scenes/x/program"));
        assert!(allowed("moderator", "POST", "/api/v1/scenes/x/program"));
        assert!(allowed("moderator", "POST", "/chat/send"));
        assert!(allowed("moderator", "POST", "/macros/abc/run"));
        assert!(!allowed("moderator", "POST", "/stream/start"));
        assert!(!allowed("moderator", "PUT", "/settings/output"));
        assert!(!allowed("moderator", "DELETE", "/sources/x"));
        // Device ids are for admins only (a restricted phone could impersonate another).
        assert!(!allowed("viewer", "GET", "/api/v1/remote/devices"));
        assert!(!allowed("moderator", "GET", "/remote/devices"));
        assert!(allowed("", "GET", "/remote/devices"));
    }

    #[test]
    fn new_devices_start_restricted_once_roles_are_used() {
        use crate::model::RemoteDevice;
        let d = |role: &str| RemoteDevice { id: "x".into(), name: "x".into(), ip: String::new(), first_seen: 0, last_seen: 0, blocked: false, role: role.into(), connected: false };
        assert_eq!(super::default_role(&[]), "");
        assert_eq!(super::default_role(&[d("")]), "");
        assert_eq!(super::default_role(&[d(""), d("moderator")]), "viewer");
    }
}
