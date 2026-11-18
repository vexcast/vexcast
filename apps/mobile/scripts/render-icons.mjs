#!/usr/bin/env node
// Renders the SVG sources in assets/ to the PNGs referenced by app.config.ts.
// Uses `rsvg-convert` when available, otherwise a headless Chromium via Playwright.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets");
const jobs = [
  ["icon.svg", "icon.png", 1024],
  ["adaptive-icon.svg", "adaptive-icon.png", 1024],
  ["adaptive-icon-monochrome.svg", "adaptive-icon-monochrome.png", 1024],
  ["splash-icon.svg", "splash-icon.png", 1024],
  ["icon.svg", "favicon.png", 48],
];

function hasRsvg() {
  try {
    execFileSync("rsvg-convert", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (hasRsvg()) {
  for (const [src, out, size] of jobs) {
    execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), path.join(assets, src), "-o", path.join(assets, out)]);
    console.log("rendered", out);
  }
} else {
  const require = createRequire(import.meta.url);
  let playwright;
  try {
    playwright = require("playwright");
  } catch {
    console.error("Neither rsvg-convert nor playwright is available.");
    process.exit(1);
  }
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage();
  for (const [src, out, size] of jobs) {
    const svg = readFileSync(path.join(assets, src), "utf8");
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><img style="display:block;width:${size}px;height:${size}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"></body></html>`,
    );
    await page.waitForLoadState("load");
    await page.screenshot({ path: path.join(assets, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log("rendered", out);
  }
  await browser.close();
}
