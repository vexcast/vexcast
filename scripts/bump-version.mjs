#!/usr/bin/env node
// Bump the Vexcast version everywhere: node scripts/bump-version.mjs 0.2.0
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? "")) {
  console.error("Usage: node scripts/bump-version.mjs X.Y.Z");
  process.exit(1);
}

const edit = (file, fn) => {
  const before = readFileSync(file, "utf8");
  const after = fn(before);
  if (before === after) console.warn(`(unchanged) ${file}`);
  writeFileSync(file, after);
  console.log(`✔ ${file}`);
};

edit("Cargo.toml", (s) => s.replace(/(\[workspace\.package\][^[]*?version\s*=\s*")[^"]+(")/, `$1${version}$2`));
for (const f of ["apps/desktop/package.json", "apps/mobile/package.json", "packages/protocol/package.json"]) {
  edit(f, (s) => s.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`));
}
const tauriCargo = "apps/desktop/src-tauri/Cargo.toml";
edit(tauriCargo, (s) => (s.includes("version.workspace") ? s : s.replace(/^(version\s*=\s*")[^"]+(")/m, `$1${version}$2`)));

console.log(`\nVersion ${version}. Next:\n  cargo check -p vexcast-core\n  git commit -am "Release v${version}"\n  git tag v${version} && git push && git push --tags`);
