#!/usr/bin/env node
// Finish the macOS app that `tauri build --bundles app` produced: copy the OBS runtime into
// the bundle, sign it, and build the DMG plus the updater archive.
//
//   node scripts/package-macos.mjs --app <Vexcast.app> --runtime <dir> --out <dir> --version <x.y.z> [--arch aarch64]
//
// <dir> is the folder made by `node scripts/fetch-obs-runtime.mjs <dir>` on macOS.
// The app is signed ad-hoc (no Apple Developer ID / notarization yet), so on first launch
// macOS asks the user to allow it in System Settings → Privacy & Security. The updater
// archive is signed with the Tauri key when TAURI_SIGNING_PRIVATE_KEY is set.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

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

// 2. Sign ad-hoc. This replaces OBS's own signatures (another team ID, which the loader would
// reject next to our binary) and drops their hardened-runtime flag, so CEF can still JIT.
run("codesign", ["--force", "--deep", "--sign", "-", app]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);

// 3. DMG with the app and an /Applications shortcut.
const dmg = join(out, `Vexcast_${version}_${arch}.dmg`);
const stage = mkdtempSync(join(tmpdir(), "vexcast-dmg-"));
run("ditto", [app, join(stage, basename(app))]);
symlinkSync("/Applications", join(stage, "Applications"));
rmSync(dmg, { force: true });
run("hdiutil", ["create", "-volname", "Vexcast", "-srcfolder", stage, "-fs", "HFS+", "-format", "UDZO", "-ov", dmg]);
rmSync(stage, { recursive: true, force: true });

// 4. Updater archive (what the in-app updater downloads on macOS) and its signature.
const tarball = join(out, `Vexcast_${version}_${arch}.app.tar.gz`);
run("tar", ["-czf", tarball, "-C", resolve(app, ".."), basename(app)]);
if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
  run("pnpm", ["--filter", "@vexcast/desktop", "exec", "tauri", "signer", "sign", tarball]);
} else {
  console.warn("TAURI_SIGNING_PRIVATE_KEY is not set: the updater archive is not signed");
}
console.log(`macOS ${arch} packages ready in ${out}`);
