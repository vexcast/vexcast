//! Streamlabs Desktop (SLOBS) scene collections → OBS Studio format.
//!
//! Streamlabs keeps its collections in `%APPDATA%/slobs-client/SceneCollections`
//! (`manifest.json` lists them by name). The JSON is a tree of "nodes" (sources,
//! scenes with scene items and folders, transitions…) on top of the same libobs
//! source types, so it converts to the OBS collection format that the normal
//! loader understands. Folders are flattened (they are only an editor grouping),
//! and only the horizontal layout of "dual output" collections is taken.

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;

/// Streamlabs Desktop's collections folder (if it exists).
pub fn collections_dir() -> Option<PathBuf> {
    let d = dirs::config_dir()?.join("slobs-client").join("SceneCollections");
    d.is_dir().then_some(d)
}

/// (name, path) of each non-deleted Streamlabs collection.
pub fn list() -> Vec<(String, PathBuf)> {
    let Some(dir) = collections_dir() else { return vec![] };
    let manifest: Value = std::fs::read_to_string(dir.join("manifest.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let mut out = vec![];
    for c in manifest["collections"].as_array().into_iter().flatten() {
        if c["deleted"].as_bool() == Some(true) {
            continue;
        }
        let (Some(id), Some(name)) = (c["id"].as_str(), c["name"].as_str()) else { continue };
        let p = dir.join(format!("{id}.json"));
        if p.is_file() {
            out.push((name.to_string(), p));
        }
    }
    out
}

/// Is this JSON a Streamlabs collection (rather than an OBS one)?
pub fn is_slobs(v: &Value) -> bool {
    v["sources"]["items"].is_array() && v["scenes"]["items"].is_array()
}

/// The collection's display name from the manifest, for a collection file path.
pub fn name_for(path: &std::path::Path) -> Option<String> {
    list().into_iter().find(|(_, p)| p == path).map(|(n, _)| n)
}

/// Streamlabs (and theme packs) store unversioned source ids; libobs would load the
/// obsolete first version of these, which renders differently (e.g. empty text).
pub fn versioned(kind: &str) -> &str {
    match kind {
        "text_gdiplus" => "text_gdiplus_v3",
        "text_ft2_source" => "text_ft2_source_v2",
        "color_source" => "color_source_v3",
        _ => kind,
    }
}

/// "game_capture_748cb38a-…" → "748cb38a-…" (a uuid libobs accepts), or a new one.
fn uuid_of(id: &str) -> String {
    if id.len() >= 36 {
        let tail = &id[id.len() - 36..];
        if uuid::Uuid::parse_str(tail).is_ok() {
            return tail.to_string();
        }
    }
    uuid::Uuid::new_v4().to_string()
}

fn filters(v: &Value) -> Vec<Value> {
    v["filters"]["items"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|f| {
            let kind = f["type"].as_str().unwrap_or_default();
            json!({
                "name": f["name"],
                "id": kind,
                "versioned_id": kind,
                "uuid": uuid::Uuid::new_v4().to_string(),
                "settings": if f["settings"].is_object() { f["settings"].clone() } else { json!({}) },
                "enabled": f["enabled"].as_bool().unwrap_or(true),
            })
        })
        .collect()
}

/// Convert a Streamlabs collection to an OBS collection named `name`.
pub fn convert(v: &Value, name: &str) -> anyhow::Result<Value> {
    if !is_slobs(v) {
        anyhow::bail!("El archivo no es una colección de Streamlabs Desktop");
    }
    let mut out = Map::new();
    let mut sources: Vec<Value> = vec![];
    // Streamlabs id → (OBS uuid, name), for inputs and scenes.
    let mut ids: HashMap<String, (String, String)> = HashMap::new();

    for s in v["sources"]["items"].as_array().into_iter().flatten() {
        let (Some(id), Some(sname), Some(kind)) = (s["id"].as_str(), s["name"].as_str(), s["type"].as_str()) else { continue };
        let uuid = uuid_of(id);
        ids.insert(id.to_string(), (uuid.clone(), sname.to_string()));
        let sync_ns = s["syncOffset"]["sec"].as_i64().unwrap_or(0) * 1_000_000_000 + s["syncOffset"]["nsec"].as_i64().unwrap_or(0);
        let src = json!({
            "name": sname,
            "uuid": uuid,
            "id": kind,
            "versioned_id": versioned(kind),
            "settings": if s["settings"].is_object() { s["settings"].clone() } else { json!({}) },
            "volume": s["volume"].as_f64().unwrap_or(1.0),
            "muted": s["muted"].as_bool().unwrap_or(false),
            "mixers": s["audioMixers"].as_u64().unwrap_or(255),
            "monitoring_type": s["monitoringType"].as_u64().unwrap_or(0),
            "sync": sync_ns,
            "flags": if s["forceMono"].as_bool() == Some(true) { 2 } else { 0 },
            "deinterlace_mode": s["deinterlaceMode"].as_u64().unwrap_or(0),
            "deinterlace_field_order": s["deinterlaceFieldOrder"].as_u64().unwrap_or(0),
            "enabled": true,
            "filters": filters(s),
        });
        // Global audio devices (channel 1-6) live at the top level in OBS files.
        if let Some(ch) = s["channel"].as_u64().filter(|c| (1..=6).contains(c)) {
            if let Some((key, _, _)) = super::collection::GLOBAL_SLOTS.iter().find(|(_, c, _)| u64::from(*c) == ch) {
                out.insert((*key).to_string(), src);
                continue;
            }
        }
        sources.push(src);
    }

    let scenes = v["scenes"]["items"].as_array().cloned().unwrap_or_default();
    for sc in &scenes {
        if let (Some(id), Some(n)) = (sc["id"].as_str(), sc["name"].as_str()) {
            ids.insert(id.to_string(), (uuid_of(id), n.to_string()));
        }
    }
    let mut order = vec![];
    for sc in &scenes {
        let Some(id) = sc["id"].as_str() else { continue };
        let (uuid, sname) = ids[id].clone();
        let mut items = vec![];
        for it in sc["sceneItems"]["items"].as_array().into_iter().flatten() {
            if it["sceneNodeType"].as_str() == Some("folder") {
                continue;
            }
            // Dual output: the vertical copy of each item is skipped.
            if it["display"].as_str().is_some_and(|d| d != "horizontal") {
                continue;
            }
            let Some((src_uuid, src_name)) = it["sourceId"].as_str().and_then(|s| ids.get(s)).cloned() else { continue };
            let crop = &it["crop"];
            items.push(json!({
                "name": src_name,
                "source_uuid": src_uuid,
                "visible": it["visible"].as_bool().unwrap_or(true),
                "locked": it["locked"].as_bool().unwrap_or(false),
                "rot": it["rotation"].as_f64().unwrap_or(0.0),
                "pos": { "x": it["x"].as_f64().unwrap_or(0.0), "y": it["y"].as_f64().unwrap_or(0.0) },
                "scale": { "x": it["scaleX"].as_f64().unwrap_or(1.0), "y": it["scaleY"].as_f64().unwrap_or(1.0) },
                // Streamlabs always positions items by their top-left corner.
                "align": 5,
                "bounds_type": 0,
                "bounds_align": 0,
                "bounds": { "x": 0.0, "y": 0.0 },
                "crop_left": crop["left"].as_i64().unwrap_or(0),
                "crop_top": crop["top"].as_i64().unwrap_or(0),
                "crop_right": crop["right"].as_i64().unwrap_or(0),
                "crop_bottom": crop["bottom"].as_i64().unwrap_or(0),
                "id": items.len() + 1,
                "scale_filter": it["scaleFilter"].as_u64().unwrap_or(0),
                "blend_type": it["blendingMode"].as_u64().unwrap_or(0),
                "blend_method": it["blendingMethod"].as_u64().unwrap_or(0),
                "group_item_backup": false,
                "show_in_multiview": true,
                "private_settings": {},
            }));
        }
        order.push(json!({ "name": sname }));
        sources.push(json!({
            "name": sname,
            "uuid": uuid,
            "id": "scene",
            "versioned_id": "scene",
            "settings": { "id_counter": items.len(), "custom_size": false, "items": items },
            "enabled": true,
            "filters": filters(sc),
        }));
    }

    // Transitions.
    let tnode = &v["transitions"];
    let mut transitions = vec![];
    let mut current = None;
    let mut duration = 300;
    for t in tnode["transitions"].as_array().into_iter().flatten() {
        let (Some(tname), Some(kind)) = (t["name"].as_str(), t["type"].as_str()) else { continue };
        if t["id"] == tnode["defaultTransitionId"] {
            current = Some(tname.to_string());
            duration = t["duration"].as_u64().unwrap_or(300);
        }
        if kind == "cut_transition" || kind == "fade_transition" {
            continue; // built in
        }
        transitions.push(json!({ "name": tname, "id": kind, "settings": if t["settings"].is_object() { t["settings"].clone() } else { json!({}) } }));
    }

    let active = scenes.iter().find(|s| s["active"].as_bool() == Some(true)).or(scenes.first()).and_then(|s| s["name"].as_str()).unwrap_or_default().to_string();
    out.insert("name".into(), json!(name));
    out.insert("current_scene".into(), json!(active));
    out.insert("current_program_scene".into(), json!(active));
    out.insert("scene_order".into(), json!(order));
    out.insert("sources".into(), json!(sources));
    out.insert("transitions".into(), json!(transitions));
    if let Some(c) = current {
        out.insert("current_transition".into(), json!(c));
    }
    out.insert("transition_duration".into(), json!(duration));
    out.insert("groups".into(), json!([]));
    Ok(Value::Object(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_items_folders_and_globals() {
        let v = json!({
            "sources": { "items": [
                { "id": "image_source_11111111-2222-3333-4444-555555555555", "name": "Logo", "type": "image_source", "settings": { "file": "C:/logo.png" }, "volume": 1, "muted": false, "filters": { "items": [{ "name": "Croma", "type": "chroma_key_filter_v2", "settings": {}, "enabled": false }] } },
                { "id": "wasapi_output_capture_aaaaaaaa-2222-3333-4444-555555555555", "name": "Desktop Audio", "type": "wasapi_output_capture", "settings": {}, "volume": 0.5, "channel": 1, "filters": { "items": [] } }
            ]},
            "scenes": { "items": [
                { "id": "scene_99999999-2222-3333-4444-555555555555", "name": "Juego", "active": true, "filters": { "items": [] }, "sceneItems": { "items": [
                    { "id": "a", "sourceId": "image_source_11111111-2222-3333-4444-555555555555", "x": 10.5, "y": 20, "scaleX": 0.5, "scaleY": 0.5, "visible": true, "locked": false, "rotation": 0, "crop": { "left": 1, "top": 2, "right": 3, "bottom": 4 }, "sceneNodeType": "item", "display": "horizontal" },
                    { "id": "b", "sourceId": "image_source_11111111-2222-3333-4444-555555555555", "x": 0, "y": 0, "scaleX": 1, "scaleY": 1, "visible": true, "sceneNodeType": "item", "display": "vertical" },
                    { "id": "f", "name": "Carpeta", "sceneNodeType": "folder", "childrenIds": ["a"] }
                ]}}
            ]},
            "transitions": { "transitions": [{ "id": "t1", "name": "Fundido", "type": "fade_transition", "duration": 500 }], "defaultTransitionId": "t1" }
        });
        let o = convert(&v, "Mi colección").unwrap();
        assert_eq!(o["name"], "Mi colección");
        assert_eq!(o["current_scene"], "Juego");
        assert_eq!(o["transition_duration"], 500);
        assert_eq!(o["DesktopAudioDevice1"]["volume"], 0.5);
        let srcs = o["sources"].as_array().unwrap();
        let logo = srcs.iter().find(|s| s["name"] == "Logo").unwrap();
        assert_eq!(logo["uuid"], "11111111-2222-3333-4444-555555555555");
        assert_eq!(logo["filters"][0]["enabled"], false);
        let scene = srcs.iter().find(|s| s["id"] == "scene").unwrap();
        let items = scene["settings"]["items"].as_array().unwrap();
        assert_eq!(items.len(), 1, "vertical copies and folders are skipped");
        assert_eq!(items[0]["pos"]["x"], 10.5);
        assert_eq!(items[0]["crop_bottom"], 4);
        assert_eq!(items[0]["source_uuid"], "11111111-2222-3333-4444-555555555555");
    }
}
