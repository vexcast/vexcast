import { DEFAULT_PORT, VexcastClient } from "@vexcast/protocol";
import { getCoreInfo, isTauri } from "./tauri";

/**
 * Work out where the Vexcast core lives:
 *  - Tauri: ask the shell (`get_core_info`).
 *  - Served by the core under /app/: same origin.
 *  - Otherwise (vite dev / preview): ?core=..., default http://127.0.0.1:7420.
 */
export async function resolveCore(): Promise<{ baseUrl: string; token?: string }> {
  const params = new URLSearchParams(location.search);
  if (isTauri()) {
    const info = await getCoreInfo();
    return { baseUrl: `http://127.0.0.1:${info.port}`, token: info.token };
  }
  const token = params.get("token") ?? undefined;
  const explicit = params.get("core");
  if (explicit) return { baseUrl: explicit, token };
  if (location.pathname.startsWith("/app")) return { baseUrl: location.origin, token };
  return { baseUrl: `http://127.0.0.1:${DEFAULT_PORT}`, token };
}

export async function createClient(): Promise<VexcastClient> {
  const { baseUrl, token } = await resolveCore();
  return new VexcastClient({ baseUrl, token });
}
