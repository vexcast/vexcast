//! Automatic setup: measures the upload speed of this PC, picks the best encoder it has and
//! recommends the stream bitrate, output resolution and FPS for the enabled destinations
//! (one shared encode, so the upload has to carry the same stream once per destination).

use crate::core::Core;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Public upload-test endpoint: it accepts and discards what is POSTed.
const SPEED_URL: &str = "https://speed.cloudflare.com/__up";
const TEST_TIME: Duration = Duration::from_secs(8);
const CHUNK: usize = 1024 * 1024;
const PARALLEL: usize = 4;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutoConfig {
    /// Measured upload speed (kbps).
    pub upload_kbps: u32,
    /// Best video encoder available (hardware first).
    pub encoder: String,
    pub hardware: bool,
    /// Enabled destinations (services) the recommendation accounts for.
    pub destinations: Vec<String>,
    /// Recommended stream video bitrate (kbps), audio bitrate (kbps), output size and FPS.
    pub video_kbps: u32,
    pub audio_kbps: u32,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    /// Why the bitrate is what it is: "upload" (the connection) or "platform" (a service's maximum).
    pub limited_by: String,
}

/// Highest bitrate each service takes for H.264 (kbps).
fn platform_cap(service: &str) -> u32 {
    let s = service.to_lowercase();
    if s.contains("twitch") || s.contains("facebook") || s.contains("tiktok") {
        6000
    } else if s.contains("kick") || s.contains("trovo") {
        8000
    } else if s.contains("youtube") || s.contains("x ") || s == "x" || s.contains("twitter") {
        9000
    } else {
        6000
    }
}

/// Upload random data for a few seconds and return the speed in kbps. Only uploads the server
/// confirmed count, and the time includes the ones still in flight, so slow links aren't
/// overestimated by data sitting in send buffers.
pub async fn measure_upload() -> anyhow::Result<u32> {
    // One HTTP/1.1 connection per upload, like browser speed tests.
    let http = reqwest::Client::builder().http1_only().pool_max_idle_per_host(PARALLEL).build()?;
    let payload = bytes::Bytes::from((0..CHUNK).map(|_| rand::random::<u8>()).collect::<Vec<u8>>());
    let sent = Arc::new(AtomicU64::new(0));
    let start = Instant::now();
    let mut tasks = vec![];
    for _ in 0..PARALLEL {
        let (http, payload, sent) = (http.clone(), payload.clone(), sent.clone());
        tasks.push(tokio::spawn(async move {
            while start.elapsed() < TEST_TIME {
                let r = http.post(SPEED_URL).header("content-type", "application/octet-stream").body(payload.clone()).timeout(TEST_TIME + Duration::from_secs(10)).send().await;
                match r {
                    Ok(r) if r.status().is_success() => {
                        let _ = r.bytes().await;
                        sent.fetch_add(CHUNK as u64, Ordering::Relaxed);
                    }
                    Ok(r) => return Err(anyhow::anyhow!("HTTP {}", r.status())),
                    Err(e) => return Err(e.into()),
                }
            }
            Ok(())
        }));
    }
    let mut last_err = None;
    for t in tasks {
        if let Ok(Err(e)) = t.await {
            last_err = Some(e);
        }
    }
    let secs = start.elapsed().as_secs_f64().max(0.5);
    let bytes = sent.load(Ordering::Relaxed);
    if bytes == 0 {
        anyhow::bail!("No se pudo medir la subida: {}", last_err.map(|e| e.to_string()).unwrap_or_else(|| "sin respuesta".into()));
    }
    Ok((bytes as f64 * 8.0 / 1000.0 / secs) as u32)
}

/// Bitrate, size and FPS for a measured upload speed.
pub fn recommend(upload_kbps: u32, encoder: &str, services: &[String], base: (u32, u32)) -> AutoConfig {
    let hardware = !encoder.contains("x264");
    let n = services.len().max(1) as u32;
    let audio = 160;
    // Leave a quarter of the connection free (chat, games, other uploads).
    let per_stream = (upload_kbps as f64 * 0.75 / n as f64) as u32;
    let by_upload = per_stream.saturating_sub(audio);
    let cap = services.iter().map(|s| platform_cap(s)).min().unwrap_or(6000);
    let (raw, limited_by) = if by_upload < cap { (by_upload, "upload") } else { (cap, "platform") };
    let video = ((raw / 250) * 250).clamp(1000, 50_000);
    let (height, fps) = if hardware {
        match video {
            v if v >= 6000 => (1080, 60),
            v if v >= 4500 => (720, 60),
            v if v >= 3000 => (720, 30),
            _ => (480, 30),
        }
    } else {
        match video {
            v if v >= 4500 => (720, 60),
            v if v >= 2500 => (720, 30),
            _ => (480, 30),
        }
    };
    let (bw, bh) = (base.0.max(2), base.1.max(2));
    let height = height.min(bh);
    let width = (((height as f64 * bw as f64 / bh as f64).round() as u32) + 1) & !1;
    AutoConfig { upload_kbps, encoder: encoder.into(), hardware, destinations: services.to_vec(), video_kbps: video, audio_kbps: audio, width, height, fps, limited_by: limited_by.into() }
}

pub async fn run(core: &Arc<Core>) -> anyhow::Result<AutoConfig> {
    let upload = measure_upload().await?;
    let e = core.engine.clone();
    let encoder = tokio::task::spawn_blocking(move || e.best_stream_encoder()).await?;
    let (services, base) = core.read(|s| (s.destinations.iter().filter(|d| d.enabled).map(|d| d.service.clone()).collect::<Vec<_>>(), (s.video.base_width, s.video.base_height)));
    Ok(recommend(upload, &encoder, &services, base))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_the_upload_between_destinations() {
        let one = recommend(20_000, "obs_nvenc_h264_tex", &["Twitch".into()], (1920, 1080));
        assert_eq!((one.video_kbps, one.height, one.fps, one.limited_by.as_str()), (6000, 1080, 60, "platform"));
        let three = recommend(12_000, "obs_nvenc_h264_tex", &["Twitch".into(), "YouTube - RTMPS".into(), "Kick".into()], (1920, 1080));
        // 12000 * 0.75 / 3 = 3000 per stream, minus audio.
        assert_eq!((three.video_kbps, three.height, three.fps, three.limited_by.as_str()), (2750, 480, 30, "upload"));
        assert_eq!(three.width, 854);
    }

    #[test]
    fn software_encoding_stays_lighter() {
        let r = recommend(50_000, "obs_x264", &["YouTube - RTMPS".into()], (2560, 1440));
        assert_eq!((r.video_kbps, r.height, r.fps), (9000, 720, 60));
        assert_eq!(r.width, 1280);
    }
}
