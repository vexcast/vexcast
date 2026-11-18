//! AI features: co-host, AI moderation, chat TTS and live captions, with Claude, local engines
//! (run by the AI hub) or any compatible server.

pub mod claude;
pub mod hub;
pub mod tts;

use crate::core::Core;
use crate::model::*;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

pub struct AiService {
    core: Weak<Core>,
    last_cohost: Mutex<Option<Instant>>,
}

impl AiService {
    pub fn new(core: Weak<Core>) -> Arc<Self> {
        Arc::new(Self { core, last_cohost: Mutex::new(None) })
    }

    pub fn start(self: Arc<Self>) {
        let me = self.clone();
        tokio::spawn(async move { me.captions_loop().await });
    }

    /// Chat completion with the configured text model (Claude, local llama.cpp, Ollama or OpenAI-compatible).
    pub async fn chat(&self, system: &str, user: &str, max_tokens: u32) -> anyhow::Result<String> {
        let core = self.core.upgrade().ok_or_else(|| anyhow::anyhow!("core stopped"))?;
        let s = core.read(|s| s.ai.llm.clone());
        let base = s.endpoint.trim_end_matches('/').to_string();
        match s.provider.as_str() {
            "anthropic" => claude::chat(&core.http, &s.api_key, &s.model, system, user, max_tokens).await,
            "local" => {
                if s.local_model.is_empty() {
                    anyhow::bail!("Elige un modelo descargado en IA › Texto");
                }
                let model = core.hub.model_path(hub::ModelKind::Llm, &s.local_model).ok_or_else(|| anyhow::anyhow!("El modelo «{}» ya no está descargado", s.local_model))?;
                let port = core.hub.llm_port(&model, s.local_context, s.local_gpu).await?;
                openai_chat(&core, &format!("http://127.0.0.1:{port}/v1"), "", "local", system, user, max_tokens).await
            }
            "ollama" => {
                let r = core
                    .http
                    .post(format!("{base}/api/chat"))
                    .json(&json!({
                        "model": s.model, "stream": false,
                        "messages": [{"role":"system","content":system},{"role":"user","content":user}],
                        "options": {"num_predict": max_tokens, "temperature": 0.7}
                    }))
                    .send()
                    .await
                    .map_err(|e| anyhow::anyhow!("No se pudo conectar con Ollama en {base}: {e}"))?;
                let status = r.status();
                let v: Value = r.json().await?;
                if !status.is_success() {
                    anyhow::bail!("Ollama: {}", v["error"].as_str().unwrap_or("error"));
                }
                Ok(clean(v["message"]["content"].as_str().unwrap_or_default()))
            }
            "openai_compatible" => openai_chat(&core, &base, &s.api_key, &s.model, system, user, max_tokens).await,
            _ => anyhow::bail!("Elige un motor de texto en IA › Texto (Claude, local u otro)"),
        }
    }

    /// Check the text model's connection and list its models.
    pub async fn test(&self) -> (bool, Vec<String>, Option<String>) {
        let Some(core) = self.core.upgrade() else { return (false, vec![], None) };
        let s = core.read(|s| s.ai.llm.clone());
        let base = s.endpoint.trim_end_matches('/').to_string();
        let res: anyhow::Result<Vec<String>> = async {
            match s.provider.as_str() {
                "anthropic" => claude::models(&core.http, &s.api_key).await,
                "local" => {
                    if core.hub.exe(hub::Runtime::Llama).is_none() {
                        anyhow::bail!("Falta instalar el motor local (llama.cpp)");
                    }
                    let models: Vec<String> = core.hub.models(hub::ModelKind::Llm).iter().filter_map(|m| m["file"].as_str().map(String::from)).collect();
                    if models.is_empty() {
                        anyhow::bail!("No hay modelos descargados");
                    }
                    // Load the chosen one now, so the first real answer is fast.
                    if let Some(model) = core.hub.model_path(hub::ModelKind::Llm, &s.local_model) {
                        core.hub.llm_port(&model, s.local_context, s.local_gpu).await?;
                    }
                    Ok(models)
                }
                "ollama" => {
                    let v: Value = core.http.get(format!("{base}/api/tags")).timeout(Duration::from_secs(5)).send().await?.json().await?;
                    Ok(v["models"].as_array().cloned().unwrap_or_default().iter().filter_map(|m| m["name"].as_str().map(String::from)).collect())
                }
                "openai_compatible" => {
                    let mut req = core.http.get(format!("{base}/models")).timeout(Duration::from_secs(5));
                    if !s.api_key.is_empty() {
                        req = req.bearer_auth(&s.api_key);
                    }
                    let v: Value = req.send().await?.json().await?;
                    Ok(v["data"].as_array().cloned().unwrap_or_default().iter().filter_map(|m| m["id"].as_str().map(String::from)).collect())
                }
                _ => anyhow::bail!("Elige un proveedor"),
            }
        }
        .await;
        match res {
            Ok(m) => (true, m, None),
            Err(e) => (false, vec![], Some(e.to_string())),
        }
    }

    /// Target language code for chat translations.
    fn translate_lang(core: &Core) -> String {
        core.read(|s| if s.ai.assist.translate_to.is_empty() { s.general.language.clone() } else { s.ai.assist.translate_to.clone() })
    }

    /// Translate `text` to `to` (language code). None when it's already in that language.
    pub async fn translate(&self, text: &str, to: &str) -> anyhow::Result<Option<String>> {
        let lang = lang_name(to);
        let out = self
            .chat(
                &format!("Traduce mensajes de chat de directos al {lang}. Si el mensaje ya está en {lang}, o es solo emotes, risas o un nombre, responde exactamente: =. Si no, responde solo con la traducción, natural y breve, sin comillas ni explicaciones."),
                text,
                200,
            )
            .await?;
        let out = out.trim();
        // Small models sometimes "translate" by only fixing accents or punctuation.
        let same = fold(out) == fold(text);
        Ok((!out.is_empty() && out != "=" && !same).then(|| out.to_string()))
    }

    /// Short summary of the recent chat: topics, unanswered questions, mood.
    pub async fn summarize_chat(&self, core: &Arc<Core>) -> anyhow::Result<String> {
        let lines: Vec<String> = core.chat.history.lock().iter().rev().filter(|m| !m.is_bot).take(150).map(|m| format!("{}: {}", m.user.name, m.text)).collect();
        if lines.is_empty() {
            anyhow::bail!("Todavía no hay mensajes en el chat");
        }
        let lang = lang_name(&core.read(|s| s.general.language.clone()));
        let chat: Vec<String> = lines.into_iter().rev().collect();
        self.chat(
            &format!("Eres el ayudante de un streamer. Resume el chat reciente en {lang}, en 3 a 5 viñetas muy breves: de qué se habla, preguntas que siguen sin respuesta (con quién las hizo) y el ambiente. Sin introducción."),
            &chat.join("\n"),
            500,
        )
        .await
    }

    pub async fn ask_cohost(&self, from: &str, text: &str) -> anyhow::Result<String> {
        let core = self.core.upgrade().ok_or_else(|| anyhow::anyhow!("core stopped"))?;
        let co = core.read(|s| s.ai.cohost.clone());
        let system = format!("{}\nTe llamas {}. Responde de forma breve (máximo 2 frases), natural y apta para todo público.", co.persona, co.name);
        self.chat(&system, &format!("{from}: {text}"), 120).await
    }

    /// React to an incoming chat message.
    pub async fn on_message(&self, core: &Arc<Core>, msg: &ChatMessage) {
        let ai = core.read(|s| s.ai.clone());

        // Chat TTS (e.g. "!tts hola").
        if ai.tts.read_chat && ai.tts.provider != "none" {
            let prefix = ai.tts.read_chat_prefix.trim();
            let body = if prefix.is_empty() { Some(msg.text.as_str()) } else { msg.text.strip_prefix(prefix).map(str::trim) };
            if let Some(b) = body.filter(|b| !b.is_empty()) {
                if !msg.flagged {
                    let _ = core.tts.speak(&format!("{} dice: {}", msg.user.name, b)).await;
                }
            }
        }

        // Translate messages in other languages.
        if ai.assist.auto_translate && ai.llm.provider != "none" && msg.text.chars().filter(|c| c.is_alphabetic()).count() >= 4 && !msg.text.starts_with('!') {
            let to = Self::translate_lang(core);
            if let Ok(Some(text)) = self.translate(&msg.text, &to).await {
                if let Some(m) = core.chat.history.lock().iter_mut().find(|m| m.id == msg.id) {
                    m.translated = Some(text.clone());
                }
                core.emit(ServerEvent::ChatTranslated { id: msg.id.clone(), text });
            }
        }

        // AI moderation.
        if ai.moderation.enabled && ai.moderation.use_ai && ai.llm.provider != "none" && !msg.flagged {
            let verdict = self
                .chat(
                    "Eres un moderador de chat. Responde solo SI si el mensaje es tóxico, acoso, odio, spam o contenido sexual explícito; si no, responde NO.",
                    &msg.text,
                    3,
                )
                .await
                .unwrap_or_default();
            if verdict.to_uppercase().starts_with("SI") || verdict.to_uppercase().starts_with("SÍ") || verdict.to_uppercase().starts_with("YES") {
                let mut flagged = msg.clone();
                flagged.flagged = true;
                core.emit(ServerEvent::Chat(flagged));
                if ai.moderation.auto_delete {
                    core.chat.delete(&msg.id);
                }
                return;
            }
        }

        // Co-host.
        let co = &ai.cohost;
        if co.enabled && ai.llm.provider != "none" && !co.name.is_empty() && msg.text.to_lowercase().contains(&co.name.to_lowercase()) {
            {
                let mut last = self.last_cohost.lock();
                if last.map(|t| t.elapsed() < Duration::from_secs(co.cooldown_sec as u64)).unwrap_or(false) {
                    return;
                }
                *last = Some(Instant::now());
            }
            match self.ask_cohost(&msg.user.name, &msg.text).await {
                Ok(reply) if !reply.is_empty() => {
                    if co.reply_in_chat {
                        core.chat.send(&reply, None);
                        core.chat.local_echo(core, &co.name, &reply, true);
                    }
                    if co.speak {
                        let _ = core.tts.speak(&reply).await;
                    }
                }
                Ok(_) => {}
                Err(e) => core.notify("warning", format!("Co-host IA: {e}")),
            }
        }
    }

    /// Live captions: transcribe the selected mic in ~4 s chunks with an
    /// OpenAI-compatible transcription server (faster-whisper-server, speaches, whisper.cpp).
    async fn captions_loop(self: Arc<Self>) {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let Some(core) = self.core.upgrade() else { return };
            if core.is_stopping() {
                return;
            }
            let (enabled, stt, translate_to) = core.read(|s| (s.widgets.captions.enabled, s.ai.stt.clone(), s.widgets.captions.translate_to.clone()));
            let Some(source_id) = stt.source_id.clone().filter(|_| enabled) else { continue };
            let Some((rx, tap, rate)) = core.engine.tap_audio(&source_id) else {
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            };
            // Collect ~4 s of audio.
            let samples = tokio::task::spawn_blocking(move || {
                let mut out: Vec<f32> = Vec::with_capacity(rate as usize * 2 * 4);
                let deadline = Instant::now() + Duration::from_secs(4);
                while Instant::now() < deadline {
                    if let Ok(c) = rx.recv_timeout(Duration::from_millis(200)) {
                        out.extend_from_slice(&c);
                    }
                }
                drop(tap);
                out
            })
            .await
            .unwrap_or_default();
            // Skip silence.
            let peak = samples.iter().fold(0f32, |m, s| m.max(s.abs()));
            if samples.is_empty() || peak < 0.02 {
                continue;
            }
            let wav = to_wav_16k_mono(&samples, rate);
            let base = if stt.provider == "local" {
                let Some(model) = core.hub.model_path(hub::ModelKind::Whisper, &stt.local_model) else {
                    core.notify("warning", "Subtítulos: elige un modelo de Whisper descargado en IA › Subtítulos".to_string());
                    tokio::time::sleep(Duration::from_secs(20)).await;
                    continue;
                };
                match core.hub.stt_port(&model).await {
                    Ok(port) => format!("http://127.0.0.1:{port}/inference"),
                    Err(e) => {
                        core.notify("warning", format!("Subtítulos: {e}"));
                        tokio::time::sleep(Duration::from_secs(20)).await;
                        continue;
                    }
                }
            } else {
                stt.endpoint.trim_end_matches('/').to_string()
            };
            let url = if stt.provider == "local" { base } else { format!("{base}/audio/transcriptions") };
            let part = match reqwest::multipart::Part::bytes(wav).file_name("audio.wav").mime_str("audio/wav") {
                Ok(p) => p,
                Err(_) => continue,
            };
            let mut form = reqwest::multipart::Form::new().part("file", part).text("model", stt.model.clone()).text("response_format", "json");
            if !stt.language.is_empty() {
                form = form.text("language", stt.language.clone());
            }
            let mut req = core.http.post(&url).multipart(form);
            if stt.provider != "local" && !stt.api_key.is_empty() {
                req = req.bearer_auth(&stt.api_key);
            }
            let text = match req.send().await {
                Ok(r) if r.status().is_success() => r.json::<Value>().await.ok().and_then(|v| v["text"].as_str().map(|s| s.trim().to_string())).unwrap_or_default(),
                Ok(r) => {
                    core.notify("warning", format!("Subtítulos: el servidor respondió {}", r.status()));
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    continue;
                }
                Err(e) => {
                    core.notify("warning", format!("Subtítulos: no se pudo conectar con {url}: {e}"));
                    tokio::time::sleep(Duration::from_secs(15)).await;
                    continue;
                }
            };
            if text.is_empty() {
                continue;
            }
            let translated = if !translate_to.is_empty() {
                self.chat(&format!("Traduce el texto del usuario al idioma «{translate_to}». Responde solo con la traducción."), &text, 200).await.ok()
            } else {
                None
            };
            core.emit(ServerEvent::Caption(Caption { id: new_id(), text, translated, is_final: true, ts: now_ms() }));
        }
    }
}

/// Chat completion against an OpenAI-compatible server.
async fn openai_chat(core: &Core, base: &str, key: &str, model: &str, system: &str, user: &str, max_tokens: u32) -> anyhow::Result<String> {
    let mut req = core.http.post(format!("{base}/chat/completions")).json(&json!({
        "model": model, "max_tokens": max_tokens, "temperature": 0.7,
        "messages": [{"role":"system","content":system},{"role":"user","content":user}]
    }));
    if !key.is_empty() {
        req = req.bearer_auth(key);
    }
    let r = req.send().await.map_err(|e| anyhow::anyhow!("No se pudo conectar con {base}: {e}"))?;
    let status = r.status();
    let v: Value = r.json().await?;
    if !status.is_success() {
        anyhow::bail!("LLM: {}", v["error"]["message"].as_str().or(v["error"].as_str()).unwrap_or("error"));
    }
    Ok(clean(v["choices"][0]["message"]["content"].as_str().unwrap_or_default()))
}

/// Lowercase letters and digits without accents, for "same text?" checks.
fn fold(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            c => c,
        })
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// Language name for prompts.
fn lang_name(code: &str) -> &'static str {
    match code.split(['-', '_']).next().unwrap_or("") {
        "en" => "inglés",
        "fr" => "francés",
        "de" => "alemán",
        "pt" => "portugués",
        "it" => "italiano",
        "ja" => "japonés",
        _ => "español",
    }
}

/// Strip reasoning tags and quotes some local models add.
fn clean(s: &str) -> String {
    let mut s = s.to_string();
    while let (Some(a), Some(b)) = (s.find("<think>"), s.find("</think>")) {
        if b > a {
            s.replace_range(a..b + 8, "");
        } else {
            break;
        }
    }
    s.trim().trim_matches('"').trim().to_string()
}

/// Stereo f32 at `rate` Hz -> 16 kHz mono 16-bit WAV.
pub fn to_wav_16k_mono(samples: &[f32], rate: u32) -> Vec<u8> {
    let spec = hound::WavSpec { channels: 1, sample_rate: 16_000, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    let mut cur = std::io::Cursor::new(Vec::new());
    if let Ok(mut w) = hound::WavWriter::new(&mut cur, spec) {
        // Downmix to mono and resample (box filter over each output sample's span).
        let frames = samples.len() / 2;
        let ratio = rate.max(16_000) as f64 / 16_000.0;
        let out_len = (frames as f64 / ratio) as usize;
        for i in 0..out_len {
            let a = (i as f64 * ratio) as usize;
            let b = (((i + 1) as f64 * ratio) as usize).min(frames).max(a + 1);
            let mut sum = 0f32;
            for f in a..b {
                sum += (samples[f * 2] + samples[f * 2 + 1]) * 0.5;
            }
            let v = sum / (b - a) as f32;
            let _ = w.write_sample((v.clamp(-1.0, 1.0) * 32767.0) as i16);
        }
        let _ = w.finalize();
    }
    cur.into_inner()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folds_text() {
        assert_eq!(fold("¿Qué teclado usas?"), fold("que teclado usas"));
        assert_ne!(fold("What keyboard?"), fold("¿Qué teclado?"));
    }
    #[test]
    fn cleans() {
        assert_eq!(clean("<think>hmm</think> \"Hola!\""), "Hola!");
    }
    #[test]
    fn wav() {
        let w = to_wav_16k_mono(&vec![0.1; 48_000 * 2], 48_000);
        assert!(w.starts_with(b"RIFF"));
        assert_eq!(w.len(), 44 + 16_000 * 2);
    }
}
