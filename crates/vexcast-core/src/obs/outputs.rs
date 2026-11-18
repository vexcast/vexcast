//! Outputs: multistream (one shared encoder, N services), recording, replay buffer, virtual camera, stats.

use super::ffi::*;
use super::model::*;
use super::Engine;
use crate::model::now_ms;
use libobs as sys;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

macro_rules! owned {
    ($name:ident, $t:ty, $release:path) => {
        pub struct $name(pub *mut $t);
        unsafe impl Send for $name {}
        impl Drop for $name {
            fn drop(&mut self) {
                if !self.0.is_null() {
                    unsafe { $release(self.0) }
                }
            }
        }
    };
}

owned!(Output, sys::obs_output_t, sys::obs_output_release);
owned!(Encoder, sys::obs_encoder_t, sys::obs_encoder_release);
owned!(Service, sys::obs_service_t, sys::obs_service_release);

struct StreamOut {
    output: Output,
    _service: Service,
    _venc: Option<Encoder>,
    name: String,
    started: Instant,
}

struct RecOut {
    output: Output,
    _venc: Option<Encoder>,
    path: String,
    started: i64,
}

#[derive(Default)]
struct State {
    venc: Option<(Encoder, String)>,
    /// Encoder on the vertical canvas video (shared by vertical destinations).
    venc_vertical: Option<Encoder>,
    aencs: HashMap<u32, Encoder>,
    streams: HashMap<String, StreamOut>,
    stream_started: Option<i64>,
    record: Option<RecOut>,
    replay: Option<Output>,
    virtualcam: Option<Output>,
    last_recording: Option<String>,
    last_replay: Option<String>,
    errors: HashMap<String, String>,
    rates: HashMap<String, (u64, Instant, f64)>,
    stopping: Vec<Output>,
    sys: Option<sysinfo::System>,
    disks: Option<sysinfo::Disks>,
}

#[derive(Default)]
pub struct Outputs {
    st: Mutex<State>,
}

pub struct OutStatus {
    pub streaming: bool,
    pub stream_started_at: Option<i64>,
    pub recording: bool,
    pub recording_paused: bool,
    pub recording_started_at: Option<i64>,
    pub last_recording_path: Option<String>,
    pub replay_active: bool,
    pub virtualcam_active: bool,
}

fn recording_dir(s: &OutputSettings) -> PathBuf {
    if !s.recording_path.trim().is_empty() {
        return PathBuf::from(s.recording_path.trim());
    }
    dirs::video_dir().or_else(dirs::home_dir).unwrap_or_else(std::env::temp_dir).join("Vexcast")
}

/// OBS filename format specifiers (%CCYY %YY %MM %DD %hh %mm %ss %%).
pub fn format_filename(fmt: &str) -> String {
    let secs = now_ms() / 1000;
    let offset = local_offset_secs();
    let t = secs + offset;
    let days = t.div_euclid(86_400);
    let rem = t.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    let out = fmt
        .replace("%CCYY", &format!("{y:04}"))
        .replace("%YY", &format!("{:02}", y % 100))
        .replace("%MM", &format!("{m:02}"))
        .replace("%DD", &format!("{d:02}"))
        .replace("%hh", &format!("{:02}", rem / 3600))
        .replace("%mm", &format!("{:02}", (rem % 3600) / 60))
        .replace("%ss", &format!("{:02}", rem % 60))
        .replace("%%", "%");
    out.chars().map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') { '-' } else { c }).collect()
}

fn local_offset_secs() -> i64 {
    // Use the OS's notion of local time via libc-free approach: compare with sysinfo boot? Fallback to TZ env.
    #[cfg(windows)]
    {
        #[repr(C)]
        struct TzInfo {
            bias: i32,
            _rest: [u8; 168],
        }
        extern "system" {
            fn GetTimeZoneInformation(info: *mut TzInfo) -> u32;
        }
        unsafe {
            let mut tz: TzInfo = std::mem::zeroed();
            let r = GetTimeZoneInformation(&mut tz);
            // Daylight bias is folded in by the OS for r == 2 only partially; good enough for file names.
            let _ = r;
            -(tz.bias as i64) * 60
        }
    }
    #[cfg(not(windows))]
    {
        0
    }
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

unsafe fn output_type_for(protocol: &str) -> &'static str {
    match protocol.to_uppercase().as_str() {
        "SRT" | "RIST" => "ffmpeg_mpegts_muxer",
        "WHIP" => "whip_output",
        "HLS" => "ffmpeg_hls_muxer",
        _ => "rtmp_output",
    }
}

unsafe fn last_error(o: *mut sys::obs_output_t) -> Option<String> {
    opt_string(sys::obs_output_get_last_error(o))
}

unsafe fn proc_call(o: *mut sys::obs_output_t, name: &str, read_string: Option<&str>) -> Option<String> {
    let ph = sys::obs_output_get_proc_handler(o);
    if ph.is_null() {
        return None;
    }
    let mut cd: sys::calldata = std::mem::zeroed();
    sys::proc_handler_call(ph, cstr(name).as_ptr(), &mut cd);
    let mut out = None;
    if let Some(key) = read_string {
        let mut p: *const std::os::raw::c_char = std::ptr::null();
        if sys::calldata_get_string(&cd, cstr(key).as_ptr(), &mut p) {
            out = opt_string(p);
        }
    }
    if !cd.fixed && !cd.stack.is_null() {
        sys::bfree(cd.stack as *mut _);
    }
    out
}

impl Outputs {
    unsafe fn ensure_encoders(&self, st: &mut State, s: &OutputSettings, tracks: &[u32]) -> anyhow::Result<()> {
        let fingerprint = format!("{}|{}", s.stream_encoder, s.stream_encoder_settings);
        let busy = !st.streams.is_empty() || st.record.is_some() || st.replay.is_some();
        let stale = st.venc.as_ref().map(|(_, f)| f != &fingerprint).unwrap_or(true);
        if stale && !busy {
            st.venc = None;
            st.aencs.clear();
        }
        if st.venc.is_none() {
            let id = if s.stream_encoder.is_empty() { super::catalog::best_video_encoder() } else { s.stream_encoder.clone() };
            let settings = Data::from_json(&s.stream_encoder_settings);
            let enc = sys::obs_video_encoder_create(cstr(&id).as_ptr(), cstr("Vexcast Video").as_ptr(), settings.ptr(), std::ptr::null_mut());
            if enc.is_null() {
                anyhow::bail!("No se pudo crear el codificador de video «{id}»");
            }
            sys::obs_encoder_set_video(enc, sys::obs_get_video());
            st.venc = Some((Encoder(enc), fingerprint));
        }
        for t in tracks {
            if st.aencs.contains_key(t) {
                continue;
            }
            let settings = Data::new();
            settings.set_int("bitrate", s.stream_audio_bitrate.clamp(32, 640) as i64);
            let id = if s.stream_audio_encoder.is_empty() { "ffmpeg_aac".to_string() } else { s.stream_audio_encoder.clone() };
            let enc = sys::obs_audio_encoder_create(cstr(&id).as_ptr(), cstr(&format!("Vexcast Audio {t}")).as_ptr(), settings.ptr(), (*t - 1) as usize, std::ptr::null_mut());
            if enc.is_null() {
                anyhow::bail!("No se pudo crear el codificador de audio «{id}»");
            }
            sys::obs_encoder_set_audio(enc, sys::obs_get_audio());
            st.aencs.insert(*t, Encoder(enc));
        }
        Ok(())
    }

    pub fn any_active(&self) -> bool {
        let st = self.st.lock();
        !st.streams.is_empty() || st.record.is_some() || st.replay.is_some() || st.virtualcam.is_some()
    }

    pub fn start_stream(&self, dests: &[Destination], s: &OutputSettings, vertical_video: Option<*mut sys::video_t>) -> anyhow::Result<Vec<String>> {
        let mut st = self.st.lock();
        let enabled: Vec<&Destination> = dests.iter().filter(|d| d.enabled).collect();
        if enabled.is_empty() {
            anyhow::bail!("Añade y activa al menos un destino en Ajustes → Emisión");
        }
        let track = s.stream_audio_track.clamp(1, 6);
        unsafe { self.ensure_encoders(&mut st, s, &[track])? };
        let mut warnings = vec![];
        for d in enabled {
            if st.streams.contains_key(&d.id) {
                continue;
            }
            let vertical = d.canvas == "vertical";
            if vertical && vertical_video.is_none() {
                warnings.push(format!("{}: activa el lienzo vertical en Ajustes → Video; se emite el horizontal", d.name));
            }
            if let (true, Some(vv), None) = (vertical, vertical_video, st.venc_vertical.as_ref()) {
                unsafe {
                    let id = if s.stream_encoder.is_empty() { super::catalog::best_video_encoder() } else { s.stream_encoder.clone() };
                    let settings = Data::from_json(&s.stream_encoder_settings);
                    let enc = sys::obs_video_encoder_create(cstr(&id).as_ptr(), cstr("Vexcast Vertical Video").as_ptr(), settings.ptr(), std::ptr::null_mut());
                    if !enc.is_null() {
                        sys::obs_encoder_set_video(enc, vv);
                        st.venc_vertical = Some(Encoder(enc));
                    }
                }
            }
            unsafe {
                let ss = Data::new();
                let service_id = if d.service == "Custom" || d.service.is_empty() { "rtmp_custom" } else { "rtmp_common" };
                if service_id == "rtmp_common" {
                    ss.set_string("service", &d.service);
                }
                ss.set_string("server", &d.server);
                ss.set_string("key", &d.stream_key);
                let svc = sys::obs_service_create(cstr(service_id).as_ptr(), cstr(&format!("svc-{}", d.id)).as_ptr(), ss.ptr(), std::ptr::null_mut());
                if svc.is_null() {
                    warnings.push(format!("{}: no se pudo crear el servicio", d.name));
                    continue;
                }
                let service = Service(svc);
                let protocol = string(sys::obs_service_get_protocol(svc));
                let os = Data::new();
                os.set_string("bind_ip", &s.bind_ip);
                os.set_bool("dyn_bitrate", s.dynamic_bitrate);
                os.set_bool("low_latency_mode_enabled", s.low_latency_mode);
                os.set_bool("new_socket_loop_enabled", s.low_latency_mode);
                let out = sys::obs_output_create(cstr(output_type_for(&protocol)).as_ptr(), cstr(&format!("stream-{}", d.id)).as_ptr(), os.ptr(), std::ptr::null_mut());
                if out.is_null() {
                    warnings.push(format!("{}: no se pudo crear la salida ({protocol})", d.name));
                    continue;
                }
                let output = Output(out);
                // Per-destination encoder override or the shared one.
                let mut own_venc = None;
                let venc = match &d.encoder_override {
                    Some(ov) if !ov.encoder.is_empty() => {
                        let es = Data::from_json(&ov.settings);
                        let e = sys::obs_video_encoder_create(cstr(&ov.encoder).as_ptr(), cstr(&format!("venc-{}", d.id)).as_ptr(), es.ptr(), std::ptr::null_mut());
                        if e.is_null() {
                            warnings.push(format!("{}: codificador «{}» no disponible", d.name, ov.encoder));
                            continue;
                        }
                        sys::obs_encoder_set_video(e, sys::obs_get_video());
                        own_venc = Some(Encoder(e));
                        e
                    }
                    _ if vertical && st.venc_vertical.is_some() => st.venc_vertical.as_ref().unwrap().0,
                    _ => st.venc.as_ref().unwrap().0 .0,
                };
                let aenc = st.aencs.get(&track).unwrap().0;
                // Respect the service's recommended limits only when the encoder isn't shared.
                if own_venc.is_some() || st.streams.is_empty() && dests.iter().filter(|x| x.enabled).count() == 1 {
                    let vs = sys::obs_encoder_get_settings(venc);
                    let as_ = sys::obs_encoder_get_settings(aenc);
                    sys::obs_service_apply_encoder_settings(svc, vs, as_);
                    sys::obs_encoder_update(venc, vs);
                    sys::obs_encoder_update(aenc, as_);
                    sys::obs_data_release(vs);
                    sys::obs_data_release(as_);
                }
                sys::obs_output_set_video_encoder(out, venc);
                sys::obs_output_set_audio_encoder(out, aenc, 0);
                sys::obs_output_set_service(out, svc);
                sys::obs_output_set_reconnect_settings(out, if s.reconnect { s.reconnect_max_retries as i32 } else { 0 }, s.reconnect_retry_delay_sec as i32);
                if s.stream_delay_sec > 0 {
                    sys::obs_output_set_delay(out, s.stream_delay_sec, if s.stream_delay_preserve { sys::OBS_OUTPUT_DELAY_PRESERVE } else { 0 });
                }
                if sys::obs_output_start(out) {
                    st.errors.remove(&d.id);
                    st.streams.insert(d.id.clone(), StreamOut { output, _service: service, _venc: own_venc, name: d.name.clone(), started: Instant::now() });
                } else {
                    let e = last_error(out).unwrap_or_else(|| "no se pudo conectar".into());
                    st.errors.insert(d.id.clone(), e.clone());
                    warnings.push(format!("{}: {e}", d.name));
                }
            }
        }
        if st.streams.is_empty() {
            anyhow::bail!("No se pudo iniciar ningún destino. {}", warnings.join(" · "));
        }
        if st.stream_started.is_none() {
            st.stream_started = Some(now_ms());
        }
        Ok(warnings)
    }

    pub fn stop_stream(&self) {
        let mut st = self.st.lock();
        let streams: Vec<StreamOut> = st.streams.drain().map(|(_, s)| s).collect();
        for s in streams {
            unsafe { sys::obs_output_stop(s.output.0) };
            st.stopping.push(s.output);
        }
        st.stream_started = None;
        st.venc_vertical = None;
    }

    pub fn start_recording(&self, s: &OutputSettings) -> anyhow::Result<String> {
        let mut st = self.st.lock();
        if st.record.is_some() {
            anyhow::bail!("Ya se está grabando");
        }
        let tracks: Vec<u32> = (1..=6).filter(|t| s.recording_tracks & (1 << (t - 1)) != 0).collect();
        let tracks = if tracks.is_empty() { vec![1] } else { tracks };
        unsafe { self.ensure_encoders(&mut st, s, &tracks)? };
        let dir = recording_dir(s);
        std::fs::create_dir_all(&dir).map_err(|e| anyhow::anyhow!("No se pudo crear la carpeta {}: {e}", dir.display()))?;
        let (ext, output_id, muxer) = match s.recording_format.as_str() {
            "hybrid_mp4" => ("mp4", "mp4_output", ""),
            "mp4" => ("mp4", "ffmpeg_muxer", ""),
            "mov" => ("mov", "ffmpeg_muxer", ""),
            "flv" => ("flv", "ffmpeg_muxer", ""),
            "ts" => ("ts", "ffmpeg_muxer", ""),
            "fragmented_mp4" => ("mp4", "ffmpeg_muxer", "movflags=frag_keyframe+empty_moov+delay_moov"),
            "fragmented_mov" => ("mov", "ffmpeg_muxer", "movflags=frag_keyframe+empty_moov+delay_moov"),
            _ => ("mkv", "ffmpeg_muxer", ""),
        };
        let mut name = format_filename(&s.recording_filename_format);
        let mut path = dir.join(format!("{name}.{ext}"));
        let mut n = 2;
        while path.exists() && !s.overwrite_if_exists {
            name = format!("{} ({n})", format_filename(&s.recording_filename_format));
            path = dir.join(format!("{name}.{ext}"));
            n += 1;
        }
        let path_s = path.to_string_lossy().replace('\\', "/");
        unsafe {
            let os = Data::new();
            os.set_string("path", &path_s);
            if !muxer.is_empty() {
                os.set_string("muxer_settings", muxer);
            }
            match s.split_file.mode.as_str() {
                "time" => {
                    os.set_bool("split_file", true);
                    os.set_int("max_time_sec", (s.split_file.minutes.max(1) * 60) as i64);
                }
                "size" => {
                    os.set_bool("split_file", true);
                    os.set_int("max_size_mb", s.split_file.megabytes.max(1) as i64);
                }
                "manual" => os.set_bool("split_file", true),
                _ => {}
            }
            let out = sys::obs_output_create(cstr(output_id).as_ptr(), cstr("Vexcast Recording").as_ptr(), os.ptr(), std::ptr::null_mut());
            if out.is_null() {
                anyhow::bail!("No se pudo crear la salida de grabación");
            }
            let output = Output(out);
            let mut own = None;
            let venc = if !s.recording_encoder.is_empty() && s.recording_encoder != "same" {
                let es = Data::from_json(&s.recording_encoder_settings);
                let e = sys::obs_video_encoder_create(cstr(&s.recording_encoder).as_ptr(), cstr("Vexcast Recording Video").as_ptr(), es.ptr(), std::ptr::null_mut());
                if e.is_null() {
                    anyhow::bail!("Codificador de grabación no disponible: {}", s.recording_encoder);
                }
                sys::obs_encoder_set_video(e, sys::obs_get_video());
                if let Some(r) = &s.recording_rescale {
                    if r.width > 0 && r.height > 0 {
                        sys::obs_encoder_set_scaled_size(e, r.width & !1, r.height & !1);
                    }
                }
                own = Some(Encoder(e));
                e
            } else {
                st.venc.as_ref().unwrap().0 .0
            };
            sys::obs_output_set_video_encoder(out, venc);
            for (idx, t) in tracks.iter().enumerate() {
                sys::obs_output_set_audio_encoder(out, st.aencs.get(t).unwrap().0, idx);
            }
            if !sys::obs_output_start(out) {
                anyhow::bail!("No se pudo iniciar la grabación: {}", last_error(out).unwrap_or_default());
            }
            st.record = Some(RecOut { output, _venc: own, path: path_s.clone(), started: now_ms() });
        }
        Ok(path_s)
    }

    pub fn stop_recording(&self) -> Option<String> {
        let mut st = self.st.lock();
        let rec = st.record.take()?;
        unsafe { sys::obs_output_stop(rec.output.0) };
        st.last_recording = Some(rec.path.clone());
        st.stopping.push(rec.output);
        Some(rec.path)
    }

    pub fn pause_recording(&self, paused: bool) -> anyhow::Result<()> {
        let st = self.st.lock();
        let rec = st.record.as_ref().ok_or_else(|| anyhow::anyhow!("No se está grabando"))?;
        unsafe {
            if !sys::obs_output_pause(rec.output.0, paused) {
                anyhow::bail!("Este codificador no admite pausar la grabación");
            }
        }
        Ok(())
    }

    pub fn split_recording(&self) -> anyhow::Result<()> {
        let st = self.st.lock();
        let rec = st.record.as_ref().ok_or_else(|| anyhow::anyhow!("No se está grabando"))?;
        unsafe { proc_call(rec.output.0, "split_file", None) };
        Ok(())
    }

    pub fn start_replay(&self, s: &OutputSettings) -> anyhow::Result<()> {
        let mut st = self.st.lock();
        if st.replay.is_some() {
            return Ok(());
        }
        let track = s.stream_audio_track.clamp(1, 6);
        unsafe { self.ensure_encoders(&mut st, s, &[track])? };
        let dir = recording_dir(s);
        let _ = std::fs::create_dir_all(&dir);
        unsafe {
            let os = Data::new();
            os.set_string("directory", &dir.to_string_lossy().replace('\\', "/"));
            os.set_string("format", &format!("Replay {}", s.recording_filename_format));
            os.set_string("extension", "mkv");
            os.set_bool("allow_spaces", true);
            os.set_int("max_time_sec", s.replay_buffer_seconds.clamp(5, 21_600) as i64);
            os.set_int("max_size_mb", s.replay_buffer_max_mb.clamp(64, 65_536) as i64);
            let out = sys::obs_output_create(cstr("replay_buffer").as_ptr(), cstr("Vexcast Replay").as_ptr(), os.ptr(), std::ptr::null_mut());
            if out.is_null() {
                anyhow::bail!("No se pudo crear el búfer de repetición");
            }
            let output = Output(out);
            sys::obs_output_set_video_encoder(out, st.venc.as_ref().unwrap().0 .0);
            sys::obs_output_set_audio_encoder(out, st.aencs.get(&track).unwrap().0, 0);
            if !sys::obs_output_start(out) {
                anyhow::bail!("No se pudo iniciar el búfer: {}", last_error(out).unwrap_or_default());
            }
            st.replay = Some(output);
        }
        Ok(())
    }

    pub fn stop_replay(&self) {
        let mut st = self.st.lock();
        if let Some(o) = st.replay.take() {
            unsafe { sys::obs_output_stop(o.0) };
            st.stopping.push(o);
        }
    }

    pub fn save_replay(&self) -> anyhow::Result<()> {
        let st = self.st.lock();
        let o = st.replay.as_ref().ok_or_else(|| anyhow::anyhow!("El búfer de repetición no está activo"))?;
        unsafe { proc_call(o.0, "save", None) };
        Ok(())
    }

    pub fn start_virtualcam(&self) -> anyhow::Result<()> {
        let mut st = self.st.lock();
        if st.virtualcam.is_some() {
            return Ok(());
        }
        unsafe {
            let out = sys::obs_output_create(cstr("virtualcam_output").as_ptr(), cstr("Vexcast Virtual Camera").as_ptr(), std::ptr::null_mut(), std::ptr::null_mut());
            if out.is_null() {
                anyhow::bail!("La cámara virtual no está disponible en este sistema");
            }
            let output = Output(out);
            sys::obs_output_set_media(out, sys::obs_get_video(), sys::obs_get_audio());
            if !sys::obs_output_start(out) {
                anyhow::bail!("No se pudo iniciar la cámara virtual: {}", last_error(out).unwrap_or_else(|| "¿está instalado el controlador de cámara virtual de OBS?".into()));
            }
            st.virtualcam = Some(output);
        }
        Ok(())
    }

    pub fn stop_virtualcam(&self) {
        let mut st = self.st.lock();
        if let Some(o) = st.virtualcam.take() {
            unsafe { sys::obs_output_stop(o.0) };
            st.stopping.push(o);
        }
    }

    pub fn stop_all(&self) {
        self.stop_stream();
        self.stop_recording();
        self.stop_replay();
        self.stop_virtualcam();
        let mut st = self.st.lock();
        st.stopping.clear();
        st.venc = None;
        st.aencs.clear();
    }

    pub fn status(&self) -> OutStatus {
        let st = self.st.lock();
        OutStatus {
            streaming: !st.streams.is_empty(),
            stream_started_at: st.stream_started,
            recording: st.record.is_some(),
            recording_paused: st.record.as_ref().map(|r| unsafe { sys::obs_output_paused(r.output.0) }).unwrap_or(false),
            recording_started_at: st.record.as_ref().map(|r| r.started),
            last_recording_path: st.last_recording.clone(),
            replay_active: st.replay.is_some(),
            virtualcam_active: st.virtualcam.is_some(),
        }
    }

    /// Called ~1 Hz: detect outputs that stopped on their own (errors) and release stopped ones.
    pub fn poll(&self, engine: &Engine) {
        let mut st = self.st.lock();
        st.stopping.retain(|o| unsafe { sys::obs_output_active(o.0) });
        let mut failed = vec![];
        for (id, s) in st.streams.iter() {
            unsafe {
                if !sys::obs_output_active(s.output.0) && s.started.elapsed().as_secs() > 2 {
                    failed.push((id.clone(), s.name.clone(), last_error(s.output.0).unwrap_or_else(|| "la conexión se cerró".into())));
                }
            }
        }
        for (id, name, e) in &failed {
            st.streams.remove(id);
            st.errors.insert(id.clone(), e.clone());
            if let Some(c) = engine.core() {
                c.notify("error", format!("{name}: {e}"));
            }
        }
        if !failed.is_empty() && st.streams.is_empty() {
            st.stream_started = None;
        }
        let rec_dead = st.record.as_ref().map(|r| unsafe { !sys::obs_output_active(r.output.0) } && now_ms() - r.started > 2000).unwrap_or(false);
        if rec_dead {
            let r = st.record.take().unwrap();
            let e = unsafe { last_error(r.output.0) };
            st.last_recording = Some(r.path.clone());
            if let (Some(c), Some(e)) = (engine.core(), e) {
                c.notify("error", format!("La grabación se detuvo: {e}"));
            }
        }
        let replay_path = st.replay.as_ref().and_then(|o| unsafe { proc_call(o.0, "get_last_replay", Some("path")) });
        if replay_path.is_some() && replay_path != st.last_replay {
            if st.last_replay.is_some() {
                if let (Some(c), Some(p)) = (engine.core(), &replay_path) {
                    c.notify("success", format!("Repetición guardada: {p}"));
                }
            }
            st.last_replay = replay_path;
        }
    }

    pub fn stats(&self, engine: &Engine) -> Stats {
        let mut st = self.st.lock();
        let mut out = Stats::default();
        if !engine.is_ready() {
            return out;
        }
        unsafe {
            let mut ovi: sys::obs_video_info = std::mem::zeroed();
            sys::obs_get_video_info(&mut ovi);
            out.target_fps = ovi.fps_num as f64 / ovi.fps_den.max(1) as f64;
            out.fps = (sys::obs_get_active_fps() * 100.0).round() / 100.0;
            out.average_render_ms = (sys::obs_get_average_frame_time_ns() as f64 / 1_000_000.0 * 100.0).round() / 100.0;
            out.render_skipped = sys::obs_get_lagged_frames() as u64;
            out.render_total = sys::obs_get_total_frames() as u64;
            let video = sys::obs_get_video();
            out.encoding_skipped = sys::video_output_get_skipped_frames(video) as u64;
            out.encoding_total = sys::video_output_get_total_frames(video) as u64;
        }
        let sys_ = st.sys.get_or_insert_with(sysinfo::System::new);
        sys_.refresh_cpu_usage();
        out.cpu = (sys_.global_cpu_usage() as f64 * 10.0).round() / 10.0;
        if let Ok(pid) = sysinfo::get_current_pid() {
            sys_.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
            if let Some(p) = sys_.process(pid) {
                out.memory_mb = (p.memory() as f64 / 1_048_576.0).round();
            }
        }
        let dir = engine.core().map(|c| c.read(|s| recording_dir(&s.output))).unwrap_or_default();
        let disks = st.disks.get_or_insert_with(sysinfo::Disks::new_with_refreshed_list);
        disks.refresh(true);
        out.disk_free_gb = disks
            .list()
            .iter()
            .filter(|d| dir.starts_with(d.mount_point()))
            .max_by_key(|d| d.mount_point().as_os_str().len())
            .map(|d| (d.available_space() as f64 / 1_073_741_824.0 * 10.0).round() / 10.0);

        let now = Instant::now();
        let mut rows: Vec<(String, *mut sys::obs_output_t)> = st.streams.iter().map(|(id, s)| (id.clone(), s.output.0)).collect();
        if let Some(r) = &st.record {
            rows.push(("record".into(), r.output.0));
        }
        if let Some(r) = &st.replay {
            rows.push(("replay".into(), r.0));
        }
        if let Some(r) = &st.virtualcam {
            rows.push(("virtualcam".into(), r.0));
        }
        for (id, o) in rows {
            unsafe {
                let bytes = sys::obs_output_get_total_bytes(o);
                let entry = st.rates.entry(id.clone()).or_insert((bytes, now, 0.0));
                let dt = now.duration_since(entry.1).as_secs_f64();
                if dt >= 0.9 {
                    entry.2 = ((bytes.saturating_sub(entry.0)) as f64 * 8.0 / 1000.0 / dt).round();
                    entry.0 = bytes;
                    entry.1 = now;
                }
                let active = sys::obs_output_active(o);
                let reconnecting = sys::obs_output_reconnecting(o);
                out.outputs.push(OutputStatus {
                    id: id.clone(),
                    state: if reconnecting { "reconnecting" } else if active { "active" } else { "starting" }.into(),
                    kbps: entry.2,
                    total_bytes: bytes,
                    dropped_frames: sys::obs_output_get_frames_dropped(o) as i64,
                    total_frames: sys::obs_output_get_total_frames(o) as i64,
                    congestion: sys::obs_output_get_congestion(o) as f64,
                    duration_ms: sys::obs_output_get_connect_time_ms(o) as i64,
                    error: None,
                });
            }
        }
        for (id, e) in st.errors.clone() {
            if !out.outputs.iter().any(|o| o.id == id) {
                out.outputs.push(OutputStatus { id, state: "error".into(), error: Some(e), ..Default::default() });
            }
        }
        out
    }
}

/// File present while live (see `start_stream_mode`).
const LIVE_MARKER: &str = "live.json";

fn is_twitch(d: &Destination) -> bool {
    let s = format!("{} {} {}", d.service, d.server, d.name).to_lowercase();
    s.contains("twitch")
}

impl Engine {
    pub fn start_stream(&self) -> anyhow::Result<Vec<String>> {
        self.start_stream_mode(false)
    }

    /// Go live. `rehearsal`: only the Twitch destinations, in Twitch's bandwidth-test mode
    /// (the stream reaches Twitch, which measures it, but nobody can watch it).
    pub fn start_stream_mode(&self, rehearsal: bool) -> anyhow::Result<Vec<String>> {
        self.require_ready()?;
        let core = self.core().ok_or_else(|| anyhow::anyhow!("core"))?;
        let (mut dests, s) = core.read(|st| (st.destinations.clone(), st.output.clone()));
        if rehearsal {
            dests.retain(|d| d.enabled && is_twitch(d));
            if dests.is_empty() {
                anyhow::bail!("El ensayo necesita un destino de Twitch activo: Twitch es la única plataforma que permite emitir sin publicar (Kick, YouTube y TikTok no tienen ese modo)");
            }
            for d in &mut dests {
                if !d.stream_key.contains("bandwidthtest") {
                    d.stream_key.push_str(if d.stream_key.contains('?') { "&bandwidthtest=true" } else { "?bandwidthtest=true" });
                }
            }
        }
        let w = self.outputs.start_stream(&dests, &s, self.vertical_video())?;
        self.rehearsal.store(rehearsal, std::sync::atomic::Ordering::Release);
        if rehearsal {
            core.notify("success", "Ensayo en marcha: Twitch recibe la señal pero no se publica");
        } else {
            if s.replay_buffer_enabled {
                let _ = self.outputs.start_replay(&s);
            }
            // Left behind only if Vexcast closes without stopping the stream (crash, power cut).
            let _ = std::fs::write(self.data_dir.join(LIVE_MARKER), serde_json::json!({ "startedAt": crate::model::now_ms() }).to_string());
            core.notify("success", "¡Estás en directo!");
        }
        Ok(w)
    }

    pub fn stop_stream(&self) {
        self.outputs.stop_stream();
        let _ = std::fs::remove_file(self.data_dir.join(LIVE_MARKER));
        let was_rehearsal = self.rehearsal.swap(false, std::sync::atomic::Ordering::AcqRel);
        if let Some(c) = self.core() {
            c.notify("info", if was_rehearsal { "Ensayo terminado" } else { "Transmisión finalizada" });
        }
    }

    /// Change the stream bitrate while live (encoders that support it apply it right away).
    pub fn set_live_bitrate(&self, kbps: i64) -> bool {
        let st = self.outputs.st.lock();
        let mut applied = false;
        unsafe {
            for enc in st.venc.as_ref().map(|(e, _)| e.0).into_iter().chain(st.venc_vertical.as_ref().map(|e| e.0)) {
                let data = Data::own(sys::obs_encoder_get_settings(enc));
                data.set_int("bitrate", kbps);
                sys::obs_encoder_update(enc, data.ptr());
                applied = true;
            }
        }
        applied && !st.streams.is_empty()
    }

    /// When the last run ended while live without stopping: when it started (ms).
    pub fn unfinished_stream(&self) -> Option<i64> {
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(self.data_dir.join(LIVE_MARKER)).ok()?).ok()?;
        v["startedAt"].as_i64()
    }

    /// Forget the crash marker (clean exit, or recovery declined).
    pub fn clear_unfinished_stream(&self) {
        let _ = std::fs::remove_file(self.data_dir.join(LIVE_MARKER));
    }

    pub fn start_recording(&self) -> anyhow::Result<String> {
        self.require_ready()?;
        let s = self.core().map(|c| c.read(|st| st.output.clone())).unwrap_or_default();
        self.outputs.start_recording(&s)
    }

    pub fn stop_recording(&self) {
        let Some(p) = self.outputs.stop_recording() else { return };
        let Some(c) = self.core() else { return };
        c.notify("success", format!("Grabación guardada: {p}"));
        let (auto_remux, format) = c.read(|s| (s.output.auto_remux, s.output.recording_format.clone()));
        if auto_remux && matches!(format.as_str(), "mkv" | "flv" | "ts") {
            let core = self.core.clone();
            std::thread::spawn(move || remux_to_mp4(core, PathBuf::from(p)));
        }
    }

    pub fn start_replay(&self) -> anyhow::Result<()> {
        self.require_ready()?;
        let s = self.core().map(|c| c.read(|st| st.output.clone())).unwrap_or_default();
        self.outputs.start_replay(&s)
    }

    pub fn outputs_pause(&self, paused: bool) -> anyhow::Result<()> {
        self.outputs.pause_recording(paused)
    }

    pub fn outputs_split(&self) -> anyhow::Result<()> {
        self.outputs.split_recording()
    }

    pub fn stop_replay(&self) {
        self.outputs.stop_replay();
    }

    pub fn save_replay(&self) -> anyhow::Result<()> {
        self.outputs.save_replay()
    }

    pub fn start_virtualcam(&self) -> anyhow::Result<()> {
        self.require_ready()?;
        self.outputs.start_virtualcam()
    }

    pub fn stop_virtualcam(&self) {
        self.outputs.stop_virtualcam();
    }

    pub fn screenshot_dir(&self) -> PathBuf {
        let s = self.core().map(|c| c.read(|st| st.output.clone())).unwrap_or_default();
        recording_dir(&s)
    }
}

/// ffmpeg next to Vexcast or on PATH (used only for remuxing).
fn find_ffmpeg() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.to_path_buf())) {
        if dir.join(exe).is_file() {
            return Some(dir.join(exe));
        }
    }
    std::env::var_os("PATH").and_then(|p| std::env::split_paths(&p).map(|d| d.join(exe)).find(|c| c.is_file()))
}

/// Losslessly remux a finished recording to MP4 (like OBS's "automatically remux to mp4").
fn remux_to_mp4(core: std::sync::Weak<crate::core::Core>, input: PathBuf) {
    // Wait for the muxer to finish writing the file.
    let mut last = 0u64;
    for _ in 0..60 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let len = std::fs::metadata(&input).map(|m| m.len()).unwrap_or(0);
        if len > 0 && len == last {
            break;
        }
        last = len;
    }
    let notify = |level: &str, msg: String| {
        if let Some(c) = core.upgrade() {
            c.notify(level, msg);
        }
    };
    let Some(ffmpeg) = find_ffmpeg() else {
        notify("warning", "Para el remux automático a MP4 instala FFmpeg (winget install Gyan.FFmpeg) o usa el formato MP4 híbrido".into());
        return;
    };
    let output = input.with_extension("mp4");
    let status = crate::util::command(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&input)
        .args(["-map", "0", "-c", "copy", "-movflags", "+faststart"])
        .arg(&output)
        .stdin(std::process::Stdio::null())
        .status();
    match status {
        Ok(s) if s.success() => notify("success", format!("Remux a MP4 completado: {}", output.display())),
        _ => notify("error", format!("No se pudo hacer el remux de {}", input.display())),
    }
}
