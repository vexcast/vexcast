//! Audio: per-source volume meters, effect playback (TTS / alert sounds) and audio taps (captions).

use super::ffi::*;
use super::model::{AudioLevel, SourceInfo};
use crate::core::Core;
use libobs as sys;
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::os::raw::c_void;
use std::path::PathBuf;
use std::sync::{Arc, Weak};
use std::time::Duration;

const MAX_CH: usize = 8;

struct Meter {
    vm: *mut sys::obs_volmeter_t,
    param: Box<MeterParam>,
}

struct MeterParam {
    uuid: String,
    levels: Arc<Mutex<HashMap<String, AudioLevel>>>,
}

unsafe impl Send for Meter {}

unsafe extern "C" fn meter_cb(param: *mut c_void, magnitude: *const f32, peak: *const f32, input_peak: *const f32) {
    let p = &*(param as *const MeterParam);
    let read = |ptr: *const f32| -> Vec<f32> {
        let s = std::slice::from_raw_parts(ptr, MAX_CH);
        s.iter().take_while(|v| v.is_finite() || **v == f32::NEG_INFINITY).map(|v| if v.is_finite() { v.max(-100.0) } else { -100.0 }).collect()
    };
    let mut mag = read(magnitude);
    let mut pk = read(peak);
    let mut ip = read(input_peak);
    // Trim to the number of audio channels configured.
    let ch = sys::audio_output_get_channels(sys::obs_get_audio()).max(1);
    mag.truncate(ch);
    pk.truncate(ch);
    ip.truncate(ch);
    p.levels.lock().insert(p.uuid.clone(), AudioLevel { source_uuid: p.uuid.clone(), magnitude: mag, peak: pk, input_peak: ip });
}

#[derive(Default)]
pub struct Meters {
    meters: Mutex<HashMap<String, Meter>>,
    levels: Arc<Mutex<HashMap<String, AudioLevel>>>,
}

impl Meters {
    /// Ensure every audio source has a volmeter (and drop meters of removed sources).
    pub fn reconcile(&self, sources: &[SourceInfo]) {
        let mut m = self.meters.lock();
        let wanted: Vec<&SourceInfo> = sources.iter().filter(|s| s.audio).collect();
        let keep: Vec<String> = wanted.iter().map(|s| s.uuid.clone()).collect();
        let stale: Vec<String> = m.keys().filter(|k| !keep.contains(k)).cloned().collect();
        for k in stale {
            if let Some(meter) = m.remove(&k) {
                unsafe { destroy(meter) };
            }
            self.levels.lock().remove(&k);
        }
        for s in wanted {
            if m.contains_key(&s.uuid) {
                continue;
            }
            let Some(src) = Source::by_uuid(&s.uuid) else { continue };
            unsafe {
                let vm = sys::obs_volmeter_create(sys::obs_fader_type_OBS_FADER_LOG);
                let param = Box::new(MeterParam { uuid: s.uuid.clone(), levels: self.levels.clone() });
                sys::obs_volmeter_attach_source(vm, src.ptr());
                sys::obs_volmeter_add_callback(vm, Some(meter_cb), &*param as *const MeterParam as *mut c_void);
                m.insert(s.uuid.clone(), Meter { vm, param });
            }
        }
    }

    pub fn clear(&self) {
        for (_, meter) in self.meters.lock().drain() {
            unsafe { destroy(meter) };
        }
        self.levels.lock().clear();
    }

    /// Emit `levels` events at ~20 Hz.
    pub fn spawn_emitter(&self, core: Weak<Core>) {
        let levels = self.levels.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_millis(50));
            loop {
                iv.tick().await;
                let Some(c) = core.upgrade() else { break };
                if c.is_stopping() {
                    break;
                }
                let data: Vec<AudioLevel> = levels.lock().values().cloned().collect();
                if !data.is_empty() {
                    c.emit(crate::model::ServerEvent::Levels(data));
                }
            }
        });
    }
}

unsafe fn destroy(meter: Meter) {
    sys::obs_volmeter_remove_callback(meter.vm, Some(meter_cb), &*meter.param as *const MeterParam as *mut c_void);
    sys::obs_volmeter_detach_source(meter.vm);
    sys::obs_volmeter_destroy(meter.vm);
    drop(meter.param);
}

// ---------------------------------------------------------------- effects player

/// Plays audio files (TTS, alert sounds) through a private media source on output
/// channel 7: mixed into the stream/recording and monitored locally.
#[derive(Default)]
pub struct Fx {
    queue: Arc<Mutex<VecDeque<PathBuf>>>,
    source: Mutex<Option<Source>>,
    running: std::sync::atomic::AtomicBool,
}

impl Fx {
    pub fn init(&self) {
        unsafe {
            let d = Data::new();
            d.set_bool("is_local_file", true);
            d.set_bool("restart_on_activate", false);
            d.set_bool("close_when_inactive", false);
            d.set_bool("hw_decode", false);
            if let Some(s) = Source::own(sys::obs_source_create_private(cstr("ffmpeg_source").as_ptr(), cstr("Vexcast FX").as_ptr(), d.ptr())) {
                sys::obs_source_set_monitoring_type(s.ptr(), sys::obs_monitoring_type_OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT);
                // Output channels are also drawn on top of the program: a video clip (an alert
                // .webm played for its sound) would cover the whole stream. Make it invisible.
                let fd = Data::new();
                fd.set_double("opacity", 0.0);
                if let Some(f) = Source::own(sys::obs_source_create_private(cstr("color_filter_v2").as_ptr(), cstr("Vexcast FX (invisible)").as_ptr(), fd.ptr())) {
                    sys::obs_source_filter_add(s.ptr(), f.ptr());
                }
                sys::obs_set_output_source(7, s.ptr());
                *self.source.lock() = Some(s);
            }
        }
    }

    pub fn clear(&self) {
        self.queue.lock().clear();
        unsafe { sys::obs_set_output_source(7, std::ptr::null_mut()) };
        *self.source.lock() = None;
    }

    /// Stop the current clip and drop queued ones.
    pub fn skip(&self) {
        self.queue.lock().clear();
        if let Some(s) = self.source.lock().as_ref() {
            unsafe { sys::obs_source_media_stop(s.ptr()) };
        }
    }

    /// Queue a file for playback.
    pub fn play(self: &Arc<Self>, path: PathBuf) {
        self.queue.lock().push_back(path);
        if self.running.swap(true, std::sync::atomic::Ordering::AcqRel) {
            return;
        }
        let me = self.clone();
        std::thread::spawn(move || {
            loop {
                let next = me.queue.lock().pop_front();
                let Some(path) = next else { break };
                let Some(src) = me.source.lock().clone() else { break };
                unsafe {
                    let d = Data::new();
                    d.set_string("local_file", &path.to_string_lossy());
                    d.set_bool("is_local_file", true);
                    sys::obs_source_update(src.ptr(), d.ptr());
                    sys::obs_source_media_restart(src.ptr());
                    // Wait until it ends (max 60 s).
                    std::thread::sleep(Duration::from_millis(250));
                    for _ in 0..600 {
                        let st = sys::obs_source_media_get_state(src.ptr());
                        if st == sys::obs_media_state_OBS_MEDIA_STATE_ENDED || st == sys::obs_media_state_OBS_MEDIA_STATE_STOPPED || st == sys::obs_media_state_OBS_MEDIA_STATE_ERROR || st == sys::obs_media_state_OBS_MEDIA_STATE_NONE {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
                let _ = std::fs::remove_file(&path);
            }
            me.running.store(false, std::sync::atomic::Ordering::Release);
        });
    }
}

// ---------------------------------------------------------------- audio taps (captions)

struct TapParam {
    tx: std::sync::mpsc::SyncSender<Arc<Vec<f32>>>,
}

unsafe extern "C" fn tap_cb(param: *mut c_void, _src: *mut sys::obs_source_t, data: *const sys::audio_data, muted: bool) {
    if muted || data.is_null() {
        return;
    }
    let p = &*(param as *const TapParam);
    let d = &*data;
    let frames = d.frames as usize;
    let l = d.data[0] as *const f32;
    if l.is_null() {
        return;
    }
    let r = if d.data[1].is_null() { l } else { d.data[1] as *const f32 };
    let left = std::slice::from_raw_parts(l, frames);
    let right = std::slice::from_raw_parts(r, frames);
    let mut out = Vec::with_capacity(frames * 2);
    for i in 0..frames {
        out.push(left[i]);
        out.push(right[i]);
    }
    let _ = p.tx.try_send(Arc::new(out));
}

/// Removes the audio tap on drop.
pub struct AudioTap {
    src: Source,
    param: Box<TapParam>,
}

impl Drop for AudioTap {
    fn drop(&mut self) {
        unsafe { sys::obs_source_remove_audio_capture_callback(self.src.ptr(), Some(tap_cb), &*self.param as *const TapParam as *mut c_void) };
    }
}

/// Tap a source's audio (interleaved stereo f32 at the OBS sample rate).
pub fn tap(uuid: &str) -> Option<(std::sync::mpsc::Receiver<Arc<Vec<f32>>>, AudioTap)> {
    let src = Source::by_uuid(uuid)?;
    let (tx, rx) = std::sync::mpsc::sync_channel(2000);
    let param = Box::new(TapParam { tx });
    unsafe { sys::obs_source_add_audio_capture_callback(src.ptr(), Some(tap_cb), &*param as *const TapParam as *mut c_void) };
    Some((rx, AudioTap { src, param }))
}

pub fn sample_rate() -> u32 {
    unsafe { sys::audio_output_get_sample_rate(sys::obs_get_audio()) }
}
