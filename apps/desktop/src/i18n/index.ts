import { useStore } from "../lib/store";
import { en } from "./en";
import { es, type Dict } from "./es";

export type Lang = "es" | "en";
export const dictionaries: Record<Lang, Dict> = { es, en };

export function useLang(): Lang {
  return useStore((s) => s.state?.general.language ?? "es");
}

export function useT(): Dict {
  return dictionaries[useLang()];
}

/** Dictionary outside React (event handlers, actions). */
export function getT(): Dict {
  return dictionaries[useStore.getState().state?.general.language ?? "es"];
}

export type { Dict };
