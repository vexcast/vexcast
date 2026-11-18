//! End-to-end on the real libobs engine: compose a scene, multistream to a local RTMP
//! listener (ffmpeg) and record, then verify the received files.
//! Requires the OBS runtime next to the test binary (scripts/fetch-obs-runtime.mjs) and ffmpeg;
//! skipped otherwise.

use serde_json::{json, Value};
use std::process::{Command, Stdio};
use std::time::Duration;

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg").arg("-version").stdout(Stdio::null()).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
}

fn runtime_available() -> bool {
    vexcast_core::obs::runtime::runtime_dir().join("obs-plugins").is_dir()
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

fn probe_streams(path: &std::path::Path) -> String {
    let o = Command::new("ffprobe").args(["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0"]).arg(path).output().expect("ffprobe");
    String::from_utf8_lossy(&o.stdout).to_string()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn stream_and_record() {
    if !ffmpeg_available() || !runtime_available() {
        eprintln!("skipping e2e test (ffmpeg: {}, OBS runtime: {})", ffmpeg_available(), runtime_available());
        return;
    }
    // libobs launches obs-ffmpeg-mux next to the running executable (true for the real app).
    let exe_dir = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
    for helper in ["obs-ffmpeg-mux.exe", "obs-ffmpeg-mux"] {
        let src = vexcast_core::obs::runtime::runtime_dir().join(helper);
        if src.exists() && !exe_dir.join(helper).exists() {
            let _ = std::fs::copy(&src, exe_dir.join(helper));
        }
    }
    let tmp = std::env::temp_dir().join(format!("vexcast-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();

    let handle = vexcast_core::start(vexcast_core::CoreConfig { port: free_port(), data_dir: Some(tmp.join("data")), lan: false, ..Default::default() }).await.expect("core starts");
    let http = lite::Client::new(&format!("http://127.0.0.1:{}/api/v1", handle.port));

    let mut state = Value::Null;
    for _ in 0..150 {
        state = http.get("/state").await;
        if state["status"]["ready"] == true {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert_eq!(state["status"]["ready"], true, "engine ready: {}", state["status"]);
    let scene = state["programSceneUuid"].as_str().expect("program scene").to_string();

    // A color source filling the canvas + text.
    let color = http.post("/sources", json!({"name": "Fondo", "kind": "color_source_v3", "settings": {"width": 1920, "height": 1080, "color": 0xFF7F3F8Bu32}, "sceneUuid": scene})).await;
    assert!(color["uuid"].is_string(), "{color}");
    let props = http.get(&format!("/sources/{}/properties", color["uuid"].as_str().unwrap())).await;
    assert!(props.as_array().map(|a| a.iter().any(|p| p["name"] == "color")).unwrap_or(false), "color property: {props}");
    http.put("/settings/output", json!({"recordingPath": tmp.join("rec").to_string_lossy(), "recordingFormat": "mkv", "streamEncoder": "obs_x264", "streamEncoderSettings": {"rate_control": "CBR", "bitrate": 2500, "preset": "veryfast"}})).await;
    http.put("/settings/video", json!({"baseWidth": 1280, "baseHeight": 720, "outputWidth": 1280, "outputHeight": 720, "fpsNum": 30, "fpsDen": 1})).await;

    // Local RTMP "server".
    let rtmp_port = free_port();
    let out = tmp.join("received.flv");
    let mut listener = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-listen", "1", "-i", &format!("rtmp://127.0.0.1:{rtmp_port}/live/key"), "-c", "copy", "-y"])
        .arg(&out)
        .stdin(Stdio::null())
        .spawn()
        .unwrap();
    tokio::time::sleep(Duration::from_millis(800)).await;
    http.post("/destinations", json!({"name": "Local", "service": "Custom", "server": format!("rtmp://127.0.0.1:{rtmp_port}/live"), "streamKey": "key", "enabled": true, "canvas": "horizontal", "encoderOverride": null})).await;

    http.post("/stream/start", json!({})).await;
    http.post("/record/start", json!({})).await;
    tokio::time::sleep(Duration::from_secs(5)).await;
    let stats = http.get("/stats").await;
    let jpg = http.get_bytes("/preview.jpg").await;
    assert!(jpg.starts_with(&[0xFF, 0xD8]), "preview is a JPEG");
    http.post("/stream/stop", json!({})).await;
    http.post("/record/stop", json!({})).await;
    tokio::time::sleep(Duration::from_secs(3)).await;
    let _ = listener.kill();
    let _ = listener.wait();
    handle.shutdown().await;

    let outputs = stats["outputs"].as_array().cloned().unwrap_or_default();
    assert!(outputs.iter().any(|o| o["id"] == "record" && o["state"] == "active"), "recording active: {stats}");
    assert!(outputs.iter().any(|o| o["id"] != "record" && o["state"] == "active"), "stream active: {stats}");
    let received = probe_streams(&out);
    assert!(received.contains("h264") && received.contains("aac"), "rtmp output has h264+aac: {received}");
    let rec = std::fs::read_dir(tmp.join("rec")).unwrap().filter_map(|e| e.ok()).next().expect("recording file").path();
    let recorded = probe_streams(&rec);
    assert!(recorded.contains("h264") && recorded.contains("aac"), "recording has h264+aac: {recorded}");
    let _ = std::fs::remove_dir_all(&tmp);
}

/// Minimal HTTP/1.1 client (keeps dev-deps small).
mod lite {
    use serde_json::Value;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    pub struct Client {
        host: String,
        prefix: String,
    }

    impl Client {
        pub fn new(base: &str) -> Self {
            let rest = base.trim_start_matches("http://");
            let (host, prefix) = rest.split_once('/').unwrap();
            Self { host: host.to_string(), prefix: format!("/{prefix}") }
        }

        async fn raw(&self, method: &str, path: &str, body: Option<Value>) -> (u16, Vec<u8>) {
            let mut s = tokio::net::TcpStream::connect(&self.host).await.unwrap();
            let body = body.map(|b| b.to_string()).unwrap_or_default();
            let req = format!(
                "{method} {}{path} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                self.prefix,
                self.host,
                body.len()
            );
            s.write_all(req.as_bytes()).await.unwrap();
            let mut buf = vec![];
            s.read_to_end(&mut buf).await.unwrap();
            let split = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
            let head = String::from_utf8_lossy(&buf[..split]).to_string();
            let status: u16 = head.split_whitespace().nth(1).unwrap().parse().unwrap();
            let mut body = buf[split + 4..].to_vec();
            if head.to_lowercase().contains("transfer-encoding: chunked") {
                body = dechunk(&body);
            }
            (status, body)
        }

        pub async fn get(&self, path: &str) -> Value {
            let (_, b) = self.raw("GET", path, None).await;
            serde_json::from_slice(&b).unwrap_or(Value::Null)
        }
        pub async fn get_bytes(&self, path: &str) -> Vec<u8> {
            self.raw("GET", path, None).await.1
        }
        pub async fn post(&self, path: &str, body: Value) -> Value {
            let (st, b) = self.raw("POST", path, Some(body)).await;
            assert!(st < 400, "POST {path} -> {st}: {}", String::from_utf8_lossy(&b));
            serde_json::from_slice(&b).unwrap_or(Value::Null)
        }
        pub async fn put(&self, path: &str, body: Value) -> Value {
            let (st, b) = self.raw("PUT", path, Some(body)).await;
            assert!(st < 400, "PUT {path} -> {st}: {}", String::from_utf8_lossy(&b));
            serde_json::from_slice(&b).unwrap_or(Value::Null)
        }
    }

    fn dechunk(mut b: &[u8]) -> Vec<u8> {
        let mut out = vec![];
        loop {
            let Some(pos) = b.windows(2).position(|w| w == b"\r\n") else { break };
            let size = usize::from_str_radix(String::from_utf8_lossy(&b[..pos]).trim(), 16).unwrap_or(0);
            if size == 0 {
                break;
            }
            out.extend_from_slice(&b[pos + 2..pos + 2 + size]);
            b = &b[pos + 2 + size + 2..];
        }
        out
    }
}
