#!/usr/bin/env node
// Finish the macOS app that `tauri build --bundles app` produced: copy the OBS runtime into
// the bundle, sign it, and build the DMG plus the updater archive.
//
//   node scripts/package-macos.mjs --app <Vexcast.app> --runtime <dir> --out <dir> --version <x.y.z> [--arch aarch64]
//
// <dir> is the folder made by `node scripts/fetch-obs-runtime.mjs <dir>` on macOS.
//
// Signing:
//   APPLE_SIGNING_IDENTITY ("Developer ID Application: …", already in the keychain) → signed
//   with the hardened runtime and apps/desktop/src-tauri/entitlements.plist; plus
//   APPLE_ID, APPLE_PASSWORD (app-specific password) and APPLE_TEAM_ID → notarized and stapled.
//   Without them the app is signed ad-hoc, and on first launch macOS asks the user to allow
//   it in System Settings → Privacy & Security.
// The updater archive is signed with the Tauri key when TAURI_SIGNING_PRIVATE_KEY is set.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (def !== undefined) return def;
  console.error(`Missing --${name}`);
  process.exit(1);
};
const app = resolve(arg("app"));
const runtime = resolve(arg("runtime"));
const out = resolve(arg("out"));
const version = arg("version");
const arch = arg("arch", "aarch64");
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

if (!existsSync(join(app, "Contents", "MacOS"))) throw new Error(`Not an app bundle: ${app}`);
if (!existsSync(join(runtime, "libobs.framework"))) throw new Error(`No OBS runtime in ${runtime}`);
mkdirSync(out, { recursive: true });

// 1. OBS runtime → Contents/Frameworks and Contents/PlugIns.
const frameworks = join(app, "Contents", "Frameworks");
const plugins = join(app, "Contents", "PlugIns");
mkdirSync(frameworks, { recursive: true });
mkdirSync(plugins, { recursive: true });
for (const name of readdirSync(runtime)) {
  if (name === "PlugIns" || name.startsWith(".")) continue;
  rmSync(join(frameworks, name), { recursive: true, force: true });
  run("ditto", [join(runtime, name), join(frameworks, name)]);
}
for (const name of readdirSync(join(runtime, "PlugIns"))) {
  rmSync(join(plugins, name), { recursive: true, force: true });
  run("ditto", [join(runtime, "PlugIns", name), join(plugins, name)]);
}

// 2. Sign. This replaces OBS's own signatures (another team ID, which the loader would reject
// next to our binary). Ad-hoc: no hardened runtime, so CEF can JIT. Developer ID: hardened
// runtime with entitlements that allow the JIT and libraries signed by other teams.
const identity = process.env.APPLE_SIGNING_IDENTITY;
const notarize = identity && process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID;
const entitlements = join(root, "apps", "desktop", "src-tauri", "entitlements.plist");
if (identity) {
  run("codesign", ["--force", "--deep", "--options", "runtime", "--timestamp", "--entitlements", entitlements, "--sign", identity, app]);
} else {
  run("codesign", ["--force", "--deep", "--sign", "-", app]);
}
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
const notary = (file) => {
  run("xcrun", ["notarytool", "submit", file, "--apple-id", process.env.APPLE_ID, "--password", process.env.APPLE_PASSWORD, "--team-id", process.env.APPLE_TEAM_ID, "--wait"]);
};
if (notarize) {
  const zip = join(mkdtempSync(join(tmpdir(), "vexcast-notary-")), "Vexcast.zip");
  run("ditto", ["-c", "-k", "--keepParent", app, zip]);
  notary(zip);
  run("xcrun", ["stapler", "staple", app]);
} else if (identity) {
  console.warn("APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID not set: signed but not notarized");
}

// 3. DMG with the app and an /Applications shortcut.
const dmg = join(out, `Vexcast_${version}_${arch}.dmg`);
const stage = mkdtempSync(join(tmpdir(), "vexcast-dmg-"));
run("ditto", [app, join(stage, basename(app))]);
symlinkSync("/Applications", join(stage, "Applications"));
rmSync(dmg, { force: true });
run("hdiutil", ["create", "-volname", "Vexcast", "-srcfolder", stage, "-fs", "HFS+", "-format", "UDZO", "-ov", dmg]);
rmSync(stage, { recursive: true, force: true });
if (identity) run("codesign", ["--force", "--timestamp", "--sign", identity, dmg]);
if (notarize) {
  notary(dmg);
  run("xcrun", ["stapler", "staple", dmg]);
}

// 4. Updater archive (what the in-app updater downloads on macOS) and its signature.
const tarball = join(out, `Vexcast_${version}_${arch}.app.tar.gz`);
run("tar", ["-czf", tarball, "-C", resolve(app, ".."), basename(app)]);
if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
  run("pnpm", ["--filter", "@vexcast/desktop", "exec", "tauri", "signer", "sign", tarball]);
} else {
  console.warn("TAURI_SIGNING_PRIVATE_KEY is not set: the updater archive is not signed");
}
console.log(`macOS ${arch} packages ready in ${out}`);
