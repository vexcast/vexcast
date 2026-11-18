import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;
// Canonical on-disk path (Windows drive-letter casing can differ between the
// shell cwd and import.meta.url; mixing both would load modules twice).
const here = realpathSync.native(path.dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  // Relative base so the build works under the core's /app/ route and inside Tauri.
  root: here,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.join(here, "src") } },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
