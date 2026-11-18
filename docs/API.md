# API del núcleo de Vexcast (v2)

El núcleo es un servidor HTTP + WebSocket local (puerto **7420** por defecto). Lo usan la app de escritorio, la app móvil, los widgets y cualquier integración (Stream Deck, bots…).

- Tipos: [`packages/protocol/src/obs.ts`](../packages/protocol/src/obs.ts) (modelo de OBS) y [`types.ts`](../packages/protocol/src/types.ts) (estado y extras).
- Cliente tipado con todos los métodos: [`packages/protocol/src/client.ts`](../packages/protocol/src/client.ts).

## Autenticación

Cada petición lleva el token, como `Authorization: Bearer <token>` o como `?token=<token>` (WebSocket, `<img>`, widgets). Las peticiones desde `127.0.0.1` no lo necesitan, salvo que se defina `VEXCAST_REQUIRE_TOKEN=1`. El token aparece en **Herramientas → Control remoto** y va dentro del QR de emparejamiento. Los errores devuelven un estado no 2xx con `{ "error": "mensaje" }`.

## Endpoints (prefijo `/api/v1`)

| Área | Endpoints |
|---|---|
| Estado | `GET /health` (sin token) · `GET /state` · `GET /stats` · `GET /ws` (WebSocket) |
| Catálogo | `GET /obs/source-types` · `GET /obs/source-types/:kind/defaults` · `GET /obs/filter-types?source=` · `GET /obs/transition-types` · `GET /obs/encoders` · `POST /obs/encoders/:id/properties {settings}` · `GET /obs/services` · `GET /obs/audio-devices?kind=input\|output` · `GET /obs/monitoring-devices` |
| Colecciones | `POST /collections {name}` · `POST /collections/:name/activate` · `POST /collections/:name/duplicate {name}` · `PATCH /collections/:name {name}` · `DELETE /collections/:name` · `GET /collections/obs` (OBS Studio y Streamlabs Desktop, con `app`) · `POST /collections/import {path,name?}` · `POST /collections/install-theme {path,name?}` (`path` también puede ser un enlace `https://…` a un `.vxoverlay`, `.overlay` o `.zip`) (`.overlay`, `.json` de un pack o su carpeta → `{name, alerts}`) · `POST /collections/setup-devices` (pantalla principal en capturas de pantalla, primera cámara en webcams sin dispositivo, y la pantalla bajo las capturas de juego; se ejecuta solo al importar o instalar) |
| Escenas | `POST /scenes/:uuid/arrange-vertical {mode: tiktok\|auto\|fit, background?}` (rehace la versión 9:16 desde la horizontal; `tiktok` respeta las zonas que tapa la app y `background` es una fuente vertical que rellena detrás) · `POST /scenes {name}` · `PATCH /scenes/:uuid {name}` · `DELETE /scenes/:uuid` · `POST /scenes/:uuid/duplicate` · `POST /scenes/reorder {uuids}` · `POST /scenes/:uuid/program[?force=1]` · `POST /scenes/:uuid/preview` · `POST /studio-mode {enabled}` · `POST /studio-mode/transition` |
| Elementos | `POST /scenes/:uuid/items {sourceUuid}` · `PATCH /scenes/:uuid/items/:id` (transformación parcial) · `DELETE …/items/:id` · `POST …/items/:id/transform {action}` · `POST …/items/:id/order {action}` · `POST /scenes/:uuid/items/reorder {ids}` · `POST …/copy-transform` · `POST …/paste-transform` · `POST /scenes/:uuid/group {ids,name}` · `POST …/items/:id/ungroup` |
| Fuentes | `POST /sources {name,kind,settings?,sceneUuid?}` · `PATCH /sources/:uuid` (nombre, volumen, mute, monitorización, sync, balance, pistas…) · `DELETE /sources/:uuid` · `POST /sources/:uuid/duplicate` · `GET /sources/:uuid/properties` · `PATCH /sources/:uuid/settings` · `POST /sources/:uuid/settings/reset` · `POST /sources/:uuid/properties/:prop/click` · `POST /sources/:uuid/media {action}` · `POST /sources/:uuid/interact` · `GET /sources/:uuid/snapshot.jpg` |
| Filtros | `POST /sources/:uuid/filters {kind,name}` · `PATCH …/filters/:f {name,enabled}` · `DELETE …/filters/:f` · `GET …/filters/:f/properties` · `PATCH …/filters/:f/settings` · `POST …/filters/:f/properties/:prop/click` · `POST /sources/:uuid/filters/reorder {uuids}` |
| Transiciones | `POST /transitions {kind,name}` · `POST /transitions/:uuid/current` · `PUT /transitions/duration {ms}` · `GET /transitions/:uuid/properties` · `PATCH /transitions/:uuid/settings` · `PATCH /transitions/:uuid {name}` · `DELETE /transitions/:uuid` |
| Ajustes | `PUT /settings/{video,audio,output,advanced,widgets,ai,bot,general}` (parcial, mezcla profunda) · `GET /hotkeys` · `PUT /hotkeys/:id {bindings}` |
| Salud del directo | `GET /stream-health` (`{level, issues: [{id, level, title, detail, fixes}]}`; los cambios llegan por WebSocket como evento `health`) · `POST /stream-health/fix {id}` (`lower_bitrate` en caliente, `dynamic_bitrate`, `hardware_encoder`) |
| Dispositivos remotos | `PATCH /remote/devices/:id {name?, blocked?, role?}` con `role`: `admin` (todo), `moderator` (escenas, alertas, chat, audio, macros, título) o `viewer` (solo lectura); el resto de rutas devuelven 403 a esos roles |
| Macros | `PUT /macros [{id, name, color, steps: [{kind, value}]}]` (lista completa; cada macro tiene su atajo «Macro: nombre») · `POST /macros/:id/run` |
| Salidas | `POST /stream/rehearsal` (ensayo: solo los destinos de Twitch en modo de prueba de ancho de banda, no se publica) · `POST /destinations` · `PATCH/DELETE /destinations/:id` · `POST /stream/start\|stop` · `POST /record/start\|stop` · `POST /record/pause {paused}` · `POST /record/split` · `POST /replay/start\|stop\|save` · `POST /virtualcam/start\|stop` · `POST /screenshot {sourceUuid?}` |
| Vista previa | `GET /preview.mjpeg?scene=&source=&fps=` (MJPEG) · `GET /preview.jpg` |
| Chat y alertas | `PUT /chat/connections` · `POST /chat/send` · `POST /chat/delete` · `GET /chat/history` · `GET, POST y DELETE /chat/highlight` (mensaje destacado en pantalla) · `POST /alerts/test` · `POST /alerts/skip` · `GET /alerts/recent` · `GET, POST y DELETE /poll` · `POST /poll/end` · `POST /poll/resolve {winner}` (predicciones) (encuesta en el chat de todas las plataformas) · `GET /loyalty?q=&limit=` · `POST /loyalty/set {key, points}` · `POST /loyalty/reset` (puntos de fidelidad) · `GET, POST y DELETE /giveaway` · `POST /giveaway/close` · `POST /giveaway/draw` (sorteos) · `PUT /counters` · `POST /counters/:id/add {delta}` · `POST /counters/:id/set {value}` · `PUT /countdown` · `POST /countdown {action, seconds}` (contadores y cuenta atrás) · `GET, POST {url} y DELETE /songs` · `POST /songs/next`, `/songs/pause`, `/songs/volume`, `/songs/ended`, `/songs/duration` · `DELETE /songs/:id` (peticiones de canciones) · `POST /labels/reset {scope: session o all}` (etiquetas de texto) |
| Análisis | `GET /sessions` (informes, el más reciente primero; incluye el directo en curso) · `GET /sessions/:id` (muestras por minuto: espectadores por plataforma, chat, escena, kbps, pérdidas; eventos; resumen) · `DELETE /sessions/:id` · `POST /sessions/:id/insights` (análisis con IA, se guarda) |
| Chat inteligente | `POST /chat/translate {id?, text?, to?}` (`{text}`, `null` si ya está en ese idioma; con `id` se guarda y se emite `chat_translated`) · `POST /chat/summary` (`{text}`). Cada mensaje trae `viewer` (`firstTime`, `returning`, `messages`, `daysAway`) y `question`. |
| IA | `POST /tts/speak` · `GET /tts/audio/:id` · `POST /ai/cohost` · `POST /ai/test` (motor de texto: `anthropic`, `local`, `ollama`, `openai_compatible`) |
| Centro de IA | `GET /ai/hub` (motores, modelos, descargas, servidores en marcha) · `POST /ai/hub/install {runtime: llama|whisper|piper, backend?}` · `POST /ai/hub/uninstall {runtime}` · `POST /ai/hub/download {kind: llm|whisper|piper, repo, file}` · `POST /ai/hub/cancel {id}` · `POST /ai/hub/delete {kind, file}` · `POST /ai/hub/stop` · `GET /ai/hub/search?q=` (GGUF en Hugging Face) · `GET /ai/hub/files?repo=&ext=` · `GET /ai/hub/voices` (catálogo de Piper). Instalar, descargar y borrar solo desde este PC. |
| Cuentas | `POST /oauth/:platform/start\|cancel\|disconnect\|apply` · `GET\|POST /oauth/:platform/stream-info` (`{title, category?, categoryId?}`) · `GET /oauth/:platform/categories?q=` · `GET /oauth/callback` (redirección del navegador) |
| Varios | `GET /pairing` · `POST /update/check` · `POST /uploads?name=` (cuerpo binario → `{ path }`) · `POST /media/import {path}` (copia un archivo local a la carpeta de medios) · `POST /alerts/designs/export {path, ids?}` / `POST /alerts/designs/import {path}` (paquetes `.vxalert` del diseñador de alertas) · `POST /alerts/test {type, design?}` · `GET /files?path=` (sirve archivos de la carpeta de datos de Vexcast a los widgets) |

Fuera del prefijo:

| Ruta | Descripción |
|---|---|
| `/widgets/{alerts,chat,goal,events,captions,audio}.html?token=` (`audio.html?source=&style=bars|ring|glow|wave&color=&color2=&gain=`) | Overlays para fuentes de navegador (también sirven en OBS) |
| `POST /webhooks/kofi` | Webhook de Ko-fi (campo `data`, se valida con el token de verificación) |
| `/app/` | Interfaz web (modo servidor sin interfaz) |

## WebSocket `/api/v1/ws?token=…`

El servidor envía mensajes JSON (`ServerEvent`):

- `state`: `AppState` completo. Llega al conectar y tras cada cambio.
- `status`: `EngineStatus` (~1 Hz).
- `stats`: `Stats` (~1 Hz).
- `levels`: `AudioLevel[]` por canal (~20 Hz).
- `chat`, `chat_deleted`, `chat_highlight`, `poll`, `giveaway`, `songs`, `alert`, `alert_skip`, `tts`, `caption`, `notification`.

Los clientes no envían nada por el socket: los comandos van por REST.
