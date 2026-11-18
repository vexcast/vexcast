//! Fonts that come with themes and imported collections.
//!
//! Theme packs and Streamlabs collections use fonts that are not installed in
//! Windows (Streamlabs downloads them to `slobs-client/Fonts`). The files are copied
//! to `<data>/fonts` (and loaded privately for the browser/FreeType sources), and
//! text sources whose font isn't installed in Windows fall back to Arial, because the
//! GDI+ text source only sees installed fonts: text is never invisible.

use serde_json::Value;
use std::path::{Path, PathBuf};

pub fn fonts_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("fonts")
}

fn is_font(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| matches!(e.to_ascii_lowercase().as_str(), "ttf" | "otf" | "ttc"))
}

/// Windows' font folders (system and per-user).
fn system_font_dirs() -> Vec<PathBuf> {
    let mut v = vec![];
    if let Ok(w) = std::env::var("WINDIR") {
        v.push(PathBuf::from(w).join("Fonts"));
    }
    if let Some(l) = dirs::data_local_dir() {
        v.push(l.join("Microsoft").join("Windows").join("Fonts"));
    }
    v
}

/// Lower-case, without spaces/dashes/underscores: "ABeeZee-Regular.ttf" ≈ "abeezee".
fn key(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase()
}

fn files_in(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.path()).filter(|p| is_font(p)).collect()).unwrap_or_default()
}

/// Is there a font file whose name starts with this face (installed, or loaded by us)?
fn face_available(face: &str, ours: &Path) -> bool {
    let k = key(face);
    if k.is_empty() {
        return true;
    }
    // Common faces are always there even if their file names differ (arial.ttf is "Arial").
    if matches!(k.as_str(), "arial" | "segoeui" | "tahoma" | "verdana" | "timesnewroman" | "couriernew" | "calibri" | "consolas" | "impact" | "georgia" | "trebuchetms") {
        return true;
    }
    // Only fonts installed in Windows count: the GDI+ text source doesn't see private ones.
    let _ = ours;
    system_font_dirs().iter().flat_map(|d| files_in(d)).any(|p| p.file_stem().and_then(|s| s.to_str()).is_some_and(|s| key(s).starts_with(&k)))
}

/// Copy the fonts a collection needs into `<data>/fonts` (from `search` folders: the
/// theme pack, Streamlabs' font folder…), load them, and switch text sources whose
/// font is still missing to Arial.
pub fn prepare_collection(v: &mut Value, data_dir: &Path, search: &[PathBuf]) {
    let ours = fonts_dir(data_dir);
    let _ = std::fs::create_dir_all(&ours);
    // Every font file shipped in the search folders (a pack's "Fonts" folder…).
    let mut candidates: Vec<PathBuf> = vec![];
    for d in search {
        candidates.extend(super::theme::walk_files(d, 4, 5000).into_iter().filter(|p| is_font(p)));
    }
    for f in &candidates {
        if let Some(name) = f.file_name() {
            let target = ours.join(name);
            if !target.exists() {
                let _ = std::fs::copy(f, &target);
            }
        }
    }
    load_dir(&ours);
    let sources = v["sources"].as_array_mut();
    for s in sources.into_iter().flatten() {
        let id = s["id"].as_str().unwrap_or_default();
        if !id.starts_with("text_gdiplus") && !id.starts_with("text_ft2") {
            continue;
        }
        // Streamlabs keeps the theme font apart ("custom_font") with Arial as the face:
        // use the real one when it's installed in Windows.
        if let Some(custom) = s["settings"]["custom_font"].as_str().filter(|c| !c.trim().is_empty()).map(String::from) {
            let k = key(Path::new(&custom).file_stem().and_then(|x| x.to_str()).unwrap_or_default());
            let file = files_in(&ours).into_iter().find(|p| p.file_stem().and_then(|x| x.to_str()).is_some_and(|x| key(x) == k));
            if let Some(family) = file.as_deref().and_then(family_name).filter(|f| face_available(f, &ours) && !installed_this_run(f)) {
                if !s["settings"]["font"].is_object() {
                    s["settings"]["font"] = serde_json::json!({ "size": 36, "flags": 0 });
                }
                s["settings"]["font"]["face"] = Value::String(family);
                continue;
            }
        }
        let face = s["settings"]["font"]["face"].as_str().unwrap_or_default().to_string();
        if !face.is_empty() && !face_available(&face, &ours) {
            tracing::info!("Fuente «{face}» no disponible: se usa Arial");
            s["settings"]["font"]["face"] = Value::String("Arial".into());
        }
    }
}

/// Family name inside a TrueType/OpenType file (name table, ID 16 or 1).
pub fn family_name(path: &Path) -> Option<String> {
    let b = std::fs::read(path).ok()?;
    let u16at = |o: usize| -> Option<u16> { Some(u16::from_be_bytes([*b.get(o)?, *b.get(o + 1)?])) };
    let u32at = |o: usize| -> Option<u32> { Some(u32::from_be_bytes([*b.get(o)?, *b.get(o + 1)?, *b.get(o + 2)?, *b.get(o + 3)?])) };
    // A collection (.ttc): use its first font.
    let base = if b.get(0..4) == Some(b"ttcf") { u32at(12)? as usize } else { 0 };
    let tables = u16at(base + 4)? as usize;
    let mut name_off = None;
    for i in 0..tables {
        let rec = base + 12 + i * 16;
        if b.get(rec..rec + 4) == Some(b"name") {
            name_off = Some(u32at(rec + 8)? as usize);
        }
    }
    let t = name_off?;
    let count = u16at(t + 2)? as usize;
    let strings = t + u16at(t + 4)? as usize;
    let mut best: Option<(u8, String)> = None;
    for i in 0..count {
        let r = t + 6 + i * 12;
        let (platform, _enc, lang, id, len, off) = (u16at(r)?, u16at(r + 2)?, u16at(r + 4)?, u16at(r + 6)?, u16at(r + 8)? as usize, u16at(r + 10)? as usize);
        if id != 1 && id != 16 {
            continue;
        }
        let raw = b.get(strings + off..strings + off + len)?;
        let text = if platform == 3 || platform == 0 {
            String::from_utf16_lossy(&raw.chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect::<Vec<_>>())
        } else {
            raw.iter().map(|&c| c as char).collect()
        };
        // Prefer: typographic family (16) in English on Windows, then family (1).
        let score = (if id == 16 { 4 } else { 0 }) + (if platform == 3 { 2 } else { 0 }) + (if lang == 0x409 || lang == 0 { 1 } else { 0 });
        if !text.trim().is_empty() && best.as_ref().is_none_or(|(s, _)| score > *s) {
            best = Some((score, text.trim().to_string()));
        }
    }
    best.map(|(_, n)| n)
}

/// Families installed while Vexcast is running: the engine can't draw them until it restarts.
static FRESH: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Installed during this run (needs a restart to be usable).
pub fn installed_this_run(family: &str) -> bool {
    FRESH.lock().map(|f| f.iter().any(|x| x.eq_ignore_ascii_case(family))).unwrap_or(false)
}

/// On load: texts from themes use their font when Windows has it (installed before this run).
pub fn apply_installed(v: &mut Value, data_dir: &Path) -> usize {
    let ours = fonts_dir(data_dir);
    let files = files_in(&ours);
    let mut n = 0;
    for s in v["sources"].as_array_mut().into_iter().flatten() {
        let id = s["id"].as_str().unwrap_or_default();
        if !id.starts_with("text_gdiplus") && !id.starts_with("text_ft2") {
            continue;
        }
        let Some(custom) = s["settings"]["custom_font"].as_str().filter(|c| !c.trim().is_empty()).map(String::from) else { continue };
        let k = key(Path::new(&custom).file_stem().and_then(|x| x.to_str()).unwrap_or_default());
        let Some(family) = files.iter().find(|p| p.file_stem().and_then(|x| x.to_str()).is_some_and(|x| key(x) == k)).and_then(|p| family_name(p)) else { continue };
        if installed_this_run(&family) || !face_available(&family, &ours) {
            continue;
        }
        if s["settings"]["font"]["face"].as_str() == Some(family.as_str()) {
            continue;
        }
        if !s["settings"]["font"].is_object() {
            s["settings"]["font"] = serde_json::json!({ "size": 36, "flags": 0 });
        }
        s["settings"]["font"]["face"] = Value::String(family);
        n += 1;
    }
    n
}

/// A font file of ours matching a Streamlabs `custom_font` ("ABeeZee-Regular.ttf").
pub fn find_font(data_dir: &Path, custom: &str) -> Option<PathBuf> {
    let k = key(Path::new(custom).file_stem()?.to_str()?);
    files_in(&fonts_dir(data_dir)).into_iter().find(|p| p.file_stem().and_then(|s| s.to_str()).is_some_and(|s| key(s) == k))
}

/// Is a family installed in Windows (so GDI+ text can use it)?
pub fn installed(family: &str) -> bool {
    face_available(family, Path::new(""))
}

/// Install a font for the current Windows user (no admin rights; like double-clicking it and
/// choosing "Install"). Returns its family name.
#[cfg(windows)]
pub fn install_for_user(path: &Path) -> anyhow::Result<String> {
    let family = family_name(path).ok_or_else(|| anyhow::anyhow!("No se pudo leer la fuente"))?;
    let dir = dirs::data_local_dir().ok_or_else(|| anyhow::anyhow!("Sin carpeta de usuario"))?.join("Microsoft").join("Windows").join("Fonts");
    std::fs::create_dir_all(&dir)?;
    let target = dir.join(path.file_name().ok_or_else(|| anyhow::anyhow!("Ruta no válida"))?);
    if !target.exists() {
        std::fs::copy(path, &target)?;
    }
    let kind = if path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("otf")) { "OpenType" } else { "TrueType" };
    let status = std::process::Command::new("reg")
        .args(["add", r"HKCU\Software\Microsoft\Windows NT\CurrentVersion\Fonts", "/v", &format!("{family} ({kind})"), "/t", "REG_SZ", "/d", &target.to_string_lossy(), "/f"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()?;
    if !status.success() {
        anyhow::bail!("Windows no dejó registrar la fuente");
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn AddFontResourceW(name: *const u16) -> i32;
    }
    use std::os::windows::ffi::OsStrExt;
    let wide: Vec<u16> = target.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        AddFontResourceW(wide.as_ptr());
    }
    if let Ok(mut f) = FRESH.lock() {
        f.push(family.clone());
    }
    Ok(family)
}

#[cfg(not(windows))]
pub fn install_for_user(_path: &Path) -> anyhow::Result<String> {
    anyhow::bail!("Solo disponible en Windows")
}

/// Load every font in `dir` for this process (Windows; no-op elsewhere).
pub fn load_dir(dir: &Path) {
    for f in files_in(dir) {
        load(&f);
    }
}

#[cfg(windows)]
fn load(path: &Path) {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "gdi32")]
    extern "system" {
        fn AddFontResourceExW(name: *const u16, fl: u32, res: *mut std::ffi::c_void) -> i32;
    }
    const FR_PRIVATE: u32 = 0x10;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    unsafe {
        AddFontResourceExW(wide.as_ptr(), FR_PRIVATE, std::ptr::null_mut());
    }
}

#[cfg(not(windows))]
fn load(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    /// Reads the family from a real font file when one is around (Windows' Arial).
    #[test]
    fn reads_family_names() {
        let arial = std::env::var("WINDIR").map(|w| PathBuf::from(w).join("Fonts").join("arial.ttf")).unwrap_or_default();
        if arial.exists() {
            assert_eq!(family_name(&arial).as_deref(), Some("Arial"));
        }
        assert_eq!(family_name(Path::new("no-existe.ttf")), None);
    }
}
