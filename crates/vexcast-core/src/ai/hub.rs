//! AI hub: one-click install of the local AI engines (llama.cpp for text, whisper.cpp for
//! captions, Piper for voices) and of models from Hugging Face, plus the local servers Vexcast
//! starts on demand for them. Nothing has to be installed by hand.

use crate::core::Core;
use crate::util::tokio_command;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Weak};
use std::time::Duration;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Runtime {
    Llama,
    Whisper,
    Piper,
}

impl Runtime {
    pub const ALL: [Runtime; 3] = [Runtime::Llama, Runtime::Whisper, Runtime::Piper];
    fn id(self) -> &'static str {
        match self {
            Runtime::Llama => "llama",
            Runtime::Whisper => "whisper",
            Runtime::Piper => "piper",
        }
    }
    fn repo(self) -> &'static str {
        match self {
            Runtime::Llama => "ggml-org/llama.cpp",
            Runtime::Whisper => "ggml-org/whisper.cpp",
            Runtime::Piper => "rhasspy/piper",
        }
    }
    fn exe(self) -> &'static str {
        match self {
            Runtime::Llama => "llama-server",
            Runtime::Whisper => "whisper-server",
            Runtime::Piper => "piper",
        }
    }
    fn label(self) -> &'static str {
        match self {
            Runtime::Llama => "llama.cpp",
            Runtime::Whisper => "whisper.cpp",
            Runtime::Piper => "Piper",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelKind {
    Llm,
    Whisper,
    Piper,
}

impl ModelKind {
    fn dir(self) -> &'static str {
        match self {
            ModelKind::Llm => "llm",
            ModelKind::Whisper => "whisper",
            ModelKind::Piper => "piper",
        }
    }
    fn accepts(self, file: &str) -> bool {
        let f = file.to_lowercase();
        match self {
            ModelKind::Llm => f.ends_with(".gguf"),
            ModelKind::Whisper => f.ends_with(".bin"),
            ModelKind::Piper => f.ends_with(".onnx"),
        }
    }
}

/// Why an engine can't run on this computer (None = supported).
pub fn unsupported(rt: Runtime) -> Option<&'static str> {
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    match rt {
        Runtime::Llama => match (os, arch) {
            ("windows", "x86_64") | ("macos", _) | ("linux", "x86_64") => None,
            _ => Some("llama.cpp no publica un programa listo para este sistema. Usa Claude, Ollama o un servidor compatible con OpenAI."),
        },
        Runtime::Whisper => match (os, arch) {
            ("windows", "x86_64") | ("linux", "x86_64") => None,
            _ => Some("whisper.cpp no publica un programa listo para este sistema (en Mac solo hay una librería para apps). Usa un servidor compatible con OpenAI (speaches, faster-whisper-server) o la API de OpenAI."),
        },
        Runtime::Piper => match (os, arch) {
            ("windows", "x86_64") | ("macos", _) | ("linux", "x86_64") | ("linux", "aarch64") => None,
            _ => Some("Piper no publica un programa listo para este sistema. Usa las voces del sistema."),
        },
    }
}

/// A download or install in progress (or finished).
pub struct Job {
    pub id: String,
    pub label: String,
    pub kind: &'static str,
    pub target: String,
    received: AtomicU64,
    total: AtomicU64,
    state: Mutex<&'static str>,
    error: Mutex<Option<String>>,
    cancel: AtomicBool,
}

impl Job {
    fn view(&self) -> Value {
        json!({
            "id": self.id, "label": self.label, "kind": self.kind, "target": self.target,
            "received": self.received.load(Ordering::Relaxed), "total": self.total.load(Ordering::Relaxed),
            "state": *self.state.lock(), "error": *self.error.lock(),
        })
    }
}

struct Server {
    child: tokio::process::Child,
    port: u16,
    model: PathBuf,
}

pub struct Hub {
    core: Weak<Core>,
    dir: PathBuf,
    jobs: Mutex<Vec<Arc<Job>>>,
    llm: tokio::sync::Mutex<Option<Server>>,
    stt: tokio::sync::Mutex<Option<Server>>,
    /// What's running, readable without awaiting: (kind, model file name).
    running: Mutex<Vec<(&'static str, String)>>,
    voices: Mutex<Option<Value>>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct Installed {
    version: String,
    backend: String,
    exe: PathBuf,
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).unwrap_or(0)
}

/// GPU builds of llama.cpp that work on most PCs: Vulkan (NVIDIA, AMD, Intel) or Metal (Mac).
fn default_backend(rt: Runtime) -> &'static str {
    match (rt, std::env::consts::OS) {
        (Runtime::Llama, "macos") => "metal",
        (Runtime::Llama, _) => "vulkan",
        _ => "cpu",
    }
}

fn has_nvidia() -> bool {
    let exe = if cfg!(windows) { "nvidia-smi.exe" } else { "nvidia-smi" };
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).any(|d| d.join(exe).is_file())).unwrap_or(false)
        || (cfg!(windows) && Path::new("C:\\Windows\\System32\\nvidia-smi.exe").is_file())
}

/// Release assets to download for `rt` with `backend` on this computer: (name, url, size).
fn pick_assets(rt: Runtime, backend: &str, assets: &[(String, String, u64)]) -> anyhow::Result<Vec<(String, String, u64)>> {
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    let find = |f: &dyn Fn(&str) -> bool| assets.iter().find(|(n, _, _)| f(n)).cloned();
    let archive = |n: &str| n.ends_with(".zip") || n.ends_with(".tar.gz");
    let one = |a: Option<(String, String, u64)>| a.map(|a| vec![a]).ok_or_else(|| anyhow::anyhow!("La última versión no trae un paquete para este sistema ({os} {arch}, {backend})"));
    match rt {
        Runtime::Llama => match os {
            "windows" => match backend {
                "cuda" => {
                    // Prefer CUDA 12 (works with older drivers), then any.
                    let main = find(&|n| n.starts_with("llama-") && n.contains("-bin-win-cuda-12") && n.ends_with("-x64.zip")).or_else(|| find(&|n| n.starts_with("llama-") && n.contains("-bin-win-cuda-") && n.ends_with("-x64.zip")));
                    let main = main.ok_or_else(|| anyhow::anyhow!("La última versión no trae paquete CUDA para Windows"))?;
                    let ver = main.0.split("-bin-win-cuda-").nth(1).and_then(|r| r.strip_suffix("-x64.zip")).unwrap_or("").to_string();
                    let mut out = vec![main];
                    if let Some(rt) = find(&|n| n.starts_with("cudart-") && n.contains(&format!("cuda-{ver}")) && n.ends_with(".zip")) {
                        out.push(rt);
                    }
                    Ok(out)
                }
                "cpu" => one(find(&|n| n.ends_with("-bin-win-cpu-x64.zip"))),
                _ => one(find(&|n| n.ends_with("-bin-win-vulkan-x64.zip"))),
            },
            "macos" => one(find(&|n| n.contains(if arch == "aarch64" { "-bin-macos-arm64" } else { "-bin-macos-x64" }) && archive(n))),
            _ => match backend {
                "cpu" => one(find(&|n| n.contains("-bin-ubuntu-x64") && archive(n))),
                _ => one(find(&|n| n.contains("-bin-ubuntu-vulkan-x64") && archive(n))),
            },
        },
        Runtime::Whisper => match (os, backend) {
            ("linux", _) => one(find(&|n| n == "whisper-bin-ubuntu-x64.tar.gz")),
            (_, "cuda") => one(
                find(&|n| (n.starts_with("whisper-bin-win-cuda-12") && n.ends_with("-x64.zip")) || (n.starts_with("whisper-cublas-12") && n.ends_with("-bin-x64.zip")))
                    .or_else(|| find(&|n| (n.starts_with("whisper-bin-win-cuda-") || n.starts_with("whisper-cublas-")) && n.ends_with("x64.zip"))),
            ),
            _ => one(find(&|n| n == "whisper-bin-x64.zip" || n == "whisper-bin-win-cpu-x64.zip")),
        },
        Runtime::Piper => one(find(&|n| match (os, arch) {
            ("windows", _) => n == "piper_windows_amd64.zip",
            ("macos", "aarch64") => n == "piper_macos_aarch64.tar.gz",
            ("macos", _) => n == "piper_macos_x64.tar.gz",
            ("linux", "aarch64") => n == "piper_linux_aarch64.tar.gz",
            _ => n == "piper_linux_x86_64.tar.gz",
        })),
    }
}

/// Models split in parts ("…-00001-of-00003.gguf") can't be used one part at a time.
fn is_split_part(name: &str) -> bool {
    let stem = name.trim_end_matches(".gguf");
    let parts: Vec<&str> = stem.rsplitn(4, '-').collect();
    parts.len() == 4 && parts[1] == "of" && parts[0].len() == 5 && parts[2].len() == 5 && parts[0].bytes().all(|b| b.is_ascii_digit()) && parts[2].bytes().all(|b| b.is_ascii_digit())
}

/// Download URL of a file in a Hugging Face repo (path segments escaped).
fn hf_url(repo: &str, file: &str) -> String {
    let mut u = url::Url::parse("https://huggingface.co/").expect("static url");
    if let Ok(mut seg) = u.path_segments_mut() {
        seg.pop_if_empty().extend(repo.split('/')).extend(["resolve", "main"]).extend(file.split('/'));
    }
    u.to_string()
}

/// Voices re-published for Piper 1.5 list multi-character phonemes ("aɪ") that the last Piper
/// program with ready-made builds (2023.11.14) rejects. That program never produces them, so
/// they are dropped from the voice's .onnx.json. Returns whether the file changed.
pub fn fix_piper_config(path: &Path) -> anyhow::Result<bool> {
    let mut v: Value = serde_json::from_slice(&std::fs::read(path)?)?;
    let Some(map) = v["phoneme_id_map"].as_object_mut() else { return Ok(false) };
    let before = map.len();
    map.retain(|k, _| k.chars().count() == 1);
    if map.len() == before {
        return Ok(false);
    }
    std::fs::write(path, serde_json::to_vec(&v)?)?;
    Ok(true)
}

/// Extract a .zip or .tar.gz into `dest`.
fn extract(archive: &Path, dest: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(dest)?;
    let name = archive.to_string_lossy().to_lowercase();
    if name.ends_with(".tar.gz") {
        let gz = flate2::read::GzDecoder::new(std::fs::File::open(archive)?);
        tar::Archive::new(gz).unpack(dest)?;
        return Ok(());
    }
    let mut zip = zip::ZipArchive::new(std::fs::File::open(archive)?)?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i)?;
        let Some(rel) = f.enclosed_name() else { continue };
        let out = dest.join(rel);
        if f.is_dir() {
            std::fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p)?;
        }
        let mut w = std::fs::File::create(&out)?;
        std::io::copy(&mut f, &mut w)?;
        #[cfg(unix)]
        if let Some(mode) = f.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode));
        }
    }
    Ok(())
}

/// Find an executable by stem anywhere under `dir`.
fn find_exe(dir: &Path, stem: &str) -> Option<PathBuf> {
    let want = if cfg!(windows) { format!("{stem}.exe") } else { stem.to_string() };
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).ok()?.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(&want)) {
                return Some(p);
            }
        }
    }
    None
}

impl Hub {
    pub fn new(core: Weak<Core>, dir: PathBuf) -> Arc<Self> {
        Arc::new(Self { core, dir, jobs: Mutex::new(vec![]), llm: tokio::sync::Mutex::new(None), stt: tokio::sync::Mutex::new(None), running: Mutex::new(vec![]), voices: Mutex::new(None) })
    }

    fn bin_dir(&self, rt: Runtime) -> PathBuf {
        self.dir.join("bin").join(rt.id())
    }
    pub fn models_dir(&self, kind: ModelKind) -> PathBuf {
        self.dir.join("models").join(kind.dir())
    }

    fn installed(&self, rt: Runtime) -> Option<Installed> {
        let v: Installed = serde_json::from_slice(&std::fs::read(self.bin_dir(rt).join("vexcast-runtime.json")).ok()?).ok()?;
        v.exe.is_file().then_some(v)
    }

    /// Path of an installed engine's program.
    pub fn exe(&self, rt: Runtime) -> Option<PathBuf> {
        self.installed(rt).map(|i| i.exe)
    }

    pub fn models(&self, kind: ModelKind) -> Vec<Value> {
        let mut out: Vec<Value> = std::fs::read_dir(self.models_dir(kind))
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| {
                let p = e.path();
                let name = p.file_name()?.to_string_lossy().to_string();
                (kind.accepts(&name) && p.is_file()).then(|| json!({ "file": name, "path": p.to_string_lossy(), "size": e.metadata().map(|m| m.len()).unwrap_or(0) }))
            })
            .collect();
        out.sort_by(|a, b| a["file"].as_str().cmp(&b["file"].as_str()));
        out
    }

    /// Full path of a downloaded model by file name.
    pub fn model_path(&self, kind: ModelKind, file: &str) -> Option<PathBuf> {
        let p = if Path::new(file).is_absolute() { PathBuf::from(file) } else { self.models_dir(kind).join(file) };
        p.is_file().then_some(p)
    }

    pub fn status(&self) -> Value {
        // Drop finished jobs older than the list's last 20.
        let jobs: Vec<Value> = {
            let mut j = self.jobs.lock();
            let len = j.len();
            if len > 20 {
                j.drain(..len - 20);
            }
            j.iter().map(|x| x.view()).collect()
        };
        let runtimes: Vec<Value> = Runtime::ALL
            .iter()
            .map(|rt| {
                let i = self.installed(*rt);
                json!({
                    "id": rt.id(), "name": rt.label(),
                    "installed": i.is_some(),
                    "version": i.as_ref().map(|i| i.version.clone()),
                    "backend": i.as_ref().map(|i| i.backend.clone()),
                    "defaultBackend": default_backend(*rt),
                    "unsupported": unsupported(*rt),
                })
            })
            .collect();
        let running = self.running.lock().clone();
        let run = |k: &str| running.iter().find(|(x, _)| *x == k).map(|(_, m)| m.clone());
        json!({
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "nvidia": has_nvidia(),
            "runtimes": runtimes,
            "models": { "llm": self.models(ModelKind::Llm), "whisper": self.models(ModelKind::Whisper), "piper": self.models(ModelKind::Piper) },
            "jobs": jobs,
            "running": { "llm": run("llm"), "stt": run("stt") },
            "dir": self.dir.to_string_lossy(),
        })
    }

    fn new_job(&self, kind: &'static str, label: String, target: String) -> anyhow::Result<Arc<Job>> {
        let mut jobs = self.jobs.lock();
        if jobs.iter().any(|j| j.target == target && *j.state.lock() == "running") {
            anyhow::bail!("Ya se está descargando");
        }
        let job = Arc::new(Job {
            id: crate::model::new_id(),
            label,
            kind,
            target,
            received: AtomicU64::new(0),
            total: AtomicU64::new(0),
            state: Mutex::new("running"),
            error: Mutex::new(None),
            cancel: AtomicBool::new(false),
        });
        jobs.push(job.clone());
        Ok(job)
    }

    pub fn cancel(&self, id: &str) {
        if let Some(j) = self.jobs.lock().iter().find(|j| j.id == id) {
            j.cancel.store(true, Ordering::Release);
        }
    }

    /// Stream `url` into `dest` (via a .part file), counting into the job.
    async fn download(&self, core: &Core, job: &Job, url: &str, dest: &Path) -> anyhow::Result<()> {
        let mut r = core
            .http
            .get(url)
            .timeout(Duration::from_secs(6 * 3600))
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("No se pudo descargar ({e})"))?;
        if !r.status().is_success() {
            anyhow::bail!("El servidor respondió {} al descargar", r.status());
        }
        if let Some(p) = dest.parent() {
            tokio::fs::create_dir_all(p).await?;
        }
        let part = dest.with_extension(format!("{}.part", dest.extension().and_then(|e| e.to_str()).unwrap_or("")));
        let mut f = tokio::fs::File::create(&part).await?;
        let res: anyhow::Result<()> = async {
            while let Some(chunk) = r.chunk().await.map_err(|e| anyhow::anyhow!("Se cortó la descarga ({e})"))? {
                if job.cancel.load(Ordering::Acquire) {
                    anyhow::bail!("cancelled");
                }
                f.write_all(&chunk).await?;
                job.received.fetch_add(chunk.len() as u64, Ordering::Relaxed);
            }
            f.flush().await?;
            Ok(())
        }
        .await;
        drop(f);
        if let Err(e) = res {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(e);
        }
        tokio::fs::rename(&part, dest).await?;
        Ok(())
    }

    fn finish(&self, job: &Job, res: anyhow::Result<()>) {
        match res {
            Ok(()) => *job.state.lock() = "done",
            Err(e) if e.to_string() == "cancelled" => *job.state.lock() = "cancelled",
            Err(e) => {
                *job.error.lock() = Some(e.to_string());
                *job.state.lock() = "error";
            }
        }
    }

    /// Install (or update) an engine from its official GitHub release. Returns the job id.
    pub fn install(self: &Arc<Self>, rt: Runtime, backend: Option<String>) -> anyhow::Result<String> {
        if let Some(why) = unsupported(rt) {
            anyhow::bail!("{why}");
        }
        let backend = backend.filter(|b| !b.is_empty() && b != "auto").unwrap_or_else(|| default_backend(rt).to_string());
        let job = self.new_job("runtime", format!("{} ({backend})", rt.label()), format!("runtime:{}", rt.id()))?;
        let id = job.id.clone();
        let me = self.clone();
        tokio::spawn(async move {
            let res = me.install_inner(rt, &backend, &job).await;
            if res.is_err() {
                // Leave nothing half-downloaded behind.
                let _ = tokio::fs::remove_dir_all(me.dir.join("bin").join(format!("{}.new", rt.id()))).await;
                let _ = tokio::fs::remove_dir_all(me.dir.join("tmp")).await;
            }
            me.finish(&job, res);
        });
        Ok(id)
    }

    async fn install_inner(&self, rt: Runtime, backend: &str, job: &Job) -> anyhow::Result<()> {
        let core = self.core.upgrade().ok_or_else(|| anyhow::anyhow!("core stopped"))?;
        // Builds are published as numbered (pre)releases and the "latest" one can come without
        // files: take the newest release that has a package for this computer.
        let r = core
            .http
            .get(format!("https://api.github.com/repos/{}/releases", rt.repo()))
            .query(&[("per_page", "20")])
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("No se pudo consultar GitHub ({e})"))?;
        if r.status().as_u16() == 403 || r.status().as_u16() == 429 {
            anyhow::bail!("GitHub limita las consultas por hora; inténtalo en unos minutos");
        }
        let releases: Value = r.json().await?;
        let mut found: Option<(String, Vec<(String, String, u64)>)> = None;
        let mut last_err = None;
        for rel in releases.as_array().into_iter().flatten() {
            let assets: Vec<(String, String, u64)> = rel["assets"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|a| Some((a["name"].as_str()?.to_string(), a["browser_download_url"].as_str()?.to_string(), a["size"].as_u64().unwrap_or(0))))
                .collect();
            if assets.is_empty() {
                continue;
            }
            match pick_assets(rt, backend, &assets) {
                Ok(p) => {
                    found = Some((rel["tag_name"].as_str().unwrap_or("?").to_string(), p));
                    break;
                }
                Err(e) => last_err = Some(e),
            }
        }
        let (version, picked) = match (found, last_err) {
            (Some(f), _) => f,
            (None, Some(e)) => return Err(e),
            (None, None) => anyhow::bail!("GitHub no devolvió versiones de {}", rt.label()),
        };
        job.total.store(picked.iter().map(|a| a.2).sum(), Ordering::Relaxed);
        let tmp = self.dir.join("tmp");
        let staging = self.dir.join("bin").join(format!("{}.new", rt.id()));
        let _ = tokio::fs::remove_dir_all(&staging).await;
        for (name, url, _) in &picked {
            let file = tmp.join(name);
            self.download(&core, job, url, &file).await?;
            let (f, s) = (file.clone(), staging.clone());
            tokio::task::spawn_blocking(move || extract(&f, &s)).await??;
            let _ = tokio::fs::remove_file(&file).await;
        }
        let exe = find_exe(&staging, rt.exe()).ok_or_else(|| anyhow::anyhow!("El paquete descargado no trae {}", rt.exe()))?;
        // The running server holds the old program open (Windows locks it).
        self.stop_runtime(rt).await;
        let dest = self.bin_dir(rt);
        let _ = tokio::fs::remove_dir_all(&dest).await;
        tokio::fs::rename(&staging, &dest).await?;
        let exe = dest.join(exe.strip_prefix(&staging).unwrap_or(&exe));
        let info = Installed { version, backend: backend.to_string(), exe };
        tokio::fs::write(dest.join("vexcast-runtime.json"), serde_json::to_vec_pretty(&info)?).await?;
        core.notify("success", format!("{} instalado", rt.label()));
        Ok(())
    }

    pub async fn uninstall(&self, rt: Runtime) -> anyhow::Result<()> {
        self.stop_runtime(rt).await;
        let _ = tokio::fs::remove_dir_all(self.bin_dir(rt)).await;
        Ok(())
    }

    async fn stop_runtime(&self, rt: Runtime) {
        match rt {
            Runtime::Llama => self.stop_server("llm").await,
            Runtime::Whisper => self.stop_server("stt").await,
            Runtime::Piper => {}
        }
    }

    /// Download a model file from a Hugging Face repo. Returns the job id.
    pub fn download_model(self: &Arc<Self>, kind: ModelKind, repo: &str, file: &str) -> anyhow::Result<String> {
        let repo = repo.trim().trim_matches('/').to_string();
        let file = file.trim().trim_start_matches('/').to_string();
        if repo.split('/').count() != 2 || file.contains("..") || !kind.accepts(&file) {
            anyhow::bail!("Archivo de modelo no válido");
        }
        let name = file.rsplit('/').next().unwrap_or(&file).to_string();
        let job = self.new_job("model", name.clone(), format!("model:{}:{name}", kind.dir()))?;
        let id = job.id.clone();
        let me = self.clone();
        tokio::spawn(async move {
            let res: anyhow::Result<()> = async {
                let core = me.core.upgrade().ok_or_else(|| anyhow::anyhow!("core stopped"))?;
                let url = |f: &str| hf_url(&repo, f);
                // Size first, so the progress bar is right.
                if let Ok(r) = core.http.head(url(&file)).send().await {
                    let len = r.headers().get("x-linked-size").or(r.headers().get("content-length")).and_then(|v| v.to_str().ok()?.parse::<u64>().ok());
                    job.total.store(len.unwrap_or(0), Ordering::Relaxed);
                }
                let dest = me.models_dir(kind).join(&name);
                me.download(&core, &job, &url(&file), &dest).await?;
                // Piper voices need their .onnx.json next to them.
                if kind == ModelKind::Piper {
                    let cfg = me.models_dir(kind).join(format!("{name}.json"));
                    me.download(&core, &job, &url(&format!("{file}.json")), &cfg).await?;
                    let _ = fix_piper_config(&cfg);
                }
                core.notify("success", format!("{name} descargado"));
                Ok(())
            }
            .await;
            me.finish(&job, res);
        });
        Ok(id)
    }

    pub async fn delete_model(&self, kind: ModelKind, file: &str) -> anyhow::Result<()> {
        let name = Path::new(file).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let path = self.models_dir(kind).join(&name);
        if !path.is_file() {
            anyhow::bail!("No existe");
        }
        // A server using it keeps the file open.
        let key = if kind == ModelKind::Llm { "llm" } else { "stt" };
        if self.running.lock().iter().any(|(k, m)| *k == key && *m == name) {
            self.stop_server(key).await;
        }
        tokio::fs::remove_file(&path).await?;
        if kind == ModelKind::Piper {
            let _ = tokio::fs::remove_file(self.models_dir(kind).join(format!("{name}.json"))).await;
        }
        Ok(())
    }

    // -------------------------------------------------------------- servers

    async fn stop_server(&self, key: &'static str) {
        let slot = if key == "llm" { &self.llm } else { &self.stt };
        if let Some(mut s) = slot.lock().await.take() {
            let _ = s.child.kill().await;
        }
        self.running.lock().retain(|(k, _)| *k != key);
    }

    pub async fn stop_all(&self) {
        self.stop_server("llm").await;
        self.stop_server("stt").await;
    }

    /// Kill the servers without awaiting (app exit).
    pub fn kill_all(&self) {
        for slot in [&self.llm, &self.stt] {
            if let Ok(mut g) = slot.try_lock() {
                if let Some(s) = g.as_mut() {
                    let _ = s.child.start_kill();
                }
            }
        }
    }

    /// Port of the local llama.cpp server with `model` loaded, starting it if needed.
    pub async fn llm_port(&self, model: &Path, context: u32, gpu: bool) -> anyhow::Result<u16> {
        let exe = self.exe(Runtime::Llama).ok_or_else(|| anyhow::anyhow!("Instala el motor de texto local (llama.cpp) en IA › Centro de IA"))?;
        let ngl = if gpu && self.installed(Runtime::Llama).is_some_and(|i| i.backend != "cpu") { "99" } else { "0" };
        let args = vec!["-m".into(), model.to_string_lossy().to_string(), "-c".into(), context.max(512).to_string(), "-ngl".into(), ngl.into()];
        self.ensure_server("llm", &self.llm, exe, model, args, "/health", Duration::from_secs(240)).await
    }

    /// Port of the local whisper.cpp server with `model`, starting it if needed. Transcriptions
    /// are served at its own path, /inference (it takes the same form fields as OpenAI's).
    pub async fn stt_port(&self, model: &Path) -> anyhow::Result<u16> {
        let exe = self.exe(Runtime::Whisper).ok_or_else(|| anyhow::anyhow!("Instala el motor de subtítulos local (whisper.cpp) en IA › Centro de IA"))?;
        let threads = std::thread::available_parallelism().map(|n| (n.get() / 2).max(2)).unwrap_or(4);
        let args = vec!["-m".into(), model.to_string_lossy().to_string(), "-t".into(), threads.to_string()];
        self.ensure_server("stt", &self.stt, exe, model, args, "/", Duration::from_secs(120)).await
    }

    #[allow(clippy::too_many_arguments)]
    async fn ensure_server(&self, key: &'static str, slot: &tokio::sync::Mutex<Option<Server>>, exe: PathBuf, model: &Path, mut args: Vec<String>, health: &str, wait: Duration) -> anyhow::Result<u16> {
        let core = self.core.upgrade().ok_or_else(|| anyhow::anyhow!("core stopped"))?;
        let mut g = slot.lock().await;
        if let Some(s) = g.as_mut() {
            if s.model == model && matches!(s.child.try_wait(), Ok(None)) {
                return Ok(s.port);
            }
            let _ = s.child.kill().await;
            *g = None;
        }
        self.running.lock().retain(|(k, _)| *k != key);
        let port = free_port();
        args.extend(["--host".into(), "127.0.0.1".into(), "--port".into(), port.to_string()]);
        let logs = self.dir.join("logs");
        let _ = std::fs::create_dir_all(&logs);
        let log_path = logs.join(format!("{key}.log"));
        let log = std::fs::File::create(&log_path)?;
        let mut cmd = tokio_command(&exe);
        cmd.args(&args).current_dir(exe.parent().unwrap_or(Path::new("."))).stdin(Stdio::null()).stdout(Stdio::from(log.try_clone()?)).stderr(Stdio::from(log));
        let mut child = cmd.spawn().map_err(|e| anyhow::anyhow!("No se pudo iniciar {} ({e})", exe.display()))?;
        let url = format!("http://127.0.0.1:{port}{health}");
        let deadline = std::time::Instant::now() + wait;
        loop {
            if let Ok(Some(status)) = child.try_wait() {
                let tail = std::fs::read_to_string(&log_path).unwrap_or_default();
                let last: Vec<&str> = tail.lines().rev().filter(|l| !l.trim().is_empty()).take(3).collect();
                anyhow::bail!("El motor local se cerró ({status}): {}", last.into_iter().rev().collect::<Vec<_>>().join(" · "));
            }
            if let Ok(r) = core.http.get(&url).timeout(Duration::from_secs(2)).send().await {
                if r.status().is_success() {
                    break;
                }
            }
            if std::time::Instant::now() > deadline {
                let _ = child.kill().await;
                anyhow::bail!("El motor local tardó demasiado en cargar el modelo");
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
        }
        let name = model.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        self.running.lock().push((key, name));
        *g = Some(Server { child, port, model: model.to_path_buf() });
        Ok(port)
    }

    // -------------------------------------------------------------- Hugging Face

    /// Search GGUF models on Hugging Face (most downloaded first).
    pub async fn search(&self, q: &str) -> anyhow::Result<Value> {
        let core = self.core.upgrade().ok_or_else(|| anyhow::anyhow!("core stopped"))?;
        let v: Value = core
            .http
            .get("https://huggingface.co/api/models")
            .query(&[("search", q), ("filter", "gguf"), ("sort", "downloads"), ("direction", "-1"), ("limit", "30")])
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("No se pudo conectar con Hugging Face ({e})"))?
            .json()
            .await?;
        Ok(json!(v
            .as_array()
            .into_iter()
            .flatten()
            .map(|m| json!({ "repo": m["id"], "downloads": m["downloads"], "likes": m["likes"], "updated": m["lastModified"] }))
            .collect::<Vec<_>>()))
    }

    /// Files of a repo with sizes, filtered by extension (".gguf" by default; projector files left out).
    pub async fn files(&self, repo: &str, ext: &str) -> anyhow::Result<Value> {
        let core = self.core.upgrade().ok_or_else(|| anyhow::anyhow!("core stopped"))?;
        let r = core
            .http
            .get(format!("https://huggingface.co/api/models/{}/tree/main", repo.trim().trim_matches('/')))
            .query(&[("recursive", "true")])
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("No se pudo conectar con Hugging Face ({e})"))?;
        if !r.status().is_success() {
            anyhow::bail!("Hugging Face respondió {} (¿el repositorio existe y es público?)", r.status());
        }
        let v: Value = r.json().await?;
        let ext = if ext.is_empty() { ".gguf" } else { ext };
        let mut files: Vec<Value> = v
            .as_array()
            .into_iter()
            .flatten()
            .filter(|f| f["type"] == "file")
            .filter_map(|f| {
                let path = f["path"].as_str()?;
                let lower = path.to_lowercase();
                (lower.ends_with(ext) && !lower.contains("mmproj") && !is_split_part(&lower)).then(|| json!({ "path": path, "size": f["lfs"]["size"].as_u64().or(f["size"].as_u64()).unwrap_or(0) }))
            })
            .collect();
        files.sort_by_key(|f| f["size"].as_u64().unwrap_or(0));
        Ok(json!(files))
    }

    /// Piper's voice catalog (cached).
    pub async fn voices(&self) -> anyhow::Result<Value> {
        if let Some(v) = self.voices.lock().clone() {
            return Ok(v);
        }
        let core = self.core.upgrade().ok_or_else(|| anyhow::anyhow!("core stopped"))?;
        let v: Value = core
            .http
            .get("https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json")
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("No se pudo descargar el catálogo de voces ({e})"))?
            .json()
            .await?;
        let mut list: Vec<Value> = v
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(key, x)| {
                let (path, info) = x["files"].as_object()?.iter().find(|(p, _)| p.ends_with(".onnx"))?;
                Some(json!({
                    "key": key, "name": x["name"], "quality": x["quality"], "speakers": x["num_speakers"],
                    "language": x["language"]["code"], "languageName": x["language"]["name_native"], "country": x["language"]["country_english"],
                    "file": path, "size": info["size_bytes"],
                }))
            })
            .collect();
        list.sort_by(|a, b| a["key"].as_str().cmp(&b["key"].as_str()));
        let out = json!(list);
        *self.voices.lock() = Some(out.clone());
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_llama_assets() {
        let a = |n: &str| (n.to_string(), format!("https://x/{n}"), 10);
        let assets = vec![
            // Release order: the runtime packages come first and also contain "-bin-win-cuda-".
            a("cudart-llama-bin-win-cuda-12.4-x64.zip"),
            a("cudart-llama-bin-win-cuda-13.1-x64.zip"),
            a("llama-b7000-bin-win-cpu-x64.zip"),
            a("llama-b7000-bin-win-vulkan-x64.zip"),
            a("llama-b7000-bin-win-cuda-12.4-x64.zip"),
            a("llama-b7000-bin-win-cuda-13.1-x64.zip"),
        ];
        if cfg!(windows) {
            let v = pick_assets(Runtime::Llama, "vulkan", &assets).unwrap();
            assert_eq!(v[0].0, "llama-b7000-bin-win-vulkan-x64.zip");
            let c = pick_assets(Runtime::Llama, "cuda", &assets).unwrap();
            assert_eq!(c.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), ["llama-b7000-bin-win-cuda-12.4-x64.zip", "cudart-llama-bin-win-cuda-12.4-x64.zip"]);
        }
    }

    #[test]
    fn fixes_piper_config() {
        let dir = std::env::temp_dir().join(format!("vx-piper-{}", crate::model::new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("v.onnx.json");
        std::fs::write(&f, r#"{"phoneme_id_map":{"a":[1],"aɪ":[2],"ɪ":[3]}}"#).unwrap();
        assert!(fix_piper_config(&f).unwrap());
        let v: Value = serde_json::from_slice(&std::fs::read(&f).unwrap()).unwrap();
        assert_eq!(v["phoneme_id_map"].as_object().unwrap().len(), 2);
        assert!(!fix_piper_config(&f).unwrap());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn model_kinds() {
        assert!(ModelKind::Llm.accepts("Qwen2.5-3B-Instruct-Q4_K_M.gguf"));
        assert!(!ModelKind::Llm.accepts("model.bin"));
        assert!(ModelKind::Piper.accepts("es_ES-davefx-medium.onnx"));
        assert!(is_split_part("qwen2.5-3b-instruct-fp16-00002-of-00002.gguf"));
        assert!(!is_split_part("qwen2.5-3b-instruct-q4_k_m.gguf"));
    }
}
