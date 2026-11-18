//! MCP server (Model Context Protocol, "Streamable HTTP" transport, JSON responses)
//! at `POST /api/v1/mcp`, so AI assistants (Claude Code, Claude Desktop, Cursor…)
//! can configure Vexcast: scenes, sources, overlays, alert variants and groups,
//! widgets, streaming, chat…
//!
//! Every tool calls the local REST API (the same code the app uses), so the MCP
//! never bypasses its validation. Only reachable from this PC.

use crate::core::Core;
use serde_json::{json, Value};
use std::sync::Arc;

const PROTOCOL: &str = "2025-06-18";
/// Tool results are truncated to keep the assistant's context small.
const MAX_TEXT: usize = 60_000;

struct Tool {
    name: &'static str,
    description: &'static str,
    schema: Value,
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({ "type": "object", "properties": props, "required": required })
}

fn tools() -> Vec<Tool> {
    vec![
        Tool { name: "get_overview", description: "Short summary of Vexcast: scene collection, scenes with their sources (names, kinds, visibility, position/size), current program scene, streaming/recording status, destinations, alert variants and groups. Start here.", schema: obj(json!({}), &[]) },
        Tool { name: "get_state", description: "Full Vexcast state as JSON (large): settings, scenes, sources with settings, widgets (alertBox.designs = alert variants, alertBox.groups), chat, accounts…", schema: obj(json!({}), &[]) },
        Tool { name: "switch_scene", description: "Show a scene on stream (program). In studio mode use preview=true to put it in preview instead.", schema: obj(json!({ "scene": { "type": "string", "description": "Scene name or uuid" }, "preview": { "type": "boolean" } }), &["scene"]) },
        Tool { name: "create_scene", description: "Create a new scene.", schema: obj(json!({ "name": { "type": "string" } }), &["name"]) },
        Tool {
            name: "add_source",
            description: "Create a source in a scene. Common kinds: image_source {file}, ffmpeg_source {local_file, looping}, browser_source {url, width, height}, text_gdiplus_v3 {text, font:{face,size}, color}, color_source_v3 {color, width, height}, monitor_capture, window_capture, game_capture, dshow_input (webcam), wasapi_input_capture (mic). Files must be absolute paths.",
            schema: obj(json!({ "scene": { "type": "string" }, "name": { "type": "string" }, "kind": { "type": "string" }, "settings": { "type": "object" } }), &["scene", "name", "kind"]),
        },
        Tool { name: "update_source", description: "Change a source's settings (merged), e.g. {text:'Hola'} for a text source or {url:'…'} for a browser source. Optionally rename it or change volume/mute.", schema: obj(json!({ "source": { "type": "string", "description": "Source name or uuid" }, "settings": { "type": "object" }, "rename": { "type": "string" }, "volumeDb": { "type": "number" }, "muted": { "type": "boolean" } }), &["source"]) },
        Tool { name: "delete_source", description: "Delete a source from every scene.", schema: obj(json!({ "source": { "type": "string" } }), &["source"]) },
        Tool {
            name: "set_item",
            description: "Move/resize/show/hide/lock a source inside a scene. pos {x,y} and scale {x,y} are in canvas pixels / factors; visible, locked, rot (degrees), crop {left,top,right,bottom}.",
            schema: obj(json!({ "scene": { "type": "string" }, "source": { "type": "string" }, "pos": { "type": "object" }, "scale": { "type": "object" }, "rot": { "type": "number" }, "visible": { "type": "boolean" }, "locked": { "type": "boolean" }, "crop": { "type": "object" } }), &["scene", "source"]),
        },
        Tool { name: "get_alert_variants", description: "List the alert variants (designs): id, name, type (follow, subscription, gift_sub, raid, bits, superchat, donation, kofi, member, host), enabled, min/max amount, canvas size, layers (text/image/video/shape with position, style and animations) and custom HTML/CSS/JS. Also the groups.", schema: obj(json!({}), &[]) },
        Tool {
            name: "save_alert_variant",
            description: "Create or update an alert variant. Pass the full design object (same shape as get_alert_variants). Missing id → a new variant. Text supports {user} {amount} {message} {currency} {months}. Layer kinds: text, image, video, shape; animations animIn/animOut/animLoop (fadeIn, zoomIn, pop, slideUp, bounceIn, typewriter…).",
            schema: obj(json!({ "design": { "type": "object" } }), &["design"]),
        },
        Tool { name: "delete_alert_variant", description: "Delete an alert variant by id.", schema: obj(json!({ "id": { "type": "string" } }), &["id"]) },
        Tool { name: "save_alert_group", description: "Create or update an alert group: one browser source showing the listed variant ids. {id?, name, designs: [variant ids], width, height}.", schema: obj(json!({ "group": { "type": "object" } }), &["group"]) },
        Tool { name: "test_alert", description: "Fire a test alert on stream (optionally a specific variant).", schema: obj(json!({ "type": { "type": "string" }, "variant": { "type": "string", "description": "Variant id" } }), &["type"]) },
        Tool {
            name: "update_widget",
            description: "Change a widget's settings (merged): section alertBox (general alert settings: ttsEnabled, durationMs…), chatBox (theme, fontSize, maxMessages, showBadges…), goal (title, target, current, currency…), captions.",
            schema: obj(json!({ "section": { "type": "string", "enum": ["alertBox", "chatBox", "goal", "captions"] }, "settings": { "type": "object" } }), &["section", "settings"]),
        },
        Tool { name: "stream", description: "Start or stop streaming to the enabled destinations.", schema: obj(json!({ "action": { "type": "string", "enum": ["start", "stop"] } }), &["action"]) },
        Tool { name: "record", description: "Start, stop, pause/resume or split the recording.", schema: obj(json!({ "action": { "type": "string", "enum": ["start", "stop", "pause", "resume", "split"] } }), &["action"]) },
        Tool { name: "set_stream_info", description: "Change the stream title (and optionally the category/game by name) on the connected Twitch/Kick accounts.", schema: obj(json!({ "platforms": { "type": "array", "items": { "type": "string", "enum": ["twitch", "kick"] } }, "title": { "type": "string" }, "category": { "type": "string" } }), &["platforms"]) },
        Tool { name: "send_chat", description: "Send a chat message to the connected platforms.", schema: obj(json!({ "text": { "type": "string" } }), &["text"]) },
        Tool { name: "run_macro", description: "Run a saved macro (by name or id). Macros are listed in get_state (macros).", schema: obj(json!({ "macro": { "type": "string" } }), &["macro"]) },
        Tool { name: "save_macros", description: "Replace the whole macro list. Each macro: {id?, name, color?, steps:[{kind, value}]}. kinds: scene {scene: name|uuid}, stream {action: start|stop}, record {action}, replay {}, chat {text}, title {title, category?}, tts {text}, mute {source, muted?}, visibility {scene, item (id), visible?}, alert {type}, wait {ms}.", schema: obj(json!({ "macros": { "type": "array" } }), &["macros"]) },
        Tool { name: "arrange_vertical", description: "Rebuild the vertical 9:16 version (TikTok/Shorts) of a scene from its horizontal layout. mode \"tiktok\": keeps clear of the top bar and the comments at the bottom (camera on top, whole game, labels under it, chat widgets left out); optional background = uuid of a vertical video/image source that fills behind. mode \"auto\": camera with its frame on top, game/screen filling the middle, labels below, alerts centered, backgrounds filling; \"fit\": the whole 16:9 scene scaled to the vertical width. Use scene \"*\" for every scene. Needs the vertical canvas enabled.", schema: obj(json!({ "scene": { "type": "string" }, "mode": { "type": "string", "enum": ["tiktok", "auto", "fit"] }, "background": { "type": "string", "description": "Source uuid of a vertical background" } }), &["scene"]) },
        Tool { name: "setup_devices", description: "Point screen captures to the main monitor and webcams to the first camera when they have no valid device, and add a capture of the main screen under game captures (shows the desktop while not gaming).", schema: obj(json!({}), &[]) },
        Tool { name: "export_overlay", description: "Export the current scene collection (+ files, alert variants, groups and widget looks) as a .vxoverlay package at an absolute path.", schema: obj(json!({ "path": { "type": "string" } }), &["path"]) },
        Tool { name: "install_overlay", description: "Install an overlay: .vxoverlay, Streamlabs .overlay, a pack's collection .json or the pack folder (absolute path). Creates and switches to a new scene collection.", schema: obj(json!({ "path": { "type": "string" }, "name": { "type": "string" } }), &["path"]) },
        Tool {
            name: "api_request",
            description: "Call any Vexcast REST endpoint (paths relative to /api/v1), for everything not covered by the other tools. Examples: GET /state · PUT /settings/{video|audio|output|advanced|widgets|ai|bot|general} · POST /scenes/{uuid}/items {sourceUuid} · POST /sources/{uuid}/filters {kind,name} · PATCH /sources/{uuid}/filters/{f}/settings · POST /transitions/{uuid}/current · PUT /transitions/duration {ms} · POST /destinations · PATCH /destinations/{id} · POST /replay/save · POST /collections/{name}/activate.",
            schema: obj(json!({ "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"] }, "path": { "type": "string" }, "body": {} }), &["method", "path"]),
        },
    ]
}

/// Handle one JSON-RPC message. None = notification (no response body).
pub async fn handle(core: Arc<Core>, msg: Value) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg["method"].as_str().unwrap_or_default().to_string();
    id.as_ref()?;
    let id = id.unwrap();
    let result: Result<Value, (i64, String)> = match method.as_str() {
        "initialize" => Ok(json!({
            "protocolVersion": msg["params"]["protocolVersion"].as_str().unwrap_or(PROTOCOL),
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "vexcast", "title": "Vexcast", "version": core.read(|s| s.version.clone()) },
            "instructions": "Vexcast is a local streaming studio (OBS engine). Call get_overview first. Scenes and sources can be referred to by name. Alert variants are designs per alert type; alert groups show several variants in one browser source. Changes apply live.",
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools().iter().map(|t| json!({ "name": t.name, "description": t.description, "inputSchema": t.schema })).collect::<Vec<_>>() })),
        "tools/call" => {
            let name = msg["params"]["name"].as_str().unwrap_or_default().to_string();
            let args = msg["params"]["arguments"].clone();
            let (text, is_error) = match call(&core, &name, &args).await {
                Ok(v) => (if let Value::String(s) = v { s } else { serde_json::to_string_pretty(&v).unwrap_or_default() }, false),
                Err(e) => (e.to_string(), true),
            };
            let text = if text.len() > MAX_TEXT { format!("{}…\n[truncated]", &text[..text.char_indices().take_while(|(i, _)| *i < MAX_TEXT).last().map(|(i, _)| i).unwrap_or(0)]) } else { text };
            Ok(json!({ "content": [{ "type": "text", "text": text }], "isError": is_error }))
        }
        _ => Err((-32601, format!("Method not found: {method}"))),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    })
}

/// Local REST call (loopback: trusted).
async fn api(core: &Core, method: &str, path: &str, body: Option<Value>) -> anyhow::Result<Value> {
    let url = format!("http://127.0.0.1:{}/api/v1{}", core.port, if path.starts_with('/') { path.to_string() } else { format!("/{path}") });
    let m = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())?;
    let mut req = core.http.request(m, &url);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let r = req.send().await?;
    let status = r.status();
    let text = r.text().await.unwrap_or_default();
    if !status.is_success() {
        let msg = serde_json::from_str::<Value>(&text).ok().and_then(|v| v["error"].as_str().map(String::from)).unwrap_or(text);
        anyhow::bail!("{status}: {msg}");
    }
    Ok(if text.is_empty() { json!({ "ok": true }) } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) })
}

fn s<'a>(args: &'a Value, k: &str) -> anyhow::Result<&'a str> {
    args[k].as_str().filter(|v| !v.trim().is_empty()).ok_or_else(|| anyhow::anyhow!("Missing argument «{k}»"))
}

/// Scene uuid from a name or uuid.
fn find_scene(state: &Value, key: &str) -> anyhow::Result<String> {
    let all = state["scenes"].as_array().into_iter().flatten().chain(state["verticalScenes"].as_array().into_iter().flatten());
    for sc in all {
        if sc["uuid"] == key || sc["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(key)) {
            return Ok(sc["uuid"].as_str().unwrap_or_default().to_string());
        }
    }
    anyhow::bail!("Scene «{key}» not found")
}

fn find_source(state: &Value, key: &str) -> anyhow::Result<String> {
    for src in state["sources"].as_array().into_iter().flatten() {
        if src["uuid"] == key || src["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(key)) {
            return Ok(src["uuid"].as_str().unwrap_or_default().to_string());
        }
    }
    anyhow::bail!("Source «{key}» not found")
}

fn overview(st: &Value) -> Value {
    let src_by_uuid = |u: &Value| st["sources"].as_array().into_iter().flatten().find(|s| s["uuid"] == *u).cloned().unwrap_or(Value::Null);
    let scenes: Vec<Value> = st["scenes"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|sc| {
            let items: Vec<Value> = sc["items"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|it| {
                    let src = src_by_uuid(&it["sourceUuid"]);
                    json!({ "item": it["id"], "name": it["name"], "kind": src["kind"], "visible": it["visible"], "pos": it["pos"], "scale": it["scale"], "size": [it["sourceWidth"], it["sourceHeight"]] })
                })
                .collect();
            json!({ "name": sc["name"], "uuid": sc["uuid"], "program": sc["uuid"] == st["programSceneUuid"], "items": items })
        })
        .collect();
    let designs: Vec<Value> = st["widgets"]["alertBox"]["designs"].as_array().into_iter().flatten().map(|d| json!({ "id": d["id"], "name": d["name"], "type": d["type"], "enabled": d["enabled"], "minAmount": d["minAmount"], "maxAmount": d["maxAmount"] })).collect();
    json!({
        "sceneCollection": st["sceneCollection"],
        "status": { "streaming": st["status"]["streaming"], "recording": st["status"]["recording"], "studioMode": st["status"]["studioMode"] },
        "canvas": [st["video"]["baseWidth"], st["video"]["baseHeight"]],
        "scenes": scenes,
        "destinations": st["destinations"].as_array().into_iter().flatten().map(|d| json!({ "name": d["name"], "enabled": d["enabled"], "canvas": d["canvas"] })).collect::<Vec<_>>(),
        "alertVariants": designs,
        "alertGroups": st["widgets"]["alertBox"]["groups"],
        "accounts": st["accounts"].as_array().into_iter().flatten().filter(|a| a["connected"] == true).map(|a| json!({ "platform": a["platform"], "login": a["login"] })).collect::<Vec<_>>(),
    })
}

async fn call(core: &Arc<Core>, name: &str, a: &Value) -> anyhow::Result<Value> {
    let state = || api(core, "GET", "/state", None);
    match name {
        "get_overview" => Ok(overview(&state().await?)),
        "get_state" => state().await,
        "switch_scene" => {
            let uuid = find_scene(&state().await?, s(a, "scene")?)?;
            let action = if a["preview"].as_bool() == Some(true) { "preview" } else { "program" };
            api(core, "POST", &format!("/scenes/{uuid}/{action}"), None).await
        }
        "create_scene" => api(core, "POST", "/scenes", Some(json!({ "name": s(a, "name")? }))).await,
        "add_source" => {
            let uuid = find_scene(&state().await?, s(a, "scene")?)?;
            api(core, "POST", "/sources", Some(json!({ "name": s(a, "name")?, "kind": s(a, "kind")?, "settings": if a["settings"].is_object() { a["settings"].clone() } else { json!({}) }, "sceneUuid": uuid }))).await
        }
        "update_source" => {
            let uuid = find_source(&state().await?, s(a, "source")?)?;
            let mut out = json!({});
            if a["settings"].is_object() {
                out["settings"] = api(core, "PATCH", &format!("/sources/{uuid}/settings"), Some(a["settings"].clone())).await.map(|_| json!("updated"))?;
            }
            let mut patch = serde_json::Map::new();
            if let Some(n) = a["rename"].as_str() {
                patch.insert("name".into(), json!(n));
            }
            if let Some(v) = a["volumeDb"].as_f64() {
                patch.insert("volumeDb".into(), json!(v));
            }
            if let Some(m) = a["muted"].as_bool() {
                patch.insert("muted".into(), json!(m));
            }
            if !patch.is_empty() {
                out["source"] = api(core, "PATCH", &format!("/sources/{uuid}"), Some(Value::Object(patch))).await?;
            }
            Ok(out)
        }
        "delete_source" => {
            let uuid = find_source(&state().await?, s(a, "source")?)?;
            api(core, "DELETE", &format!("/sources/{uuid}"), None).await
        }
        "set_item" => {
            let st = state().await?;
            let scene = find_scene(&st, s(a, "scene")?)?;
            let src = find_source(&st, s(a, "source")?)?;
            let sc = st["scenes"].as_array().into_iter().flatten().chain(st["verticalScenes"].as_array().into_iter().flatten()).find(|x| x["uuid"] == scene.as_str()).cloned().unwrap_or(Value::Null);
            let item = sc["items"].as_array().into_iter().flatten().find(|it| it["sourceUuid"] == src.as_str()).ok_or_else(|| anyhow::anyhow!("That source is not in the scene"))?;
            let mut patch = serde_json::Map::new();
            for k in ["pos", "scale", "rot", "visible", "locked", "crop"] {
                if !a[k].is_null() {
                    patch.insert(k.into(), a[k].clone());
                }
            }
            api(core, "PATCH", &format!("/scenes/{scene}/items/{}", item["id"]), Some(Value::Object(patch))).await
        }
        "get_alert_variants" => {
            let st = state().await?;
            Ok(json!({ "variants": st["widgets"]["alertBox"]["designs"], "groups": st["widgets"]["alertBox"]["groups"] }))
        }
        "save_alert_variant" => {
            let st = state().await?;
            let mut designs: Vec<Value> = st["widgets"]["alertBox"]["designs"].as_array().cloned().unwrap_or_default();
            let mut d = a["design"].clone();
            if !d.is_object() {
                anyhow::bail!("«design» must be an object");
            }
            let id = d["id"].as_str().filter(|x| !x.is_empty()).map(String::from).unwrap_or_else(crate::model::new_id);
            d["id"] = json!(id);
            // Fill defaults through the core's model (validates the shape).
            let parsed: crate::model::AlertDesign = serde_json::from_value(d).map_err(|e| anyhow::anyhow!("Invalid design: {e}"))?;
            let v = serde_json::to_value(&parsed)?;
            match designs.iter_mut().find(|x| x["id"] == id.as_str()) {
                Some(x) => *x = v,
                None => designs.push(v),
            }
            api(core, "PUT", "/settings/widgets", Some(json!({ "alertBox": { "designs": designs } }))).await?;
            Ok(json!({ "saved": id }))
        }
        "delete_alert_variant" => {
            let st = state().await?;
            let id = s(a, "id")?;
            let designs: Vec<Value> = st["widgets"]["alertBox"]["designs"].as_array().cloned().unwrap_or_default().into_iter().filter(|x| x["id"] != id).collect();
            api(core, "PUT", "/settings/widgets", Some(json!({ "alertBox": { "designs": designs } }))).await
        }
        "save_alert_group" => {
            let st = state().await?;
            let mut groups: Vec<Value> = st["widgets"]["alertBox"]["groups"].as_array().cloned().unwrap_or_default();
            let mut g = a["group"].clone();
            let id = g["id"].as_str().filter(|x| !x.is_empty()).map(String::from).unwrap_or_else(crate::model::new_id);
            g["id"] = json!(id);
            let parsed: crate::model::AlertGroup = serde_json::from_value(g).map_err(|e| anyhow::anyhow!("Invalid group: {e}"))?;
            let v = serde_json::to_value(&parsed)?;
            match groups.iter_mut().find(|x| x["id"] == id.as_str()) {
                Some(x) => *x = v,
                None => groups.push(v),
            }
            api(core, "PUT", "/settings/widgets", Some(json!({ "alertBox": { "groups": groups } }))).await?;
            Ok(json!({ "saved": id, "url": format!("http://127.0.0.1:{}/widgets/alerts.html?group={id}", core.port) }))
        }
        "test_alert" => api(core, "POST", "/alerts/test", Some(json!({ "type": s(a, "type")?, "design": a["variant"] }))).await,
        "update_widget" => api(core, "PUT", "/settings/widgets", Some(json!({ s(a, "section")?: a["settings"] }))).await,
        "stream" => api(core, "POST", if s(a, "action")? == "stop" { "/stream/stop" } else { "/stream/start" }, None).await,
        "record" => match s(a, "action")? {
            "stop" => api(core, "POST", "/record/stop", None).await,
            "pause" => api(core, "POST", "/record/pause", Some(json!({ "paused": true }))).await,
            "resume" => api(core, "POST", "/record/pause", Some(json!({ "paused": false }))).await,
            "split" => api(core, "POST", "/record/split", None).await,
            _ => api(core, "POST", "/record/start", None).await,
        },
        "set_stream_info" => {
            let mut done = vec![];
            for p in a["platforms"].as_array().into_iter().flatten().filter_map(|p| p.as_str()) {
                api(core, "POST", &format!("/oauth/{p}/stream-info"), Some(json!({ "title": a["title"], "category": a["category"] }))).await?;
                done.push(p.to_string());
            }
            Ok(json!({ "updated": done }))
        }
        "send_chat" => api(core, "POST", "/chat/send", Some(json!({ "text": s(a, "text")? }))).await,
        "arrange_vertical" => {
            let st = state().await?;
            let mode = a["mode"].as_str().unwrap_or("tiktok").to_string();
            let background = a["background"].as_str().map(String::from);
            let key = s(a, "scene")?;
            let ids: Vec<String> = if key == "*" { st["scenes"].as_array().into_iter().flatten().filter_map(|x| x["uuid"].as_str().map(String::from)).collect() } else { vec![find_scene(&st, key)?] };
            let mut out = vec![];
            for id in ids {
                out.push(api(core, "POST", &format!("/scenes/{id}/arrange-vertical"), Some(json!({ "mode": mode, "background": background }))).await?);
            }
            Ok(json!(out))
        }
        "setup_devices" => api(core, "POST", "/collections/setup-devices", None).await,
        "run_macro" => {
            let key = s(a, "macro")?;
            let id = core.read(|st| st.macros.iter().find(|m| m.id == key || m.name.eq_ignore_ascii_case(key)).map(|m| m.id.clone())).ok_or_else(|| anyhow::anyhow!("No hay ninguna macro «{key}»"))?;
            api(core, "POST", &format!("/macros/{id}/run"), None).await
        }
        "save_macros" => api(core, "PUT", "/macros", Some(a["macros"].clone())).await,
        "export_overlay" => api(core, "POST", "/collections/export-overlay", Some(json!({ "path": s(a, "path")? }))).await,
        "install_overlay" => api(core, "POST", "/collections/install-theme", Some(json!({ "path": s(a, "path")?, "name": a["name"] }))).await,
        "api_request" => {
            let body = if a["body"].is_null() { None } else { Some(a["body"].clone()) };
            api(core, s(a, "method")?, s(a, "path")?, body).await
        }
        _ => anyhow::bail!("Unknown tool «{name}»"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_schemas_are_objects_with_unique_names() {
        let t = tools();
        let mut names: Vec<&str> = t.iter().map(|x| x.name).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), t.len());
        assert!(t.iter().all(|x| x.schema["type"] == "object"));
    }

    #[test]
    fn finds_scenes_and_sources_by_name() {
        let st = json!({ "scenes": [{ "uuid": "s1", "name": "Live Scene" }], "sources": [{ "uuid": "x1", "name": "Webcam" }] });
        assert_eq!(find_scene(&st, "live scene").unwrap(), "s1");
        assert_eq!(find_source(&st, "x1").unwrap(), "x1");
        assert!(find_source(&st, "nope").is_err());
    }
}
