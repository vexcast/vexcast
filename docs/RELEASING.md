# Releasing a version

Releases are built and published automatically by GitHub Actions (`.github/workflows/release.yml`).

## One-time setup: updater key

The built-in updater only installs packages **signed** with the project key. The public key is already in `apps/desktop/src-tauri/tauri.conf.json`. The private key is **not** committed to the repository:

1. GitHub → **Settings → Secrets and variables → Actions → New repository secret**.
2. Create `TAURI_SIGNING_PRIVATE_KEY` with the full contents of the private key file.
3. Create `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` with its password. If it has no password, leave it empty (or don't create it).

> ⚠️ Keep a copy of the private key somewhere safe (a password manager). If it's lost, existing installs won't be able to auto-update to versions signed with a different key.

To generate a new key:

```bash
pnpm --filter @vexcast/desktop tauri signer generate -w vexcast-updater.key
```

Then replace `plugins.updater.pubkey` in `tauri.conf.json` with the contents of `vexcast-updater.key.pub`.

## Optional: code signing

Add these repository secrets and the release signs the apps; without them it still builds everything.

| Secret | What |
|---|---|
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Code-signing certificate (`.pfx`, base64) for the Windows installer: no SmartScreen warning. |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | "Developer ID Application" certificate (`.p12`, base64) from an Apple Developer account. |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple ID, an app-specific password and the team ID, to notarize: macOS opens the app without asking. |

## Test the release first

**Actions → Release → Run workflow** (with "Dry run" checked) builds every package into a draft release called `dry-run-<run id>` that is never published. Check the files and `latest.json`, then delete that draft.

## Every release

Bump the version in all packages:

```bash
node scripts/bump-version.mjs 0.2.0
```

Commit:

```bash
git commit -am "Release v0.2.0"
```

Create the tag:

```bash
git tag v0.2.0
```

Push the commit and the tag:

```bash
git push && git push --tags
```

The workflow:
1. Creates a draft release.
2. Builds the installers for **Windows**, **macOS** (Apple Silicon and Intel) and **Linux** (AppImage and deb), all with the OBS engine except the deb (it uses the system OBS), signs the update packages and uploads `latest.json` with every platform.
3. Builds the **Android APK** of the remote control app and the **headless server** for each OS.
4. Publishes the release.

Installed apps check `https://github.com/vexcast/vexcast/releases/latest/download/latest.json` on startup and every 6 hours. The mobile app queries the releases API once a day.
