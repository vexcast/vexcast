//! Macros: a named list of actions (switch scene, set the title, say something in chat, start
//! recording, wait…) run in order from a button, a hotkey, the phone or MCP.

use crate::core::Core;
use crate::model::*;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("").trim()
}

/// Run blocking engine work off the async threads.
async fn eng<T: Send + 'static>(core: &Arc<Core>, f: impl FnOnce(&Arc<crate::obs::Engine>) -> anyhow::Result<T> + Send + 'static) -> anyhow::Result<T> {
    let e = core.engine.clone();
    tokio::task::spawn_blocking(move || f(&e)).await?
}

/// Scene uuid from a uuid or a name.
fn scene_uuid(core: &Core, key: &str) -> anyhow::Result<String> {
    let snap = core.engine.snapshot();
    snap.scenes
        .iter()
        .find(|sc| sc.uuid.to_string() == key || sc.name.eq_ignore_ascii_case(key))
        .map(|sc| sc.uuid.to_string())
        .ok_or_else(|| anyhow::anyhow!("la escena «{key}» no existe"))
}

async fn step(core: &Arc<Core>, st: &MacroStep) -> anyhow::Result<()> {
    let v = &st.value;
    match st.kind.as_str() {
        "scene" => {
            let uuid = scene_uuid(core, s(v, "scene"))?;
            eng(core, move |e| e.set_program_scene(&uuid, false)).await?;
        }
        "stream" => match s(v, "action") {
            "stop" => eng(core, |e| Ok(e.stop_stream())).await?,
            _ => {
                if !core.engine.status().streaming {
                    for w in eng(core, |e| e.start_stream()).await? {
                        core.notify("warning", w);
                    }
                }
            }
        },
        "record" => match s(v, "action") {
            "stop" => eng(core, |e| Ok(e.stop_recording())).await?,
            _ => {
                if !core.engine.status().recording {
                    eng(core, |e| e.start_recording().map(|_| ())).await?;
                }
            }
        },
        "replay" => eng(core, |e| e.save_replay()).await?,
        "counter" => {
            let id = s(v, "counter");
            let delta = v["delta"].as_i64().unwrap_or(1);
            if v["set"].as_bool() == Some(true) {
                crate::counters::set(core, id, delta).ok_or_else(|| anyhow::anyhow!("el contador «{id}» no existe"))?;
            } else {
                crate::counters::add(core, id, delta).ok_or_else(|| anyhow::anyhow!("el contador «{id}» no existe"))?;
            }
        }
        "countdown" => {
            crate::counters::countdown(core, s(v, "action"), v["seconds"].as_i64().unwrap_or(0));
        }
        "chat" => {
            let text = s(v, "text");
            if !text.is_empty() {
                core.chat.send(text, None);
                core.chat.local_echo(core, "Vexcast", text, true);
            }
        }
        "title" => {
            let title = Some(s(v, "title").to_string()).filter(|t| !t.is_empty());
            let category = Some(s(v, "category").to_string()).filter(|t| !t.is_empty());
            let accounts = core.oauth.accounts(&core.read(|s| s.account_tokens.clone()));
            let mut done = 0;
            for a in accounts.iter().filter(|a| a.connected) {
                match core.oauth.set_stream_info(&a.platform, title.clone(), category.clone(), None).await {
                    Ok(()) => done += 1,
                    Err(e) => core.notify("warning", format!("{}: {e}", a.platform)),
                }
            }
            if done == 0 {
                anyhow::bail!("no hay cuentas conectadas para cambiar el título");
            }
        }
        "tts" => {
            let text = s(v, "text");
            if !text.is_empty() {
                core.tts.speak(text).await?;
            }
        }
        "mute" => {
            let source = s(v, "source").to_string();
            let snap = core.engine.snapshot();
            let src = snap.sources.iter().find(|x| x.uuid.to_string() == source || x.name.eq_ignore_ascii_case(&source)).ok_or_else(|| anyhow::anyhow!("la fuente «{source}» no existe"))?;
            let muted = v["muted"].as_bool().unwrap_or(!src.muted);
            let uuid = src.uuid.to_string();
            eng(core, move |e| e.update_source(&uuid, &json!({ "muted": muted })).map(|_| ())).await?;
        }
        "visibility" => {
            let scene = scene_uuid(core, s(v, "scene"))?;
            let item = v["item"].as_i64().ok_or_else(|| anyhow::anyhow!("falta el elemento"))?;
            let snap = core.engine.snapshot();
            let current = snap.scenes.iter().find(|sc| sc.uuid.to_string() == scene).and_then(|sc| sc.items.iter().find(|i| i.id == item)).map(|i| i.visible).unwrap_or(true);
            let visible = v["visible"].as_bool().unwrap_or(!current);
            let patch = crate::obs::model::SceneItemPatch { visible: Some(visible), ..Default::default() };
            eng(core, move |e| e.update_item(&scene, item, patch).map(|_| ())).await?;
        }
        "alert" => {
            let kind: AlertType = serde_json::from_value(json!(s(v, "type"))).map_err(|_| anyhow::anyhow!("tipo de alerta no válido"))?;
            core.alerts.test(kind).await;
        }
        "wait" => {
            let ms = v["ms"].as_u64().unwrap_or(1000).min(60_000);
            tokio::time::sleep(Duration::from_millis(ms)).await;
        }
        other => anyhow::bail!("acción desconocida «{other}»"),
    }
    Ok(())
}

/// Run every step in order; stops at the first failure.
pub async fn run(core: &Arc<Core>, m: &Macro) -> anyhow::Result<()> {
    for (i, st) in m.steps.iter().enumerate() {
        step(core, st).await.map_err(|e| anyhow::anyhow!("Macro «{}», paso {}: {e}", m.name, i + 1))?;
    }
    core.engine.changed();
    Ok(())
}

pub async fn run_by_id(core: &Arc<Core>, id: &str) -> anyhow::Result<()> {
    let m = core.read(|s| s.macros.iter().find(|m| m.id == id || m.name.eq_ignore_ascii_case(id)).cloned()).ok_or_else(|| anyhow::anyhow!("La macro no existe"))?;
    run(core, &m).await
}
