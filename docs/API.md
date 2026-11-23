# Vexcast core API (v2)

The core is a local HTTP + WebSocket server (port **7420** by default). It's used by the desktop app, the mobile app, the widgets and any integration (Stream Deck, bots…).

- Types: [`packages/protocol/src/obs.ts`](../packages/protocol/src/obs.ts) (OBS model) and [`types.ts`](../packages/protocol/src/types.ts) (state and extras).
- Typed client with every method: [`packages/protocol/src/client.ts`](../packages/protocol/src/client.ts).

## Authentication

Every request carries the token, either as `Authorization: Bearer <token>` or as `?token=<token>` (WebSocket, `<img>`, widgets). Requests from `127.0.0.1` don't need it, unless `VEXCAST_REQUIRE_TOKEN=1` is set. The token is shown in **Tools → Remote control** and is embedded in the pairing QR. Errors return a non-2xx status with `{ "error": "message" }`.

## Endpoints (prefix `/api/v1`)

| Area | Endpoints |
|---|---|
| State | `GET /health` (no token) · `GET /state` · `GET /stats` · `GET /ws` (WebSocket) |
| Catalog | `GET /obs/source-types` · `GET /obs/source-types/:kind/defaults` · `GET /obs/filter-types?source=` · `GET /obs/transition-types` · `GET /obs/encoders` · `POST /obs/encoders/:id/properties {settings}` · `GET /obs/services` · `GET /obs/audio-devices?kind=input\|output` · `GET /obs/monitoring-devices` · `GET /obs/plugins` → `{folders, plugins: [{name, path, thirdParty, state: loaded|failed|disabled|off|duplicate, error}]}` (third-party OBS plugins, loaded at startup when `advanced.thirdPartyPlugins` is on and not in `advanced.disabledPlugins`) |
| Automatic setup | `POST /autoconfig` → `{uploadKbps, encoder, hardware, destinations, videoKbps, audioKbps, width, height, fps, limitedBy: upload\|platform}`: measures this PC's upload for ~8 s (uploading random data to speed.cloudflare.com) and recommends the stream settings for the enabled destinations. Nothing is changed; apply it with `PUT /settings/output` and `PUT /settings/video`. |
| System | `GET /system/checks` → `[{id, level: info\|warn\|error, title, detail, fix}]` (macOS screen recording permission, Wayland sessions, an engine that didn't start) · `POST /system/checks/:id/fix` (`fix` is the button label; macOS: asks for the permission and opens the settings pane) |
| Clips | `POST /twitch/clip` → `{id, url, editUrl}`: Twitch clip of the last seconds of the live stream (needs the `clips:edit` permission: accounts linked before v1.2 must be linked again). Also a macro step: `clip`. |
| Collections | `POST /collections {name}` · `POST /collections/:name/activate` · `POST /collections/:name/duplicate {name}` · `PATCH /collections/:name {name}` · `DELETE /collections/:name` · `GET /collections/obs` (OBS Studio and Streamlabs Desktop, with `app`) · `POST /collections/import {path,name?}` · `POST /collections/install-theme {path,name?}` (`path`: a `.vxoverlay`, `.overlay`, `.zip`, an alert pack's `.json` or its folder, or an `https://…` link to one of them → `{name, alerts}`) · `POST /collections/setup-devices` (main display in screen captures, first camera in webcams with no device, and the display under game captures; runs only on import or install) |
| Scenes | `POST /scenes/:uuid/arrange-vertical {mode: tiktok\|auto\|fit, background?}` (rebuilds the 9:16 version from the horizontal one; `tiktok` respects the areas the app covers and `background` is a vertical source that fills in behind) · `POST /scenes {name}` · `PATCH /scenes/:uuid {name}` · `DELETE /scenes/:uuid` · `POST /scenes/:uuid/duplicate` · `POST /scenes/reorder {uuids}` · `POST /scenes/:uuid/program[?force=1]` · `POST /scenes/:uuid/preview` · `POST /studio-mode {enabled}` · `POST /studio-mode/transition` |
| Items | `POST /scenes/:uuid/items {sourceUuid}` · `PATCH /scenes/:uuid/items/:id` (partial transform) · `DELETE …/items/:id` · `POST …/items/:id/transform {action}` · `POST …/items/:id/order {action}` · `POST /scenes/:uuid/items/reorder {ids}` · `POST …/copy-transform` · `POST …/paste-transform` · `POST /scenes/:uuid/group {ids,name}` · `POST …/items/:id/ungroup` |
| Sources | `POST /sources {name,kind,settings?,sceneUuid?}` · `PATCH /sources/:uuid` (name, volume, mute, monitoring, sync, balance, tracks…) · `DELETE /sources/:uuid` · `POST /sources/:uuid/duplicate` · `GET /sources/:uuid/properties` · `PATCH /sources/:uuid/settings` · `POST /sources/:uuid/settings/reset` · `POST /sources/:uuid/properties/:prop/click` · `POST /sources/:uuid/media {action}` · `POST /sources/:uuid/interact` · `GET /sources/:uuid/snapshot.jpg` |
| Filters | `POST /sources/:uuid/filters {kind,name}` · `PATCH …/filters/:f {name,enabled}` · `DELETE …/filters/:f` · `GET …/filters/:f/properties` · `PATCH …/filters/:f/settings` · `POST …/filters/:f/properties/:prop/click` · `POST /sources/:uuid/filters/reorder {uuids}` |
| Transitions | `POST /transitions {kind,name}` · `POST /transitions/:uuid/current` · `PUT /transitions/duration {ms}` · `GET /transitions/:uuid/properties` · `PATCH /transitions/:uuid/settings` · `PATCH /transitions/:uuid {name}` · `DELETE /transitions/:uuid` |
| Settings | `PUT /settings/{video,audio,output,advanced,widgets,ai,bot,general}` (partial, deep merge) · `GET /hotkeys` · `PUT /hotkeys/:id {bindings}` |
| Stream health | `GET /stream-health` (`{level, issues: [{id, level, title, detail, fixes}]}`; changes arrive over WebSocket as a `health` event) · `POST /stream-health/fix {id}` (`lower_bitrate` live, `dynamic_bitrate`, `hardware_encoder`) |
| Remote devices | `PATCH /remote/devices/:id {name?, blocked?, role?}` with `role`: `admin` (everything), `moderator` (scenes, alerts, chat, audio, macros, title) or `viewer` (read-only); all other routes return 403 for those roles |
| Macros | `PUT /macros [{id, name, color, steps: [{kind, value}]}]` (full list; each macro gets its own "Macro: name" hotkey) · `POST /macros/:id/run` |
| Outputs | `POST /stream/rehearsal` (rehearsal: Twitch destinations only, in bandwidth test mode; nothing goes public) · `POST /destinations` · `PATCH/DELETE /destinations/:id` · `POST /stream/start\|stop` · `POST /record/start\|stop` · `POST /record/pause {paused}` · `POST /record/split` · `POST /replay/start\|stop\|save` · `POST /virtualcam/start\|stop` · `POST /screenshot {sourceUuid?}` |
| Preview | `GET /preview.mjpeg?scene=&source=&fps=` (MJPEG) · `GET /preview.jpg` |
| Chat and alerts | `PUT /chat/connections` · `POST /chat/send` · `POST /chat/delete` · `GET /chat/history` · `GET, POST and DELETE /chat/highlight` (on-screen highlighted message) · `POST /alerts/test` · `POST /alerts/skip` · `GET /alerts/recent` · `GET, POST and DELETE /poll` · `POST /poll/end` · `POST /poll/resolve {winner}` (polls in every platform's chat, and predictions) · `GET /loyalty?q=&limit=` · `POST /loyalty/set {key, points}` · `POST /loyalty/reset` (loyalty points) · `GET, POST and DELETE /giveaway` · `POST /giveaway/close` · `POST /giveaway/draw` (giveaways) · `PUT /counters` · `POST /counters/:id/add {delta}` · `POST /counters/:id/set {value}` · `PUT /countdown` · `POST /countdown {action, seconds}` (counters and countdown) · `GET, POST {url} and DELETE /songs` · `POST /songs/next`, `/songs/pause`, `/songs/volume`, `/songs/ended`, `/songs/duration` · `DELETE /songs/:id` (song requests) · `POST /labels/reset {scope: session or all}` (text labels) |
| Analytics | `GET /sessions` (reports, most recent first; includes the stream in progress) · `GET /sessions/:id` (per-minute samples: viewers per platform, chat, scene, kbps, drops; events; summary) · `DELETE /sessions/:id` · `POST /sessions/:id/insights` (AI analysis, saved) |
| Smart chat | `POST /chat/translate {id?, text?, to?}` (`{text}`, `null` if it's already in that language; with `id` it's saved and `chat_translated` is emitted) · `POST /chat/summary` (`{text}`). Each message includes `viewer` (`firstTime`, `returning`, `messages`, `daysAway`) and `question`. |
| AI | `POST /tts/speak` · `GET /tts/audio/:id` · `POST /ai/cohost` · `POST /ai/test` (text engine: `anthropic`, `local`, `ollama`, `openai_compatible`) |
| AI hub | `GET /ai/hub` (engines, models, downloads, running servers) · `POST /ai/hub/install {runtime: llama|whisper|piper, backend?}` · `POST /ai/hub/uninstall {runtime}` · `POST /ai/hub/download {kind: llm|whisper|piper, repo, file}` · `POST /ai/hub/cancel {id}` · `POST /ai/hub/delete {kind, file}` · `POST /ai/hub/stop` · `GET /ai/hub/search?q=` (GGUF on Hugging Face) · `GET /ai/hub/files?repo=&ext=` · `GET /ai/hub/voices` (Piper catalog). Install, download and delete only from this PC. |
| Accounts | `POST /oauth/:platform/start\|cancel\|disconnect\|apply` · `GET\|POST /oauth/:platform/stream-info` (`{title, category?, categoryId?}`) · `GET /oauth/:platform/categories?q=` · `GET /oauth/callback` (browser redirect) |
| Misc | `GET /pairing` · `POST /update/check` · `POST /uploads?name=` (binary body → `{ path }`) · `POST /media/import {path}` (copies a local file into the media folder) · `POST /alerts/designs/export {path, ids?}` / `POST /alerts/designs/import {path}` (`.vxalert` packages from the alert designer) · `POST /alerts/test {type, design?}` · `GET /files?path=` (serves files from the Vexcast data folder to the widgets) |

Outside the prefix:

| Route | Description |
|---|---|
| `/widgets/{alerts,chat,goal,events,captions,audio}.html?token=` (`audio.html?source=&style=bars|ring|glow|wave&color=&color2=&gain=`) | Overlays for browser sources (they also work in OBS) |
| `POST /webhooks/kofi` | Ko-fi webhook (`data` field, validated with the verification token) |
| `/app/` | Web UI (headless server mode) |

## WebSocket `/api/v1/ws?token=…`

The server sends JSON messages (`ServerEvent`):

- `state`: full `AppState`. Sent on connect and after every change.
- `status`: `EngineStatus` (~1 Hz).
- `stats`: `Stats` (~1 Hz).
- `levels`: `AudioLevel[]` per channel (~20 Hz).
- `chat`, `chat_deleted`, `chat_highlight`, `poll`, `giveaway`, `songs`, `alert`, `alert_skip`, `tts`, `caption`, `notification`.
- `phone_cams`: `PhoneCam[]`, the phones currently sending their camera over the local network (also available via `GET /api/v1/phonecam`).
- `session_ended`: `{id, title, summary, droppedPct}`, sent when a stream (not a rehearsal) ends and its report was saved (`GET /api/v1/sessions/:id` has the full report).

Clients don't send anything over the socket: commands go through REST.

## WebSocket `/api/v1/phonecam/ws?id=<room>&role=send|view`

WebRTC signaling for "Phone camera" over the local network. The phone (`send`) and the `phonecam.html` widget inside a browser source (`view`) meet in room `id` (letters, digits, `-` and `_`, up to 64 characters) and exchange the offer, the answer and ICE candidates; the video goes directly between them over the local network, without passing through the core.

- When a viewer joins, the phone receives `{"type":"join","peer":N}`; when it leaves, `{"type":"leave","peer":N}`.
- The phone sends `{"to":N, ...}` and viewer N receives it with `"from":0`. Whatever a viewer sends reaches the phone with `"from":N`.
- If the phone disconnects, the viewers receive `{"type":"bye"}`. A new phone connection replaces the previous one.
