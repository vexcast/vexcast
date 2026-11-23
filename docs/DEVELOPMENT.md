# Development

Vexcast uses **libobs**, the core of OBS Studio, as its video and audio engine. The Rust core (`crates/vexcast-core`) links against libobs 32.1 and needs the **OBS runtime** (DLLs, plugins and data) next to the executable.

## Requirements (Windows)

- Stable [Rust](https://rustup.rs), with Visual Studio Build Tools (C++).
- Node 22+ and [pnpm](https://pnpm.io) 10.
- FFmpeg, only for the end-to-end test (`winget install Gyan.FFmpeg`).

## First run

Install the JavaScript dependencies:

```bash
pnpm install
```

Download the official OBS 32.1.2 runtime into `target/debug` and `target/release`:

```bash
node scripts/fetch-obs-runtime.mjs
```

Start the desktop app:

```bash
pnpm tauri dev
```

Or run just the core with the web UI (open `http://localhost:7499/app/`). First build the UI:

```bash
pnpm build:ui
```

Then start the server:

```bash
cargo run -p vexcast-server -- --port 7499 --ui-dir apps/desktop/dist
```

To work on the UI without building Rust, use the mock core:

```bash
pnpm --filter @vexcast/mock-core start
```

```bash
pnpm dev
```

## Tests

Core unit tests:

```bash
cargo test -p vexcast-core
```

End-to-end test with real libobs: streams to a local RTMP server, records and verifies. Requires the runtime and FFmpeg:

```bash
cargo test -p vexcast-server --test e2e
```

Tests without the engine (Linux, macOS, CI):

```bash
cargo test -p vexcast-core --no-default-features
```

Type checking for the UI and the mobile app:

```bash
pnpm typecheck
```

## Engine architecture

`crates/vexcast-core/src/obs/`:

| File | What it does |
|---|---|
| `runtime.rs` | Starts libobs, plugin paths, `obs_reset_video/audio`, UI task queue |
| `snapshot.rs` | Reads scenes, items (OBS transforms), sources, filters and transitions |
| `ops.rs` | Mutations: scenes, items, sources, filters, transitions and global audio |
| `props.rs` | Converts `obs_properties` into the generic `Property` schema the UI renders |
| `catalog.rs` | Source/filter/transition types, encoders, services (rtmp-services), devices |
| `outputs.rs` | Multistream (shared encoder), recording, replay buffer, virtual camera, stats |
| `preview.rs` | GPU-scaled frames → JPEG (program, scene or source) |
| `audio.rs` | Per-channel volume meters, effects player (TTS and alert sounds), audio captures |
| `collection.rs` | Scene collections in OBS format and import from OBS Studio |
| `hotkeys.rs` | Global frontend and source hotkeys |

Collections are stored in `%APPDATA%\vexcast\scenes\*.json` in the same format as OBS Studio, so OBS collections can be imported directly.

## macOS and Linux

**macOS (Apple Silicon)**: install the Xcode command line tools and `brew install simde` (header used by the libobs bindings), then:

```bash
node scripts/fetch-obs-runtime.mjs obs-runtime-macos target/release   # libobs.framework, dylibs, PlugIns/ from the official OBS DMG
export LIBOBS_PATH="$PWD/obs-runtime-macos"
cargo run --release -p vexcast-server -- --port 7499 --ui-dir apps/desktop/dist
```

To build the app: `cd apps/desktop && pnpm tauri build --bundles app --config src-tauri/tauri.no-updater.conf.json`, then `node scripts/package-macos.mjs --app target/release/bundle/macos/Vexcast.app --runtime obs-runtime-macos --out dist-macos --version <x.y.z>` copies the OBS runtime into `Contents/Frameworks` and `Contents/PlugIns`, signs it ad-hoc and makes the DMG and the updater archive. Inside the app, libobs loads its plugins from `Contents/PlugIns` on its own.

**Linux**: install OBS Studio 32 from the official PPA (`ppa:obsproject/obs-studio`) plus `libclang-dev pkg-config libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`. The engine links the system libobs through `pkg-config`; `pnpm tauri build --bundles deb` makes a `.deb` that depends on `obs-studio`.

Without libobs, build with `--no-default-features`: the API, chat, alerts and AI work, but the video engine shows as unavailable.
