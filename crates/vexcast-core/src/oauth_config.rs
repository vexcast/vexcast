//! Public OAuth app credentials for "Conectar con Twitch/Kick/YouTube".
//!
//! Fill these in after registering the apps (see docs/ACCOUNTS.md). They can also be
//! provided at build time or run time with the environment variables of the same name
//! (`VEXCAST_TWITCH_CLIENT_ID`, …), which take precedence.
//!
//! - Twitch: a *Public* client — only the Client ID is needed (device-code flow).
//! - YouTube: a Google "Desktop app" OAuth client. Google treats the secret of installed
//!   apps as non-confidential, so it can ship with the app.
//! - Kick: needs a client secret for the token exchange. Never commit it: either point
//!   `KICK_TOKEN_PROXY` to a tiny proxy that adds the secret (scripts/kick-token-proxy.js),
//!   or set `VEXCAST_KICK_CLIENT_SECRET` in your own local builds.

pub const TWITCH_CLIENT_ID: &str = "4y4vh8ur5gie96qcmop6h6imvgik0u";
pub const KICK_CLIENT_ID: &str = "01M7KD53ZXXNMJGTSK6XWNQ0F4";
/// e.g. "https://vexcast-kick.<your-subdomain>.workers.dev/token"
pub const KICK_TOKEN_PROXY: &str = "";
pub const YOUTUBE_CLIENT_ID: &str = "";
pub const YOUTUBE_CLIENT_SECRET: &str = "";

/// Resolve a value: runtime env > build-time env > constant above.
pub fn get(name: &str) -> String {
    if let Ok(v) = std::env::var(name) {
        if !v.trim().is_empty() {
            return v.trim().to_string();
        }
    }
    let build = match name {
        "VEXCAST_TWITCH_CLIENT_ID" => option_env!("VEXCAST_TWITCH_CLIENT_ID"),
        "VEXCAST_KICK_CLIENT_ID" => option_env!("VEXCAST_KICK_CLIENT_ID"),
        "VEXCAST_KICK_TOKEN_PROXY" => option_env!("VEXCAST_KICK_TOKEN_PROXY"),
        "VEXCAST_YOUTUBE_CLIENT_ID" => option_env!("VEXCAST_YOUTUBE_CLIENT_ID"),
        "VEXCAST_YOUTUBE_CLIENT_SECRET" => option_env!("VEXCAST_YOUTUBE_CLIENT_SECRET"),
        _ => None,
    };
    if let Some(v) = build.filter(|v| !v.trim().is_empty()) {
        return v.trim().to_string();
    }
    match name {
        "VEXCAST_TWITCH_CLIENT_ID" => TWITCH_CLIENT_ID,
        "VEXCAST_KICK_CLIENT_ID" => KICK_CLIENT_ID,
        "VEXCAST_KICK_TOKEN_PROXY" => KICK_TOKEN_PROXY,
        "VEXCAST_YOUTUBE_CLIENT_ID" => YOUTUBE_CLIENT_ID,
        "VEXCAST_YOUTUBE_CLIENT_SECRET" => YOUTUBE_CLIENT_SECRET,
        _ => "",
    }
    .to_string()
}
