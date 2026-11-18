//! Sensible capture devices for imported collections and themes: the main monitor for screen
//! captures and the first camera for webcams (imported files point to devices of another PC).

use super::model::{SceneItemPatch, Vec2};
use super::Engine;
use serde_json::{json, Value};
use std::sync::Arc;

/// Settings key that holds the device of each capture kind.
fn device_key(kind: &str) -> Option<&'static str> {
    match kind {
        "monitor_capture" => Some("monitor_id"),
        "dshow_input" => Some("video_device_id"),
        _ => None,
    }
}

/// Primary monitor first ("@ 0,0" is always the primary on Windows), else the first one.
fn pick_monitor(items: &[(String, Value)]) -> Option<Value> {
    let primary = items.iter().find(|(n, _)| {
        let l = n.to_lowercase();
        n.contains("@ 0,0") || l.contains("primary") || l.contains("principal")
    });
    primary.or_else(|| items.first()).map(|(_, v)| v.clone())
}

impl Engine {
    /// Valid choices of a source's list property (disabled placeholders left out).
    fn device_choices(&self, uuid: &str, key: &str) -> (Value, Vec<(String, Value)>) {
        let props = self.source_properties(uuid).unwrap_or_default();
        let Some(p) = props.into_iter().find(|p| p.name == key) else { return (Value::Null, vec![]) };
        let items = p.items.unwrap_or_default().into_iter().filter(|i| !i.disabled && !i.value.as_str().is_some_and(|s| s.is_empty() || s == "DUMMY")).map(|i| (i.name, i.value)).collect();
        (p.value, items)
    }

    /// Point screen and camera captures with no valid device to the main monitor / first camera.
    /// Returns how many sources were changed.
    pub fn assign_default_devices(&self) -> usize {
        if !self.is_ready() {
            return 0;
        }
        let mut changed = 0;
        for s in self.snapshot().sources {
            let Some(key) = device_key(&s.kind) else { continue };
            let (current, items) = self.device_choices(&s.uuid, key);
            if items.is_empty() || items.iter().any(|(_, v)| *v == current) {
                continue;
            }
            let pick = if key == "monitor_id" { pick_monitor(&items) } else { items.first().map(|(_, v)| v.clone()) };
            if let Some(v) = pick {
                if self.update_source_settings(&s.uuid, &json!({ key: v })).is_ok() {
                    changed += 1;
                }
            }
        }
        changed
    }

    /// Under every game capture with no screen capture in its scene, add a capture of the main
    /// monitor fitted to the canvas: the game shows while it is fullscreen, the desktop otherwise.
    pub fn add_screen_under_game_captures(self: &Arc<Self>, name: &str) -> usize {
        if !self.is_ready() {
            return 0;
        }
        let snap = self.snapshot();
        let kind_of = |uuid: &str| snap.sources.iter().find(|s| s.uuid.to_string() == uuid).map(|s| s.kind.clone()).unwrap_or_default();
        let mut screen: Option<String> = snap.sources.iter().find(|s| s.kind == "monitor_capture").map(|s| s.uuid.to_string());
        let mut added = 0;
        for scene in &snap.scenes {
            let kinds: Vec<String> = scene.items.iter().map(|i| kind_of(&i.source_uuid.to_string())).collect();
            if kinds.iter().any(|k| k == "monitor_capture") {
                continue;
            }
            let Some(game) = scene.items.iter().zip(&kinds).find(|(_, k)| *k == "game_capture").map(|(i, _)| i.clone()) else { continue };
            let uuid = match &screen {
                Some(u) => u.clone(),
                None => match self.create_source(name, "monitor_capture", Some(json!({ "capture_cursor": true })), None) {
                    Ok(info) => {
                        let u = info.uuid.to_string();
                        let (_, items) = self.device_choices(&u, "monitor_id");
                        if let Some(v) = pick_monitor(&items) {
                            let _ = self.update_source_settings(&u, &json!({ "monitor_id": v }));
                        }
                        screen = Some(u.clone());
                        u
                    }
                    Err(_) => return added,
                },
            };
            let su = scene.uuid.to_string();
            let Ok(item) = self.add_source_to_scene(&su, &uuid) else { continue };
            let (cw, ch) = self.scene_canvas_size(&su);
            let (cw, ch) = (cw as f64, ch as f64);
            let full = game.bounds_type == "none" && (game.scale.x - 1.0).abs() < 0.01 && game.pos.x.abs() < 4.0 && game.pos.y.abs() < 4.0;
            // A full-canvas game capture: both fill the canvas. A framed one (a window in the
            // theme): both fill the game's frame, sized as if the game were canvas-sized.
            let fit = if full || game.bounds_type != "none" {
                SceneItemPatch {
                    pos: Some(if full { Vec2 { x: 0.0, y: 0.0 } } else { game.pos.clone() }),
                    scale: Some(Vec2 { x: 1.0, y: 1.0 }),
                    alignment: Some(if full { 5 } else { game.alignment }),
                    bounds_type: Some("scale_inner".into()),
                    bounds_alignment: Some(0),
                    bounds: Some(if full { Vec2 { x: cw, y: ch } } else { game.bounds.clone() }),
                    ..Default::default()
                }
            } else {
                SceneItemPatch {
                    pos: Some(game.pos.clone()),
                    scale: Some(Vec2 { x: 1.0, y: 1.0 }),
                    alignment: Some(game.alignment),
                    bounds_type: Some("scale_inner".into()),
                    bounds_alignment: Some(0),
                    bounds: Some(Vec2 { x: cw * game.scale.x, y: ch * game.scale.y }),
                    ..Default::default()
                }
            };
            let _ = self.update_item(&su, item.id, fit.clone());
            // A game at any resolution fits the same space.
            if game.bounds_type == "none" {
                let _ = self.update_item(&su, game.id, fit);
            }
            // Right below the game capture.
            let mut order: Vec<i64> = scene.items.iter().map(|i| i.id).collect();
            let at = order.iter().position(|id| *id == game.id).unwrap_or(0);
            order.insert(at, item.id);
            let _ = self.reorder_items(&su, &order);
            added += 1;
        }
        added
    }
}
