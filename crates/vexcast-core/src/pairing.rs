//! Pairing info for the mobile remote (LAN addresses + token, encoded in a QR).

use crate::model::PairingInfo;

pub fn lan_addresses() -> Vec<String> {
    let mut out: Vec<String> = vec![];
    if let Ok(ifaces) = local_ip_address::list_afinet_netifas() {
        for (_, ip) in ifaces {
            if let std::net::IpAddr::V4(v4) = ip {
                if !v4.is_loopback() && !v4.is_link_local() && !v4.is_unspecified() {
                    out.push(v4.to_string());
                }
            }
        }
    }
    // Private ranges first (typical home LAN).
    out.sort_by_key(|a| if a.starts_with("192.168.") { 0 } else if a.starts_with("10.") { 1 } else if a.starts_with("172.") { 2 } else { 3 });
    out.dedup();
    out
}

pub fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .or_else(|| crate::util::command("hostname").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).to_string()))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "PC".into())
}

pub fn info(port: u16, token: &str) -> PairingInfo {
    let addresses = lan_addresses();
    let host = if addresses.is_empty() { "127.0.0.1".to_string() } else { addresses.join(",") };
    let name = computer_name();
    let enc: String = url::form_urlencoded::byte_serialize(name.as_bytes()).collect();
    PairingInfo { qr_payload: format!("vexcast://connect?host={host}&port={port}&token={token}&name={enc}"), addresses, port, token: token.to_string(), name }
}
