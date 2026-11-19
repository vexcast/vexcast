//! Preview frames: program output (raw video callback) and per-scene / per-source views,
//! scaled on the GPU by libobs and JPEG-encoded for the UI (MJPEG).

use super::ffi::*;
use super::{PreviewKey, PreviewQuality};

/// One preview stream: what it shows and how detailed it is.
type Key = (PreviewKey, PreviewQuality);
use bytes::Bytes;
use libobs as sys;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::os::raw::c_void;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, OnceLock};
use tokio::sync::watch;

struct Sink {
    key: Key,
    w: u32,
    h: u32,
    divisor: u32,
    counter: AtomicU32,
}

/// Off-screen renderer thread for a scene/source preview.
struct Renderer {
    stop: Arc<std::sync::atomic::AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

struct Entry {
    tx: watch::Sender<Option<Bytes>>,
    subs: usize,
    sink: Option<Box<Sink>>,
    renderer: Option<Renderer>,
}

unsafe impl Send for Entry {}

type Frame = (Key, Vec<u8>, u32, u32);

static JPEG_TX: OnceLock<SyncSender<Frame>> = OnceLock::new();
static ENTRIES: OnceLock<Arc<Mutex<HashMap<Key, Entry>>>> = OnceLock::new();

fn entries() -> Arc<Mutex<HashMap<Key, Entry>>> {
    ENTRIES.get_or_init(|| Arc::new(Mutex::new(HashMap::new()))).clone()
}

fn jpeg_tx() -> SyncSender<Frame> {
    JPEG_TX
        .get_or_init(|| {
            let (tx, rx) = sync_channel::<Frame>(3);
            std::thread::Builder::new()
                .name("preview-jpeg".into())
                .spawn(move || {
                    while let Ok((key, rgba, w, h)) = rx.recv() {
                        let mut out = Vec::with_capacity((w * h / 3) as usize);
                        let enc = jpeg_encoder::Encoder::new(&mut out, key.1.jpeg());
                        if enc.encode(&rgba, w as u16, h as u16, jpeg_encoder::ColorType::Rgba).is_ok() {
                            if let Some(e) = entries().lock().get(&key) {
                                let _ = e.tx.send(Some(Bytes::from(out)));
                            }
                        }
                    }
                })
                .ok();
            tx
        })
        .clone()
}

unsafe extern "C" fn on_frame(param: *mut c_void, frame: *mut sys::video_data) {
    let sink = &*(param as *const Sink);
    let n = sink.counter.fetch_add(1, Ordering::Relaxed);
    if n % sink.divisor != 0 {
        return;
    }
    let f = &*frame;
    if f.data[0].is_null() {
        return;
    }
    let stride = f.linesize[0] as usize;
    let row = sink.w as usize * 4;
    let mut buf = Vec::with_capacity(row * sink.h as usize);
    for y in 0..sink.h as usize {
        buf.extend_from_slice(std::slice::from_raw_parts(f.data[0].add(y * stride), row));
    }
    let _ = jpeg_tx().try_send((sink.key.clone(), buf, sink.w, sink.h));
}

fn fit(w: u32, h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    if w == 0 || h == 0 {
        return (max_w & !1, max_h & !1);
    }
    let s = (max_w as f64 / w as f64).min(max_h as f64 / h as f64).min(1.0);
    ((((w as f64 * s) as u32).max(2)) & !1, (((h as f64 * s) as u32).max(2)) & !1)
}

/// Decrements the subscriber count when dropped.
pub struct PreviewGuard {
    key: Key,
}

impl Drop for PreviewGuard {
    fn drop(&mut self) {
        let map = entries();
        let mut m = map.lock();
        let remove = match m.get_mut(&self.key) {
            Some(e) => {
                e.subs = e.subs.saturating_sub(1);
                e.subs == 0
            }
            None => false,
        };
        if remove {
            if let Some(e) = m.remove(&self.key) {
                drop(m);
                unsafe { teardown(e) };
            }
        }
    }
}

unsafe fn teardown(mut e: Entry) {
    if let Some(mut r) = e.renderer.take() {
        r.stop.store(true, Ordering::Release);
        if let Some(t) = r.thread.take() {
            let _ = t.join();
        }
    }
    if let Some(sink) = e.sink.take() {
        let ptr = &*sink as *const Sink as *mut c_void;
        sys::obs_remove_raw_video_callback(Some(on_frame), ptr);
        drop(sink);
    }
}

/// Render `src` off-screen (in the OBS graphics context) at ~`fps` and publish JPEGs.
/// Used for scene (studio mode) and single-source (properties/filters) previews.
enum Target {
    Source(Source, bool),
    Canvas(CanvasRef, u32, u32),
}

struct CanvasRef(*mut sys::obs_canvas_t);
unsafe impl Send for CanvasRef {}
impl Drop for CanvasRef {
    fn drop(&mut self) {
        unsafe { sys::obs_canvas_release(self.0) }
    }
}

fn spawn_renderer(key: Key, target: Target, fps: u32) -> Renderer {
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let st = stop.clone();
    let thread = std::thread::Builder::new()
        .name("preview-render".into())
        .spawn(move || unsafe {
            if let Target::Source(src, _) = &target {
                sys::obs_source_inc_showing(src.ptr());
            }
            let mut tex: *mut sys::gs_texrender_t = std::ptr::null_mut();
            let mut stage: *mut sys::gs_stagesurf_t = std::ptr::null_mut();
            let mut stage_size = (0u32, 0u32);
            let interval = std::time::Duration::from_millis(1000 / fps.clamp(1, 60) as u64);
            while !st.load(Ordering::Acquire) {
                let started = std::time::Instant::now();
                let (bw, bh, big) = match &target {
                    Target::Source(src, true) => {
                        // Scenes report their canvas size (the 9:16 one for vertical twins).
                        let (w, h) = (sys::obs_source_get_width(src.ptr()), sys::obs_source_get_height(src.ptr()));
                        if w >= 2 && h >= 2 {
                            (w, h, true)
                        } else {
                            let mut ovi: sys::obs_video_info = std::mem::zeroed();
                            sys::obs_get_video_info(&mut ovi);
                            (ovi.base_width, ovi.base_height, true)
                        }
                    }
                    Target::Source(src, false) => (sys::obs_source_get_width(src.ptr()), sys::obs_source_get_height(src.ptr()), false),
                    Target::Canvas(_, w, h) => (*w, *h, true),
                };
                if bw >= 2 && bh >= 2 {
                    let (mw, mh) = if big { key.1.max_size() } else { key.1.source_size() };
                    let (w, h) = fit(bw, bh, mw, mh);
                    let mut frame: Option<Vec<u8>> = None;
                    sys::obs_enter_graphics();
                    if tex.is_null() {
                        tex = sys::gs_texrender_create(sys::gs_color_format_GS_RGBA, sys::gs_zstencil_format_GS_ZS_NONE);
                    }
                    if stage.is_null() || stage_size != (w, h) {
                        if !stage.is_null() {
                            sys::gs_stagesurface_destroy(stage);
                        }
                        stage = sys::gs_stagesurface_create(w, h, sys::gs_color_format_GS_RGBA);
                        stage_size = (w, h);
                    }
                    sys::gs_texrender_reset(tex);
                    if sys::gs_texrender_begin(tex, w, h) {
                        let clear: sys::vec4 = std::mem::zeroed();
                        sys::gs_clear(sys::GS_CLEAR_COLOR, &clear, 0.0, 0);
                        sys::gs_ortho(0.0, bw as f32, 0.0, bh as f32, -100.0, 100.0);
                        sys::gs_blend_state_push();
                        sys::gs_blend_function(sys::gs_blend_type_GS_BLEND_ONE, sys::gs_blend_type_GS_BLEND_ZERO);
                        match &target {
                            Target::Source(src, _) => sys::obs_source_video_render(src.ptr()),
                            Target::Canvas(c, _, _) => sys::obs_canvas_render(c.0),
                        }
                        sys::gs_blend_state_pop();
                        sys::gs_texrender_end(tex);
                        sys::gs_stage_texture(stage, sys::gs_texrender_get_texture(tex));
                        let mut data: *mut u8 = std::ptr::null_mut();
                        let mut linesize: u32 = 0;
                        if sys::gs_stagesurface_map(stage, &mut data, &mut linesize) {
                            let row = w as usize * 4;
                            let mut buf = Vec::with_capacity(row * h as usize);
                            for y in 0..h as usize {
                                buf.extend_from_slice(std::slice::from_raw_parts(data.add(y * linesize as usize), row));
                            }
                            sys::gs_stagesurface_unmap(stage);
                            frame = Some(buf);
                        }
                    }
                    sys::obs_leave_graphics();
                    if let Some(buf) = frame {
                        let _ = jpeg_tx().try_send((key.clone(), buf, w, h));
                    }
                }
                let spent = started.elapsed();
                if spent < interval {
                    std::thread::sleep(interval - spent);
                }
            }
            sys::obs_enter_graphics();
            if !tex.is_null() {
                sys::gs_texrender_destroy(tex);
            }
            if !stage.is_null() {
                sys::gs_stagesurface_destroy(stage);
            }
            sys::obs_leave_graphics();
            if let Target::Source(src, _) = &target {
                sys::obs_source_dec_showing(src.ptr());
            }
        })
        .ok();
    Renderer { stop, thread }
}

#[derive(Default)]
pub struct Previews;

impl Previews {
    pub fn clear(&self) {
        let all: Vec<Entry> = entries().lock().drain().map(|(_, e)| e).collect();
        for e in all {
            unsafe { teardown(e) };
        }
    }

    /// Subscribe to JPEG frames for `key`. Starts the capture on first subscriber.
    pub fn subscribe(&self, key: PreviewKey, quality: PreviewQuality, max_fps: u32, canvas: Option<(*mut sys::obs_canvas_t, u32, u32)>) -> anyhow::Result<(watch::Receiver<Option<Bytes>>, PreviewGuard)> {
        let max_fps = max_fps.min(quality.max_fps());
        let key: Key = (key, quality);
        let map = entries();
        let mut m = map.lock();
        if let Some(e) = m.get_mut(&key) {
            e.subs += 1;
            return Ok((e.tx.subscribe(), PreviewGuard { key }));
        }
        let (tx, rx) = watch::channel(None);
        let mut entry = Entry { tx, subs: 1, sink: None, renderer: None };
        unsafe {
            let mut ovi: sys::obs_video_info = std::mem::zeroed();
            if !sys::obs_get_video_info(&mut ovi) {
                anyhow::bail!("El video no está iniciado");
            }
            let fps = (ovi.fps_num as f64 / ovi.fps_den.max(1) as f64).max(1.0);
            let divisor = (fps / max_fps.max(1) as f64).round().max(1.0) as u32;
            match &key.0 {
                PreviewKey::Program => {
                    let (mw, mh) = quality.max_size();
                    let (w, h) = fit(ovi.base_width, ovi.base_height, mw, mh);
                    let sink = Box::new(Sink { key: key.clone(), w, h, divisor, counter: AtomicU32::new(0) });
                    let conv = sys::video_scale_info { format: sys::video_format_VIDEO_FORMAT_RGBA, width: w, height: h, range: sys::video_range_type_VIDEO_RANGE_FULL, colorspace: sys::video_colorspace_VIDEO_CS_709 };
                    sys::obs_add_raw_video_callback(&conv, Some(on_frame), &*sink as *const Sink as *mut c_void);
                    entry.sink = Some(sink);
                }
                PreviewKey::Scene(uuid) | PreviewKey::Source(uuid) => {
                    let src = Source::by_uuid(uuid).ok_or_else(|| anyhow::anyhow!("No encontrado"))?;
                    let is_scene = matches!(key.0, PreviewKey::Scene(_));
                    entry.renderer = Some(spawn_renderer(key.clone(), Target::Source(src, is_scene), if is_scene { max_fps.min(30) } else { max_fps.min(15) }));
                }
                PreviewKey::Vertical => {
                    let (c, w, h) = canvas.ok_or_else(|| anyhow::anyhow!("El lienzo vertical está desactivado"))?;
                    entry.renderer = Some(spawn_renderer(key.clone(), Target::Canvas(CanvasRef(c), w, h), max_fps.min(30)));
                }
            }
        }
        m.insert(key.clone(), entry);
        Ok((rx, PreviewGuard { key }))
    }
}
