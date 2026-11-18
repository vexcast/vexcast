// Metro configuration for the pnpm monorepo.
//
// - watchFolders: the whole workspace, so `@vexcast/protocol` (TypeScript
//   source in packages/protocol) is bundled and hot-reloaded.
// - nodeModulesPaths: resolve from the app first, then from the workspace root.
// - symlinks: pnpm links workspace packages and dependencies with symlinks.
//   Metro follows them by default (resolver.unstable_enableSymlinks), so it is
//   intentionally not overridden here.
// - blockList: never crawl Rust/Tauri build output or native project folders.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(new Set([workspaceRoot, ...(config.watchFolders ?? [])]));
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

const escape = (p) => p.replace(/[/\\]/g, "[/\\\\]").replace(/\./g, "\\.");
const extraBlock = [
  new RegExp(`^${escape(path.join(workspaceRoot, "target"))}[/\\\\].*`),
  new RegExp(`^${escape(path.join(workspaceRoot, "crates"))}[/\\\\].*[/\\\\]target[/\\\\].*`),
  new RegExp(`^${escape(path.join(workspaceRoot, "apps", "desktop", "src-tauri"))}[/\\\\].*`),
  new RegExp(`^${escape(path.join(projectRoot, "android"))}[/\\\\].*`),
  new RegExp(`^${escape(path.join(projectRoot, "ios"))}[/\\\\].*`),
  new RegExp(`^${escape(path.join(workspaceRoot, ".git"))}[/\\\\].*`),
];
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...extraBlock];

module.exports = config;
