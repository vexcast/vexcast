//! Small helpers.

use rand::Rng;

pub fn random_token(len: usize) -> String {
    const CHARS: &[u8] = b"abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..len).map(|_| CHARS[rng.gen_range(0..CHARS.len())] as char).collect()
}

/// A `std::process::Command` that never opens a console window on Windows.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

/// Async variant of [`command`].
pub fn tokio_command(program: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut c = tokio::process::Command::new(program);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c.kill_on_drop(true);
    c
}

/// Format a duration in ms as "1h 02m" / "12m 30s".
pub fn format_uptime(ms: i64) -> String {
    let secs = (ms / 1000).max(0);
    let (h, m, s) = (secs / 3600, (secs % 3600) / 60, secs % 60);
    if h > 0 {
        format!("{h}h {m:02}m")
    } else {
        format!("{m}m {s:02}s")
    }
}

/// Parse "#RRGGBB" or "#RRGGBBAA" into RGBA.
pub fn parse_color(s: &str) -> [u8; 4] {
    let h = s.trim().trim_start_matches('#');
    let p = |i: usize| u8::from_str_radix(h.get(i..i + 2).unwrap_or("ff"), 16).unwrap_or(255);
    match h.len() {
        6 => [p(0), p(2), p(4), 255],
        8 => [p(0), p(2), p(4), p(6)],
        3 => {
            let q = |i: usize| u8::from_str_radix(&h[i..i + 1].repeat(2), 16).unwrap_or(255);
            [q(0), q(1), q(2), 255]
        }
        _ => [0, 0, 0, 255],
    }
}

/// Truncate to a max number of chars (UTF-8 safe).
pub fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut t: String = s.chars().take(max.saturating_sub(1)).collect();
        t.push('…');
        t
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn colors() {
        assert_eq!(parse_color("#ff0000"), [255, 0, 0, 255]);
        assert_eq!(parse_color("#00ff0080"), [0, 255, 0, 128]);
        assert_eq!(parse_color("#fff"), [255, 255, 255, 255]);
    }
    #[test]
    fn uptime() {
        assert_eq!(format_uptime(3_725_000), "1h 02m");
        assert_eq!(format_uptime(65_000), "1m 05s");
    }
}
