//! Convert libobs property trees into the generic `Property` schema.

use super::ffi::*;
use super::model::{ListItem, Property};
use libobs as sys;
use serde_json::Value;

/// Walk `props` and produce the schema, with current values from `settings_json`
/// (settings including defaults).
pub unsafe fn convert(props: *mut sys::obs_properties_t, settings_json: &Value) -> Vec<Property> {
    let mut out = vec![];
    if props.is_null() {
        return out;
    }
    let mut p = sys::obs_properties_first(props);
    while !p.is_null() {
        out.push(convert_one(p, settings_json));
        if !sys::obs_property_next(&mut p) {
            break;
        }
    }
    out
}

unsafe fn convert_one(p: *mut sys::obs_property_t, settings: &Value) -> Property {
    let name = string(sys::obs_property_name(p));
    let ty = sys::obs_property_get_type(p);
    let mut prop = Property {
        value: settings.get(&name).cloned().unwrap_or(Value::Null),
        name,
        description: string(sys::obs_property_description(p)),
        long_description: opt_string(sys::obs_property_long_description(p)),
        enabled: sys::obs_property_enabled(p),
        visible: sys::obs_property_visible(p),
        ..Default::default()
    };
    match ty {
        sys::obs_property_type_OBS_PROPERTY_BOOL => prop.kind = "bool".into(),
        sys::obs_property_type_OBS_PROPERTY_INT => {
            prop.kind = "int".into();
            prop.min = Some(sys::obs_property_int_min(p) as f64);
            prop.max = Some(sys::obs_property_int_max(p) as f64);
            prop.step = Some(sys::obs_property_int_step(p) as f64);
            prop.suffix = opt_string(sys::obs_property_int_suffix(p));
            prop.slider = Some(sys::obs_property_int_type(p) == sys::obs_number_type_OBS_NUMBER_SLIDER);
        }
        sys::obs_property_type_OBS_PROPERTY_FLOAT => {
            prop.kind = "float".into();
            prop.min = Some(sys::obs_property_float_min(p));
            prop.max = Some(sys::obs_property_float_max(p));
            prop.step = Some(sys::obs_property_float_step(p));
            prop.suffix = opt_string(sys::obs_property_float_suffix(p));
            prop.slider = Some(sys::obs_property_float_type(p) == sys::obs_number_type_OBS_NUMBER_SLIDER);
        }
        sys::obs_property_type_OBS_PROPERTY_TEXT => {
            prop.kind = "text".into();
            prop.text_type = Some(
                match sys::obs_property_text_type(p) {
                    sys::obs_text_type_OBS_TEXT_PASSWORD => "password",
                    sys::obs_text_type_OBS_TEXT_MULTILINE => "multiline",
                    sys::obs_text_type_OBS_TEXT_INFO => "info",
                    _ => "default",
                }
                .into(),
            );
            prop.monospace = Some(sys::obs_property_text_monospace(p));
            prop.info_type = Some(
                match sys::obs_property_text_info_type(p) {
                    sys::obs_text_info_type_OBS_TEXT_INFO_WARNING => "warning",
                    sys::obs_text_info_type_OBS_TEXT_INFO_ERROR => "error",
                    _ => "normal",
                }
                .into(),
            );
        }
        sys::obs_property_type_OBS_PROPERTY_PATH => {
            prop.kind = "path".into();
            prop.path_type = Some(
                match sys::obs_property_path_type(p) {
                    sys::obs_path_type_OBS_PATH_FILE_SAVE => "file_save",
                    sys::obs_path_type_OBS_PATH_DIRECTORY => "directory",
                    _ => "file",
                }
                .into(),
            );
            prop.filter = opt_string(sys::obs_property_path_filter(p));
            prop.default_path = opt_string(sys::obs_property_path_default_path(p));
        }
        sys::obs_property_type_OBS_PROPERTY_LIST => {
            prop.kind = "list".into();
            prop.list_type = Some(
                match sys::obs_property_list_type(p) {
                    sys::obs_combo_type_OBS_COMBO_TYPE_EDITABLE => "editable",
                    sys::obs_combo_type_OBS_COMBO_TYPE_RADIO => "radio",
                    _ => "list",
                }
                .into(),
            );
            let fmt = sys::obs_property_list_format(p);
            prop.format = Some(
                match fmt {
                    sys::obs_combo_format_OBS_COMBO_FORMAT_INT => "int",
                    sys::obs_combo_format_OBS_COMBO_FORMAT_FLOAT => "float",
                    sys::obs_combo_format_OBS_COMBO_FORMAT_BOOL => "bool",
                    _ => "string",
                }
                .into(),
            );
            let n = sys::obs_property_list_item_count(p);
            let mut items = Vec::with_capacity(n);
            for i in 0..n {
                let value = match fmt {
                    sys::obs_combo_format_OBS_COMBO_FORMAT_INT => Value::from(sys::obs_property_list_item_int(p, i)),
                    sys::obs_combo_format_OBS_COMBO_FORMAT_FLOAT => Value::from(sys::obs_property_list_item_float(p, i)),
                    sys::obs_combo_format_OBS_COMBO_FORMAT_BOOL => Value::from(sys::obs_property_list_item_bool(p, i)),
                    _ => Value::from(string(sys::obs_property_list_item_string(p, i))),
                };
                items.push(ListItem { name: string(sys::obs_property_list_item_name(p, i)), value, disabled: sys::obs_property_list_item_disabled(p, i) });
            }
            prop.items = Some(items);
        }
        sys::obs_property_type_OBS_PROPERTY_COLOR => prop.kind = "color".into(),
        sys::obs_property_type_OBS_PROPERTY_COLOR_ALPHA => prop.kind = "color_alpha".into(),
        sys::obs_property_type_OBS_PROPERTY_BUTTON => {
            prop.kind = "button".into();
            prop.button_type = Some(if sys::obs_property_button_type(p) == sys::obs_button_type_OBS_BUTTON_URL { "url" } else { "default" }.into());
            prop.url = opt_string(sys::obs_property_button_url(p));
        }
        sys::obs_property_type_OBS_PROPERTY_FONT => prop.kind = "font".into(),
        sys::obs_property_type_OBS_PROPERTY_EDITABLE_LIST => {
            prop.kind = "editable_list".into();
            prop.editable_list_type = Some(
                match sys::obs_property_editable_list_type(p) {
                    sys::obs_editable_list_type_OBS_EDITABLE_LIST_TYPE_FILES => "files",
                    sys::obs_editable_list_type_OBS_EDITABLE_LIST_TYPE_FILES_AND_URLS => "files_and_urls",
                    _ => "strings",
                }
                .into(),
            );
            prop.filter = opt_string(sys::obs_property_editable_list_filter(p));
            prop.default_path = opt_string(sys::obs_property_editable_list_default_path(p));
            if prop.value.is_null() {
                prop.value = Value::Array(vec![]);
            }
        }
        sys::obs_property_type_OBS_PROPERTY_FRAME_RATE => prop.kind = "frame_rate".into(),
        sys::obs_property_type_OBS_PROPERTY_GROUP => {
            prop.kind = "group".into();
            prop.group_type = Some(if sys::obs_property_group_type(p) == sys::obs_group_type_OBS_GROUP_CHECKABLE { "checkable" } else { "normal" }.into());
            prop.properties = Some(convert(sys::obs_property_group_content(p), settings));
        }
        _ => prop.kind = "text".into(),
    }
    prop
}

/// Find a property by name (searching groups) and click it if it's a button.
/// `obj` is the object passed to the button callback (source/encoder/…).
pub unsafe fn click(props: *mut sys::obs_properties_t, name: &str, obj: *mut std::os::raw::c_void) -> bool {
    let p = sys::obs_properties_get(props, cstr(name).as_ptr());
    if p.is_null() || sys::obs_property_get_type(p) != sys::obs_property_type_OBS_PROPERTY_BUTTON {
        return false;
    }
    sys::obs_property_button_clicked(p, obj)
}

/// Apply "modified" callbacks so dependent properties update (OBS does this on every change).
pub unsafe fn apply_modified(props: *mut sys::obs_properties_t, settings: *mut sys::obs_data_t) {
    if props.is_null() || settings.is_null() {
        return;
    }
    // Same as OBS's properties view refresh: runs every "modified" callback.
    sys::obs_properties_apply_settings(props, settings);
}
