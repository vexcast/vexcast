# Desarrollo

Vexcast usa **libobs**, el núcleo de OBS Studio, como motor de video y audio. El núcleo en Rust (`crates/vexcast-core`) enlaza con libobs 32.1 y necesita el **runtime de OBS** (DLLs, plugins y datos) junto al ejecutable.

## Requisitos (Windows)

- [Rust](https://rustup.rs) estable, con Visual Studio Build Tools (C++).
- Node 22+ y [pnpm](https://pnpm.io) 10.
- FFmpeg solo para el test end-to-end (`winget install Gyan.FFmpeg`).

## Primer arranque

Instala las dependencias de JavaScript:

```bash
pnpm install
```

Descarga el runtime oficial de OBS 32.1.2 en `target/debug` y `target/release`:

```bash
node scripts/fetch-obs-runtime.mjs
```

Arranca la app de escritorio:

```bash
pnpm tauri dev
```

O bien solo el núcleo con la interfaz web (abre `http://localhost:7499/app/`). Primero compila la interfaz:

```bash
pnpm build:ui
```

Y luego arranca el servidor:

```bash
cargo run -p vexcast-server -- --port 7499 --ui-dir apps/desktop/dist
```

Para trabajar en la interfaz sin compilar Rust, usa el núcleo simulado:

```bash
pnpm --filter @vexcast/mock-core start
```

```bash
pnpm dev
```

## Tests

Pruebas unitarias del núcleo:

```bash
cargo test -p vexcast-core
```

Test end-to-end con libobs real: transmite a un RTMP local, graba y verifica. Necesita el runtime y FFmpeg:

```bash
cargo test -p vexcast-server --test e2e
```

Pruebas sin el motor (Linux, macOS, CI):

```bash
cargo test -p vexcast-core --no-default-features
```

Tipos de la interfaz y de la app móvil:

```bash
pnpm typecheck
```

## Arquitectura del motor

`crates/vexcast-core/src/obs/`:

| Archivo | Qué hace |
|---|---|
| `runtime.rs` | Arranca libobs, rutas de plugins, `obs_reset_video/audio`, cola de tareas de UI |
| `snapshot.rs` | Lee escenas, elementos (transformaciones de OBS), fuentes, filtros y transiciones |
| `ops.rs` | Mutaciones: escenas, elementos, fuentes, filtros, transiciones y audio global |
| `props.rs` | Convierte las `obs_properties` en el esquema genérico `Property` que pinta la interfaz |
| `catalog.rs` | Tipos de fuente/filtro/transición, codificadores, servicios (rtmp-services), dispositivos |
| `outputs.rs` | Multistream (codificador compartido), grabación, búfer de repetición, cámara virtual, estadísticas |
| `preview.rs` | Fotogramas escalados por la GPU → JPEG (programa, escena o fuente) |
| `audio.rs` | Volmetros por canal, reproductor de efectos (TTS y sonidos de alertas), capturas de audio |
| `collection.rs` | Colecciones de escenas en el formato de OBS e importación desde OBS Studio |
| `hotkeys.rs` | Atajos globales del frontend y de las fuentes |

Las colecciones se guardan en `%APPDATA%\vexcast\scenes\*.json` con el mismo formato que OBS Studio, así que se pueden importar las de OBS directamente.

## macOS y Linux

El motor compila contra libobs mediante `pkg-config` (Linux) o el framework de OBS (macOS). Aún no hay paquetes publicados para estas plataformas. Sin libobs, compila con `--no-default-features`: la API, el chat, las alertas y la IA funcionan, pero el motor de video aparece como no disponible.
