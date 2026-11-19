import {
  ApiError,
  VexcastClient,
  type AlertEvent,
  type AppState,
  type ChatMessage,
  type ServerEvent,
  type Stats,
} from "@vexcast/protocol";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState as RNAppState } from "react-native";

import { useI18n } from "@/lib/i18n";
import { probeHosts, type ConnectTarget } from "@/lib/pairing";
import {
  forgetAllConnections,
  forgetConnection,
  getLastConnectionId,
  getToken,
  listConnections,
  saveConnection,
  setLastConnectionId,
  type SavedConnection,
} from "@/lib/storage";
import { levelsStore } from "./levels";
import { useToast } from "./toasts";

/**
 * idle       – no PC selected (show the connect screen)
 * restoring  – reconnecting to the last PC on launch
 * connecting – user-initiated connection in progress
 * connected  – REST works and the WebSocket is open
 * lost       – we were connected, the WebSocket dropped; retrying
 */
export type Phase = "idle" | "restoring" | "connecting" | "connected" | "lost";

export interface Session {
  conn: SavedConnection;
  client: VexcastClient;
  baseUrl: string;
  host: string;
  coreVersion: string;
}

const MAX_CHAT = 500;
const MAX_ALERTS = 60;

interface RemoteValue {
  phase: Phase;
  session: Session | null;
  state: AppState | null;
  /** Render/encode/output stats (WS `stats`, ~1 Hz). */
  stats: Stats | null;
  chat: ChatMessage[];
  /** Id of the chat message shown on stream (highlight widget). */
  highlightId: string | null;
  alerts: AlertEvent[];
  error: string | null;
  saved: SavedConnection[];
  connect: (target: ConnectTarget) => Promise<boolean>;
  connectSaved: (conn: SavedConnection) => Promise<boolean>;
  disconnect: () => void;
  forget: (id: string) => Promise<void>;
  /** Disconnects and deletes every saved PC and token. */
  logout: () => Promise<void>;
  refreshSaved: () => Promise<void>;
  clearError: () => void;
  /** Re-fetches the full state over REST. */
  refresh: () => Promise<void>;
  /** Current time on the core's clock (unix ms), immune to phone/PC clock skew. */
  serverNow: () => number;
  /** Runs an API call; shows an error toast on failure. Resolves to undefined on error. */
  run: <T>(fn: (c: VexcastClient) => Promise<T>, success?: string) => Promise<T | undefined>;
}

const RemoteContext = createContext<RemoteValue | null>(null);

function sameHosts(a: string[], b: string[]) {
  return a.length === b.length && a.every((h, i) => h === b[i]);
}

export function RemoteProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("restoring");
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedConnection[]>([]);
  const sessionRef = useRef<Session | null>(null);
  const unsubRef = useRef<(() => void)[]>([]);
  const attemptRef = useRef(0);
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const refreshSaved = useCallback(async () => {
    setSaved(await listConnections());
  }, []);

  const teardown = useCallback(() => {
    unsubRef.current.forEach((f) => f());
    unsubRef.current = [];
    sessionRef.current?.client.close();
    sessionRef.current = null;
    levelsStore.clear();
  }, []);

  /** serverTime - Date.now() from the last status (0 until known). */
  const clockOffset = useRef(0);
  const syncClock = useCallback((serverTime: unknown) => {
    if (typeof serverTime === "number" && serverTime > 0) clockOffset.current = serverTime - Date.now();
  }, []);
  const serverNow = useCallback(() => Date.now() + clockOffset.current, []);

  const handleEvent = useCallback((ev: ServerEvent) => {
    switch (ev.type) {
      case "state":
        syncClock(ev.data.status?.serverTime);
        setState(ev.data);
        break;
      case "status":
        syncClock(ev.data.serverTime);
        setState((s) => (s ? { ...s, status: ev.data } : s));
        break;
      case "stats":
        setStats(ev.data);
        break;
      case "levels":
        levelsStore.set(ev.data);
        break;
      case "chat":
        // A message with a known id replaces it (e.g. edited / re-flagged by moderation).
        setChat((c) =>
          c.some((m) => m.id === ev.data.id)
            ? c.map((m) => (m.id === ev.data.id ? ev.data : m))
            : [...c.slice(-(MAX_CHAT - 1)), ev.data],
        );
        break;
      case "chat_deleted":
        setChat((c) => c.filter((m) => m.id !== ev.data.id));
        break;
      case "chat_highlight":
        setHighlightId(ev.data?.message.id ?? null);
        break;
      case "alert":
        setAlerts((a) => [ev.data, ...a.filter((x) => x.id !== ev.data.id)].slice(0, MAX_ALERTS));
        break;
      case "notification":
        toastRef.current.show(ev.data.message, ev.data.level);
        break;
      default:
        break;
    }
  }, [syncClock]);

  /**
   * Prefills chat and alerts from the core's history. Live WebSocket events
   * that already arrived win over history entries with the same id.
   * Older cores without these endpoints are ignored silently.
   */
  const loadHistory = useCallback((s: Session) => {
    s.client
      .chatHighlight()
      .then((h) => sessionRef.current === s && setHighlightId(h?.message.id ?? null))
      .catch(() => {});
    s.client
      .chatHistory()
      .then((history) => {
        if (sessionRef.current !== s || !Array.isArray(history)) return;
        setChat((live) => {
          const liveIds = new Set(live.map((m) => m.id));
          const merged = [...history.filter((m) => !liveIds.has(m.id)), ...live];
          merged.sort((a, b) => a.ts - b.ts);
          return merged.slice(-MAX_CHAT);
        });
      })
      .catch(() => {});
    s.client
      .recentAlerts()
      .then((recent) => {
        if (sessionRef.current !== s || !Array.isArray(recent)) return;
        setAlerts((live) => {
          const liveIds = new Set(live.map((a) => a.id));
          const merged = [...live, ...recent.filter((a) => !liveIds.has(a.id))];
          merged.sort((a, b) => b.ts - a.ts);
          return merged.slice(0, MAX_ALERTS);
        });
      })
      .catch(() => {});
  }, []);

  /** Wires a fresh client into the app. */
  const attach = useCallback(
    (s: Session, initial: AppState) => {
      teardown();
      sessionRef.current = s;
      syncClock(initial.status?.serverTime);
      setSession(s);
      setState(initial);
      setStats(null);
      setChat([]);
      setAlerts([]);
      setError(null);
      setPhase("connected");
      unsubRef.current.push(s.client.subscribe(handleEvent));
      unsubRef.current.push(
        s.client.onConnectionChange((up) => {
          if (sessionRef.current !== s) return;
          setPhase(up ? "connected" : "lost");
          // (Re)connected: catch up on anything missed while offline.
          if (up) {
            loadHistory(s);
            s.client
              .getStats()
              .then((st) => {
                if (sessionRef.current === s) setStats((cur) => cur ?? st);
              })
              .catch(() => {});
          }
        }),
      );
    },
    [handleEvent, teardown, syncClock, loadHistory],
  );

  /** Probes the hosts, validates the token, saves the PC and attaches. */
  const open = useCallback(
    async (target: ConnectTarget, name?: string): Promise<boolean> => {
      const attempt = ++attemptRef.current;
      const tr = tRef.current;
      let health;
      try {
        health = await probeHosts(target.hosts, target.port);
      } catch {
        if (attempt === attemptRef.current) setError(tr("connect.errUnreachable", { hosts: target.hosts.join(", ") }));
        return false;
      }
      const client = new VexcastClient({ baseUrl: health.baseUrl, token: target.token || undefined, WebSocketImpl: WebSocket });
      let initial: AppState;
      try {
        initial = await client.getState();
      } catch (e) {
        if (attempt === attemptRef.current) {
          setError(
            e instanceof ApiError && e.status === 401
              ? tr("connect.errToken")
              : e instanceof ApiError && e.status === 403
                ? tr("connect.errRefused", { reason: e.message })
                : tr("connect.errUnreachable", { hosts: health.host }),
          );
        }
        return false;
      }
      if (attempt !== attemptRef.current) {
        client.close();
        return false;
      }
      const conn = await saveConnection({
        hosts: target.hosts,
        port: target.port,
        token: target.token,
        lastHost: health.host,
        coreVersion: health.version || initial.version || null,
        name,
        defaultName: target.name || health.name || undefined,
      });
      attach({ conn, client, baseUrl: health.baseUrl, host: health.host, coreVersion: health.version || initial.version }, initial);
      void refreshSaved();
      return true;
    },
    [attach, refreshSaved],
  );

  const connect = useCallback(
    async (target: ConnectTarget) => {
      setError(null);
      setPhase((p) => (p === "connected" || p === "lost" ? p : "connecting"));
      const ok = await open(target);
      if (!ok) setPhase(sessionRef.current ? (sessionRef.current.client.connected ? "connected" : "lost") : "idle");
      return ok;
    },
    [open],
  );

  const connectSaved = useCallback(
    async (conn: SavedConnection) => {
      const token = (await getToken(conn.id)) ?? "";
      const hosts = conn.lastHost ? [conn.lastHost, ...conn.hosts.filter((h) => h !== conn.lastHost)] : conn.hosts;
      setError(null);
      setPhase((p) => (p === "restoring" ? p : p === "connected" || p === "lost" ? p : "connecting"));
      const ok = await open({ hosts, port: conn.port, token }, conn.name);
      if (!ok) setPhase(sessionRef.current ? (sessionRef.current.client.connected ? "connected" : "lost") : "idle");
      return ok;
    },
    [open],
  );

  const disconnect = useCallback(() => {
    attemptRef.current++;
    teardown();
    setSession(null);
    setState(null);
    setStats(null);
    setChat([]);
    setAlerts([]);
    setPhase("idle");
    void setLastConnectionId(null);
  }, [teardown]);

  const forget = useCallback(
    async (id: string) => {
      if (sessionRef.current?.conn.id === id) disconnect();
      await forgetConnection(id);
      await refreshSaved();
    },
    [disconnect, refreshSaved],
  );

  const logout = useCallback(async () => {
    disconnect();
    await forgetAllConnections();
    await refreshSaved();
  }, [disconnect, refreshSaved]);

  // Restore the last PC on launch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await listConnections();
      if (cancelled) return;
      setSaved(list);
      const lastId = await getLastConnectionId();
      const last = list.find((c) => c.id === lastId);
      if (!last) {
        setPhase("idle");
        return;
      }
      await connectSaved(last);
    })();
    return () => {
      cancelled = true;
    };
  }, [connectSaved]);

  // While the connection is lost, the client retries the same address every
  // 1.5 s. The PC may also have changed IP (DHCP), so every few seconds we
  // re-probe all of its known addresses and switch if another one answers.
  useEffect(() => {
    if (phase !== "lost" || !session) return;
    const timer = setInterval(async () => {
      const s = sessionRef.current;
      if (!s || s.client.connected) return;
      const others = s.conn.hosts.filter((h) => h !== s.host);
      if (others.length === 0) return;
      try {
        const h = await probeHosts(others, s.conn.port, 2500);
        if (sessionRef.current !== s || s.client.connected) return;
        const token = (await getToken(s.conn.id)) ?? "";
        const hosts = [h.host, ...s.conn.hosts.filter((x) => x !== h.host)];
        if (!sameHosts(hosts, s.conn.hosts) || h.host !== s.host) await open({ hosts, port: s.conn.port, token }, s.conn.name);
      } catch {
        /* still unreachable */
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [phase, session, open]);

  // Coming back to the foreground: refresh the full state right away.
  useEffect(() => {
    const sub = RNAppState.addEventListener("change", (st) => {
      const s = sessionRef.current;
      if (st !== "active" || !s) return;
      s.client
        .getState()
        .then((fresh) => {
          if (sessionRef.current === s) setState(fresh);
        })
        .catch(() => {});
    });
    return () => sub.remove();
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const run = useCallback(async <T,>(fn: (c: VexcastClient) => Promise<T>, success?: string) => {
    const s = sessionRef.current;
    if (!s) return undefined;
    try {
      const r = await fn(s.client);
      if (success) toastRef.current.show(success, "success");
      return r;
    } catch (e) {
      // This phone's role doesn't allow it, or the PC can't be reached: say it plainly.
      const msg =
        e instanceof ApiError && e.status === 403
          ? tRef.current("toast.forbidden")
          : e instanceof TypeError || (e instanceof Error && /network request failed/i.test(e.message))
            ? tRef.current("toast.network")
            : tRef.current("toast.actionFailed", { error: e instanceof Error ? e.message : String(e) });
      toastRef.current.show(msg, "error");
      return undefined;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const refresh = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const fresh = await s.client.getState();
      if (sessionRef.current === s) {
        syncClock(fresh.status?.serverTime);
        setState(fresh);
      }
    } catch {
      /* the banner already tells the user the PC is unreachable */
    }
  }, []);

  const value = useMemo<RemoteValue>(
    () => ({
      phase,
      session,
      state,
      stats,
      chat,
      highlightId,
      alerts,
      error,
      saved,
      connect,
      connectSaved,
      disconnect,
      forget,
      logout,
      refreshSaved,
      clearError,
      refresh,
      serverNow,
      run,
    }),
    [phase, session, state, stats, chat, highlightId, alerts, error, saved, connect, connectSaved, disconnect, forget, logout, refreshSaved, clearError, refresh, serverNow, run],
  );

  return <RemoteContext.Provider value={value}>{children}</RemoteContext.Provider>;
}

export function useRemote(): RemoteValue {
  const v = useContext(RemoteContext);
  if (!v) throw new Error("useRemote outside RemoteProvider");
  return v;
}
