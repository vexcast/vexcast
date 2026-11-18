//! Alert packs: share user-made alerts as one `.vxalert` file (a zip with
//! `alerts.json` + the images, videos and sounds they use).

use crate::model::{new_id, AlertDesign};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MANIFEST: &str = "alerts.json";

fn is_local(p: &str) -> bool {
    !p.trim().is_empty() && !p.starts_with("http://") && !p.starts_with("https://") && !p.starts_with("data:")
}

/// Every media path a design references (layers + sound), mutable.
fn media_refs(d: &mut AlertDesign) -> Vec<&mut String> {
    let mut v: Vec<&mut String> = d.layers.iter_mut().filter(|l| l.kind == "image" || l.kind == "video").map(|l| &mut l.src).collect();
    v.push(&mut d.sound);
    v
}

/// Write `designs` and their local files to a `.vxalert` zip at `out`.
pub fn export(mut designs: Vec<AlertDesign>, out: &Path) -> anyhow::Result<usize> {
    let file = std::fs::File::create(out).map_err(|e| anyhow::anyhow!("No se pudo crear {}: {e}", out.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut written: Vec<(String, String)> = vec![]; // (source path, name in zip)
    let mut n = 0usize;
    for d in designs.iter_mut() {
        for r in media_refs(d) {
            if !is_local(r) || !Path::new(r.as_str()).is_file() {
                continue;
            }
            let name = match written.iter().find(|(src, _)| src == r) {
                Some((_, name)) => name.clone(),
                None => {
                    n += 1;
                    let base = Path::new(r.as_str()).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| "archivo".into());
                    let name = format!("media/{n}_{base}");
                    zip.start_file(&name, opts)?;
                    let mut buf = vec![];
                    std::fs::File::open(r.as_str())?.read_to_end(&mut buf)?;
                    zip.write_all(&buf)?;
                    written.push((r.clone(), name.clone()));
                    name
                }
            };
            *r = name;
        }
    }
    zip.start_file(MANIFEST, opts)?;
    zip.write_all(serde_json::to_string_pretty(&json!({ "app": "vexcast", "version": 1, "designs": designs }))?.as_bytes())?;
    zip.finish()?;
    Ok(designs.len())
}

/// Read a `.vxalert` (or a plain `.json`) and return its designs with new ids,
/// media extracted to `media_dir/<pack id>/`.
pub fn import(path: &Path, media_dir: &Path) -> anyhow::Result<Vec<AlertDesign>> {
    let bytes = std::fs::read(path).map_err(|e| anyhow::anyhow!("No se pudo leer {}: {e}", path.display()))?;
    let (manifest, mut zip) = if bytes.starts_with(b"PK") {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| anyhow::anyhow!("El archivo no es un paquete de alertas válido"))?;
        let mut s = String::new();
        zip.by_name(MANIFEST).map_err(|_| anyhow::anyhow!("Al paquete le falta {MANIFEST}"))?.read_to_string(&mut s)?;
        (serde_json::from_str::<Value>(&s)?, Some(zip))
    } else {
        (serde_json::from_slice::<Value>(&bytes).map_err(|_| anyhow::anyhow!("El archivo no es un paquete de alertas válido"))?, None)
    };
    // {designs: [...]}, [...] or a single design.
    let list = if manifest["designs"].is_array() {
        manifest["designs"].clone()
    } else if manifest.is_array() {
        manifest
    } else {
        json!([manifest])
    };
    let mut designs: Vec<AlertDesign> = serde_json::from_value(list).map_err(|e| anyhow::anyhow!("Alertas no válidas: {e}"))?;
    let dest: PathBuf = media_dir.join(format!("pack-{}", &new_id()[..8]));
    for d in designs.iter_mut() {
        d.id = new_id();
        for l in d.layers.iter_mut() {
            l.id = new_id();
        }
        if let Some(zip) = zip.as_mut() {
            for r in media_refs(d) {
                if !r.starts_with("media/") {
                    continue;
                }
                let Ok(mut entry) = zip.by_name(r.as_str()) else { continue };
                // Only the file name: never trust paths inside the archive.
                let name = Path::new(r.as_str()).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| "archivo".into());
                std::fs::create_dir_all(&dest)?;
                let target = dest.join(&name);
                if !target.exists() {
                    let mut f = std::fs::File::create(&target)?;
                    std::io::copy(&mut entry, &mut f)?;
                }
                *r = target.to_string_lossy().replace('\\', "/");
            }
        }
    }
    Ok(designs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::AlertLayer;

    #[test]
    fn export_import_roundtrip_with_media() {
        let base = std::env::temp_dir().join(format!("vexcast-alertpack-{}", new_id()));
        std::fs::create_dir_all(&base).unwrap();
        let img = base.join("logo.png");
        std::fs::write(&img, b"png-bytes").unwrap();
        let d = AlertDesign {
            name: "Mi alerta".into(),
            layers: vec![AlertLayer { kind: "image".into(), src: img.to_string_lossy().into(), ..Default::default() }, AlertLayer { kind: "text".into(), text: "{user}".into(), ..Default::default() }],
            ..Default::default()
        };
        let old_id = d.id.clone();
        let out = base.join("pack.vxalert");
        assert_eq!(export(vec![d], &out).unwrap(), 1);
        let got = import(&out, &base.join("media")).unwrap();
        assert_eq!(got.len(), 1);
        assert_ne!(got[0].id, old_id, "imported designs get new ids");
        assert_eq!(got[0].name, "Mi alerta");
        let src = &got[0].layers[0].src;
        assert!(src.ends_with("logo.png"), "{src}");
        assert_eq!(std::fs::read(src).unwrap(), b"png-bytes");
        let _ = std::fs::remove_dir_all(&base);
    }
}
