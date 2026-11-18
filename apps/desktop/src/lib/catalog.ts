import { create } from "zustand";
import type { EncoderType, SourceType, StreamService } from "@vexcast/protocol";
import { useStore } from "./store";

/** Static catalogs from the core (fetched once, cached). */
interface Catalog {
  sourceTypes: SourceType[] | null;
  transitionTypes: SourceType[] | null;
  encoders: EncoderType[] | null;
  services: StreamService[] | null;
}

export const useCatalog = create<Catalog>(() => ({ sourceTypes: null, transitionTypes: null, encoders: null, services: null }));

const loaders: { [K in keyof Catalog]: () => Promise<NonNullable<Catalog[K]>> } = {
  sourceTypes: () => useStore.getState().client!.sourceTypes(),
  transitionTypes: () => useStore.getState().client!.transitionTypes(),
  encoders: () => useStore.getState().client!.encoders(),
  services: () => useStore.getState().client!.services(),
};

const inflight = new Map<string, Promise<unknown>>();

export function ensureCatalog<K extends keyof Catalog>(key: K): Promise<NonNullable<Catalog[K]>> {
  const have = useCatalog.getState()[key];
  if (have) return Promise.resolve(have as NonNullable<Catalog[K]>);
  if (!useStore.getState().client) return Promise.reject(new Error("not connected"));
  let p = inflight.get(key) as Promise<NonNullable<Catalog[K]>> | undefined;
  if (!p) {
    p = loaders[key]()
      .then((v) => {
        useCatalog.setState({ [key]: v } as Partial<Catalog>);
        return v as NonNullable<Catalog[K]>;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Hook: the catalog entry (null while loading), loading it on first use. */
export function useCatalogEntry<K extends keyof Catalog>(key: K): Catalog[K] {
  const v = useCatalog((c) => c[key]);
  if (!v) ensureCatalog(key).catch(() => {});
  return v;
}
