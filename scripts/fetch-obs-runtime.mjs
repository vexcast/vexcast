#!/usr/bin/env node
// Download the official OBS Studio runtime (libobs + plugins + browser source) that the
// Vexcast engine links against, and lay it out next to the executable.
//
//   node scripts/fetch-obs-runtime.mjs                 -> target/debug and target/release
//   node scripts/fetch-obs-runtime.mjs <dir> [<dir>…]  -> custom output folders
//
// Windows and macOS (Apple Silicon by default; VEXCAST_OBS_ARCH=intel for x64). Linux uses
// a system OBS install — see docs/DEVELOPMENT.md.
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cargo = readFileSync(join(root, "crates/vexcast-core/Cargo.toml"), "utf8");
const version = (cargo.match(/libobs-version\s*=\s*"([^"]+)"/) || [])[1] || "32.1.2";
const outs = process.argv.slice(2).length ? process.argv.slice(2).map((p) => resolve(p)) : [join(root, "target/debug"), join(root, "target/release")];

async function download(url, file, minSize) {
  if (existsSync(file) && statSync(file).size >= minSize) return;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

if (process.platform === "darwin") {
  // Layout (flat, like the Windows one) expected by crates/vexcast-core/src/obs/runtime.rs and
  // scripts/package-macos.mjs:
  //   <dir>/libobs.framework, *.dylib, Chromium Embedded Framework.framework, OBS Helper*.app …
  //   <dir>/PlugIns/<module>.plugin
  // A binary in <dir> finds libobs through its @executable_path rpath, and the plugins through
  // <dir>/PlugIns. Inside Vexcast.app they go to Contents/Frameworks and Contents/PlugIns.
  const flavor = process.env.VEXCAST_OBS_ARCH === "intel" ? "Intel" : "Apple";
  const cache = join(process.env.HOME || root, "Library", "Caches", "vexcast-obs-build", version);
  mkdirSync(cache, { recursive: true });
  const dmg = join(cache, `OBS-Studio-${version}-macOS-${flavor}.dmg`);
  await download(`https://github.com/obsproject/obs-studio/releases/download/${version}/OBS-Studio-${version}-macOS-${flavor}.dmg`, dmg, 100_000_000);

  // The OBS frontend's own plugins (they need its Qt UI) and the script runtimes stay out.
  const skipFrameworks = new Set(["Sparkle.framework", "obs-scripting.dylib"]);
  const skipPlugins = new Set([
    "frontend-tools.plugin", "obs-websocket.plugin", "decklink-captions.plugin", "decklink-output-ui.plugin", "aja-output-ui.plugin",
    "_obspython.so", "obslua.so", "iconengines", "imageformats", "platforms", "styles",
  ]);

  const mnt = mkdtempSync(join(tmpdir(), "obs-dmg-"));
  execFileSync("hdiutil", ["attach", dmg, "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mnt], { stdio: "inherit" });
  try {
    const contents = join(mnt, "OBS.app", "Contents");
    for (const out of outs) {
      mkdirSync(join(out, "PlugIns"), { recursive: true });
      for (const name of readdirSync(join(contents, "Frameworks"))) {
        if (skipFrameworks.has(name)) continue;
        rmSync(join(out, name), { recursive: true, force: true });
        execFileSync("ditto", [join(contents, "Frameworks", name), join(out, name)]);
      }
      for (const name of readdirSync(join(contents, "PlugIns"))) {
        if (skipPlugins.has(name)) continue;
        rmSync(join(out, "PlugIns", name), { recursive: true, force: true });
        execFileSync("ditto", [join(contents, "PlugIns", name), join(out, "PlugIns", name)]);
      }
      console.log(`OBS ${version} runtime (macOS ${flavor}) ready in ${out}`);
    }
  } finally {
    execFileSync("hdiutil", ["detach", mnt, "-quiet"], { stdio: "inherit" });
  }
  process.exit(0);
}

if (process.platform !== "win32") {
  console.error("This script supports Windows and macOS. On Linux install OBS " + version + " (libobs) from your distro/PPA; see docs/DEVELOPMENT.md.");
  process.exit(1);
}

const cache = join(process.env.LOCALAPPDATA || root, "vexcast-obs-build", version);
mkdirSync(cache, { recursive: true });
const zip = join(cache, `OBS-Studio-${version}-Windows-x64.zip`);
if (!existsSync(zip) || statSync(zip).size < 50_000_000) {
  const url = `https://github.com/obsproject/obs-studio/releases/download/${version}/OBS-Studio-${version}-Windows-x64.zip`;
  console.log(`Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
}

const extracted = join(cache, "extracted");
if (!existsSync(join(extracted, "bin", "64bit", "obs.dll"))) {
  rmSync(extracted, { recursive: true, force: true });
  mkdirSync(extracted, { recursive: true });
  console.log("Extracting…");
  // Windows' bsdtar reads zip files (Expand-Archive breaks on some runner images).
  const tar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  execFileSync(tar, ["-xf", zip, "-C", extracted], { stdio: "inherit" });
}

// Layout expected by crates/vexcast-core/src/obs/runtime.rs:
//   <exe dir>/obs.dll …            (bin/64bit, without the OBS frontend executable)
//   <exe dir>/obs-plugins/64bit/…
//   <exe dir>/data/libobs, data/obs-plugins/…
for (const out of outs) {
  mkdirSync(out, { recursive: true });
  const rc = (src, dst, extra = []) =>
    execFileSync("robocopy", [src, dst, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/XF", "*.pdb", ...extra], { stdio: "ignore" });
  const run = (f) => {
    try {
      f();
    } catch (e) {
      // robocopy exit codes 0-7 mean success.
      if (typeof e.status !== "number" || e.status >= 8) throw e;
    }
  };
  run(() => rc(join(extracted, "bin", "64bit"), out, ["obs64.exe", "obs-amf-test.exe", "obs-qsv-test.exe"]));
  run(() => rc(join(extracted, "obs-plugins", "64bit"), join(out, "obs-plugins", "64bit"), ["frontend-tools.dll", "obs-websocket.dll", "decklink-captions.dll", "decklink-output-ui.dll", "aja-output-ui.dll"]));
  run(() => rc(join(extracted, "data", "libobs"), join(out, "data", "libobs")));
  run(() => rc(join(extracted, "data", "obs-plugins"), join(out, "data", "obs-plugins"), [], ));
  console.log(`OBS ${version} runtime ready in ${out}`);
}
