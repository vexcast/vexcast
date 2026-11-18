//! "Install a theme": overlay packs from StreamSpell, Nerd or Die, Own3d… as a new
//! scene collection, with their files copied into Vexcast's data folder.
//!
//! Accepted inputs:
//! - a Streamlabs theme file (`.overlay`, a zip with `config.json` + media);
//! - an OBS Studio or Streamlabs Desktop collection `.json` shipped inside a pack
//!   (paths like `C:/Animated/Overlays/Webcam.webm` are relinked to the files that
//!   came with the pack);
//! - the pack's folder (the `.overlay` or `.json` inside is used).

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

pub struct Prepared {
    pub name: String,
    pub collection: Value,
    /// Folders where the theme's fonts may be (the pack, Streamlabs' font folder).
    pub font_dirs: Vec<PathBuf>,
    /// Alert media found in the pack (its "Alerts" folder), copied into the theme folder.
    pub alerts: Vec<(crate::model::AlertType, PathBuf)>,
    /// Vexcast overlay packages: their alert designs and widget settings.
    pub extras: Value,
}

// ------------------------------------------------------------------ Vexcast overlay packages (.vxoverlay)

/// Placeholder for files inside a package ("@pack/media/3_logo.png").
const PACK: &str = "@pack/";
/// Placeholder for the core's address in widget URLs ("@vexcast/widgets/alerts.html?design=…").
const CORE: &str = "@vexcast/";

/// Rewrite every string in `v` with `f`.
fn map_strings(v: &mut Value, f: &mut dyn FnMut(&str) -> Option<String>) {
    match v {
        Value::String(s) => {
            if let Some(n) = f(s) {
                *s = n;
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|x| map_strings(x, f)),
        Value::Object(o) => o.iter_mut().for_each(|(_, x)| map_strings(x, f)),
        _ => {}
    }
}

/// Replace `from` with `to` inside every string of `v`.
pub fn replace_in_strings(v: &mut Value, from: &str, to: &str) {
    map_strings(v, &mut |s: &str| s.contains(from).then(|| s.replace(from, to)));
}

/// Widget URLs of this core → "@vexcast/widgets/…" (without the access token).
fn portable_url(s: &str) -> Option<String> {
    let i = s.find("/widgets/")?;
    if !(s.starts_with("http://127.0.0.1:") || s.starts_with("http://localhost:")) {
        return None;
    }
    let rest = &s[i + 1..];
    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
    let kept: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes()).filter(|(k, _)| k != "token").map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let q: String = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(kept).finish();
    Some(format!("{CORE}{path}{}{q}", if q.is_empty() { "" } else { "?" }))
}

/// Write the current scene collection, its files, alert designs and widget settings to a
/// `.vxoverlay` package (a zip that `prepare` installs like a Streamlabs `.overlay`).
pub fn export_package(mut collection: Value, mut extras: Value, name: &str, out: &Path) -> anyhow::Result<usize> {
    use std::io::Write;
    let file = std::fs::File::create(out).map_err(|e| anyhow::anyhow!("No se pudo crear {}: {e}", out.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut files: Vec<(String, String)> = vec![]; // (source path, path in package)
    let mut errors: Vec<String> = vec![];
    {
        let mut f = |s: &str| -> Option<String> {
            if let Some(u) = portable_url(s) {
                return Some(u);
            }
            if !looks_like_path(s) || !Path::new(s).is_file() {
                return None;
            }
            if let Some((_, p)) = files.iter().find(|(src, _)| src == s) {
                return Some(format!("{PACK}{p}"));
            }
            let base = Path::new(s).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| "archivo".into());
            let p = format!("media/{}_{base}", files.len() + 1);
            let mut buf = vec![];
            match std::fs::File::open(s).and_then(|mut fh| fh.read_to_end(&mut buf)) {
                Ok(_) => {
                    if zip.start_file(&p, opts).is_ok() && zip.write_all(&buf).is_ok() {
                        files.push((s.to_string(), p.clone()));
                        return Some(format!("{PACK}{p}"));
                    }
                }
                Err(e) => errors.push(format!("{s}: {e}")),
            }
            None
        };
        map_strings(&mut collection, &mut f);
        map_strings(&mut extras, &mut f);
    }
    for e in errors {
        tracing::warn!("export overlay: {e}");
    }
    zip.start_file("collection.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&collection)?.as_bytes())?;
    zip.start_file("extras.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&extras)?.as_bytes())?;
    zip.start_file("manifest.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&json!({ "app": "vexcast", "kind": "overlay", "version": 1, "name": name }))?.as_bytes())?;
    zip.finish()?;
    Ok(files.len())
}

/// Install a `.vxoverlay`: extract it into `dest` and resolve its placeholders.
fn import_package(file: &Path, dest: &Path, port: u16) -> anyhow::Result<(Value, Value, String)> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(file)?).map_err(|_| anyhow::anyhow!("El archivo no es un overlay de Vexcast válido"))?;
    let read_json = |zip: &mut zip::ZipArchive<std::fs::File>, n: &str| -> anyhow::Result<Value> {
        let mut s = String::new();
        zip.by_name(n).map_err(|_| anyhow::anyhow!("Al overlay le falta {n}"))?.read_to_string(&mut s)?;
        Ok(serde_json::from_str(&s)?)
    };
    let manifest = read_json(&mut zip, "manifest.json").unwrap_or(Value::Null);
    let mut collection = read_json(&mut zip, "collection.json")?;
    let mut extras = read_json(&mut zip, "extras.json").unwrap_or(json!({}));
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let Some(rel) = entry.enclosed_name() else { continue };
        if entry.is_dir() || !rel.starts_with("media") {
            continue;
        }
        let out = dest.join(&rel);
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::io::copy(&mut entry, &mut std::fs::File::create(&out)?)?;
    }
    let base = path_str(dest);
    let mut f = |s: &str| -> Option<String> {
        if let Some(rest) = s.strip_prefix(PACK) {
            // Only plain file names under media/ (no "..").
            if rest.contains("..") {
                return Some(String::new());
            }
            return Some(format!("{base}/{rest}"));
        }
        s.strip_prefix(CORE).map(|rest| format!("http://127.0.0.1:{port}/{rest}"))
    };
    map_strings(&mut collection, &mut f);
    map_strings(&mut extras, &mut f);
    let name = manifest["name"].as_str().unwrap_or("Overlay").to_string();
    Ok((collection, extras, name))
}

/// Turn `path` into an OBS collection, copying/extracting its files into `themes_dir/<name>`.
pub fn prepare(path: &Path, themes_dir: &Path, name: Option<String>, canvas: (u32, u32), port: u16) -> anyhow::Result<Prepared> {
    let file = if path.is_dir() { find_in_pack(path).ok_or_else(|| anyhow::anyhow!("No hay ningún archivo .overlay ni colección .json en esa carpeta"))? } else { path.to_path_buf() };
    let ext = file.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase();
    let stem = file.file_stem().and_then(|s| s.to_str()).unwrap_or("Tema").to_string();
    let name = name.filter(|n| !n.trim().is_empty()).unwrap_or(stem);
    let dest = unique_dir(themes_dir, &sanitize(&name));
    std::fs::create_dir_all(&dest)?;
    let mut extras = json!({});
    let collection = match ext.as_str() {
        "vxoverlay" => {
            let (mut v, x, _) = import_package(&file, &dest, port)?;
            extras = x;
            v["name"] = json!(name);
            v
        }
        "overlay" | "zip" => {
            let config = extract(&file, &dest)?;
            convert_overlay(&config, &dest, &name, canvas, port)?
        }
        "json" => {
            let text = std::fs::read_to_string(&file)?;
            let mut v: Value = serde_json::from_str(&text).map_err(|_| anyhow::anyhow!("El archivo no es una colección de escenas válida"))?;
            if super::slobs::is_slobs(&v) {
                v = super::slobs::convert(&v, &name)?;
            }
            if !v["sources"].is_array() {
                anyhow::bail!("El archivo no es una colección de escenas de OBS ni de Streamlabs");
            }
            relink(&mut v, &file, &dest);
            v["name"] = json!(name);
            v
        }
        _ => anyhow::bail!("Formato no compatible: usa un archivo .vxoverlay, .overlay, una colección .json o la carpeta del pack"),
    };
    let mut font_dirs = vec![dest.clone()];
    if let Some(root) = file.parent().and_then(|p| p.parent()).or(file.parent()) {
        font_dirs.push(root.to_path_buf());
    }
    if let Some(d) = super::slobs::collections_dir().and_then(|d| d.parent().map(|p| p.join("Fonts"))) {
        font_dirs.push(d);
    }
    let alerts = font_dirs.get(1).map(|root| alert_media(root, &dest)).unwrap_or_default();
    Ok(Prepared { name, collection, font_dirs, alerts, extras })
}

fn sanitize(s: &str) -> String {
    let t: String = s.chars().map(|c| if c.is_alphanumeric() || " -_().".contains(c) { c } else { '_' }).collect();
    let t = t.trim().trim_matches('.').to_string();
    if t.is_empty() {
        "Tema".into()
    } else {
        t
    }
}

fn unique_dir(base: &Path, name: &str) -> PathBuf {
    let mut p = base.join(name);
    let mut n = 2;
    while p.exists() {
        p = base.join(format!("{name} ({n})"));
        n += 1;
    }
    p
}

/// The theme file inside a pack folder: a `.overlay` first, else a collection `.json`.
fn find_in_pack(dir: &Path) -> Option<PathBuf> {
    let files = walk(dir, 5, 5000);
    if let Some(o) = files.iter().find(|p| p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("vxoverlay") || e.eq_ignore_ascii_case("overlay"))) {
        return Some(o.clone());
    }
    files.into_iter().find(|p| {
        p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("json"))
            && std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).is_some_and(|v| v["sources"].is_array() || super::slobs::is_slobs(&v))
    })
}

/// Files under dir (up to depth folders deep, at most limit).
pub fn walk_files(dir: &Path, depth: usize, limit: usize) -> Vec<PathBuf> {
    walk(dir, depth, limit)
}

fn walk(dir: &Path, depth: usize, limit: usize) -> Vec<PathBuf> {
    let mut out = vec![];
    let mut stack = vec![(dir.to_path_buf(), 0usize)];
    while let Some((d, lvl)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                if lvl < depth {
                    stack.push((p, lvl + 1));
                }
            } else {
                out.push(p);
                if out.len() >= limit {
                    return out;
                }
            }
        }
    }
    out.sort();
    out
}

/// Extract a `.overlay` zip into `dest`; returns its `config.json`.
fn extract(file: &Path, dest: &Path) -> anyhow::Result<Value> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(file)?).map_err(|_| anyhow::anyhow!("El archivo .overlay está dañado o no es un tema de Streamlabs"))?;
    let mut config = None;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        // enclosed_name() rejects "../" and absolute paths.
        let Some(rel) = entry.enclosed_name() else { continue };
        if entry.is_dir() {
            continue;
        }
        if rel.as_os_str() == "config.json" {
            let mut s = String::new();
            entry.read_to_string(&mut s)?;
            config = Some(serde_json::from_str::<Value>(&s)?);
            continue;
        }
        let out = dest.join(&rel);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut f = std::fs::File::create(&out)?;
        std::io::copy(&mut entry, &mut f)?;
    }
    config.ok_or_else(|| anyhow::anyhow!("El tema no tiene config.json"))
}

/// Alert type from a pack file name ("Cyber Follower.webm" → Follow).
fn alert_kind(file_name: &str) -> Option<crate::model::AlertType> {
    use crate::model::AlertType::*;
    let n = file_name.to_lowercase();
    let has = |k: &str| n.contains(k);
    Some(if has("gift") {
        GiftSub
    } else if has("follow") {
        Follow
    } else if has("super chat") || has("superchat") || has("super_chat") {
        Superchat
    } else if has("sub") {
        Subscription
    } else if has("donat") || has("tip") {
        Donation
    } else if has("raid") {
        Raid
    } else if has("host") {
        Host
    } else if has("cheer") || has("bits") {
        Bits
    } else if has("member") {
        Member
    } else if has("kofi") || has("ko-fi") {
        Kofi
    } else {
        return None;
    })
}

/// Media files inside the pack's alert folder(s), copied to `dest/Alerts`.
fn alert_media(root: &Path, dest: &Path) -> Vec<(crate::model::AlertType, PathBuf)> {
    let mut out: Vec<(crate::model::AlertType, PathBuf)> = vec![];
    for f in walk(root, 5, 20000) {
        let in_alerts = f.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()).is_some_and(|n| n.to_lowercase().contains("alert"));
        let ext = f.extension().and_then(|e| e.to_str()).unwrap_or_default().to_lowercase();
        if !in_alerts || !["webm", "mp4", "mov", "gif", "png", "apng", "webp"].contains(&ext.as_str()) {
            continue;
        }
        let Some(kind) = f.file_name().and_then(|n| n.to_str()).and_then(alert_kind) else { continue };
        if out.iter().any(|(k, _)| *k == kind) {
            continue;
        }
        let target = dest.join("Alerts").join(f.file_name().unwrap_or_default());
        let _ = std::fs::create_dir_all(dest.join("Alerts"));
        if std::fs::copy(&f, &target).is_ok() {
            out.push((kind, target));
        }
    }
    out
}

fn uuid_of(id: &str) -> String {
    let tail = id.trim_start_matches("scene_");
    if uuid::Uuid::parse_str(tail).is_ok() {
        tail.to_string()
    } else {
        uuid::Uuid::new_v4().to_string()
    }
}

fn path_str(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn label_text(kind: &str) -> String {
    let t = match kind {
        "most_recent_follower" => "Último seguidor",
        "most_recent_subscriber" => "Último suscriptor",
        "most_recent_donator" => "Último donador",
        "most_recent_cheerer" => "Último cheer",
        "all_time_top_donator" => "Mayor donador",
        "session_follower_count" => "Seguidores (sesión)",
        "session_subscriber_count" => "Suscriptores (sesión)",
        _ => "",
    };
    if t.is_empty() {
        kind.replace('_', " ")
    } else {
        t.to_string()
    }
}

/// Streamlabs widget type → Vexcast's own overlay widget.
fn widget_page(kind: u64) -> Option<&'static str> {
    match kind {
        0 => Some("alerts"),
        1 => Some("goal"),
        2 => Some("goal?type=followers"),
        3 => Some("goal?type=subs"),
        4 => Some("goal?type=bits"),
        6 => Some("chat"),
        7 => Some("events"),
        12 => Some("giveaway"),
        14 => Some("songs?player=1"),
        16 => Some("poll"),
        18 => Some("highlight"),
        _ => None,
    }
}

/// Convert a Streamlabs theme `config.json` to an OBS collection.
pub fn convert_overlay(c: &Value, dir: &Path, name: &str, canvas: (u32, u32), port: u16) -> anyhow::Result<Value> {
    let (w, h) = (canvas.0 as f64, canvas.1 as f64);
    let scenes = c["scenes"]["items"].as_array().cloned().ok_or_else(|| anyhow::anyhow!("El tema no tiene escenas"))?;
    let file = |f: &Value| f.as_str().map(|f| path_str(&dir.join(f))).unwrap_or_default();
    let mut sources: Vec<Value> = vec![];
    let mut order = vec![];
    let scene_uuid: HashMap<String, (String, String)> =
        scenes.iter().filter_map(|s| Some((s["sceneId"].as_str()?.to_string(), (uuid_of(s["sceneId"].as_str()?), s["name"].as_str().unwrap_or("Escena").to_string())))).collect();

    for sc in &scenes {
        let sname = sc["name"].as_str().unwrap_or("Escena").to_string();
        let suuid = sc["sceneId"].as_str().map(uuid_of).unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let mut items = vec![];
        for slot in sc["slots"]["items"].as_array().into_iter().flatten() {
            if slot["sceneNodeType"].as_str() == Some("folder") {
                continue;
            }
            let content = &slot["content"];
            let item_name = slot["name"].as_str().unwrap_or("Fuente").to_string();
            let src: Option<(String, Value)> = match content["nodeType"].as_str().unwrap_or_default() {
                "ImageNode" => Some(("image_source".into(), json!({ "file": file(&content["filename"]) }))),
                "VideoNode" => {
                    let mut s = if content["settings"].is_object() { content["settings"].clone() } else { json!({}) };
                    s["local_file"] = json!(file(&content["filename"]));
                    s["is_local_file"] = json!(true);
                    Some(("ffmpeg_source".into(), s))
                }
                "TextNode" => Some(("text_gdiplus".into(), content["settings"].clone())),
                "StreamlabelNode" => {
                    let mut s = content["textSource"]["settings"].clone();
                    if !s.is_object() {
                        s = json!({});
                    }
                    let kind = content["labelType"].as_str().unwrap_or_default();
                    s["text"] = json!(label_text(kind));
                    s["read_from_file"] = json!(false);
                    // Vexcast keeps it up to date (latest follower, top donation…).
                    if let Some(l) = crate::live_text::from_streamlabs(kind) {
                        s[crate::live_text::KEY] = json!(l);
                    }
                    Some(("text_gdiplus".into(), s))
                }
                "WidgetNode" => {
                    let mut s = if content["settings"].is_object() { content["settings"].clone() } else { json!({}) };
                    if let Some(page) = widget_page(content["type"].as_u64().unwrap_or(99)) {
                        // "goal?type=subs" → goal.html?type=subs
                        let (file, query) = page.split_once('?').map(|(f, q)| (f, format!("?{q}"))).unwrap_or((page, String::new()));
                        s["url"] = json!(format!("http://127.0.0.1:{port}/widgets/{file}.html{query}"));
                    }
                    Some(("browser_source".into(), s))
                }
                "WebcamNode" => Some(("dshow_input".into(), json!({}))),
                "GameCaptureNode" => Some(("game_capture".into(), json!({ "capture_mode": "any_fullscreen" }))),
                "SceneSourceNode" => None,
                _ => continue,
            };
            let (src_uuid, src_name) = match src {
                Some((kind, settings)) => {
                    let u = uuid::Uuid::new_v4().to_string();
                    let filters: Vec<Value> = slot["filters"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|f| {
                            let kind = f["type"].as_str()?;
                            Some(json!({ "name": f["name"], "id": kind, "versioned_id": kind, "settings": f["settings"], "enabled": f["enabled"].as_bool().unwrap_or(true) }))
                        })
                        .collect();
                    sources.push(json!({ "name": item_name, "uuid": u, "id": kind, "versioned_id": super::slobs::versioned(&kind), "settings": settings, "enabled": true, "filters": filters, "volume": 1.0, "mixers": 255 }));
                    (u, item_name.clone())
                }
                None => match content["sceneId"].as_str().and_then(|id| scene_uuid.get(id)) {
                    Some(s) => s.clone(),
                    None => continue,
                },
            };
            let crop = &slot["crop"];
            items.push(json!({
                "name": src_name,
                "source_uuid": src_uuid,
                "visible": slot["visible"].as_bool().unwrap_or(true),
                "locked": false,
                "rot": slot["rotation"].as_f64().unwrap_or(0.0),
                // Positions are fractions of the canvas; scales are "scale / canvas size".
                "pos": { "x": slot["x"].as_f64().unwrap_or(0.0) * w, "y": slot["y"].as_f64().unwrap_or(0.0) * h },
                "scale": { "x": slot["scaleX"].as_f64().unwrap_or(1.0 / w) * w, "y": slot["scaleY"].as_f64().unwrap_or(1.0 / h) * h },
                "align": 5,
                "bounds_type": 0,
                "bounds_align": 0,
                "bounds": { "x": 0.0, "y": 0.0 },
                "crop_left": crop["left"].as_i64().unwrap_or(0),
                "crop_top": crop["top"].as_i64().unwrap_or(0),
                "crop_right": crop["right"].as_i64().unwrap_or(0),
                "crop_bottom": crop["bottom"].as_i64().unwrap_or(0),
                "id": items.len() + 1,
                "private_settings": {},
            }));
        }
        order.push(json!({ "name": sname }));
        sources.push(json!({ "name": sname, "uuid": suuid, "id": "scene", "versioned_id": "scene", "settings": { "id_counter": items.len(), "custom_size": false, "items": items }, "enabled": true }));
    }

    let mut out = json!({
        "name": name,
        "current_scene": scenes.first().and_then(|s| s["name"].as_str()).unwrap_or_default(),
        "current_program_scene": scenes.first().and_then(|s| s["name"].as_str()).unwrap_or_default(),
        "scene_order": order,
        "sources": sources,
        "groups": [],
        "transitions": [],
        "transition_duration": 300,
    });
    let t = &c["transition"];
    if let Some(kind) = t["type"].as_str().filter(|k| *k != "cut_transition" && *k != "fade_transition") {
        let mut s = if t["settings"].is_object() { t["settings"].clone() } else { json!({}) };
        if let Some(p) = s["path"].as_str().filter(|p| !p.is_empty()) {
            s["path"] = json!(path_str(&dir.join(p)));
        }
        out["transitions"] = json!([{ "name": "Transición del tema", "id": kind, "settings": s }]);
        out["current_transition"] = json!("Transición del tema");
        out["transition_duration"] = json!(t["duration"].as_u64().unwrap_or(300));
    }
    Ok(out)
}

fn looks_like_path(s: &str) -> bool {
    let b = s.as_bytes();
    (b.len() > 3 && b[1] == b':' && (b[2] == b'/' || b[2] == b'\\')) || s.starts_with('/')
}

/// Point file paths that don't exist on this PC at the pack's own copies (copied into `dest`).
fn relink(v: &mut Value, json_file: &Path, dest: &Path) {
    // The pack root: a couple of levels above the .json (packs keep it in a "Tutorial" folder or so).
    let root = json_file.parent().and_then(|p| p.parent()).or(json_file.parent()).unwrap_or(Path::new(".")).to_path_buf();
    let files = walk(&root, 6, 20000);
    let index: Vec<(String, String, &PathBuf)> = files.iter().map(|p| { let rel = path_str(p.strip_prefix(&root).unwrap_or(p)); (rel.to_lowercase(), rel, p) }).collect();
    let mut copied: HashMap<PathBuf, String> = HashMap::new();
    let mut fix = |s: &str| -> Option<String> {
        if !looks_like_path(s) || Path::new(s).exists() {
            return None;
        }
        let parts: Vec<String> = s.replace('\\', "/").split('/').filter(|p| !p.is_empty()).map(|p| p.to_lowercase()).collect();
        for k in (1..=parts.len().min(6)).rev() {
            let suffix = parts[parts.len() - k..].join("/");
            if let Some((_, rel, src)) = index.iter().find(|(lower, _, _)| *lower == suffix || lower.ends_with(&format!("/{suffix}"))) {
                if let Some(done) = copied.get(*src) {
                    return Some(done.clone());
                }
                let target = dest.join(rel);
                if let Some(p) = target.parent() {
                    let _ = std::fs::create_dir_all(p);
                }
                let _ = std::fs::copy(src, &target);
                let out = path_str(&target);
                copied.insert((*src).clone(), out.clone());
                return Some(out);
            }
        }
        None
    };
    fn visit(v: &mut Value, fix: &mut dyn FnMut(&str) -> Option<String>) {
        match v {
            Value::String(s) => {
                if let Some(n) = fix(s) {
                    *s = n;
                }
            }
            Value::Array(a) => a.iter_mut().for_each(|x| visit(x, fix)),
            Value::Object(o) => o.iter_mut().for_each(|(_, x)| visit(x, fix)),
            _ => {}
        }
    }
    for key in ["sources", "transitions"] {
        visit(&mut v[key], &mut fix);
    }
    for (key, _, _) in super::collection::GLOBAL_SLOTS {
        visit(&mut v[key], &mut fix);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_coordinates_and_nodes() {
        let c = json!({
            "scenes": { "items": [
                { "name": "Directo", "sceneId": "scene_11111111-2222-3333-4444-555555555555", "slots": { "items": [
                    { "name": "Fondo", "sceneNodeType": "item", "x": 0.5, "y": 0.25, "scaleX": 1.0 / 1920.0, "scaleY": 0.5 / 1080.0, "crop": {}, "rotation": 0, "content": { "nodeType": "ImageNode", "filename": "1.png" } },
                    { "name": "Alertas", "sceneNodeType": "item", "x": 0, "y": 0, "scaleX": 1.0 / 1920.0, "scaleY": 1.0 / 1080.0, "content": { "nodeType": "WidgetNode", "type": 0, "settings": { "width": 800, "height": 600 } } },
                    { "name": "Carpeta", "sceneNodeType": "folder", "childrenIds": [] }
                ]}},
                { "name": "Pausa", "sceneId": "scene_99999999-2222-3333-4444-555555555555", "slots": { "items": [
                    { "name": "Directo", "sceneNodeType": "item", "x": 0, "y": 0, "scaleX": 0.5 / 1920.0, "scaleY": 0.5 / 1080.0, "content": { "nodeType": "SceneSourceNode", "sceneId": "scene_11111111-2222-3333-4444-555555555555" } }
                ]}}
            ]},
            "transition": { "type": "obs_stinger_transition", "settings": { "path": "9.webm" }, "duration": 500 }
        });
        let o = convert_overlay(&c, Path::new("C:/temas/x"), "X", (1920, 1080), 7420).unwrap();
        let srcs = o["sources"].as_array().unwrap();
        let img = srcs.iter().find(|s| s["name"] == "Fondo").unwrap();
        assert_eq!(img["settings"]["file"], "C:/temas/x/1.png");
        let alerts = srcs.iter().find(|s| s["name"] == "Alertas").unwrap();
        assert_eq!(alerts["settings"]["url"], "http://127.0.0.1:7420/widgets/alerts.html");
        let directo = srcs.iter().find(|s| s["id"] == "scene" && s["name"] == "Directo").unwrap();
        let items = directo["settings"]["items"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["pos"]["x"], 960.0);
        assert_eq!(items[0]["pos"]["y"], 270.0);
        assert!((items[0]["scale"]["y"].as_f64().unwrap() - 0.5).abs() < 1e-9);
        let pausa = srcs.iter().find(|s| s["name"] == "Pausa").unwrap();
        assert_eq!(pausa["settings"]["items"][0]["source_uuid"], "11111111-2222-3333-4444-555555555555");
        assert_eq!(o["transitions"][0]["settings"]["path"], "C:/temas/x/9.webm");
        assert_eq!(o["transition_duration"], 500);
    }

    #[test]
    fn vxoverlay_roundtrip_media_urls_and_no_token() {
        let base = std::env::temp_dir().join(format!("vexcast-vxo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        let img = base.join("logo.png");
        std::fs::write(&img, b"img").unwrap();
        let col = json!({ "name": "Mi overlay", "sources": [
            { "name": "Logo", "id": "image_source", "settings": { "file": path_str(&img) } },
            { "name": "Alerta", "id": "browser_source", "settings": { "url": "http://127.0.0.1:7420/widgets/alerts.html?token=SECRETO&design=abc" } }
        ]});
        let extras = json!({ "designs": [{ "id": "abc", "layers": [{ "kind": "image", "src": path_str(&img) }] }] });
        let out = base.join("x.vxoverlay");
        assert_eq!(export_package(col, extras, "Mi overlay", &out).unwrap(), 1, "the shared file is packed once");
        let raw = std::fs::read(&out).unwrap();
        assert!(!raw.windows(7).any(|w| w == b"SECRETO"), "the access token never goes into a package");
        let dest = base.join("installed");
        std::fs::create_dir_all(&dest).unwrap();
        let (c, x, name) = import_package(&out, &dest, 9999).unwrap();
        assert_eq!(name, "Mi overlay");
        let file = c["sources"][0]["settings"]["file"].as_str().unwrap();
        assert!(Path::new(file).is_file() && file.ends_with("logo.png"), "{file}");
        assert_eq!(c["sources"][1]["settings"]["url"], "http://127.0.0.1:9999/widgets/alerts.html?design=abc");
        assert_eq!(x["designs"][0]["layers"][0]["src"], file);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn relinks_missing_paths_to_pack_files() {
        let base = std::env::temp_dir().join(format!("vexcast-theme-{}", uuid::Uuid::new_v4()));
        let pack = base.join("Animated");
        std::fs::create_dir_all(pack.join("Overlays")).unwrap();
        std::fs::create_dir_all(pack.join("Tutorial")).unwrap();
        std::fs::write(pack.join("Overlays/Webcam.webm"), b"x").unwrap();
        let json_file = pack.join("Tutorial/pack.json");
        let mut v = json!({ "sources": [{ "name": "Cam", "settings": { "local_file": "C:/Animated/Overlays/Webcam.webm", "other": "texto" } }] });
        let dest = base.join("dest");
        relink(&mut v, &json_file, &dest);
        let p = v["sources"][0]["settings"]["local_file"].as_str().unwrap().to_string();
        assert!(p.ends_with("Overlays/Webcam.webm"), "{p}");
        assert!(Path::new(&p).exists());
        assert_eq!(v["sources"][0]["settings"]["other"], "texto");
        let _ = std::fs::remove_dir_all(&base);
    }
}
