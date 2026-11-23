//! Checks of the system Vexcast runs on that the user may have to act on: the macOS screen
//! recording permission, Wayland sessions on Linux, an engine that couldn't start.

use crate::core::Core;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemCheck {
    pub id: String,
    /// info · warn · error
    pub level: String,
    pub title: String,
    pub detail: String,
    /// Label of the button that fixes it (POST /system/checks/:id/fix), if there is one.
    pub fix: Option<String>,
}

#[cfg(target_os = "macos")]
mod mac {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    pub fn screen_allowed() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() }
    }
    pub fn request_screen() {
        unsafe {
            CGRequestScreenCaptureAccess();
        }
        let _ = std::process::Command::new("open").arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture").spawn();
    }
}

pub fn checks(core: &Arc<Core>) -> Vec<SystemCheck> {
    let mut out = vec![];
    let st = core.engine.status();
    if let Some(e) = st.error.filter(|_| !st.ready) {
        let hint = if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none() {
            " Vexcast usa el OBS Studio 32 del sistema: añade el PPA oficial (sudo add-apt-repository ppa:obsproject/obs-studio) e instala obs-studio, o usa la versión AppImage, que lo lleva dentro."
        } else if cfg!(target_os = "macos") {
            " Prueba a cambiar el renderizador en Ajustes › Avanzado y reinicia Vexcast."
        } else {
            " Actualiza el controlador de tu tarjeta gráfica y reinicia Vexcast."
        };
        out.push(SystemCheck { id: "engine".into(), level: "error".into(), title: "El motor de video no arrancó".into(), detail: format!("{e}.{hint}"), fix: None });
    }
    #[cfg(target_os = "macos")]
    if !mac::screen_allowed() {
        out.push(SystemCheck {
            id: "screen-recording".into(),
            level: "warn".into(),
            title: "Falta el permiso de grabación de pantalla".into(),
            detail: "Sin él, las capturas de pantalla y de ventana salen en negro. Actívalo para Vexcast en Ajustes del Sistema › Privacidad y seguridad › Grabación de pantalla y audio del sistema, y reinicia Vexcast.".into(),
            fix: Some("Dar permiso".into()),
        });
    }
    if cfg!(target_os = "linux") && std::env::var("XDG_SESSION_TYPE").is_ok_and(|s| s.eq_ignore_ascii_case("wayland")) {
        out.push(SystemCheck {
            id: "wayland".into(),
            level: "info".into(),
            title: "Sesión Wayland".into(),
            detail: "Para capturar la pantalla o una ventana usa «Captura de pantalla (PipeWire)»: las capturas de X11 no ven las ventanas de Wayland.".into(),
            fix: None,
        });
    }
    out
}

pub fn fix(id: &str) -> anyhow::Result<()> {
    match id {
        #[cfg(target_os = "macos")]
        "screen-recording" => {
            mac::request_screen();
            Ok(())
        }
        _ => anyhow::bail!("Nada que arreglar para «{id}»"),
    }
}
