//! Stream health assistant: watches the engine stats over the last seconds and explains what's
//! wrong (render lag, encoder overload, dropped frames on a destination, reconnects, CPU, disk),
//! with one-click fixes where there is one.

use crate::core::Core;
use crate::model::*;
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

static REPORT: Mutex<Option<Value>> = parking_lot::const_mutex(None);

/// Last report (for clients that connect later).
pub fn report() -> Value {
    REPORT.lock().clone().unwrap_or_else(|| json!({ "level": "ok", "issues": [] }))
}

fn pct(a: i64, b: i64) -> f64 {
    if b > 0 {
        a as f64 * 100.0 / b as f64
    } else {
        0.0
    }
}

fn issue(id: &str, level: &str, title: String, detail: String, fixes: &[(&str, &str)]) -> Value {
    json!({ "id": id, "level": level, "title": title, "detail": detail, "fixes": fixes.iter().map(|(id, label)| json!({ "id": id, "label": label })).collect::<Vec<_>>() })
}

/// Compare the oldest and newest samples of the window.
fn analyze(core: &Core, old: &Stats, new: &Stats, streaming: bool, recording: bool) -> Vec<Value> {
    let mut out = vec![];
    let (dests, output) = core.read(|s| (s.destinations.clone(), s.output.clone()));
    let render = pct(new.render_skipped as i64 - old.render_skipped as i64, new.render_total as i64 - old.render_total as i64);
    if render > 2.0 {
        out.push(issue(
            "render",
            if render > 10.0 { "error" } else { "warn" },
            format!("La GPU no da abasto ({render:.0} % de fotogramas perdidos al dibujar)"),
            "Suele pasar cuando el juego usa toda la GPU. Limita los FPS del juego (por ejemplo a 144), baja los efectos de las escenas o reduce los FPS del lienzo.".into(),
            &[],
        ));
    }
    let enc = pct(new.encoding_skipped as i64 - old.encoding_skipped as i64, new.encoding_total as i64 - old.encoding_total as i64);
    if enc > 2.0 && (streaming || recording) {
        let hw = ["nvenc", "amf", "qsv", "videotoolbox"].iter().any(|h| output.stream_encoder.contains(h));
        out.push(issue(
            "encoder",
            if enc > 10.0 { "error" } else { "warn" },
            format!("El codificador va saturado ({enc:.0} % de fotogramas saltados)"),
            if hw { "Baja la resolución de salida o usa un preajuste más rápido del codificador.".into() } else { "Estás codificando con la CPU. Un codificador por hardware (NVENC, AMF o QuickSync) apenas la usa.".into() },
            if hw { &[] } else { &[("hardware_encoder", "Usar codificador por hardware")] },
        ));
    }
    for o in &new.outputs {
        let Some(d) = dests.iter().find(|d| d.id == o.id) else { continue };
        let prev = old.outputs.iter().find(|x| x.id == o.id);
        if o.state == "reconnecting" {
            out.push(issue(&format!("reconnect:{}", d.id), "error", format!("Reconectando con {}", d.name), "Se ha cortado la conexión con la plataforma; Vexcast lo reintenta solo. Si se repite, baja el bitrate.".into(), &[("lower_bitrate", "Bajar bitrate un 25 %")]));
            continue;
        }
        if let Some(p) = prev {
            let dropped = pct(o.dropped_frames - p.dropped_frames, o.total_frames - p.total_frames);
            if dropped > 1.0 || o.congestion > 0.5 {
                let mut fixes = vec![("lower_bitrate", "Bajar bitrate un 25 %")];
                if !output.dynamic_bitrate {
                    fixes.push(("dynamic_bitrate", "Bitrate automático"));
                }
                out.push(issue(
                    &format!("network:{}", d.id),
                    if dropped > 5.0 { "error" } else { "warn" },
                    format!("Conexión inestable con {} ({dropped:.1} % de fotogramas perdidos)", d.name),
                    "Tu subida no aguanta el bitrate actual. Bájalo o activa el bitrate automático; cierra descargas y otras apps que usen la red.".into(),
                    &fixes,
                ));
            }
        }
    }
    if old.cpu > 92.0 && new.cpu > 92.0 {
        out.push(issue("cpu", "warn", format!("CPU al {:.0} %", new.cpu), "El directo puede ir a tirones. Cierra programas en segundo plano o usa un codificador por hardware.".into(), &[]));
    }
    if recording {
        if let Some(gb) = new.disk_free_gb.filter(|g| *g < 2.0) {
            out.push(issue("disk", "error", format!("Solo quedan {gb:.1} GB libres"), "La grabación se parará cuando se llene el disco. Libera espacio o cambia la carpeta de grabación.".into(), &[]));
        }
    }
    out
}

/// Watch the stats every 2 s (window of ~10 s) and push a `health` event when the issues change.
pub async fn run(core: Arc<Core>) {
    let mut window: VecDeque<Stats> = VecDeque::new();
    let mut last_ids: Vec<String> = vec![];
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        if core.is_stopping() {
            return;
        }
        if !core.engine.is_ready() {
            continue;
        }
        let e = core.engine.clone();
        let Ok(stats) = tokio::task::spawn_blocking(move || e.stats()).await else { continue };
        window.push_back(stats);
        while window.len() > 5 {
            window.pop_front();
        }
        let status = core.engine.status();
        let issues = if window.len() >= 3 { analyze(&core, window.front().unwrap(), window.back().unwrap(), status.streaming, status.recording) } else { vec![] };
        let level = if issues.iter().any(|i| i["level"] == "error") {
            "error"
        } else if issues.is_empty() {
            "ok"
        } else {
            "warn"
        };
        let ids: Vec<String> = issues.iter().filter_map(|i| i["id"].as_str().map(String::from)).collect();
        let report = json!({ "level": level, "issues": issues, "ts": now_ms() });
        *REPORT.lock() = Some(report.clone());
        if ids != last_ids {
            // New problems while live get a toast; the indicator shows the rest.
            if status.streaming {
                for i in report["issues"].as_array().into_iter().flatten().filter(|i| !last_ids.iter().any(|x| Some(x.as_str()) == i["id"].as_str())) {
                    core.notify(if i["level"] == "error" { "error" } else { "warning" }, i["title"].as_str().unwrap_or("").to_string());
                }
            }
            last_ids = ids;
            core.emit(ServerEvent::Health(report));
        }
    }
}

/// Apply a one-click fix. Returns a message for the user.
pub fn fix(core: &Arc<Core>, id: &str) -> anyhow::Result<String> {
    match id {
        "lower_bitrate" => {
            let cur = core.read(|s| s.output.stream_encoder_settings["bitrate"].as_i64().unwrap_or(6000));
            let new = ((cur as f64 * 0.75 / 100.0).round() as i64 * 100).max(1500);
            if new >= cur {
                anyhow::bail!("El bitrate ya está en el mínimo recomendado ({cur} kbps)");
            }
            core.update(|s| {
                if !s.output.stream_encoder_settings.is_object() {
                    s.output.stream_encoder_settings = json!({});
                }
                s.output.stream_encoder_settings["bitrate"] = json!(new);
            });
            let live = core.engine.set_live_bitrate(new);
            Ok(if live { format!("Bitrate bajado de {cur} a {new} kbps, ya aplicado al directo") } else { format!("Bitrate bajado de {cur} a {new} kbps (se aplica al próximo directo)") })
        }
        "dynamic_bitrate" => {
            core.update(|s| s.output.dynamic_bitrate = true);
            Ok("Bitrate automático activado: se aplica desde el próximo directo".into())
        }
        "hardware_encoder" => {
            let enc = crate::obs::best_video_encoder();
            if enc == "obs_x264" {
                anyhow::bail!("No hay codificador por hardware disponible en este PC");
            }
            core.update(|s| s.output.stream_encoder = enc.clone());
            Ok(format!("Codificador cambiado a {enc}: se aplica desde el próximo directo"))
        }
        _ => anyhow::bail!("Arreglo desconocido"),
    }
}
