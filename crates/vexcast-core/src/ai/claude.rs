//! Claude (Anthropic API) as the text model: co-host replies, AI moderation and caption
//! translation. Plain HTTP (Rust has no official SDK). Claude only does text here: it has no
//! speech synthesis and the API doesn't transcribe audio, so voices and captions use other engines.

use serde_json::{json, Value};
use std::time::Duration;

const API: &str = "https://api.anthropic.com/v1";
const VERSION: &str = "2026-10-21";
/// Default when no model is chosen.
pub const DEFAULT_MODEL: &str = "claude-opus-5-5";

/// Models that accept the server-side refusal fallback.
fn supports_fallback(model: &str) -> bool {
    ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5"].iter().any(|m| model.starts_with(m))
}

/// Older models reject `output_config.effort`.
fn supports_effort(model: &str) -> bool {
    !(model.contains("haiku-4-5") || model.contains("sonnet-4-5") || model.contains("-3-") || model.starts_with("claude-3"))
}

fn friendly(status: u16, body: &Value) -> String {
    let msg = body["error"]["message"].as_str().unwrap_or("error");
    match status {
        401 => "La clave de API de Claude no es válida (revísala en console.anthropic.com)".into(),
        402 => "Tu cuenta de Anthropic no tiene saldo o hay un problema de facturación".into(),
        403 => format!("Tu clave de API no tiene permiso para esto: {msg}"),
        404 => format!("Ese modelo no existe o tu cuenta no tiene acceso: {msg}"),
        429 => "Has superado el límite de uso de la API de Claude; espera un momento".into(),
        529 => "La API de Claude está saturada ahora mismo; inténtalo en unos segundos".into(),
        _ => format!("Claude respondió {status}: {msg}"),
    }
}

async fn send(http: &reqwest::Client, req: impl Fn() -> reqwest::RequestBuilder) -> anyhow::Result<Value> {
    for attempt in 0..2 {
        let r = req().send().await.map_err(|e| anyhow::anyhow!("No se pudo conectar con la API de Claude: {e}"))?;
        let status = r.status().as_u16();
        let retry_after = r.headers().get("retry-after").and_then(|v| v.to_str().ok()?.parse::<u64>().ok());
        let v: Value = r.json().await.unwrap_or(Value::Null);
        if (200..300).contains(&status) {
            return Ok(v);
        }
        // Rate limit / overload / server error: one retry.
        if attempt == 0 && matches!(status, 429 | 500 | 502 | 503 | 529) {
            tokio::time::sleep(Duration::from_secs(retry_after.unwrap_or(2).min(10))).await;
            continue;
        }
        anyhow::bail!("{}", friendly(status, &v));
    }
    let _ = http;
    anyhow::bail!("La API de Claude no respondió")
}

/// One short completion: `system` instructions + one user message.
pub async fn chat(http: &reqwest::Client, key: &str, model: &str, system: &str, user: &str, max_tokens: u32) -> anyhow::Result<String> {
    if key.trim().is_empty() {
        anyhow::bail!("Pega tu clave de API de Claude en IA › Texto");
    }
    let model = if model.starts_with("claude") { model } else { DEFAULT_MODEL };
    // Thinking counts toward max_tokens on current models: leave room, keep answers short by prompt.
    let mut body = json!({
        "model": model,
        "max_tokens": (max_tokens * 8).max(2048),
        "system": system,
        "messages": [{ "role": "user", "content": user }],
    });
    if supports_effort(model) {
        body["output_config"] = json!({ "effort": "low" });
    }
    let fallback = supports_fallback(model);
    if fallback {
        body["fallbacks"] = json!("default");
    }
    let v = send(http, || {
        let mut r = http.post(format!("{API}/messages")).header("x-api-key", key.trim()).header("anthropic-version", VERSION).json(&body);
        if fallback {
            r = r.header("anthropic-beta", "server-side-fallback-2026-07-01");
        }
        r
    })
    .await?;
    if v["stop_reason"] == "refusal" {
        anyhow::bail!("Claude ha preferido no responder a este mensaje");
    }
    let text: String = v["content"].as_array().into_iter().flatten().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("");
    Ok(text.trim().trim_matches('"').trim().to_string())
}

/// Model ids available to this key (newest first).
pub async fn models(http: &reqwest::Client, key: &str) -> anyhow::Result<Vec<String>> {
    if key.trim().is_empty() {
        anyhow::bail!("Pega tu clave de API de Claude");
    }
    let v = send(http, || http.get(format!("{API}/models")).query(&[("limit", "100")]).header("x-api-key", key.trim()).header("anthropic-version", VERSION).timeout(Duration::from_secs(10))).await?;
    Ok(v["data"].as_array().into_iter().flatten().filter_map(|m| m["id"].as_str().map(String::from)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feature_gates() {
        assert!(supports_fallback("claude-opus-5-5"));
        assert!(!supports_fallback("claude-haiku-5-5"));
        assert!(supports_effort("claude-haiku-5-5"));
        assert!(!supports_effort("claude-haiku-4-5"));
    }
}
