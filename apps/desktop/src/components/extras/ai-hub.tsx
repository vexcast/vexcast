import type { VexcastClient } from "@vexcast/protocol";
import type { HfFile, HfModel, HubJob, HubModelKind, HubRuntimeId, HubStatus, LlmProvider, PiperVoice } from "@vexcast/protocol";
import {
  AudioLines,
  Bot,
  Captions,
  Check,
  ChevronRight,
  Cloud,
  Cpu,
  Download,
  ExternalLink,
  Heart,
  HardDrive,
  Loader2,
  MemoryStick,
  Search,
  Server,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { create } from "zustand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLang, useT } from "@/i18n";
import { confirmDialog } from "@/lib/dialogs";
import { fmt } from "@/lib/format";
import { act, errorMessage, useStore } from "@/lib/store";
import { revealPath } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { Section } from "./shared";

// ------------------------------------------------------------------ state

interface HubStore {
  status: HubStatus | null;
  refresh: () => Promise<void>;
}

/** AI hub status (engines, models, downloads), shared by every AI tab. */
export const useHub = create<HubStore>((set) => ({
  status: null,
  refresh: async () => {
    const c = useStore.getState().client;
    if (!c) return;
    try {
      set({ status: await c.hubStatus() });
    } catch {
      /* core restarting */
    }
  },
}));

/** Keep the hub status fresh: every second while something downloads, else every 5 s. */
export function useHubPolling() {
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await useHub.getState().refresh();
      if (!alive) return;
      const busy = useHub.getState().status?.jobs.some((j) => j.state === "running");
      timer = setTimeout(tick, busy ? 1000 : 5000);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
}

export function formatBytes(n: number, locale = "es-ES"): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toLocaleString(locale, { maximumFractionDigits: i >= 3 ? 2 : 0 })} ${u[i]}`;
}

const jobFor = (s: HubStatus | null, target: string) => s?.jobs.filter((j) => j.target === target).at(-1);

/** Start a hub job and refresh right away so the progress bar appears. */
async function startJob(run: (c: VexcastClient) => Promise<unknown>) {
  const r = await act(run);
  if (r) useHub.getState().refresh();
  return r;
}

// ------------------------------------------------------------------ progress

function JobProgress({ job }: { job: HubJob }) {
  const t = useT();
  const h = t.hub;
  const pct = job.total ? Math.min(100, (job.received / job.total) * 100) : 0;
  if (job.state === "error") return <p className="text-xs break-words text-destructive">{fmt(h.failed, { error: job.error ?? "" })}</p>;
  if (job.state !== "running") return null;
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <Progress value={job.total ? pct : undefined} className={cn("h-1.5", !job.total && "animate-pulse")} />
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>{job.kind === "runtime" && pct >= 99.5 ? h.installing : h.downloading}</span>
          <span>
            {formatBytes(job.received, t.locale)}
            {job.total ? ` / ${formatBytes(job.total, t.locale)} · ${Math.floor(pct)}%` : ""}
          </span>
        </div>
      </div>
      <Button variant="ghost" size="icon-sm" className="size-7 shrink-0" aria-label={h.cancel} title={h.cancel} onClick={() => act((c) => c.hubCancel(job.id))}>
        <X />
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ engines

const RUNTIME_ICON: Record<HubRuntimeId, typeof Cpu> = { llama: Bot, whisper: Captions, piper: AudioLines };
const BACKENDS: Record<HubRuntimeId, string[]> = { llama: ["auto", "vulkan", "cuda", "cpu"], whisper: ["cpu", "cuda"], piper: [] };

/** One local engine: status, acceleration choice and install / update / uninstall. */
export function RuntimeCard({ id, className }: { id: HubRuntimeId; className?: string }) {
  const t = useT();
  const h = t.hub;
  const status = useHub((s) => s.status);
  const rt = status?.runtimes.find((r) => r.id === id);
  const job = jobFor(status, `runtime:${id}`);
  const running = job?.state === "running";
  const backends = (status?.os === "macos" ? [] : BACKENDS[id]).filter((b) => b !== "cuda" || status?.nvidia || id === "llama");
  // Until the user picks, propose CUDA for captions on NVIDIA PCs, else the first option.
  const [picked, setBackend] = useState<string | null>(null);
  const backend = picked ?? (id === "whisper" && status?.nvidia ? "cuda" : (backends[0] ?? "auto"));
  const Icon = RUNTIME_ICON[id];
  if (!rt) return null;
  const install = () => startJob((c) => c.hubInstall(id, backend));
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border bg-card p-4", className)} data-testid={`runtime-${id}`}>
      <div className="flex items-start gap-3">
        <div className={cn("grid size-9 shrink-0 place-items-center rounded-lg", rt.installed ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{h.runtimes[id].title}</span>
            {rt.unsupported ? (
              <Badge variant="outline">{h.unavailable}</Badge>
            ) : rt.installed ? (
              <Badge variant="secondary" className="gap-1">
                <Check className="size-3" /> {h.installed}
              </Badge>
            ) : (
              <Badge variant="outline">{h.notInstalled}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{rt.unsupported ?? h.runtimes[id].desc}</p>
          {rt.installed && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {fmt(h.version, { v: rt.version ?? "?" })}
              {rt.backend ? ` · ${h.backends[rt.backend as keyof typeof h.backends] ?? rt.backend}` : ""}
            </p>
          )}
        </div>
      </div>
      {!rt.unsupported && (
        <>
          {running ? (
            <JobProgress job={job} />
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {backends.length > 0 && (
                <Select value={backend} onValueChange={setBackend}>
                  <SelectTrigger size="sm" className="h-8 min-w-0 flex-1 basis-48 text-xs" aria-label={h.backend}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {backends.map((b) => (
                      <SelectItem key={b} value={b} className="text-xs">
                        {b === "auto" ? `${h.backends.auto} · ${h.backends[rt.defaultBackend as keyof typeof h.backends] ?? rt.defaultBackend}` : h.backends[b as keyof typeof h.backends]}
                        {b === "cuda" && status?.nvidia ? ` · ${h.nvidiaDetected}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button size="sm" variant={rt.installed ? "outline" : "default"} className="h-8" onClick={install} data-testid={`install-${id}`}>
                <Download /> {rt.installed ? h.update : h.install}
              </Button>
              {rt.installed && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-muted-foreground"
                  onClick={async () => {
                    if (await confirmDialog({ title: fmt(h.uninstallConfirm, { name: rt.name }), description: h.uninstallDesc, destructive: true, confirmLabel: h.uninstall }))
                      startJob((c) => c.hubUninstall(id));
                  }}
                >
                  {h.uninstall}
                </Button>
              )}
            </div>
          )}
          {job?.state === "error" && <JobProgress job={job} />}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ downloaded models

/** Downloaded models of one kind; pick one (when `onChange`) or just manage them. */
export function ModelList({ kind, value, onChange, onBrowse }: { kind: HubModelKind; value?: string; onChange?: (file: string) => void; onBrowse?: () => void }) {
  const t = useT();
  const h = t.hub;
  const status = useHub((s) => s.status);
  const models = status?.models[kind] ?? [];
  const loaded = kind === "llm" ? status?.running.llm : kind === "whisper" ? status?.running.stt : null;
  const jobs = (status?.jobs ?? []).filter((j) => j.state === "running" && j.target.startsWith(`model:${kind}:`));
  return (
    <div className="flex flex-col gap-1.5">
      {models.length === 0 && jobs.length === 0 && (
        <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          {kind === "llm" ? h.localNoModels : kind === "whisper" ? h.whisperNoModels : h.piperNoVoices}
        </div>
      )}
      {models.map((m) => {
        const active = value === m.file;
        return (
          <div
            key={m.file}
            role={onChange ? "button" : undefined}
            tabIndex={onChange ? 0 : undefined}
            onClick={() => onChange?.(m.file)}
            onKeyDown={(e) => e.key === "Enter" && onChange?.(m.file)}
            className={cn(
              "group flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors",
              onChange && "cursor-pointer hover:bg-accent/50",
              active && "border-primary bg-primary/5 ring-1 ring-primary/30",
            )}
          >
            {onChange && <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", active && "border-primary bg-primary text-primary-foreground")}>{active && <Check className="size-3" />}</span>}
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={m.file}>
              {m.file.replace(/\.(gguf|bin|onnx)$/i, "")}
            </span>
            {loaded === m.file && (
              <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
                <MemoryStick className="size-3" /> {h.loaded}
              </Badge>
            )}
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{formatBytes(m.size, t.locale)}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 shrink-0 opacity-60 group-hover:opacity-100"
              aria-label={h.deleteModel}
              title={h.deleteModel}
              onClick={async (e) => {
                e.stopPropagation();
                if (await confirmDialog({ title: fmt(h.deleteConfirm, { name: m.file }), description: fmt(h.deleteDesc, { size: formatBytes(m.size, t.locale) }), destructive: true, confirmLabel: t.common.delete }))
                  startJob((c) => c.hubDelete(kind, m.file));
              }}
            >
              <Trash2 />
            </Button>
          </div>
        );
      })}
      {jobs.map((j) => (
        <div key={j.id} className="rounded-md border px-3 py-2">
          <div className="mb-1.5 truncate font-mono text-xs">{j.label}</div>
          <JobProgress job={j} />
        </div>
      ))}
      {onBrowse && (
        <Button variant="outline" size="sm" className="mt-1 self-start" onClick={onBrowse} data-testid={`browse-${kind}`}>
          <Download /> {kind === "piper" ? h.browseVoices : h.browse}
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ model browser

const CURATED = [
  { id: "qwen3b", name: "Qwen 2.5 3B Instruct", repo: "Qwen/Qwen2.5-3B-Instruct-GGUF" },
  { id: "llama3b", name: "Llama 3.2 3B Instruct", repo: "bartowski/Llama-3.2-3B-Instruct-GGUF" },
  { id: "gemma4b", name: "Gemma 3 4B", repo: "unsloth/gemma-3-4b-it-GGUF" },
  { id: "qwen7b", name: "Qwen 2.5 7B Instruct", repo: "bartowski/Qwen2.5-7B-Instruct-GGUF" },
  { id: "qwen1_5b", name: "Qwen 2.5 1.5B Instruct", repo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF" },
] as const;

const WHISPER_ORDER = ["ggml-large-v3-turbo-q5_0.bin", "ggml-small.bin", "ggml-base.bin", "ggml-tiny.bin", "ggml-medium.bin", "ggml-large-v3-turbo.bin", "ggml-large-v3.bin"];

const quantOf = (file: string) => file.match(/(IQ\d_[A-Z0-9_]+|Q\d(_K)?(_[A-Z0-9]+)?|F16|BF16|F32)/i)?.[0]?.toUpperCase() ?? null;

/** Download button / progress / "downloaded" state for one file. */
function DownloadAction({ kind, repo, file, size }: { kind: HubModelKind; repo: string; file: string; size?: number }) {
  const t = useT();
  const h = t.hub;
  const name = file.split("/").pop() ?? file;
  const status = useHub((s) => s.status);
  const have = status?.models[kind].some((m) => m.file === name);
  const job = jobFor(status, `model:${kind}:${name}`);
  if (job?.state === "running") return <div className="w-48 shrink-0"><JobProgress job={job} /></div>;
  if (have)
    return (
      <Badge variant="secondary" className="shrink-0 gap-1">
        <Check className="size-3" /> {h.downloaded}
      </Badge>
    );
  return (
    <Button size="sm" variant="outline" className="h-7 shrink-0 gap-1.5 px-2.5 text-xs" onClick={() => startJob((c) => c.hubDownload(kind, repo, file))}>
      <Download className="size-3.5" /> {h.download}
      {size ? <span className="text-muted-foreground tabular-nums">· {formatBytes(size, t.locale)}</span> : null}
    </Button>
  );
}

/** Files of a Hugging Face repo with their sizes and download buttons. */
function RepoFiles({ repo, kind, ext, describe, order }: { repo: string; kind: HubModelKind; ext?: string; describe?: (f: string) => string | undefined; order?: string[] }) {
  const t = useT();
  const h = t.hub;
  const client = useStore((s) => s.client);
  const [files, setFiles] = useState<HfFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setFiles(null);
    setError(null);
    client
      ?.hubFiles(repo, ext)
      .then((f) => alive && setFiles(f))
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [client, repo, ext]);
  if (error) return <p className="px-1 py-2 text-xs text-destructive">{error}</p>;
  if (!files)
    return (
      <p className="flex items-center gap-2 px-1 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> {h.loadingFiles}
      </p>
    );
  let list = files;
  if (order) list = order.map((o) => files.find((f) => f.path === o)).filter((f): f is HfFile => !!f);
  if (!list.length) return <p className="px-1 py-2 text-xs text-muted-foreground">{h.noFiles}</p>;
  // Recommend Q4_K_M (or the closest) for GGUF.
  const rec = kind === "llm" ? (list.find((f) => /q4_k_m/i.test(f.path)) ?? list.find((f) => /q4/i.test(f.path)))?.path : order?.[0];
  return (
    <div className="flex flex-col gap-1">
      {kind === "llm" && <p className="px-1 pb-1 text-[11px] text-muted-foreground">{h.quantHint}</p>}
      {list.map((f) => {
        const name = f.path.split("/").pop() ?? f.path;
        const q = kind === "llm" ? quantOf(name) : null;
        return (
          <div key={f.path} className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40", f.path === rec && "bg-primary/5")}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {q && (
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                    {q}
                  </Badge>
                )}
                <span className="truncate font-mono text-xs" title={f.path}>
                  {name}
                </span>
                {f.path === rec && <Badge className="shrink-0 text-[10px]">{h.recommendedQuant}</Badge>}
              </div>
              {(describe?.(name) || (kind === "llm" && f.size)) && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{describe?.(name) ?? fmt(h.sizeFit, { ram: formatBytes(f.size * 1.2, t.locale) })}</p>
              )}
            </div>
            <DownloadAction kind={kind} repo={repo} file={f.path} size={f.size} />
          </div>
        );
      })}
    </div>
  );
}

function RepoRow({ title, subtitle, meta, children, defaultOpen }: { title: string; subtitle?: string; meta?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-lg border">
      <button type="button" className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-accent/40" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        {meta}
      </button>
      {open && <div className="border-t px-2 py-2">{children}</div>}
    </div>
  );
}

function LlmBrowser() {
  const t = useT();
  const h = t.hub;
  const client = useStore((s) => s.client);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<HfModel[] | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    if (!client || !q.trim()) return;
    setBusy(true);
    try {
      setResults(await client.hubSearch(q.trim()));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const n = (x: number) => x.toLocaleString(t.locale, { notation: "compact" });
  return (
    <Tabs defaultValue="rec" className="min-h-0 min-w-0 flex-1">
      <TabsList className="w-full">
        <TabsTrigger value="rec">
          <Sparkles /> {h.recommended}
        </TabsTrigger>
        <TabsTrigger value="search" data-testid="hf-search-tab">
          <Search /> {h.search}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="rec" className="mt-3 flex min-h-0 flex-col gap-2">
        {CURATED.map((m, i) => (
          <RepoRow key={m.id} title={m.name} subtitle={h.curated[m.id]} defaultOpen={i === 0}>
            <RepoFiles repo={m.repo} kind="llm" />
          </RepoRow>
        ))}
      </TabsContent>
      <TabsContent value="search" className="mt-3 flex min-h-0 flex-col gap-2">
        <div className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder={h.searchPh} autoFocus data-testid="hf-search" />
          <Button onClick={search} disabled={busy || !q.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : <Search />} {h.search}
          </Button>
        </div>
        {results?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{h.noResults}</p>}
        {results?.map((r) => (
          <RepoRow
            key={r.repo}
            title={r.repo.split("/")[1] ?? r.repo}
            subtitle={r.repo}
            meta={
              <span className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                <span className="flex items-center gap-1" title={fmt(h.dl, { n: n(r.downloads) })}>
                  <Download className="size-3" /> {n(r.downloads)}
                </span>
                <span className="flex items-center gap-1" title={fmt(h.likes, { n: n(r.likes) })}>
                  <Heart className="size-3" /> {n(r.likes)}
                </span>
              </span>
            }
          >
            <RepoFiles repo={r.repo} kind="llm" />
          </RepoRow>
        ))}
      </TabsContent>
    </Tabs>
  );
}

function VoiceBrowser() {
  const t = useT();
  const h = t.hub;
  const lang = useLang();
  const client = useStore((s) => s.client);
  const [voices, setVoices] = useState<PiperVoice[] | null>(null);
  const [language, setLanguage] = useState<string>(lang);
  const [q, setQ] = useState("");
  useEffect(() => {
    client
      ?.hubVoices()
      .then(setVoices)
      .catch((e) => toast.error(errorMessage(e)));
  }, [client]);
  const languages = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of voices ?? []) m.set(v.language.split("_")[0], v.languageName);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [voices]);
  const QUALITY = ["high", "medium", "low", "x_low"];
  const list = (voices ?? [])
    .filter((v) => (language === "all" || v.language.startsWith(language)) && (!q || v.key.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.language.localeCompare(b.language) || QUALITY.indexOf(a.quality) - QUALITY.indexOf(b.quality) || a.name.localeCompare(b.name));
  if (!voices)
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {h.loadingFiles}
      </p>
    );
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Select value={language} onValueChange={setLanguage}>
          <SelectTrigger className="w-48" aria-label={h.language}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{h.allLanguages}</SelectItem>
            {languages.map(([code, name]) => (
              <SelectItem key={code} value={code}>
                {name} ({code})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={h.search} className="min-w-0 flex-1 basis-40" />
      </div>
      <div className="flex flex-col gap-1">
        {list.map((v) => (
          <div key={v.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium capitalize">{v.name.replace(/_/g, " ")}</span>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {v.language}
                </Badge>
                <Badge variant={v.quality === "high" || v.quality === "medium" ? "secondary" : "outline"} className="shrink-0 text-[10px]">
                  {h.quality[v.quality as keyof typeof h.quality] ?? v.quality}
                </Badge>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {v.country}
                {v.speakers > 1 ? ` · ${fmt(h.speakers, { n: v.speakers })}` : ""}
              </p>
            </div>
            <DownloadAction kind="piper" repo="rhasspy/piper-voices" file={v.file} size={v.size} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Dialog to download models of one kind. */
export function ModelBrowser({ kind, open, onOpenChange }: { kind: HubModelKind; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const h = t.hub;
  const title = kind === "llm" ? h.browserTitle : kind === "whisper" ? h.browserWhisperTitle : h.browserVoicesTitle;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(760px,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-2xl" data-testid="model-browser">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{h.kinds[kind]} · Hugging Face</DialogDescription>
        </DialogHeader>
        {/* Native scroll: a ScrollArea inside a flex child has no definite height and never scrolls. */}
        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="model-browser-scroll">
          <div className="px-6 pb-1">
            {kind === "llm" && <LlmBrowser />}
            {kind === "piper" && <VoiceBrowser />}
            {kind === "whisper" && <RepoFiles repo="ggerganov/whisper.cpp" kind="whisper" ext=".bin" order={WHISPER_ORDER} describe={(f) => h.whisperModels[f as keyof typeof h.whisperModels]} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ providers

const PROVIDER_ICON: Record<LlmProvider, typeof Cpu> = { anthropic: Sparkles, local: HardDrive, ollama: Server, openai_compatible: Cloud, none: X };
export const PROVIDER_ORDER: LlmProvider[] = ["anthropic", "local", "ollama", "openai_compatible", "none"];

/** Big selectable cards for the text engine. */
export function ProviderCards({ value, onChange }: { value: LlmProvider; onChange: (p: LlmProvider) => void }) {
  const t = useT();
  const h = t.hub;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,170px),1fr))] gap-2" role="radiogroup" aria-label={h.engine}>
      {PROVIDER_ORDER.map((p) => {
        const Icon = PROVIDER_ICON[p];
        const meta = h.providers[p];
        const active = value === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(p)}
            data-testid={`provider-${p}`}
            className={cn(
              "flex min-w-0 flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50",
              active && "border-primary bg-primary/5 ring-1 ring-primary/40",
            )}
          >
            <div className="flex w-full items-start justify-between gap-2">
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-md", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                <Icon className="size-3.5" />
              </span>
              {meta.badge && (
                <Badge variant={active ? "default" : "secondary"} className="shrink-0 text-[10px]">
                  {meta.badge}
                </Badge>
              )}
            </div>
            <span className="text-sm leading-tight font-medium">{meta.name}</span>
            <span className="text-[11px] leading-snug text-muted-foreground">{meta.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ capability matrix

type Feature = "cohost" | "moderation" | "translate" | "tts" | "stt";
const FEATURES: Feature[] = ["cohost", "moderation", "translate", "tts", "stt"];
const MATRIX_PROVIDERS = ["anthropic", "local", "ollama", "openai_compatible"] as const;

/** Which engine can do what, with the reason when it can't. */
export function CapabilityMatrix() {
  const t = useT();
  const h = t.hub;
  const why: Partial<Record<(typeof MATRIX_PROVIDERS)[number], Partial<Record<Feature, string>>>> = {
    anthropic: { tts: h.why.claudeTts, stt: h.why.claudeStt },
    local: { tts: h.why.localTts, stt: h.why.localStt },
    ollama: { tts: h.why.ollamaTts, stt: h.why.ollamaStt },
    openai_compatible: { tts: h.why.openaiTts, stt: h.why.openaiStt },
  };
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[520px] text-xs">
        <thead>
          <tr className="border-b bg-muted/40 text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium" />
            {MATRIX_PROVIDERS.map((p) => (
              <th key={p} className="px-3 py-2 text-center font-medium">
                {h.providers[p].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {FEATURES.map((f) => (
            <tr key={f} className="border-b last:border-0">
              <td className="px-3 py-2 font-medium">{h.features[f]}</td>
              {MATRIX_PROVIDERS.map((p) => {
                const reason = why[p]?.[f];
                const partial = p === "openai_compatible" && reason;
                return (
                  <td key={p} className="px-3 py-2 text-center">
                    {reason ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className={cn("inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5", partial ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground")}>
                            {partial ? "~" : <X className="size-3" />} {partial ? "" : h.no}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-64">{reason}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-400">
                        <Check className="size-3" /> {h.yes}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ overview tab

/** "AI hub" tab: engine choice, local engines, downloaded models and what each AI can do. */
export function HubOverview({ onConfigure }: { onConfigure: (tab: "llm" | "tts" | "stt") => void }) {
  const t = useT();
  const h = t.hub;
  const status = useHub((s) => s.status);
  const provider = useStore((s) => s.state!.ai.llm.provider);
  const [browse, setBrowse] = useState<HubModelKind | null>(null);
  const kinds: HubModelKind[] = ["llm", "whisper", "piper"];
  const total = kinds.reduce((a, k) => a + (status?.models[k] ?? []).reduce((b, m) => b + m.size, 0), 0);
  const count = kinds.reduce((a, k) => a + (status?.models[k]?.length ?? 0), 0);
  const running = status && (status.running.llm || status.running.stt);
  return (
    <div className="flex flex-col gap-4" data-testid="ai-hub">
      <Section title={h.engine} description={h.engineDesc} icon={<Sparkles />} action={<Button size="sm" variant="outline" onClick={() => onConfigure("llm")}>{h.configure}</Button>}>
        <ProviderCards
          value={provider}
          onChange={(p) => {
            act((c) => c.setAi({ llm: { provider: p, ...(p === "anthropic" ? { model: "claude-opus-5-5" } : {}) } }));
            if (p !== "none") onConfigure("llm");
          }}
        />
        {provider === "none" && <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{h.noEngine}</p>}
      </Section>

      <Section title={h.engines} description={h.enginesDesc} icon={<Cpu />}>
        <div className="grid gap-3 lg:grid-cols-3">
          {(["llama", "whisper", "piper"] as HubRuntimeId[]).map((id) => (
            <RuntimeCard key={id} id={id} />
          ))}
        </div>
      </Section>

      <Section
        title={h.models}
        description={fmt(h.modelsDesc, { n: count, size: formatBytes(total, t.locale) })}
        icon={<HardDrive />}
        action={
          running ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    if (await act((c) => c.hubStop())) {
                      toast.success(h.stopped);
                      useHub.getState().refresh();
                    }
                  }}
                >
                  <MemoryStick /> {h.stopServers}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-60">{h.stopServersHint}</TooltipContent>
            </Tooltip>
          ) : undefined
        }
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {kinds.map((k) => (
            <div key={k} className="flex min-w-0 flex-col gap-2">
              <span className="text-xs font-medium text-muted-foreground">{h.kinds[k]}</span>
              <ModelList kind={k} onBrowse={() => setBrowse(k)} />
            </div>
          ))}
        </div>
      </Section>

      <Section title={h.matrix} description={h.matrixDesc} icon={<Check />}>
        <CapabilityMatrix />
      </Section>
      {browse && <ModelBrowser kind={browse} open onOpenChange={(o) => !o && setBrowse(null)} />}
      {status?.dir && (
        <button type="button" className="flex items-center gap-1.5 self-start text-[11px] text-muted-foreground hover:text-foreground" onClick={() => revealPath(status.dir)}>
          <ExternalLink className="size-3" /> {status.dir}
        </button>
      )}
    </div>
  );
}
