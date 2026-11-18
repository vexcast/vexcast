import { API_PREFIX, DEFAULT_PORT } from "@vexcast/protocol";

export interface ConnectTarget {
  hosts: string[];
  port: number;
  token: string;
  /** Computer name from the QR (`&name=`), if any. */
  name?: string;
}

function splitHosts(raw: string): string[] {
  return raw
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => h.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""));
}

/**
 * Parses `vexcast://connect?host=<ip[,ip2]>&port=<port>&token=<token>`.
 * Also accepts http(s) URLs with the same query and bare query strings.
 */
export function parseConnectPayload(payload: string): ConnectTarget | null {
  const text = payload.trim();
  const q = text.indexOf("?");
  if (q < 0) return null;
  const isVexcast = /^vexcast:\/\/+connect/i.test(text) || /^vexcast:connect/i.test(text);
  const isHttp = /^https?:\/\//i.test(text);
  if (!isVexcast && !isHttp && !text.startsWith("?")) return null;
  const params = new Map<string, string>();
  for (const part of text.slice(q + 1).split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    try {
      params.set(decodeURIComponent(part.slice(0, eq)), decodeURIComponent(part.slice(eq + 1).replace(/\+/g, " ")));
    } catch {
      /* malformed component */
    }
  }
  return fromParams({ host: params.get("host"), port: params.get("port"), token: params.get("token"), name: params.get("name") });
}

export function fromParams(p: {
  host?: string | string[];
  port?: string | string[];
  token?: string | string[];
  name?: string | string[];
}): ConnectTarget | null {
  const first = (v?: string | string[]) => (Array.isArray(v) ? v.join(",") : v);
  const host = first(p.host);
  if (!host) return null;
  const hosts = splitHosts(host);
  if (hosts.length === 0) return null;
  const portNum = Number(first(p.port) ?? DEFAULT_PORT);
  const port = Number.isInteger(portNum) && portNum > 0 && portNum < 65536 ? portNum : DEFAULT_PORT;
  const name = (Array.isArray(p.name) ? p.name[0] : p.name)?.trim();
  return { hosts, port, token: (first(p.token) ?? "").trim(), ...(name ? { name } : {}) };
}

export function baseUrlFor(host: string, port: number): string {
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host; // IPv6 literal
  return `http://${h}:${port}`;
}

export interface HealthResult {
  host: string;
  baseUrl: string;
  version: string;
  /** Computer name reported by the core ("" on older cores). */
  name: string;
  /** Core clock at the time of the probe (null on older cores). */
  serverTime: number | null;
}

async function healthOnce(host: string, port: number, timeoutMs: number): Promise<HealthResult> {
  const baseUrl = baseUrlFor(host, port);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${API_PREFIX}/health`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { ok?: boolean; version?: string; app?: string; name?: string; serverTime?: number };
    if (body.app && body.app !== "vexcast") throw new Error("not a Vexcast core");
    return {
      host,
      baseUrl,
      version: body.version ?? "",
      name: typeof body.name === "string" ? body.name : "",
      serverTime: typeof body.serverTime === "number" ? body.serverTime : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes every candidate host in parallel with `GET /api/v1/health` and
 * resolves with the first one that answers, preferring earlier entries
 * if several answer at about the same time.
 */
export function probeHosts(hosts: string[], port: number, timeoutMs = 3000): Promise<HealthResult> {
  return new Promise((resolve, reject) => {
    if (hosts.length === 0) return reject(new Error("no hosts"));
    let pending = hosts.length;
    let done = false;
    hosts.forEach((host, i) => {
      // Small stagger so earlier (preferred) addresses win ties.
      setTimeout(() => {
        healthOnce(host, port, timeoutMs).then(
          (r) => {
            if (!done) {
              done = true;
              resolve(r);
            }
          },
          () => {
            pending -= 1;
            if (pending === 0 && !done) reject(new Error("unreachable"));
          },
        );
      }, i * 60);
    });
  });
}
