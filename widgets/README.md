# Vexcast widgets

Overlay pages for live streams. Each widget is a standalone HTML page with a
transparent background, served by the Vexcast core at
`http://<host>:7420/widgets/<name>.html?token=<token>` and added as a
**browser source** in Vexcast (or OBS / any app with a browser source).

- Plain HTML + CSS + vanilla JS. No build step, no external CDNs, no web
  fonts: everything works offline. The core embeds this folder into its binary.
- Widgets connect to `ws(s)://<host>/api/v1/ws?token=…`, read the `state`
  event (full `AppState`, including `widgets` settings) and react to live
  events. Settings changes in Vexcast apply immediately, no reload needed.
- They reconnect automatically with exponential backoff (0.5 s up to 15 s).
- Designed for 1920×1080 sources and also smaller sizes (alerts, goal and
  captions scale with the source size; chat and events use `fontSize`).
- They need no hover or other interaction, so they render fine in a headless
  browser.
- `index.html` is a gallery with live demos of every widget.

Screenshots: `docs/screenshots/widget-*.png`.

## Common query parameters

| Parameter | Default | Description |
|---|---|---|
| `token` | – | API token (Settings → Remote control). Not needed from `127.0.0.1` unless `VEXCAST_REQUIRE_TOKEN=1`. |
| `core` | same origin | Core base URL when the page is served from elsewhere, e.g. `http://192.168.1.20:7420`. |
| `demo=1` | off | Generates fake state and events locally (alerts, chat, goal progress, captions). No core needed. Good for previews and for testing a layout. |
| `audio=1` | off | Plays alert sounds, TTS audio and speech **in the widget itself**. See [Audio](#audio). |
| `lang=es\|en` | Vexcast language | Language of the default texts. Spanish is the default. |
| `<setting>=<value>` | – | Overrides any simple (non-object) setting of the widget's section, e.g. `theme=solid`, `fontSize=28`, `durationMs=9000`, `accentColor=%23ff3d7f`. Numbers and booleans are converted. |

### Audio

The Vexcast core mixes alert sounds and TTS straight into the stream's audio
(headless browser sources inside Vexcast do not capture audio). So widgets are
**silent by default**: they show visuals only. Add `audio=1` when you use a
widget in OBS or another app that captures browser audio. Then the alert box
plays `soundUrl`, then the alert's `ttsUrl` (or, as a fallback, browser
`speechSynthesis`), plus generic `tts` events. `demo=1` is silent too unless
you add `audio=1`.

## Widgets

### Alerts: `alerts.html`

Shows `alert` events one at a time from a queue.

- Each alert shows an animated emblem for its type (glow, rotating rays,
  pulsing rings, confetti burst), a label pill with the platform icon, a big
  title built from a template, and the donor's message.
- An alert stays on screen for `durationMs`. If its audio runs longer, it
  stays up to 30 s more, until the audio ends.
- Duplicate ids are ignored (for example, after a reconnect).
- `notification` and any unknown event types are ignored.
- `alert_skip` / `alerts_skip` events, if the core sends them, close the
  current alert and stop its audio.

Settings (`widgets.alertBox`):

| Key | Description |
|---|---|
| `enabled` | When `false`, alerts are dropped and the queue is cleared. |
| `durationMs` | How long each alert stays on screen (min. 2500 ms). |
| `templates` | Title template per alert type. Placeholders: `{user}`, `{amount}`, `{currency}`, `{message}`. For money types, `{amount}` is the formatted amount with its currency symbol (e.g. `5 €`), unless the template also contains `{currency}`; then it is the plain number. |
| `animation` | `pop` · `slide` · `fade` · `bounce`. |
| `accentColor` | Hex colour for the emblem, glow and username. |
| `soundUrl`, `soundVolume` | Sound played when an alert starts (`audio=1` only). Relative URLs go to the core with the token added. Volume is 0..1, or 0..100. |
| `ttsEnabled`, `ttsMinAmount` | With `audio=1`, an alert's `ttsUrl` is played after the sound. If the alert has no `ttsUrl` but has a message and `ttsEnabled` is on, the message is read with `speechSynthesis`. For donations, superchats, Ko-fi and bits, it is only read when `amount >= ttsMinAmount` (0 = always). |

Default titles (Spanish):

| Type | Title |
|---|---|
| `donation` | «¡{user} donó {amount}!» |
| `follow` | «¡{user} te sigue!» |
| `subscription` | «¡{user} se ha suscrito!» (months appear in the label) |
| `gift_sub` | «¡{user} regaló {amount} suscripciones!» |
| `raid` | «¡Raid de {user} con {amount} espectadores!» |
| `bits` | «¡{user} envió {amount} bits!» |
| `superchat` | «¡Superchat de {user}: {amount}!» |
| `kofi` | «¡{user} invitó {amount} en Ko-fi!» |
| `member` | «¡{user} ahora es miembro!» |
| `host` | «¡{user} te está hosteando!» |

Generic `tts` events (`{id, url, text}`) are queued and played in order with
`audio=1`.

### Chat: `chat.html`

A unified chat for Twitch, YouTube, Kick, TikTok and Vexcast.

- Newest messages appear at the bottom with a smooth slide and height
  animation. Older ones fade out at the top edge.
- Each message shows the platform icon, its badges (broadcaster, moderator,
  VIP, subscriber, founder, member, verified, bot, and a letter for anything
  else) and the user's name colour. Users with no colour get a stable one
  based on their name.
- Messages marked `flagged` are never shown.
- `chat_deleted` removes the message with an animation.
- Bot messages get a bot badge.

Settings (`widgets.chatBox`):

| Key | Description |
|---|---|
| `theme` | `glass` (translucent blurred cards), `solid` (opaque cards with a colour bar), `minimal` (inline outlined text, no background). |
| `maxMessages` | Maximum messages kept on screen. |
| `fadeAfterSec` | Hide messages after N seconds (0 = never). |
| `fontSize` | Base font size in px. |
| `showPlatformIcons`, `showBadges` | Toggle icons and badges. |

### Donation goal: `goal.html`

A progress bar from `widgets.goal`, updated on every `state` event.

- Shows the title, the current and target amounts in the goal's currency,
  and the percentage.
- The amounts count up, and the bar fills with moving stripes and a shimmer
  sweep.
- When `current >= target`, the bar turns gold, a «¡Meta alcanzada!» badge
  pops in and confetti bursts.

| Setting / param | Description |
|---|---|
| `title`, `current`, `target`, `currency` | From `widgets.goal`. `autoTrack` is applied by the core. |
| `?position=top\|center\|bottom` | Vertical position in the source (default `center`). |
| `?color=%23RRGGBB` | Bar colour (default: the alert box `accentColor`). |

### Recent events: `events.html`

The last alerts received since the page loaded (the core keeps no history
for widgets). Each event shows a colour chip for its type, the platform, the
user, a short description and how long ago it happened.

| Param | Default | Description |
|---|---|---|
| `layout` | `list` | `list` (vertical, newest on top) or `ticker` (horizontal scrolling band). |
| `max` | `10` | Number of events kept (1–50). |
| `types` | all | Comma-separated filter, e.g. `donation,kofi,superchat`. |
| `title` | `1` | `0` hides the header. |
| `titleText` | «Eventos recientes» | Custom header or ticker label. |
| `fontSize` | `18` | Base font size in px. |
| `speed` | `90` | Ticker speed in px/s. |

### Live captions: `captions.html`

Shows `caption` events.

- The current utterance updates word by word. Words that are not final yet
  appear lighter, with a blinking caret.
- When a caption has a `translated` line, it appears below in the accent
  colour.
- The previous final line stays above in small text.
- The box hides after a few seconds of silence.

| Setting / param | Description |
|---|---|
| `enabled`, `fontSize` | From `widgets.captions`. `translateTo` is applied by the core. |
| `?hideAfter=4` | Seconds of silence before hiding. |
| `?position=bottom\|top\|center` | Position (default `bottom`). |
| `?theme=outline` | No background box, outlined text only. |
| `?color=%23RRGGBB` | Colour of the translation line and caret. |

## Runtime API (`shared/widget.js`)

```js
Vexcast.on("alert", (ev) => { /* ... */ });   // any ServerEvent type, plus "connection" and "*"
Vexcast.state;                                // latest AppState (null until received)
Vexcast.settings("chatBox");                  // defaults, then live settings, then query overrides
Vexcast.url("/api/v1/tts/audio/abc");         // core URL with ?token= added
Vexcast.isDemo; Vexcast.audioEnabled; Vexcast.connected;
Vexcast.escapeHtml(s); Vexcast.formatMoney(5, "EUR"); Vexcast.formatNumber(1234);
Vexcast.icon("twitch");                       // inline SVG platform mark
Vexcast.glyph("donation");                    // inline SVG alert-type glyph
Vexcast.t("tpl.donation");                    // localized default strings (es / en)
```

`shared/widget.css` has the system font stack, colour variables, text-outline
shadows and the transparent `html, body` background.

The platform marks are simplified original glyphs, not official logos.

## Developing

Serve the folder and open a widget in demo mode:

```sh
cd widgets && python3 -m http.server 8080
# http://localhost:8080/index.html
# http://localhost:8080/alerts.html?demo=1&animation=bounce
```

To check transparency, put the page over a checkerboard. Almost every
animation uses CSS `transform` and `opacity`, so it stays smooth at 60 fps.
The two exceptions are the goal bar's width and the chat's row height, and
both are small.
