//! New-version detection against GitHub Releases.

use crate::core::Core;
use crate::model::*;
use std::sync::Arc;
use std::time::Duration;

pub const RELEASES_API: &str = "https://api.github.com/repos/vexcast/vexcast/releases/latest";

pub fn spawn_checker(core: Arc<Core>) {
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        loop {
            if core.is_stopping() {
                return;
            }
            if core.read(|s| s.general.check_for_updates) {
                let _ = check(&core).await;
            }
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

pub async fn check(core: &Arc<Core>) -> anyhow::Result<UpdateInfo> {
    let current = core.read(|s| s.version.clone());
    let r = core.http.get(RELEASES_API).header("Accept", "application/vnd.github+json").timeout(Duration::from_secs(15)).send().await?;
    if r.status().as_u16() == 404 {
        // No releases published yet.
        let info = UpdateInfo { current_version: current, latest_version: None, update_available: false, release_url: None, release_notes: None, checked_at: Some(now_ms()) };
        let i = info.clone();
        core.update_runtime(move |s| s.update = i);
        return Ok(info);
    }
    let v: serde_json::Value = r.error_for_status()?.json().await?;
    let tag = v["tag_name"].as_str().unwrap_or_default().trim_start_matches('v').to_string();
    let available = is_newer(&tag, &current);
    let info = UpdateInfo {
        current_version: current,
        latest_version: Some(tag.clone()),
        update_available: available,
        release_url: v["html_url"].as_str().map(String::from),
        release_notes: v["body"].as_str().map(|b| crate::util::truncate(b, 8000)),
        checked_at: Some(now_ms()),
    };
    let i = info.clone();
    let was = core.read(|s| s.update.update_available);
    core.update_runtime(move |s| s.update = i);
    if available && !was {
        core.notify("info", format!("Vexcast {tag} está disponible"));
    }
    Ok(info)
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    match (semver::Version::parse(latest), semver::Version::parse(current)) {
        (Ok(l), Ok(c)) => l > c,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn versions() {
        assert!(super::is_newer("0.2.0", "0.1.9"));
        assert!(!super::is_newer("0.1.0", "0.1.0"));
        assert!(!super::is_newer("garbage", "0.1.0"));
    }
}
