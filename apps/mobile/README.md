# Vexcast Remote (mobile)

Android + iOS remote control for the Vexcast desktop studio. The phone talks to
the Vexcast core API over your local network (REST + WebSocket, default port
`7420`) using the shared typed client from `@vexcast/protocol`.

Built with Expo (SDK 58), expo-router and TypeScript (strict). Spanish by
default (or the device language), English included.

## Features

- **Pairing**: scan the QR from the desktop app (*Settings → Remote control*),
  open a `vexcast://connect?host=<ip[,ip2…]>&port=<port>&token=<token>` link, or
  type host/port/token by hand. Every candidate host is probed with
  `GET /api/v1/health` and the first one that answers is used. Several PCs can
  be saved; the last one reconnects automatically on launch (tokens are kept in
  the OS keychain via expo-secure-store).
- **Dashboard**: live/offline status with uptime, Go live / End stream (with a
  confirmation sheet), record, save replay, per-destination status (bitrate,
  dropped frames), program preview (~2 fps, double-buffered so it never
  flickers), FPS / CPU / encoder / skipped frames.
- **Scenes**: big tiles, tap to switch; studio mode (preview + Transition).
- **Audio**: mute toggles, volume sliders and live level meters.
- **Chat**: unified chat with platform colors, badges and colored names; send
  messages; long-press to delete.
- **Alerts**: recent events, test buttons for every alert type, text-to-speech,
  skip current alert.
- **Settings**: saved PCs (switch / rename / forget), language, version, GitHub
  and Ko-fi links.
- **Update checker**: at most once a day the app checks the latest GitHub
  release and shows a banner if there is a newer version. If the desktop core's
  major/minor version differs from the app's, a compatibility notice is shown.
- A connection-lost banner is shown while the link is down. The app retries on
  its own, and re-probes the PC's other addresses in case its IP changed.

## Run it on your phone (Expo Go, free, Android and iOS)

```bash
pnpm install                          # at the repository root
pnpm --filter @vexcast/mobile start   # or: pnpm mobile
```

Scan the QR code printed in the terminal with **Expo Go** (Android) or the
Camera app (iOS). The phone and the computer running the dev server must be on
the same network. Then scan the Vexcast pairing QR from the desktop app.

No desktop core yet? Start the mock: `pnpm --filter @vexcast/mock-core start`
(token `mock-token-1234`) and connect manually to your computer's LAN IP, port
`7420`.

You can also try it in a browser with `pnpm --filter @vexcast/mobile web`. QR
scanning and haptics are limited there.

## Build an Android APK

### Locally (Android SDK + JDK 17 required)

```bash
cd apps/mobile
npx expo prebuild -p android
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

`android/` and `ios/` are generated (Continuous Native Generation) and
git-ignored. Change native settings in `app.config.ts`, never by hand. Note
that the default release build is signed with the debug keystore. Configure your
own signing for distribution.

### With EAS (cloud)

```bash
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview      # installable APK
npx eas-cli@latest build -p android --profile production   # Play Store AAB
```

Profiles live in `eas.json`: `development` (debug APK / iOS simulator build),
`preview` (internal APK) and `production`.

## iOS

- **Free testing**: use Expo Go as described above. Everything works except
  what Expo Go itself doesn't allow.
- **Installing a standalone build or publishing to the App Store** requires an
  Apple Developer account ($99/year):
  `npx eas-cli@latest build -p ios --profile production`, then
  `npx eas-cli@latest submit -p ios`. A local build needs macOS + Xcode:
  `npx expo prebuild -p ios && npx expo run:ios --configuration Release`.
- iOS asks for *Local Network* permission the first time the app reaches your
  PC. Allow it, or the app can't connect.

## Network notes

The core speaks plain HTTP on the LAN, so cleartext traffic is allowed:
Android `usesCleartextTraffic` (expo-build-properties), iOS
`NSAllowsLocalNetworking` + `NSLocalNetworkUsageDescription`.

## Development

```bash
pnpm --filter @vexcast/mobile typecheck                # tsc --noEmit
pnpm --filter @vexcast/mobile exec expo export --platform android   # bundle check
pnpm --filter @vexcast/mobile icons                    # re-render PNGs from assets/*.svg
```

- `metro.config.js` is set up for the pnpm monorepo: it watches the workspace
  root, resolves `node_modules` from the app and the root, and follows pnpm
  symlinks. `@vexcast/protocol` is consumed as TypeScript source.
- Routes are in `src/app` (expo-router), shared code is in `src/components`,
  `src/lib` and `src/state`.
- The icon source is `assets/icon.svg` (adaptive and splash variants next to
  it). `scripts/render-icons.mjs` renders the PNGs with `rsvg-convert`, or with
  headless Chromium via Playwright if `rsvg-convert` isn't installed.

License: GPL-3.0-or-later.
