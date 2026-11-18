//! Text-to-speech: OS voices, Piper (local neural TTS) or any OpenAI-compatible
//! speech endpoint (Kokoro-FastAPI, LocalAI, openedai-speech...).

use crate::core::Core;
use crate::model::*;
use crate::util::tokio_command;
use parking_lot::Mutex;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Weak};
use tokio::io::AsyncWriteExt;

pub struct TtsService {
    core: Weak<Core>,
    dir: PathBuf,
    /// id -> (bytes, mime)
    cache: Mutex<VecDeque<(String, Arc<Vec<u8>>, &'static str)>>,
}

impl TtsService {
    pub fn new(core: Weak<Core>, dir: PathBuf) -> Arc<Self> {
        let _ = std::fs::create_dir_all(&dir);
        Arc::new(Self { core, dir, cache: Mutex::new(VecDeque::new()) })
    }

    pub fn get(&self, id: &str) -> Option<(Arc<Vec<u8>>, &'static str)> {
        self.cache.lock().iter().find(|(i, _, _)| i == id).map(|(_, b, m)| (b.clone(), *m))
    }

    fn store(&self, bytes: Vec<u8>, mime: &'static str) -> String {
        let id = new_id();
        let mut c = self.cache.lock();
        c.push_back((id.clone(), Arc::new(bytes), mime));
        while c.len() > 64 {
            c.pop_front();
        }
        id
    }

    /// Synthesize speech; returns (cache id, audio bytes).
    pub async fn synthesize(&self, text: &str) -> anyhow::Result<(String, Vec<u8>)> {
        let core = self.core.upgrade().ok_or_else(|| anyhow::anyhow!("core stopped"))?;
        let s = core.read(|s| s.ai.tts.clone());
        let text = crate::util::truncate(text.trim(), 600);
        if text.is_empty() {
            anyhow::bail!("texto vacío");
        }
        let bytes = match s.provider.as_str() {
            "none" => anyhow::bail!("TTS desactivado"),
            "openai_compatible" => self.openai(&core, &s, &text).await?,
            "piper" => self.piper(&s, &text).await?,
            _ => self.system(&s, &text).await?,
        };
        let mime = if bytes.starts_with(b"RIFF") { "audio/wav" } else if bytes.starts_with(b"ID3") || bytes.first() == Some(&0xFF) { "audio/mpeg" } else { "application/octet-stream" };
        let id = self.store(bytes.clone(), mime);
        Ok((id, bytes))
    }

    /// Synthesize and play into the stream mix; returns the cache id.
    pub async fn speak(&self, text: &str) -> anyhow::Result<String> {
        let (id, bytes) = self.synthesize(text).await?;
        if let Some(core) = self.core.upgrade() {
            let ext = if bytes.starts_with(b"RIFF") { "wav" } else { "mp3" };
            // One path only: the stream mix when the engine runs; otherwise the browser
            // sources (alert widgets) play it.
            let played = match core.engine.play_audio(&bytes, ext) {
                Ok(()) => true,
                Err(e) => {
                    tracing::warn!("tts playback: {e}");
                    false
                }
            };
            core.emit(ServerEvent::Tts { id: id.clone(), url: format!("/api/v1/tts/audio/{id}"), text: text.to_string(), played });
        }
        Ok(id)
    }

    async fn openai(&self, core: &Arc<Core>, s: &TtsSettings, text: &str) -> anyhow::Result<Vec<u8>> {
        let url = format!("{}/audio/speech", s.endpoint.trim_end_matches('/'));
        let voice = if s.voice.is_empty() { "af_bella" } else { &s.voice };
        let r = core
            .http
            .post(&url)
            .json(&serde_json::json!({ "model": "tts-1", "input": text, "voice": voice, "response_format": "wav", "speed": s.speed }))
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("No se pudo conectar con el servidor TTS ({url}): {e}"))?;
        if !r.status().is_success() {
            anyhow::bail!("El servidor TTS respondió {}", r.status());
        }
        Ok(r.bytes().await?.to_vec())
    }

    async fn piper(&self, s: &TtsSettings, text: &str) -> anyhow::Result<Vec<u8>> {
        if s.voice.is_empty() {
            anyhow::bail!("Elige una voz de Piper descargada en IA › Voz");
        }
        let hub = self.core.upgrade().map(|c| c.hub.clone());
        // Voices downloaded in the AI hub are stored by file name; Piper installed there is used
        // unless another program is set.
        let voice = hub.as_ref().and_then(|h| h.model_path(crate::ai::hub::ModelKind::Piper, &s.voice)).map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| s.voice.clone());
        // Voices downloaded before this fix (or by hand) may need the same clean-up.
        let _ = crate::ai::hub::fix_piper_config(std::path::Path::new(&format!("{voice}.json")));
        let s = &TtsSettings { voice, ..s.clone() };
        let out = self.dir.join(format!("{}.wav", new_id()));
        let installed = hub.and_then(|h| h.exe(crate::ai::hub::Runtime::Piper)).map(|p| p.to_string_lossy().to_string());
        let exe = match (s.piper_path.trim(), installed) {
            ("" | "piper", Some(p)) => p,
            ("", None) => "piper".to_string(),
            (p, _) => p.to_string(),
        };
        let mut child = tokio_command(&exe)
            .args(["--model", &s.voice, "--output_file", &out.to_string_lossy()])
            .args(if (s.speed - 1.0).abs() > 0.01 { vec!["--length_scale".to_string(), format!("{:.2}", 1.0 / s.speed.max(0.25))] } else { vec![] })
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| anyhow::anyhow!("No se encontró Piper ({exe}): {e}"))?;
        child.stdin.take().unwrap().write_all(text.as_bytes()).await?;
        let o = child.wait_with_output().await?;
        if !o.status.success() {
            anyhow::bail!("Piper falló: {}", String::from_utf8_lossy(&o.stderr).lines().last().unwrap_or(""));
        }
        let bytes = tokio::fs::read(&out).await?;
        let _ = tokio::fs::remove_file(&out).await;
        Ok(bytes)
    }

    async fn system(&self, s: &TtsSettings, text: &str) -> anyhow::Result<Vec<u8>> {
        let out = self.dir.join(format!("{}.wav", new_id()));
        let out_s = out.to_string_lossy().to_string();
        let mut cmd;
        if cfg!(windows) {
            let voice = s.voice.replace('\'', "''");
            let rate = ((s.speed - 1.0) * 5.0).round().clamp(-10.0, 10.0) as i32;
            let script = format!(
                "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; {} $s.Rate={rate}; $s.SetOutputToWaveFile('{}'); $t=[Console]::In.ReadToEnd(); $s.Speak($t); $s.Dispose()",
                if voice.is_empty() { String::new() } else { format!("try {{ $s.SelectVoice('{voice}') }} catch {{}};") },
                out_s.replace('\'', "''")
            );
            cmd = tokio_command("powershell");
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
        } else if cfg!(target_os = "macos") {
            cmd = tokio_command("say");
            cmd.args(["-o", &out_s, "--file-format=WAVE", "--data-format=LEI16@22050", "-r", &((175.0 * s.speed) as i32).to_string(), "-f", "-"]);
            if !s.voice.is_empty() {
                cmd.args(["-v", &s.voice]);
            }
        } else {
            let exe = if which("espeak-ng") { "espeak-ng" } else { "espeak" };
            cmd = tokio_command(exe);
            cmd.args(["-w", &out_s, "-s", &((170.0 * s.speed) as i32).to_string(), "--stdin"]);
            cmd.args(["-v", if s.voice.is_empty() { "es" } else { &s.voice }]);
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| anyhow::anyhow!("No hay voz del sistema disponible ({e}). En Linux instala espeak-ng, o usa Piper/Kokoro"))?;
        child.stdin.take().unwrap().write_all(text.as_bytes()).await?;
        let o = child.wait_with_output().await?;
        if !o.status.success() {
            anyhow::bail!("La voz del sistema falló: {}", String::from_utf8_lossy(&o.stderr).trim());
        }
        let bytes = tokio::fs::read(&out).await?;
        let _ = tokio::fs::remove_file(&out).await;
        Ok(bytes)
    }
}

fn which(exe: &str) -> bool {
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).any(|d| d.join(exe).is_file())).unwrap_or(false)
}
