/**
 * "Información del directo": edit the title and game/category of every linked
 * account at once. Loads the current values from each platform, keeps the
 * titles in sync (optional) and remembers recent titles and categories.
 */
import type { AccountPlatform, StreamCategory, StreamInfo } from "@vexcast/protocol";
import { Check, ChevronsUpDown, Gamepad2, History, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { useDialogs } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { goTo, usePrefs } from "@/lib/prefs";
import { api, errorMessage, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AccountAvatar } from "./accounts-card";
import { ACCOUNT_PLATFORMS, accountMeta } from "./connect-button";

const MAX_TITLE = 140;
const MAX_RECENT = 8;
const NO_CATEGORIES: StreamCategory[] = [];

interface Row {
  platform: AccountPlatform;
  /** Values on the platform right now (null while loading / on error). */
  current: StreamInfo | null;
  loading: boolean;
  error: string | null;
  include: boolean;
  /** Own title (used when the titles are not synced). */
  title: string;
  /** New category; null = keep the current one. */
  category: StreamCategory | null;
}

const pushRecent = <T,>(list: T[], item: T, key: (x: T) => string) => [item, ...list.filter((x) => key(x) !== key(item))].slice(0, MAX_RECENT);

function CategoryThumb({ category, className }: { category: StreamCategory | null; className?: string }) {
  return category?.image ? (
    <img src={category.image} alt="" className={cn("h-7 w-5 shrink-0 rounded-sm border object-cover", className)} />
  ) : (
    <span className={cn("grid h-7 w-5 shrink-0 place-items-center rounded-sm border bg-muted text-muted-foreground", className)}>
      <Gamepad2 className="size-3" />
    </span>
  );
}

/** Searchable game/category picker backed by the platform's API. */
function CategoryPicker({ platform, value, current, onChange }: { platform: AccountPlatform; value: StreamCategory | null; current: StreamCategory | null; onChange: (c: StreamCategory | null) => void }) {
  const t = useT();
  const i = t.accounts.info;
  // Stable fallback: a new [] per render makes zustand re-render forever.
  const recent = usePrefs((p) => p.recentCategories[platform] ?? NO_CATEGORIES);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StreamCategory[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    // Kick has no "popular" list: wait for a query.
    if (!q && platform === "kick") {
      setResults([]);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const timer = setTimeout(
      () => {
        api()
          .searchCategories(platform, q)
          .then((r) => n === seq.current && setResults(r))
          .catch(() => n === seq.current && setResults([]))
          .finally(() => n === seq.current && setBusy(false));
      },
      q ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [open, query, platform]);

  const shown = value ?? current;
  const pick = (c: StreamCategory | null) => {
    onChange(c);
    setOpen(false);
    setQuery("");
  };
  const item = (c: StreamCategory) => (
    <CommandItem key={c.id} value={`${c.id}`} onSelect={() => pick(c)} className="gap-2.5">
      <CategoryThumb category={c} />
      <span className="truncate">{c.name}</span>
      <Check className={cn("ml-auto", (value ?? current)?.id === c.id ? "opacity-100" : "opacity-0")} />
    </CommandItem>
  );
  const recentShown = query.trim() ? [] : recent;
  const resultsShown = results.filter((r) => !recentShown.some((x) => x.id === r.id));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-10 w-full justify-start gap-2.5 px-2 font-normal" data-testid={`category-${platform}`}>
          <CategoryThumb category={shown} />
          <span className={cn("truncate", !shown && "text-muted-foreground")}>{shown?.name ?? i.pickCategory}</span>
          {value && current && value.id !== current.id && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
          <ChevronsUpDown className="ml-auto opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={i.searchCategory} value={query} onValueChange={setQuery} />
          <CommandList className="max-h-80">
            {busy && resultsShown.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {i.searching}
              </div>
            ) : (
              <CommandEmpty>{query.trim() || platform !== "kick" ? i.noResults : i.typeToSearch}</CommandEmpty>
            )}
            {value && (
              <CommandGroup>
                <CommandItem value="__keep" onSelect={() => pick(null)} className="text-muted-foreground">
                  <History /> {i.keepCategory}
                  {current && <span className="ml-auto truncate text-xs">{current.name}</span>}
                </CommandItem>
              </CommandGroup>
            )}
            {recentShown.length > 0 && <CommandGroup heading={i.recent}>{recentShown.map(item)}</CommandGroup>}
            {resultsShown.length > 0 && <CommandGroup heading={query.trim() ? i.results : i.popular}>{resultsShown.map(item)}</CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Title input with the recent-titles menu and a character counter. */
function TitleInput({ id, value, onChange, testId }: { id: string; value: string; onChange: (v: string) => void; testId?: string }) {
  const t = useT();
  const i = t.accounts.info;
  const recent = usePrefs((p) => p.recentTitles);
  return (
    <div className="flex gap-1.5">
      <div className="relative min-w-0 flex-1">
        <Input id={id} value={value} maxLength={MAX_TITLE} placeholder={i.titlePh} onChange={(e) => onChange(e.target.value)} className="pr-14" data-testid={testId} />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums">{fmt(i.chars, { n: value.length })}</span>
      </div>
      {recent.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" aria-label={i.recent} title={i.recent}>
              <History />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-1">
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{i.recent}</div>
            {recent.map((r) => (
              <button key={r} type="button" className="w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => onChange(r)}>
                {r}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export function StreamInfoDialog() {
  const t = useT();
  const a = t.accounts;
  const i = a.info;
  const open = useDialogs((d) => d.streamInfo);
  const close = () => useDialogs.getState().close("streamInfo");
  const sync = usePrefs((p) => p.streamInfoSync);
  const setPrefs = usePrefs((p) => p.set);
  const accounts = useStore(useShallow((s) => (s.state?.accounts ?? []).filter((x) => x.connected && ACCOUNT_PLATFORMS.includes(x.platform))));
  const platforms = accounts.map((x) => x.platform).join(",");
  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const id = useId();

  const patch = (p: AccountPlatform, v: Partial<Row>) => setRows((rs) => rs.map((r) => (r.platform === p ? { ...r, ...v } : r)));

  const load = useCallback(() => {
    const list = platforms ? (platforms.split(",") as AccountPlatform[]) : [];
    setRows(list.map((p) => ({ platform: p, current: null, loading: true, error: null, include: true, title: "", category: null })));
    setTitle("");
    let first = true;
    for (const p of list) {
      api()
        .getStreamInfo(p)
        .then((info) => {
          setRows((rs) => rs.map((r) => (r.platform === p ? { ...r, current: info, loading: false, title: info.title } : r)));
          // The shared title starts with the first platform that answers.
          if (first) {
            first = false;
            setTitle((cur) => cur || info.title);
          }
        })
        .catch((e) => setRows((rs) => rs.map((r) => (r.platform === p ? { ...r, loading: false, error: errorMessage(e) } : r))));
    }
  }, [platforms]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const included = rows.filter((r) => r.include && !r.error);
  const titles = new Set(rows.filter((r) => r.current).map((r) => r.current!.title.trim()));
  const mismatch = titles.size > 1;

  const save = async () => {
    setSaving(true);
    const ok: string[] = [];
    await Promise.all(
      included.map(async (r) => {
        const name = accountMeta(r.platform).name;
        const newTitle = (sync ? title : r.title).trim();
        try {
          await api().setStreamInfo(r.platform, { title: newTitle || undefined, categoryId: r.category?.id });
          ok.push(name);
          patch(r.platform, { current: { title: newTitle || r.current?.title || "", category: r.category ?? r.current?.category ?? null }, category: null });
        } catch (e) {
          toast.error(fmt(i.failed, { name, error: errorMessage(e) }));
        }
      }),
    );
    setSaving(false);
    // Remember what was used.
    const prefs = usePrefs.getState();
    let recentTitles = prefs.recentTitles;
    for (const tt of sync ? [title] : included.map((r) => r.title)) if (tt.trim()) recentTitles = pushRecent(recentTitles, tt.trim(), (x) => x);
    const recentCategories = { ...prefs.recentCategories };
    for (const r of included) if (r.category) recentCategories[r.platform] = pushRecent(recentCategories[r.platform] ?? [], r.category, (x) => x.id);
    setPrefs({ recentTitles, recentCategories });
    if (ok.length) {
      toast.success(fmt(i.saved, { names: ok.join(", ") }));
      if (ok.length === included.length) close();
    }
  };

  const canSave = included.length > 0 && !saving && included.every((r) => !r.loading) && (sync ? title.trim() : included.every((r) => r.title.trim()));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="sm:max-w-xl" data-testid="stream-info-dialog">
        <DialogHeader>
          <DialogTitle>{i.title}</DialogTitle>
          <DialogDescription>{i.desc}</DialogDescription>
        </DialogHeader>

        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">{i.none}</p>
            <Button
              onClick={() => {
                close();
                goTo("destinations");
              }}
            >
              {i.goAccounts}
            </Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <Label htmlFor={`${id}-sync`}>{i.sync}</Label>
                <span className="text-xs text-muted-foreground">{i.syncHint}</span>
              </div>
              <Switch id={`${id}-sync`} checked={sync} onCheckedChange={(v) => setPrefs({ streamInfoSync: v })} data-testid="stream-info-sync" />
            </div>

            {sync && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-title`}>{i.titleLabel}</Label>
                <TitleInput id={`${id}-title`} value={title} onChange={setTitle} testId="stream-info-title" />
                {mismatch && (
                  <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <TriangleAlert className="size-3.5" /> {i.mismatch}
                  </span>
                )}
              </div>
            )}

            <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto pr-1">
              {rows.map((r) => {
                const acc = accounts.find((x) => x.platform === r.platform);
                const meta = accountMeta(r.platform);
                const Icon = meta.icon;
                return (
                  <div key={r.platform} className={cn("flex flex-col gap-3 rounded-lg border p-3", !r.include && "opacity-60")} data-testid={`stream-info-${r.platform}`}>
                    <div className="flex items-center gap-3">
                      <div className="relative shrink-0">
                        {acc && <AccountAvatar account={acc} className="size-8" />}
                        <span className="absolute -right-1 -bottom-1 grid size-4 place-items-center rounded-full border bg-background" style={{ color: meta.color }}>
                          <Icon size={9} />
                        </span>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {meta.name} · {acc?.displayName || acc?.login}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {r.loading ? (
                            i.loading
                          ) : r.error ? (
                            <span className="text-destructive">{fmt(i.loadFailed, { error: r.error })}</span>
                          ) : (
                            <>
                              {i.now}: {r.current?.title || i.noTitle} · {r.current?.category?.name ?? i.noCategory}
                            </>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox id={`${id}-${r.platform}`} checked={r.include} disabled={!!r.error} onCheckedChange={(v) => patch(r.platform, { include: v === true })} />
                        <Label htmlFor={`${id}-${r.platform}`} className="text-xs font-normal whitespace-nowrap">
                          {fmt(i.update, { name: meta.name })}
                        </Label>
                      </div>
                    </div>
                    {r.include && !r.error && (
                      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
                        {!sync && (
                          <div className="flex flex-col gap-1.5 sm:col-span-2">
                            <Label htmlFor={`${id}-${r.platform}-title`} className="text-xs">
                              {i.titleLabel}
                            </Label>
                            <TitleInput id={`${id}-${r.platform}-title`} value={r.title} onChange={(v) => patch(r.platform, { title: v })} />
                          </div>
                        )}
                        <div className="flex flex-col gap-1.5 sm:col-span-2">
                          <Label className="text-xs">{i.category}</Label>
                          {r.loading ? (
                            <div className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground">
                              <Loader2 className="size-4 animate-spin" />
                            </div>
                          ) : (
                            <CategoryPicker platform={r.platform} value={r.category} current={r.current?.category ?? null} onChange={(c) => patch(r.platform, { category: c })} />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {accounts.length > 0 && (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="ghost" onClick={load} disabled={saving}>
              <RefreshCw /> {i.reload}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={close}>
                {t.common.cancel}
              </Button>
              <Button onClick={save} disabled={!canSave} data-testid="stream-info-save">
                {saving && <Loader2 className="animate-spin" />}
                {included.length === 1 ? fmt(i.saveOne, { name: accountMeta(included[0].platform).name }) : fmt(i.save, { n: included.length })}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
