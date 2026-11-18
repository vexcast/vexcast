import type { Hotkey } from "@vexcast/protocol";
import { Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { useT } from "@/i18n";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useSettings } from "./settings-context";

type Binding = Hotkey["bindings"][number];

const MOD_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph"]);

/** Map a DOM key event to an OBS key name (OBS_KEY_*). */
function obsKey(e: KeyboardEvent): string | null {
  if (MOD_KEYS.has(e.key)) return null;
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) return `OBS_KEY_${c.slice(3)}`;
  if (/^Digit\d$/.test(c)) return `OBS_KEY_${c.slice(5)}`;
  if (/^Numpad\d$/.test(c)) return `OBS_KEY_NUM${c.slice(6)}`;
  if (/^F\d{1,2}$/.test(c)) return `OBS_KEY_${c}`;
  const map: Record<string, string> = {
    Space: "SPACE",
    Enter: "RETURN",
    Tab: "TAB",
    Backspace: "BACKSPACE",
    Delete: "DELETE",
    Insert: "INSERT",
    Home: "HOME",
    End: "END",
    PageUp: "PAGEUP",
    PageDown: "PAGEDOWN",
    ArrowUp: "UP",
    ArrowDown: "DOWN",
    ArrowLeft: "LEFT",
    ArrowRight: "RIGHT",
    Escape: "ESCAPE",
    Minus: "MINUS",
    Equal: "EQUAL",
    Comma: "COMMA",
    Period: "PERIOD",
    Slash: "SLASH",
    Backquote: "ASCIITILDE",
    Pause: "PAUSE",
    PrintScreen: "PRINT",
    NumpadAdd: "NUMPLUS",
    NumpadSubtract: "NUMMINUS",
    NumpadMultiply: "NUMASTERISK",
    NumpadDivide: "NUMSLASH",
    NumpadDecimal: "NUMPERIOD",
  };
  return map[c] ? `OBS_KEY_${map[c]}` : null;
}

const keyLabel = (k: string) => k.replace(/^OBS_KEY_/, "").replace(/^NUM(\d)$/, "Num $1").replace("RETURN", "Enter").replace("ESCAPE", "Esc");

function BindingField({ binding, onChange, onClear }: { binding: Binding | null; onChange: (b: Binding) => void; onClear: () => void }) {
  const t = useT();
  const [rec, setRec] = useState(false);
  useEffect(() => {
    if (!rec) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !e.ctrlKey && !e.shiftKey && !e.altKey) return setRec(false);
      const key = obsKey(e);
      if (!key) return;
      onChange({ key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, command: e.metaKey });
      setRec(false);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [rec, onChange]);
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setRec(true)}
        onBlur={() => setRec(false)}
        className={cn(
          "flex h-8 min-w-48 items-center gap-1 rounded-md border bg-transparent px-2.5 text-left text-sm shadow-xs transition-colors outline-none hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30",
          rec && "border-ring ring-[3px] ring-ring/50",
        )}
      >
        {rec ? (
          <span className="text-muted-foreground">{t.settings.hotkeys.press}</span>
        ) : binding?.key ? (
          <>
            {binding.ctrl && <Kbd>Ctrl</Kbd>}
            {binding.shift && <Kbd>Shift</Kbd>}
            {binding.alt && <Kbd>Alt</Kbd>}
            {binding.command && <Kbd>Win</Kbd>}
            <Kbd>{keyLabel(binding.key)}</Kbd>
          </>
        ) : (
          <span className="text-muted-foreground">{t.settings.hotkeys.unset}</span>
        )}
      </button>
      {binding && (
        <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label={t.settings.hotkeys.clear}>
          <X />
        </Button>
      )}
    </div>
  );
}

export function HotkeysTab() {
  const t = useT();
  const client = useStore((s) => s.client);
  const { draft, setHotkey } = useSettings();
  const [list, setList] = useState<Hotkey[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    client
      ?.hotkeys()
      .then(setList)
      .catch(() => setList([]));
  }, [client]);

  const groups = useMemo(() => {
    const m = new Map<string, Hotkey[]>();
    for (const h of list ?? []) {
      if (q && !`${h.description} ${h.owner}`.toLowerCase().includes(q.toLowerCase())) continue;
      const g = h.owner === "frontend" ? t.settings.hotkeys.groups.frontend : h.owner;
      m.set(g, [...(m.get(g) ?? []), h]);
    }
    return [...m.entries()];
  }, [list, q, t]);

  return (
    <div className="grid gap-5">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.settings.hotkeys.search} className="h-8 pl-8" />
      </div>
      {!list && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      )}
      {list && groups.length === 0 && <p className="text-sm text-muted-foreground">{t.settings.hotkeys.none}</p>}
      {groups.map(([g, hs]) => (
        <section key={g} className="grid gap-2">
          <h3 className="border-b pb-1.5 text-sm font-semibold">{g}</h3>
          {hs.map((h) => {
            const bindings = draft.hotkeys[h.id] ?? h.bindings;
            return (
              <div key={h.id} className="grid grid-cols-[16rem_1fr] items-start gap-4">
                <span className="pt-1.5 text-right text-sm text-muted-foreground">{h.description}</span>
                <div className="flex flex-col gap-1.5">
                  {(bindings.length ? bindings : [null]).map((b, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <BindingField
                        binding={b}
                        onChange={(nb) => {
                          const next = bindings.slice();
                          next[i] = nb;
                          setHotkey(h.id, next);
                        }}
                        onClear={() => setHotkey(h.id, bindings.filter((_, k) => k !== i))}
                      />
                      {i === bindings.length - 1 && b && (
                        <Button variant="ghost" size="icon-sm" aria-label={t.settings.hotkeys.add} onClick={() => setHotkey(h.id, [...bindings, { key: "", ctrl: false, shift: false, alt: false, command: false }])}>
                          <Plus />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
