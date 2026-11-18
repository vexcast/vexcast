//! Small safe-ish helpers over the raw libobs bindings.

#![allow(clippy::missing_safety_doc)]

use libobs as sys;
use serde_json::Value;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

pub fn cstr(s: &str) -> CString {
    CString::new(s.replace('\0', "")).unwrap_or_default()
}

pub unsafe fn string(p: *const c_char) -> String {
    if p.is_null() {
        String::new()
    } else {
        CStr::from_ptr(p).to_string_lossy().into_owned()
    }
}

pub unsafe fn opt_string(p: *const c_char) -> Option<String> {
    if p.is_null() {
        None
    } else {
        let s = CStr::from_ptr(p).to_string_lossy().into_owned();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
}

/// Owned obs_data_t.
pub struct Data(pub *mut sys::obs_data_t);

impl Data {
    pub fn new() -> Self {
        unsafe { Data(sys::obs_data_create()) }
    }
    pub fn from_json(v: &Value) -> Self {
        let s = cstr(&v.to_string());
        unsafe {
            let d = sys::obs_data_create_from_json(s.as_ptr());
            if d.is_null() {
                Data::new()
            } else {
                Data(d)
            }
        }
    }
    /// Takes ownership of an already-referenced pointer.
    pub unsafe fn own(p: *mut sys::obs_data_t) -> Self {
        Data(p)
    }
    pub fn to_json(&self) -> Value {
        if self.0.is_null() {
            return Value::Object(Default::default());
        }
        unsafe {
            let s = string(sys::obs_data_get_json(self.0));
            serde_json::from_str(&s).unwrap_or(Value::Object(Default::default()))
        }
    }
    /// JSON including default values for unset keys.
    pub fn to_json_with_defaults(&self) -> Value {
        if self.0.is_null() {
            return Value::Object(Default::default());
        }
        unsafe {
            let s = string(sys::obs_data_get_json_with_defaults(self.0));
            serde_json::from_str(&s).unwrap_or(Value::Object(Default::default()))
        }
    }
    pub fn set_string(&self, k: &str, v: &str) {
        unsafe { sys::obs_data_set_string(self.0, cstr(k).as_ptr(), cstr(v).as_ptr()) }
    }
    pub fn set_int(&self, k: &str, v: i64) {
        unsafe { sys::obs_data_set_int(self.0, cstr(k).as_ptr(), v) }
    }
    pub fn set_bool(&self, k: &str, v: bool) {
        unsafe { sys::obs_data_set_bool(self.0, cstr(k).as_ptr(), v) }
    }
    pub fn set_double(&self, k: &str, v: f64) {
        unsafe { sys::obs_data_set_double(self.0, cstr(k).as_ptr(), v) }
    }
    pub fn get_string(&self, k: &str) -> String {
        unsafe { string(sys::obs_data_get_string(self.0, cstr(k).as_ptr())) }
    }
    pub fn get_int(&self, k: &str) -> i64 {
        unsafe { sys::obs_data_get_int(self.0, cstr(k).as_ptr()) }
    }
    pub fn get_obj(&self, k: &str) -> Option<Data> {
        unsafe {
            let p = sys::obs_data_get_obj(self.0, cstr(k).as_ptr());
            if p.is_null() {
                None
            } else {
                Some(Data(p))
            }
        }
    }
    pub fn set_obj(&self, k: &str, v: &Data) {
        unsafe { sys::obs_data_set_obj(self.0, cstr(k).as_ptr(), v.0) }
    }
    /// Merge a JSON object into this data (keys replaced).
    pub fn apply_json(&self, v: &Value) {
        let other = Data::from_json(v);
        unsafe { sys::obs_data_apply(self.0, other.0) }
    }
    pub fn ptr(&self) -> *mut sys::obs_data_t {
        self.0
    }
}

impl Default for Data {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for Data {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { sys::obs_data_release(self.0) }
        }
    }
}

/// Owned obs_source_t reference.
pub struct Source(pub *mut sys::obs_source_t);

unsafe impl Send for Source {}
unsafe impl Sync for Source {}

impl Source {
    /// Takes ownership of an already-referenced pointer (returns None for null).
    pub unsafe fn own(p: *mut sys::obs_source_t) -> Option<Self> {
        if p.is_null() {
            None
        } else {
            Some(Source(p))
        }
    }
    /// Adds a reference to a borrowed pointer.
    pub unsafe fn borrow(p: *mut sys::obs_source_t) -> Option<Self> {
        if p.is_null() {
            return None;
        }
        Source::own(sys::obs_source_get_ref(p))
    }
    pub fn by_uuid(uuid: &str) -> Option<Self> {
        unsafe { Source::own(sys::obs_get_source_by_uuid(cstr(uuid).as_ptr())) }
    }
    pub fn by_name(name: &str) -> Option<Self> {
        unsafe { Source::own(sys::obs_get_source_by_name(cstr(name).as_ptr())) }
    }
    pub fn ptr(&self) -> *mut sys::obs_source_t {
        self.0
    }
    pub fn uuid(&self) -> String {
        unsafe { string(sys::obs_source_get_uuid(self.0)) }
    }
    pub fn name(&self) -> String {
        unsafe { string(sys::obs_source_get_name(self.0)) }
    }
    pub fn id(&self) -> String {
        unsafe { string(sys::obs_source_get_id(self.0)) }
    }
    pub fn settings(&self) -> Data {
        unsafe { Data(sys::obs_source_get_settings(self.0)) }
    }
    pub fn scene(&self) -> *mut sys::obs_scene_t {
        unsafe { sys::obs_scene_from_source(self.0) }
    }
    pub fn is_scene(&self) -> bool {
        unsafe { !sys::obs_scene_from_source(self.0).is_null() }
    }
    pub fn is_group(&self) -> bool {
        unsafe { sys::obs_source_is_group(self.0) }
    }
}

impl Clone for Source {
    fn clone(&self) -> Self {
        unsafe { Source(sys::obs_source_get_ref(self.0)) }
    }
}

impl Drop for Source {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { sys::obs_source_release(self.0) }
        }
    }
}

pub fn vec2(x: f32, y: f32) -> sys::vec2 {
    sys::vec2 { __bindgen_anon_1: sys::vec2__bindgen_ty_1 { ptr: [x, y] } }
}

pub fn vec2_xy(v: &sys::vec2) -> (f32, f32) {
    unsafe { (v.__bindgen_anon_1.ptr[0], v.__bindgen_anon_1.ptr[1]) }
}

pub fn mul_to_db(mul: f32) -> f64 {
    if mul <= 0.0 {
        -100.0
    } else {
        (20.0 * (mul as f64).log10()).max(-100.0)
    }
}

pub fn db_to_mul(db: f64) -> f32 {
    if db <= -100.0 {
        0.0
    } else {
        10f64.powf(db / 20.0) as f32
    }
}

/// Collect pointers from an enum callback into a Vec (each with an added ref).
pub unsafe extern "C" fn collect_sources(param: *mut std::os::raw::c_void, src: *mut sys::obs_source_t) -> bool {
    let v = &mut *(param as *mut Vec<Source>);
    if let Some(s) = Source::borrow(src) {
        v.push(s);
    }
    true
}
