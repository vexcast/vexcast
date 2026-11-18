import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** A desktop PC the phone has paired with. The token lives in secure storage. */
export interface SavedConnection {
  id: string;
  name: string;
  /** Candidate LAN addresses (from the QR). The first that answers wins. */
  hosts: string[];
  port: number;
  /** Address that answered last time (tried first). */
  lastHost: string | null;
  lastUsedAt: number;
  coreVersion: string | null;
}

const CONNECTIONS_KEY = "vexcast.connections.v1";
const LAST_KEY = "vexcast.lastConnection";
const tokenKey = (id: string) => `vexcast.token.${id}`;

const secureAvailable = Platform.OS === "ios" || Platform.OS === "android";

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function setJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep working in memory */
  }
}

export async function removeKey(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export async function getToken(id: string): Promise<string | null> {
  try {
    if (secureAvailable) return await SecureStore.getItemAsync(tokenKey(id));
    return await AsyncStorage.getItem(tokenKey(id));
  } catch {
    return null;
  }
}

async function setToken(id: string, token: string): Promise<void> {
  try {
    if (secureAvailable) await SecureStore.setItemAsync(tokenKey(id), token);
    else await AsyncStorage.setItem(tokenKey(id), token);
  } catch {
    /* ignore */
  }
}

async function deleteToken(id: string): Promise<void> {
  try {
    if (secureAvailable) await SecureStore.deleteItemAsync(tokenKey(id));
    else await AsyncStorage.removeItem(tokenKey(id));
  } catch {
    /* ignore */
  }
}

export async function listConnections(): Promise<SavedConnection[]> {
  const list = await getJSON<SavedConnection[]>(CONNECTIONS_KEY, []);
  return [...list].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export async function getLastConnectionId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export async function setLastConnectionId(id: string | null): Promise<void> {
  try {
    if (id) await AsyncStorage.setItem(LAST_KEY, id);
    else await AsyncStorage.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
}

function newId(): string {
  return `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Saves (or updates) a connection. A saved PC is matched by token or by
 * sharing an address and port, so re-scanning the same QR does not duplicate it.
 */
export async function saveConnection(input: {
  hosts: string[];
  port: number;
  token: string;
  lastHost: string;
  coreVersion: string | null;
  /** Forces this name (e.g. reconnecting to a saved PC). */
  name?: string;
  /** Used only for a PC that is not saved yet (QR `name` / health `name`). */
  defaultName?: string;
}): Promise<SavedConnection> {
  const list = await getJSON<SavedConnection[]>(CONNECTIONS_KEY, []);
  let existing: SavedConnection | undefined;
  for (const c of list) {
    const tok = await getToken(c.id);
    const sharesHost = c.port === input.port && c.hosts.some((h) => input.hosts.includes(h));
    if (tok === input.token || sharesHost) {
      existing = c;
      break;
    }
  }
  const conn: SavedConnection = {
    id: existing?.id ?? newId(),
    // A saved PC still named after its IP (never renamed) adopts the computer name.
    name:
      input.name ??
      (existing && !(input.defaultName && existing.hosts.includes(existing.name)) ? existing.name : undefined) ??
      (input.defaultName || input.lastHost),
    hosts: Array.from(new Set([input.lastHost, ...input.hosts])),
    port: input.port,
    lastHost: input.lastHost,
    lastUsedAt: Date.now(),
    coreVersion: input.coreVersion,
  };
  const next = [conn, ...list.filter((c) => c.id !== conn.id)];
  await setJSON(CONNECTIONS_KEY, next);
  await setToken(conn.id, input.token);
  await setLastConnectionId(conn.id);
  return conn;
}

export async function renameConnection(id: string, name: string): Promise<void> {
  const list = await getJSON<SavedConnection[]>(CONNECTIONS_KEY, []);
  await setJSON(
    CONNECTIONS_KEY,
    list.map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c)),
  );
}

export async function forgetConnection(id: string): Promise<void> {
  const list = await getJSON<SavedConnection[]>(CONNECTIONS_KEY, []);
  await setJSON(
    CONNECTIONS_KEY,
    list.filter((c) => c.id !== id),
  );
  await deleteToken(id);
  if ((await getLastConnectionId()) === id) await setLastConnectionId(null);
}

/** Deletes every saved PC and its token (app "log out"). */
export async function forgetAllConnections(): Promise<void> {
  const list = await getJSON<SavedConnection[]>(CONNECTIONS_KEY, []);
  for (const c of list) await deleteToken(c.id);
  await removeKey(CONNECTIONS_KEY);
  await setLastConnectionId(null);
}
