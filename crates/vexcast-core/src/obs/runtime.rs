//! libobs startup/shutdown, module loading, video/audio reset and the UI task handler.

use super::ffi::*;
use super::model::{AudioSettings, VideoSettings};
use libobs as sys;
use std::os::raw::c_void;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;

struct UiTask {
    task: sys::obs_task_t,
    param: usize,
    done: Option<Sender<()>>,
}

static UI_TASKS: OnceLock<std::sync::Mutex<Sender<UiTask>>> = OnceLock::new();

unsafe extern "C" fn ui_task_handler(task: sys::obs_task_t, param: *mut c_void, wait: bool) {
    let Some(tx) = UI_TASKS.get() else {
        if let Some(t) = task {
            t(param);
        }
        return;
    };
    let (done_tx, done_rx) = channel();
    let job = UiTask { task, param: param as usize, done: if wait { Some(done_tx) } else { None } };
    if tx.lock().map(|t| t.send(job).is_ok()).unwrap_or(false) && wait {
        let _ = done_rx.recv();
    }
}

fn start_ui_thread() {
    let (tx, rx) = channel::<UiTask>();
    if UI_TASKS.set(std::sync::Mutex::new(tx)).is_err() {
        return;
    }
    std::thread::Builder::new()
        .name("obs-ui-tasks".into())
        .spawn(move || {
            while let Ok(job) = rx.recv() {
                if let Some(t) = job.task {
                    unsafe { t(job.param as *mut c_void) };
                }
                if let Some(d) = job.done {
                    let _ = d.send(());
                }
            }
        })
        .ok();
}

/// Directory that holds obs.dll / libobs and the plugins: $VEXCAST_OBS_DIR, the executable's
/// folder, or the nearest parent folder that contains the runtime (dev/test builds).
pub fn runtime_dir() -> PathBuf {
    if let Ok(p) = std::env::var("VEXCAST_OBS_DIR") {
        return PathBuf::from(p);
    }
    let exe_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)).unwrap_or_else(|| PathBuf::from("."));
    let mut dir = Some(exe_dir.as_path());
    for _ in 0..6 {
        let Some(d) = dir else { break };
        if d.join("obs-plugins").is_dir() && d.join("data").join("libobs").is_dir() {
            return d.to_path_buf();
        }
        dir = d.parent();
    }
    exe_dir
}

fn slash(p: &Path) -> String {
    let mut s = p.to_string_lossy().replace('\\', "/");
    if !s.ends_with('/') {
        s.push('/');
    }
    s
}

pub fn locale_for(lang: &str) -> &'static str {
    match lang {
        "es" => "es-ES",
        _ => "en-US",
    }
}

// va_list is a plain pointer on Windows and Apple targets, a struct array on Linux x86_64.
#[cfg(any(windows, target_os = "macos"))]
type VaList = sys::va_list;
#[cfg(not(any(windows, target_os = "macos")))]
type VaList = *mut sys::__va_list_tag;

/// libobs' own log handler (we filter in front of it).
static DEFAULT_LOG: std::sync::OnceLock<(sys::log_handler_t, usize)> = std::sync::OnceLock::new();

/// Lines libobs/FFmpeg repeat endlessly while looping media files play; harmless.
const LOG_NOISE: &[&str] = &["Could not update timestamps for discarded samples", "TS_SMOOTHING_THRESHOLD"];

unsafe extern "C" fn log_filter(lvl: std::os::raw::c_int, msg: *const std::os::raw::c_char, args: VaList, p: *mut std::os::raw::c_void) {
    let _ = p;
    if lvl >= sys::LOG_DEBUG as std::os::raw::c_int {
        return;
    }
    if !msg.is_null() {
        let fmt = std::ffi::CStr::from_ptr(msg).to_string_lossy();
        if LOG_NOISE.iter().any(|n| fmt.contains(n)) {
            return;
        }
    }
    if let Some((Some(h), param)) = DEFAULT_LOG.get() {
        h(lvl, msg, args, *param as *mut std::os::raw::c_void);
    }
}

/// Keep libobs' log readable: no debug lines, no endless media warnings.
unsafe fn install_log_filter() {
    let mut handler: sys::log_handler_t = None;
    let mut param: *mut std::os::raw::c_void = std::ptr::null_mut();
    sys::base_get_log_handler(&mut handler, &mut param);
    if handler.is_some() && DEFAULT_LOG.set((handler, param as usize)).is_ok() {
        sys::base_set_log_handler(Some(log_filter), std::ptr::null_mut());
    }
}

/// Start libobs. Returns the OBS version.
pub unsafe fn startup(config_dir: &Path, locale: &str) -> anyhow::Result<String> {
    install_log_filter();
    start_ui_thread();
    let dir = runtime_dir();
    let _ = std::fs::create_dir_all(config_dir);
    let cfg = cstr(&slash(config_dir));
    if !sys::obs_startup(cstr(locale).as_ptr(), cfg.as_ptr(), std::ptr::null_mut()) {
        anyhow::bail!("No se pudo iniciar libobs");
    }
    sys::obs_set_ui_task_handler(Some(ui_task_handler));

    #[cfg(windows)]
    {
        sys::obs_add_data_path(cstr(&slash(&dir.join("data").join("libobs"))).as_ptr());
        sys::obs_add_module_path(
            cstr(&slash(&dir.join("obs-plugins").join("64bit"))).as_ptr(),
            cstr(&format!("{}%module%/", slash(&dir.join("data").join("obs-plugins")))).as_ptr(),
        );
    }
    #[cfg(target_os = "linux")]
    {
        // AppImage: its own OBS build (usr/lib/obs-plugins, usr/share/obs), never the system one.
        if let Some(app) = appimage_dir() {
            sys::obs_add_data_path(cstr(&slash(&app.join("usr/share/obs/libobs"))).as_ptr());
            sys::obs_add_module_path(cstr(&slash(&app.join("usr/lib/obs-plugins"))).as_ptr(), cstr(&format!("{}%module%/", slash(&app.join("usr/share/obs/obs-plugins")))).as_ptr());
        } else {
            // System or bundled OBS install (prefix/lib/obs-plugins, prefix/share/obs).
            for prefix in [dir.join(".."), PathBuf::from("/usr"), PathBuf::from("/usr/local")] {
                let data = prefix.join("share/obs/libobs");
                if data.exists() {
                    sys::obs_add_data_path(cstr(&slash(&data)).as_ptr());
                }
            }
        }
    }
    // macOS: nothing to add. libobs finds its data inside libobs.framework/Resources, and
    // obs_startup already registers <main bundle>/PlugIns/%module%.plugin — Contents/PlugIns in
    // Vexcast.app, <exe dir>/PlugIns for a bare binary. Adding it again loads every plugin twice.
    #[cfg(target_os = "macos")]
    let _ = &dir;
    Ok(string(sys::obs_get_version_string()))
}

pub fn graphics_module(renderer: &str) -> String {
    if cfg!(windows) {
        return if renderer == "opengl" { "libobs-opengl" } else { "libobs-d3d11" }.into();
    }
    if cfg!(target_os = "macos") {
        // libobs appends ".so" to names without an extension, so macOS needs the full file
        // name (as the OBS app does). Prefer the copy next to the binary (flat runtime layout);
        // inside Vexcast.app dyld finds it in Contents/Frameworks through libobs' rpath.
        let file = if renderer == "metal" { "libobs-metal.dylib" } else { "libobs-opengl.dylib" };
        let local = runtime_dir().join(file);
        return if local.is_file() { local.to_string_lossy().into_owned() } else { file.into() };
    }
    "libobs-opengl".into()
}

pub fn video_format(s: &str) -> sys::video_format {
    match s {
        "I420" => sys::video_format_VIDEO_FORMAT_I420,
        "I444" => sys::video_format_VIDEO_FORMAT_I444,
        "P010" => sys::video_format_VIDEO_FORMAT_P010,
        "I010" => sys::video_format_VIDEO_FORMAT_I010,
        "P216" => sys::video_format_VIDEO_FORMAT_P216,
        "P416" => sys::video_format_VIDEO_FORMAT_P416,
        "BGRA" => sys::video_format_VIDEO_FORMAT_BGRA,
        _ => sys::video_format_VIDEO_FORMAT_NV12,
    }
}

pub fn colorspace(s: &str) -> sys::video_colorspace {
    match s {
        "601" => sys::video_colorspace_VIDEO_CS_601,
        "sRGB" => sys::video_colorspace_VIDEO_CS_SRGB,
        "2100PQ" => sys::video_colorspace_VIDEO_CS_2100_PQ,
        "2100HLG" => sys::video_colorspace_VIDEO_CS_2100_HLG,
        _ => sys::video_colorspace_VIDEO_CS_709,
    }
}

pub fn scale_type(s: &str) -> sys::obs_scale_type {
    match s {
        "bilinear" => sys::obs_scale_type_OBS_SCALE_BILINEAR,
        "bicubic" => sys::obs_scale_type_OBS_SCALE_BICUBIC,
        "area" => sys::obs_scale_type_OBS_SCALE_AREA,
        _ => sys::obs_scale_type_OBS_SCALE_LANCZOS,
    }
}

/// obs_reset_video. Returns the libobs status code (0 = success).
pub unsafe fn reset_video(v: &VideoSettings, renderer: &str) -> i32 {
    let gm = cstr(&graphics_module(renderer));
    let mut ovi: sys::obs_video_info = std::mem::zeroed();
    ovi.graphics_module = gm.as_ptr();
    ovi.fps_num = v.fps_num.max(1);
    ovi.fps_den = v.fps_den.max(1);
    ovi.base_width = v.base_width.clamp(32, 8192) & !1;
    ovi.base_height = v.base_height.clamp(32, 8192) & !1;
    ovi.output_width = v.output_width.clamp(32, 8192) & !1;
    ovi.output_height = v.output_height.clamp(32, 8192) & !1;
    ovi.output_format = video_format(&v.color_format);
    ovi.adapter = 0;
    ovi.gpu_conversion = true;
    ovi.colorspace = colorspace(&v.color_space);
    ovi.range = if v.color_range == "full" { sys::video_range_type_VIDEO_RANGE_FULL } else { sys::video_range_type_VIDEO_RANGE_PARTIAL };
    ovi.scale_type = scale_type(&v.downscale_filter);
    let r = sys::obs_reset_video(&mut ovi);
    if r == 0 {
        sys::obs_set_video_levels(v.sdr_white_level as f32, v.hdr_nominal_peak_level as f32);
    }
    r
}

pub fn speakers(s: &str) -> sys::speaker_layout {
    match s {
        "mono" => sys::speaker_layout_SPEAKERS_MONO,
        "2.1" => sys::speaker_layout_SPEAKERS_2POINT1,
        "4.0" => sys::speaker_layout_SPEAKERS_4POINT0,
        "4.1" => sys::speaker_layout_SPEAKERS_4POINT1,
        "5.1" => sys::speaker_layout_SPEAKERS_5POINT1,
        "7.1" => sys::speaker_layout_SPEAKERS_7POINT1,
        _ => sys::speaker_layout_SPEAKERS_STEREO,
    }
}

pub unsafe fn reset_audio(a: &AudioSettings) -> bool {
    let ai = sys::obs_audio_info2 {
        samples_per_sec: if a.sample_rate == 44100 { 44100 } else { 48000 },
        speakers: speakers(&a.channels),
        max_buffering_ms: 0,
        fixed_buffering: a.low_latency_buffering,
    };
    sys::obs_reset_audio2(&ai)
}

extern "C" {
    /// util/platform.h: checks the library's exports without loading it.
    fn os_is_obs_plugin(path: *const std::os::raw::c_char) -> bool;
}

/// A module found in the module search paths.
struct FoundModule {
    name: String,
    bin: String,
    data: String,
}

unsafe extern "C" fn collect_module(param: *mut c_void, info: *const sys::obs_module_info2) {
    let out = &mut *(param as *mut Vec<FoundModule>);
    let info = &*info;
    out.push(FoundModule { name: string(info.name), bin: string(info.bin_path), data: string(info.data_path) });
}

/// The AppImage mount point when running from one (its own OBS build lives inside).
pub fn appimage_dir() -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    std::env::var_os("APPIMAGE")?;
    std::env::var_os("APPDIR").map(PathBuf::from)
}

/// Folders where third-party OBS plugins are installed: Vexcast's own one first, then the
/// shared OBS Studio one (where plugin installers put them).
pub fn plugin_folders(data_dir: &Path) -> Vec<PathBuf> {
    let mut v = vec![data_dir.join("obs-plugins")];
    if cfg!(windows) {
        if let Some(pd) = std::env::var_os("ProgramData") {
            v.push(PathBuf::from(pd).join("obs-studio").join("plugins"));
        }
    } else if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        if cfg!(target_os = "macos") {
            v.push(home.join("Library/Application Support/obs-studio/plugins"));
        } else {
            v.push(std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".config")).join("obs-studio/plugins"));
        }
    }
    v
}

/// Search patterns (binary, data) of a plugin folder, in each OS's plugin layout.
fn plugin_patterns(root: &Path) -> (String, String) {
    let r = slash(root);
    if cfg!(target_os = "macos") {
        (format!("{r}%module%.plugin/Contents/MacOS/"), format!("{r}%module%.plugin/Contents/Resources/"))
    } else {
        (format!("{r}%module%/bin/64bit/"), format!("{r}%module%/data/"))
    }
}

fn under(path: &str, root: &Path) -> bool {
    let p = path.replace('\\', "/").to_lowercase();
    let r = slash(root).to_lowercase();
    p.starts_with(&r)
}

/// What to load: third-party plugins (opt-in) minus the ones the user turned off.
pub struct PluginPolicy<'a> {
    pub third_party: bool,
    pub disabled: &'a [String],
    /// Written with the plugin's name while a third-party plugin loads, removed afterwards:
    /// if it's still there on the next start, that plugin crashed Vexcast.
    pub marker: &'a Path,
}

/// Load the bundled OBS modules and, when allowed, third-party plugins. Bundled modules win
/// over same-named copies elsewhere; inside an AppImage, a system OBS install is ignored.
pub unsafe fn load_modules(data_dir: &Path, policy: &PluginPolicy) -> Vec<super::model::ObsPlugin> {
    use super::model::ObsPlugin;
    let folders = plugin_folders(data_dir);
    let _ = std::fs::create_dir_all(&folders[0]);
    for f in &folders {
        let (bin, data) = plugin_patterns(f);
        sys::obs_add_module_path(cstr(&bin).as_ptr(), cstr(&data).as_ptr());
    }
    let mut found: Vec<FoundModule> = vec![];
    sys::obs_find_modules2(Some(collect_module), &mut found as *mut _ as *mut c_void);
    if found.is_empty() {
        // Nothing found through our search: let libobs do its own thing.
        sys::obs_load_all_modules();
        sys::obs_log_loaded_modules();
        sys::obs_post_load_modules();
        return vec![];
    }
    let appdir = appimage_dir();
    let is_third = |m: &FoundModule| folders.iter().any(|f| under(&m.bin, f));
    // Bundled first so they take precedence over duplicates.
    found.sort_by_key(|m| is_third(m));
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![];
    for m in &found {
        let third = is_third(m);
        if !third {
            if let Some(a) = &appdir {
                if !under(&m.bin, a) {
                    continue;
                }
            }
        }
        if !os_is_obs_plugin(cstr(&m.bin).as_ptr()) {
            continue;
        }
        let mut p = ObsPlugin { name: m.name.clone(), path: m.bin.clone(), third_party: third, state: "loaded".into(), error: None };
        if !seen.insert(m.name.to_lowercase()) {
            if third {
                p.state = "duplicate".into();
                out.push(p);
            }
            continue;
        }
        if third && !policy.third_party {
            p.state = "off".into();
            out.push(p);
            continue;
        }
        if policy.disabled.iter().any(|d| d.eq_ignore_ascii_case(&m.name)) {
            p.state = "disabled".into();
            out.push(p);
            continue;
        }
        if third {
            let _ = std::fs::write(policy.marker, &m.name);
        }
        let mut module: *mut sys::obs_module_t = std::ptr::null_mut();
        let code = sys::obs_open_module(&mut module, cstr(&m.bin).as_ptr(), cstr(&m.data).as_ptr());
        if code != 0 || module.is_null() {
            p.state = "failed".into();
            p.error = Some(
                match code {
                    sys::MODULE_MISSING_EXPORTS => "Le faltan funciones de OBS: no es un plugin de OBS o es de otra versión".into(),
                    sys::MODULE_INCOMPATIBLE_VER => "Compilado para una versión de OBS incompatible".into(),
                    sys::MODULE_FAILED_TO_OPEN => "No se pudo abrir (faltan dependencias, por ejemplo Qt)".into(),
                    sys::MODULE_HARDCODED_SKIP => "OBS lo bloquea".into(),
                    c => format!("Error {c}"),
                },
            );
        } else if !sys::obs_init_module(module) {
            p.state = "failed".into();
            p.error = Some("El plugin no se pudo iniciar".into());
        }
        if third {
            let _ = std::fs::remove_file(policy.marker);
            if p.state == "failed" {
                tracing::warn!("third-party OBS plugin {} not loaded: {:?}", m.name, p.error);
            } else {
                tracing::info!("third-party OBS plugin loaded: {} ({})", m.name, m.bin);
            }
        }
        // Bundled modules that open but decline to start (no AJA card, no NVIDIA GPU…) are normal.
        if third || p.error.as_deref().is_some_and(|_| code != 0) {
            out.push(p);
        }
    }
    sys::obs_log_loaded_modules();
    sys::obs_post_load_modules();
    out
}

pub unsafe fn shutdown() {
    sys::obs_shutdown();
}
