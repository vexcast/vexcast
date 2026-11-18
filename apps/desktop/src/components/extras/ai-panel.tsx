import type { AiSettings, LlmProvider, LlmSettings, SttProvider, TtsProvider } from "@vexcast/protocol";
import { Brain, Captions, CheckCircle2, ExternalLink, Info, LayoutGrid, Loader2, MessageCircleHeart, Play, Send, ShieldCheck, Sparkles, Speech, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { act, EMPTY, errorMessage, useStore } from "@/lib/store";
import { openExternal } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { HubOverview, ModelBrowser, ModelList, ProviderCards, RuntimeCard, useHub, useHubPolling } from "./ai-hub";
import { Field, fromSelect, Hint, isMasked, NONE, num, PanelTabs, SaveBar, SecretInput, Section, SwitchRow, toSelect, TRANSLATE_LANGS, useDraft } from "./shared";

type SectionKey = keyof AiSettings;
type Tab = "hub" | "tts" | "llm" | "cohost" | "moderation" | "stt";

/** Local draft of one AI section, saved explicitly. */
function useSection<K extends SectionKey>(key: K) {
  const t = useT();
  const value = useStore((s) => s.state!.ai[key]);
  const { draft, set, dirty, reset } = useDraft(value);
  const [saving, setSaving] = useState(false);
  const save = async (patch?: Partial<AiSettings[K]>) => {
    setSaving(true);
    const r = await act((c) => c.setAi({ [key]: patch ?? draft } as Partial<AiSettings>), patch ? undefined : t.common.saved);
    setSaving(false);
    return r;
  };
  return { d: draft, set, dirty, save, reset, saving };
}

/** Split a hint like "Text: command — rest" into text and copyable command. */
function splitHint(h: string): { text: string; cmd?: string } {
  const m = h.match(/(ollama pull \S+|docker run [^—]+)/);
  return m ? { text: h.replace(m[0], "…").trim(), cmd: m[0].trim() } : { text: h };
}

function StateBadge({ on }: { on: boolean }) {
  const t = useT();
  return (
    <Badge variant={on ? "secondary" : "outline"} className="gap-1.5">
      <span className={cn("size-1.5 rounded-full", on ? "bg-emerald-500" : "bg-muted-foreground/40")} />
      {on ? t.common.enabled : t.common.disabled}
    </Badge>
  );
}

function ProviderSelect<P extends string>({ value, options, onChange }: { value: P; options: readonly P[]; onChange: (p: P) => void }) {
  const t = useT();
  return (
    <Select value={value} onValueChange={(v) => onChange(v as P)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((p) => (
          <SelectItem key={p} value={p}>
            {t.ai.providers[p as keyof typeof t.ai.providers] ?? p}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LangSelect({ value, onChange, emptyLabel }: { value: string; onChange: (v: string) => void; emptyLabel: string }) {
  const t = useT();
  return (
    <Select value={toSelect(value)} onValueChange={(v) => onChange(fromSelect(v))}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TRANSLATE_LANGS.map((l) => (
          <SelectItem key={l} value={toSelect(l)}>
            {l === "" ? emptyLabel : t.languages[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Busy({ busy, icon }: { busy: boolean; icon: ReactNode }) {
  return busy ? <Loader2 className="animate-spin" /> : <>{icon}</>;
}

/** Name of the configured text engine. */
function useEngineName(): { provider: LlmProvider; name: string } {
  const t = useT();
  const llm = useStore((s) => s.state!.ai.llm);
  const h = t.hub;
  const name =
    llm.provider === "none"
      ? h.engineNone
      : llm.provider === "anthropic"
        ? (h.claudeModels[llm.model as keyof typeof h.claudeModels]?.name ?? llm.model)
        : llm.provider === "local"
          ? `${h.providers.local.name} · ${llm.localModel.replace(/\.gguf$/i, "") || "—"}`
          : `${h.providers[llm.provider].name} · ${llm.model}`;
  return { provider: llm.provider, name };
}

/** "Uses: Claude Haiku 5.5 [Change]" strip for the features that need the text engine. */
function EngineStrip({ onChange }: { onChange: () => void }) {
  const t = useT();
  const { provider, name } = useEngineName();
  const none = provider === "none";
  return (
    <div className={cn("flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs", none ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400" : "bg-muted/30 text-muted-foreground")}>
      <Brain className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{none ? t.hub.noEngine : fmt(t.hub.engineInUse, { engine: name })}</span>
      <Button size="sm" variant="outline" className="h-7" onClick={onChange}>
        {none ? t.hub.configure : t.hub.change}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ TTS

function TtsSection({ onHub }: { onHub: () => void }) {
  const t = useT();
  const h = t.hub;
  const { d, set, dirty, save, reset, saving } = useSection("tts");
  const client = useStore((s) => s.client);
  const llmProvider = useStore((s) => s.state!.ai.llm.provider);
  const piperInstalled = useHub((s) => !!s.status?.runtimes.find((r) => r.id === "piper")?.installed);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [browse, setBrowse] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  const test = async () => {
    if (!client || busy) return;
    if (dirty) await save();
    setBusy(true);
    try {
      // Preview: heard only here, not on stream (and not twice).
      const { url } = await client.speak(text.trim() || t.ai.testVoiceDefault, true);
      audio.current?.pause();
      audio.current = new Audio(client.url(url, true));
      await audio.current.play();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const hint = d.provider === "openai_compatible" ? t.ai.hints.kokoro : d.provider === "system" ? t.ai.hints.system : null;
  const hh = hint ? splitHint(hint) : null;
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title={t.ai.tts} description={t.ai.ttsDesc} icon={<Speech />} action={<StateBadge on={d.provider !== "none"} />}>
            {llmProvider === "anthropic" && (
              <p className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" /> {h.claudeNoVoice}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.ai.provider}>
                <ProviderSelect value={d.provider} options={["none", "system", "piper", "openai_compatible"] as TtsProvider[]} onChange={(provider) => set({ provider })} />
              </Field>
              <Field label={`${t.ai.speed} · ${d.speed.toFixed(2)}×`}>
                <Slider min={0.5} max={2} step={0.05} value={[d.speed]} onValueChange={([speed]) => set({ speed })} className="my-auto py-2" />
              </Field>
            </div>
            {d.provider === "piper" && (
              <>
                <RuntimeCard id="piper" />
                <Field label={h.piperVoice}>
                  <ModelList kind="piper" value={d.voice.split(/[\\/]/).pop()} onChange={(voice) => set({ voice })} onBrowse={() => setBrowse(true)} />
                </Field>
                {!piperInstalled && (
                  <Field label={t.ai.piperPath}>
                    <Input value={d.piperPath} onChange={(e) => set({ piperPath: e.target.value })} className="font-mono text-xs" placeholder="piper" spellCheck={false} />
                  </Field>
                )}
              </>
            )}
            {d.provider === "openai_compatible" && (
              <Field label={t.ai.endpoint}>
                <Input value={d.endpoint} onChange={(e) => set({ endpoint: e.target.value })} className="font-mono text-xs" placeholder="http://localhost:8880/v1" spellCheck={false} />
              </Field>
            )}
            {(d.provider === "system" || d.provider === "openai_compatible") && (
              <Field label={t.ai.voice} hint={t.ai.voiceHint}>
                <Input value={d.voice} onChange={(e) => set({ voice: e.target.value })} className="font-mono text-xs" placeholder={d.provider === "system" ? "Microsoft Helena Desktop" : "ef_dora"} spellCheck={false} />
              </Field>
            )}
            {d.provider !== "none" && (
              <>
                <SwitchRow label={t.ai.readChat} checked={d.readChat} onCheckedChange={(readChat) => set({ readChat })} />
                {d.readChat && (
                  <Field label={t.ai.readChatPrefix}>
                    <Input value={d.readChatPrefix} onChange={(e) => set({ readChatPrefix: e.target.value })} className="w-40 font-mono" />
                  </Field>
                )}
              </>
            )}
          </Section>
        </div>
        <div className="flex flex-col gap-4">
          <Section title={t.ai.testVoice} icon={<Play />}>
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t.ai.testVoicePlaceholder} />
            <Button onClick={test} disabled={busy || d.provider === "none"} data-testid="ai-test-voice">
              <Busy busy={busy} icon={<Play />} /> {t.ai.testVoice}
            </Button>
          </Section>
          {hh && (
            <Hint cmd={hh.cmd}>
              <span className="font-medium text-foreground">{t.ai.howTo}. </span>
              {hh.text}
            </Hint>
          )}
          <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={onHub}>
            <LayoutGrid /> {h.goHub}
          </Button>
        </div>
      </div>
      {browse && <ModelBrowser kind="piper" open onOpenChange={setBrowse} />}
      <SaveBar dirty={dirty} saving={saving} onSave={() => save()} onReset={reset} />
    </>
  );
}

// ------------------------------------------------------------------ LLM

const CLAUDE_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;

function ClaudeConfig({ d, set, models }: { d: LlmSettings; set: (p: Partial<LlmSettings>) => void; models: string[] }) {
  const t = useT();
  const h = t.hub;
  const masked = isMasked(d.apiKey);
  const others = models.filter((m) => !(CLAUDE_MODELS as readonly string[]).includes(m));
  return (
    <Section title={h.providers.anthropic.name} description={h.claudeInfo} icon={<Sparkles />}>
      <Field
        label={h.claudeKey}
        hint={
          <span className="flex flex-wrap items-center gap-x-2">
            {h.claudeKeyHint}
            <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => openExternal("https://console.anthropic.com/settings/keys")}>
              <ExternalLink className="size-3" /> {h.getKey}
            </button>
          </span>
        }
      >
        <SecretInput value={masked ? "" : d.apiKey} onChange={(apiKey) => set({ apiKey })} placeholder={masked ? d.apiKey : "sk-ant-…"} />
      </Field>
      <Field label={h.claudeModel}>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {CLAUDE_MODELS.map((m) => {
            const meta = h.claudeModels[m];
            const active = d.model === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set({ model: m })}
                className={cn("flex min-w-0 flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50", active && "border-primary bg-primary/5 ring-1 ring-primary/40")}
              >
                <span className="text-sm font-medium">{meta.name}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">{meta.note}</span>
              </button>
            );
          })}
        </div>
      </Field>
      {others.length > 0 && (
        <Field label={h.otherModels}>
          <div className="flex flex-wrap gap-1.5">
            {others.map((m) => (
              <Button key={m} size="sm" variant={d.model === m ? "default" : "outline"} className="h-7 px-2 font-mono text-xs" onClick={() => set({ model: m })}>
                {m}
              </Button>
            ))}
          </div>
        </Field>
      )}
      <ul className="flex flex-col gap-1.5 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        {[h.claudeCost, h.claudePrivacy, h.claudeFallback].map((x) => (
          <li key={x} className="flex gap-2">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function LocalConfig({ d, set }: { d: LlmSettings; set: (p: Partial<LlmSettings>) => void }) {
  const t = useT();
  const h = t.hub;
  const models = useHub((s) => s.status?.models.llm ?? EMPTY);
  const loaded = useHub((s) => s.status?.running.llm ?? null);
  const [browse, setBrowse] = useState(false);
  // Pick the first downloaded model when none is chosen.
  useEffect(() => {
    if (!d.localModel && models.length) set({ localModel: models[0].file });
  }, [d.localModel, models, set]);
  return (
    <Section title={h.providers.local.name} description={h.providers.local.sub} icon={<Brain />}>
      <RuntimeCard id="llama" />
      <Field label={h.localModel}>
        <ModelList kind="llm" value={d.localModel} onChange={(localModel) => set({ localModel })} onBrowse={() => setBrowse(true)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={h.context} hint={h.contextHint}>
          <Select value={String(d.localContext)} onValueChange={(v) => set({ localContext: Number(v) })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2048, 4096, 8192, 16384].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n.toLocaleString(t.locale)} tokens
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-end">
          <SwitchRow label={h.useGpu} checked={d.localGpu} onCheckedChange={(localGpu) => set({ localGpu })} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{loaded ? fmt(h.localStatusLoaded, { model: loaded }) : h.localStatusIdle}</p>
      {browse && <ModelBrowser kind="llm" open onOpenChange={setBrowse} />}
    </Section>
  );
}

function LlmSection() {
  const t = useT();
  const h = t.hub;
  const { d, set, dirty, save, reset, saving } = useSection("llm");
  const [result, setResult] = useState<{ ok: boolean; models: string[]; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const testConn = async () => {
    if (dirty) await save();
    setBusy(true);
    const r = await act((c) => c.testLlm());
    setBusy(false);
    if (r) setResult(r);
  };
  const pick = (provider: LlmProvider) => {
    setResult(null);
    const claude = d.model.startsWith("claude");
    set({
      provider,
      model: provider === "anthropic" ? (claude ? d.model : "claude-opus-5-5") : claude ? (provider === "ollama" ? "llama3.2" : "") : d.model,
      endpoint: provider === "ollama" && !d.endpoint ? "http://localhost:11434" : d.endpoint,
    });
  };
  const masked = isMasked(d.apiKey);
  const remote = d.provider === "ollama" || d.provider === "openai_compatible";
  return (
    <>
      <div className="flex flex-col gap-4">
        <Section title={t.ai.llm} description={h.engineDesc} icon={<Brain />} action={<StateBadge on={d.provider !== "none"} />}>
          <ProviderCards value={d.provider} onChange={pick} />
        </Section>
        {d.provider === "anthropic" && <ClaudeConfig d={d} set={set} models={result?.ok ? result.models : []} />}
        {d.provider === "local" && <LocalConfig d={d} set={set} />}
        {remote && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Section title={h.providers[d.provider].name} description={h.providers[d.provider].sub} icon={<Brain />}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t.ai.endpoint}>
                  <Input value={d.endpoint} onChange={(e) => set({ endpoint: e.target.value })} className="font-mono text-xs" placeholder={d.provider === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1"} spellCheck={false} />
                </Field>
                <Field label={t.ai.model}>
                  <Input value={d.model} onChange={(e) => set({ model: e.target.value })} className="font-mono text-xs" placeholder="llama3.2" spellCheck={false} />
                </Field>
              </div>
              {d.provider === "openai_compatible" && (
                <Field label={t.ai.apiKey} hint={t.ai.apiKeyHint}>
                  <SecretInput value={masked ? "" : d.apiKey} onChange={(apiKey) => set({ apiKey })} placeholder={masked ? d.apiKey : "sk-…"} />
                </Field>
              )}
              {result?.ok && result.models.length > 0 && (
                <Field label={t.ai.availableModels}>
                  <div className="flex flex-wrap gap-1.5">
                    {result.models.map((m) => (
                      <Button key={m} size="sm" variant={d.model === m ? "default" : "outline"} className="h-7 px-2 font-mono text-xs" onClick={() => set({ model: m })}>
                        {m}
                      </Button>
                    ))}
                  </div>
                </Field>
              )}
            </Section>
            {d.provider === "ollama" && (
              <Hint cmd={splitHint(t.ai.hints.ollama).cmd}>
                <span className="font-medium text-foreground">{t.ai.howTo}. </span>
                {splitHint(t.ai.hints.ollama).text}
              </Hint>
            )}
          </div>
        )}
        {d.provider !== "none" && (
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={testConn} disabled={busy} data-testid="ai-test-llm">
              <Busy busy={busy} icon={<CheckCircle2 />} /> {t.ai.testConnection}
            </Button>
            {result &&
              (result.ok ? (
                <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" /> {fmt(t.ai.connectionOk, { n: result.models.length })}
                </span>
              ) : (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-sm break-words text-destructive">
                  <XCircle className="size-4 shrink-0" /> {result.error}
                </span>
              ))}
          </div>
        )}
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={() => save()} onReset={reset} />
    </>
  );
}

// ------------------------------------------------------------------ co-host

function CohostSection({ onEngine }: { onEngine: () => void }) {
  const t = useT();
  const { d, set, dirty, save, reset, saving } = useSection("cohost");
  const llmOn = useStore((s) => s.state?.ai.llm.provider !== "none");
  const [q, setQ] = useState("");
  const [log, setLog] = useState<{ q: string; a: string | null; error?: boolean }[]>([]);
  const ask = async () => {
    const text = q.trim();
    if (!text) return;
    if (dirty) await save();
    setQ("");
    setLog((l) => [...l, { q: text, a: null }]);
    const client = useStore.getState().client;
    try {
      const r = await client!.askCohost(text);
      setLog((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, a: r.reply || "—" } : x)));
    } catch (e) {
      setLog((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, a: errorMessage(e), error: true } : x)));
    }
  };
  return (
    <>
      <div className="flex flex-col gap-4">
        <EngineStrip onChange={onEngine} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            title={t.ai.cohost}
            description={t.ai.cohostDesc}
            icon={<MessageCircleHeart />}
            action={<Switch checked={d.enabled} onCheckedChange={(enabled) => (set({ enabled }), save({ enabled }))} aria-label={t.common.enabled} />}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
              <Field label={t.ai.cohostName}>
                <Input value={d.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label={t.ai.cooldown}>
                <Input type="number" min={0} value={d.cooldownSec} onChange={(e) => set({ cooldownSec: Math.max(0, num(e.target.value, d.cooldownSec)) })} />
              </Field>
            </div>
            <Field label={t.ai.persona} hint={t.ai.personaHint}>
              <Textarea rows={6} value={d.persona} onChange={(e) => set({ persona: e.target.value })} />
            </Field>
            <SwitchRow label={t.ai.speak} checked={d.speak} onCheckedChange={(speak) => set({ speak })} />
            <SwitchRow label={t.ai.replyInChat} checked={d.replyInChat} onCheckedChange={(replyInChat) => set({ replyInChat })} />
          </Section>
          <Section title={t.ai.playground} icon={<Send />} className="min-h-[360px]">
            <div className="flex min-h-[220px] flex-1 flex-col gap-2 rounded-md border bg-muted/30 p-3">
              {log.length === 0 && <p className="m-auto max-w-[260px] text-center text-xs text-muted-foreground">{t.ai.askPlaceholder}</p>}
              {log.map((x, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="selectable max-w-[85%] self-end rounded-lg bg-primary px-3 py-1.5 text-sm break-words text-primary-foreground">{x.q}</div>
                  <div className={cn("selectable max-w-[85%] self-start rounded-lg border bg-background px-3 py-1.5 text-sm break-words", x.error && "border-destructive/40 text-destructive")}>
                    <span className="mr-1 text-xs font-semibold text-muted-foreground">{d.name}</span>
                    {x.a ?? <Loader2 className="inline size-3.5 animate-spin text-muted-foreground" />}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder={t.ai.askPlaceholder} disabled={!llmOn} />
              <Button onClick={ask} disabled={!llmOn || !q.trim()} data-testid="ai-ask">
                <Send /> {t.ai.ask}
              </Button>
            </div>
          </Section>
        </div>
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={() => save()} onReset={reset} />
    </>
  );
}

// ------------------------------------------------------------------ moderation

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const t = useT();
  const [text, setText] = useState("");
  const add = () => {
    const words = text
      .split(",")
      .map((w) => w.trim())
      .filter((w) => w && !value.includes(w));
    if (words.length) onChange([...value, ...words]);
    setText("");
  };
  return (
    <div className="flex flex-col gap-2">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        placeholder={placeholder}
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((w) => (
            <Badge key={w} variant="secondary" className="gap-1 pr-1">
              {w}
              <button type="button" className="rounded-sm opacity-60 hover:opacity-100" onClick={() => onChange(value.filter((x) => x !== w))} aria-label={`${t.common.delete} ${w}`}>
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ModerationSection({ onEngine }: { onEngine: () => void }) {
  const t = useT();
  const { d, set, dirty, save, reset, saving } = useSection("moderation");
  return (
    <>
      <div className="flex flex-col gap-4">
        {d.useAi && <EngineStrip onChange={onEngine} />}
        <Section
          title={t.ai.moderation}
          description={t.ai.moderationDesc}
          icon={<ShieldCheck />}
          action={<Switch checked={d.enabled} onCheckedChange={(enabled) => (set({ enabled }), save({ enabled }))} aria-label={t.common.enabled} />}
        >
          <div className={cn("flex flex-col gap-4 transition-opacity", !d.enabled && "opacity-60")}>
            <Field label={t.ai.blockedWords}>
              <TagInput value={d.blockedWords} onChange={(blockedWords) => set({ blockedWords })} placeholder={t.ai.blockedWordsPlaceholder} />
            </Field>
            <SwitchRow label={t.ai.useAi} checked={d.useAi} onCheckedChange={(useAi) => set({ useAi })} />
            <SwitchRow label={t.ai.autoDelete} checked={d.autoDelete} onCheckedChange={(autoDelete) => set({ autoDelete })} />
          </div>
        </Section>
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={() => save()} onReset={reset} />
    </>
  );
}

// ------------------------------------------------------------------ captions (STT)

function SttSection() {
  const t = useT();
  const h = t.hub;
  const { d, set, dirty, save, reset, saving } = useSection("stt");
  const sources = useStore((s) => s.state?.sources ?? EMPTY);
  const mics = sources.filter((x) => x.audio);
  const captions = useStore((s) => s.state!.widgets.captions);
  const mutate = useStore((s) => s.mutate);
  const { name: engine } = useEngineName();
  const llmProvider = useStore((s) => s.state!.ai.llm.provider);
  const whisperModels = useHub((s) => s.status?.models.whisper ?? EMPTY);
  const [browse, setBrowse] = useState(false);
  const setCaptions = (patch: Partial<typeof captions>) => {
    mutate((s) => ({ ...s, widgets: { ...s.widgets, captions: { ...s.widgets.captions, ...patch } } }));
    act((c) => c.setWidgets({ captions: patch }));
  };
  useEffect(() => {
    if (d.provider === "local" && !d.localModel && whisperModels.length) set({ localModel: whisperModels[0].file });
  }, [d.provider, d.localModel, whisperModels, set]);
  const missing = d.sourceId && !mics.some((m) => m.uuid === d.sourceId);
  const masked = isMasked(d.apiKey);
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section title={t.ai.stt} description={t.ai.sttDesc} icon={<Captions />}>
            <SwitchRow label={t.ai.sttEnable} hint={t.alerts.captionsHint} checked={captions.enabled} onCheckedChange={(enabled) => setCaptions({ enabled })} />
            <Field label={h.sttProvider}>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                {(["local", "openai_compatible"] as SttProvider[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={d.provider === p}
                    onClick={() => set({ provider: p })}
                    className={cn("flex min-w-0 flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50", d.provider === p && "border-primary bg-primary/5 ring-1 ring-primary/40")}
                  >
                    <span className="text-sm font-medium">{h.sttProviders[p]}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">{p === "local" ? h.sttLocalDesc : h.sttOpenAiDesc}</span>
                  </button>
                ))}
              </div>
            </Field>
            {d.provider === "local" ? (
              <>
                <RuntimeCard id="whisper" />
                <Field label={h.whisperModel}>
                  <ModelList kind="whisper" value={d.localModel} onChange={(localModel) => set({ localModel })} onBrowse={() => setBrowse(true)} />
                </Field>
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t.ai.endpoint}>
                    <Input value={d.endpoint} onChange={(e) => set({ endpoint: e.target.value })} className="font-mono text-xs" placeholder="https://api.openai.com/v1" spellCheck={false} />
                  </Field>
                  <Field label={t.ai.model}>
                    <Input value={d.model} onChange={(e) => set({ model: e.target.value })} className="font-mono text-xs" placeholder="whisper-1" spellCheck={false} />
                  </Field>
                </div>
                <Field label={t.ai.apiKey} hint={t.ai.apiKeyHint}>
                  <SecretInput value={masked ? "" : d.apiKey} onChange={(apiKey) => set({ apiKey })} placeholder={masked ? d.apiKey : "sk-…"} />
                </Field>
              </>
            )}
            <Field label={t.ai.micSource}>
              <Select value={d.sourceId || NONE} onValueChange={(v) => set({ sourceId: v === NONE ? null : v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t.common.none}</SelectItem>
                  {missing && <SelectItem value={d.sourceId!}>{d.sourceId}</SelectItem>}
                  {mics.map((m) => (
                    <SelectItem key={m.uuid} value={m.uuid}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.ai.language}>
                <LangSelect value={d.language} onChange={(language) => set({ language })} emptyLabel={t.ai.autoDetect} />
              </Field>
              <Field label={t.ai.translateTo} hint={captions.translateTo ? fmt(h.translateNote, { engine }) : undefined}>
                <LangSelect value={captions.translateTo} onChange={(translateTo) => setCaptions({ translateTo })} emptyLabel={t.alerts.noTranslation} />
              </Field>
            </div>
          </Section>
        </div>
        <div className="flex flex-col gap-4">
          {llmProvider === "anthropic" && (
            <Hint>
              <span className="font-medium text-foreground">Claude. </span>
              {h.why.claudeStt}
            </Hint>
          )}
          {d.provider === "openai_compatible" && (
            <Hint cmd={splitHint(t.ai.hints.whisper).cmd}>
              <span className="font-medium text-foreground">{t.ai.howTo}. </span>
              {splitHint(t.ai.hints.whisper).text}
            </Hint>
          )}
        </div>
      </div>
      {browse && <ModelBrowser kind="whisper" open onOpenChange={setBrowse} />}
      <SaveBar dirty={dirty} saving={saving} onSave={() => save()} onReset={reset} />
    </>
  );
}

// ------------------------------------------------------------------ panel

/** Tool panel: AI hub, voice, text engine, co-host, moderation and live captions. */
export function AiPanel() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("hub");
  useHubPolling();
  return (
    <PanelTabs
      value={tab}
      onValueChange={setTab}
      tabs={[
        { value: "hub", label: t.hub.tab, icon: <LayoutGrid /> },
        { value: "llm", label: t.ai.llm, icon: <Brain /> },
        { value: "tts", label: t.ai.tts, icon: <Speech /> },
        { value: "cohost", label: t.ai.cohost, icon: <MessageCircleHeart /> },
        { value: "moderation", label: t.ai.moderation, icon: <ShieldCheck /> },
        { value: "stt", label: t.alerts.captions, icon: <Captions /> },
      ]}
    >
      <TabsContent value="hub">
        <HubOverview onConfigure={setTab} />
      </TabsContent>
      <TabsContent value="llm">
        <LlmSection />
      </TabsContent>
      <TabsContent value="tts">
        <TtsSection onHub={() => setTab("hub")} />
      </TabsContent>
      <TabsContent value="cohost">
        <CohostSection onEngine={() => setTab("llm")} />
      </TabsContent>
      <TabsContent value="moderation">
        <ModerationSection onEngine={() => setTab("llm")} />
      </TabsContent>
      <TabsContent value="stt">
        <SttSection />
      </TabsContent>
    </PanelTabs>
  );
}
