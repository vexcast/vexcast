import type { Destination } from "@vexcast/protocol";
import { Check, ChevronsUpDown, ExternalLink, Eye, EyeOff, KeyRound, Loader2, RefreshCw, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { AccountAvatar, AccountDestinationPicker, addAccountDestination } from "@/components/accounts/accounts-card";
import { linkedPlatform } from "@/components/accounts/connect-button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useT } from "@/i18n";
import { useCatalogEntry } from "@/lib/catalog";
import { fmt } from "@/lib/format";
import { act, useStore } from "@/lib/store";
import { PlatformBadge } from "@/lib/platforms";
import { openExternal } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { EncoderSettings, encoderOptions } from "./encoder-settings";
import { FormRow, SelectField } from "./form";

const CUSTOM = "Custom";
export type Draft = Omit<Destination, "id"> & { id?: string };

export const emptyDestination = (): Draft => ({ name: "", service: "Twitch", server: "", streamKey: "", enabled: true, canvas: "horizontal", encoderOverride: null });

function ServicePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const s = t.settings.stream;
  const services = useCatalogEntry("services");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="h-8 w-full max-w-sm justify-between font-normal" data-testid="service-picker">
          {value === CUSTOM ? s.custom : value || s.service}
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={s.searchService} />
          <CommandList>
            <CommandEmpty>{s.noService}</CommandEmpty>
            <CommandGroup>
              {(services ?? [])
                .filter((x) => x.name !== CUSTOM)
                .map((x) => (
                  <CommandItem
                    key={x.name}
                    value={x.name}
                    onSelect={() => {
                      onChange(x.name);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn(value === x.name ? "opacity-100" : "opacity-0")} />
                    {x.name}
                    <span className="ml-auto text-xs text-muted-foreground">{x.protocol}</span>
                  </CommandItem>
                ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="__custom"
                onSelect={() => {
                  onChange(CUSTOM);
                  setOpen(false);
                }}
              >
                <Check className={cn(value === CUSTOM ? "opacity-100" : "opacity-0")} />
                {s.custom}
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Vertical platforms: fill in the server and the 9:16 canvas in one click. */
export const VERTICAL_PRESETS = [
  { id: "tiktok", platform: "tiktok" as const, url: "", help: "https://livecenter.tiktok.com/producer" },
  { id: "shorts", platform: "youtube" as const, url: "rtmp://a.rtmp.youtube.com/live2", help: "https://studio.youtube.com/channel/UC/livestreaming" },
  { id: "instagram", platform: "custom" as const, url: "rtmps://live-upload.instagram.com:443/rtmp/", help: "https://www.instagram.com/" },
];

export const tiktokDraft = (): Draft => ({ ...emptyDestination(), name: "TikTok", service: CUSTOM, server: "", canvas: "vertical" });

function VerticalPresets({ d, onPick }: { d: Draft; onPick: (p: Partial<Draft>) => void }) {
  const t = useT();
  const v = t.vertical;
  const label = (id: string) => (id === "tiktok" ? "TikTok" : id === "shorts" ? v.shorts : v.instagram);
  const current = VERTICAL_PRESETS.find((p) => d.canvas === "vertical" && d.name === label(p.id));
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{v.presets}</span>
        <span className="text-[11px] text-muted-foreground">{v.presetsHint}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {VERTICAL_PRESETS.map((p) => (
          <Button
            key={p.id}
            type="button"
            size="sm"
            variant={current?.id === p.id ? "default" : "outline"}
            className="h-8 gap-2"
            onClick={() => onPick({ name: label(p.id), service: CUSTOM, server: p.url, canvas: "vertical" })}
            data-testid={`preset-${p.id}`}
          >
            <PlatformBadge platform={p.platform} size={18} />
            {label(p.id)}
          </Button>
        ))}
      </div>
      {current?.id === "tiktok" && (
        <div className="grid gap-1.5 text-xs text-muted-foreground">
          <p>{v.tiktokSteps}</p>
          <p>{v.tiktokAccess}</p>
          <Button type="button" variant="link" size="sm" className="h-auto justify-start p-0 text-xs" onClick={() => openExternal(current.help)}>
            <ExternalLink className="size-3" /> {v.openTiktok}
          </Button>
        </div>
      )}
    </div>
  );
}

export function DestinationDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const t = useT();
  const s = t.settings.stream;
  const services = useCatalogEntry("services");
  const encoders = useCatalogEntry("encoders");
  const [d, setD] = useState<Draft | null>(draft);
  const [showKey, setShowKey] = useState(false);
  // Vertical drafts (TikTok…) have no sign-in: start on the manual form.
  const [method, setMethod] = useState<"account" | "manual">(draft?.canvas === "vertical" ? "manual" : "account");
  useEffect(() => {
    setD(draft);
    setShowKey(false);
    setMethod(draft?.canvas === "vertical" ? "manual" : "account");
  }, [draft]);
  const linked = d?.id ? linkedPlatform(d.name) : null;
  const linkedAccount = useStore((x) => (linked ? x.state?.accounts?.find((a) => a.platform === linked && a.connected) : undefined));
  const [refreshing, setRefreshing] = useState(false);
  if (!d) return <Dialog open={false} />;
  const a = t.accounts;
  // New destination, "Con tu cuenta" tab: no manual form.
  const accountMode = !d.id && method === "account";
  const service = services?.find((x) => x.name === d.service);
  const custom = d.service === CUSTOM || !service;
  const upd = (p: Partial<Draft>) => setD({ ...d, ...p });
  const save = async () => {
    const { id, ...body } = d;
    const name = body.name.trim() || body.service;
    const ok = id
      ? await act((c) => c.updateDestination(id, { ...body, name, ...(body.streamKey ? {} : { streamKey: undefined }) }))
      : await act((c) => c.createDestination({ ...body, name }));
    if (ok) onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl" data-testid="destination-dialog">
        <DialogHeader>
          <DialogTitle>{d.id ? s.edit : s.add}</DialogTitle>
          <DialogDescription className="sr-only">{s.destinationsDesc}</DialogDescription>
        </DialogHeader>
        {!d.id && (
          <Tabs value={method} onValueChange={(v) => setMethod(v as "account" | "manual")}>
            <TabsList className="w-full">
              <TabsTrigger value="account" data-testid="dest-method-account">
                <UserRound /> {a.methodAccount}
              </TabsTrigger>
              <TabsTrigger value="manual" data-testid="dest-method-manual">
                <KeyRound /> {a.methodManual}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {linked && linkedAccount && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
            <AccountAvatar account={linkedAccount} className="size-8" />
            <span className="min-w-0 flex-1 text-sm">{fmt(a.linkedTo, { user: linkedAccount.displayName || linkedAccount.login || "" })}</span>
            <Button
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                const ok = await addAccountDestination(linked, a.keyRefreshed);
                setRefreshing(false);
                if (ok) onClose();
              }}
            >
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} {a.refreshKey}
            </Button>
          </div>
        )}
        {accountMode ? (
          <AccountDestinationPicker onDone={onClose} />
        ) : (
        <div className="grid gap-3">
          {!d.id && <p className="text-sm text-muted-foreground">{a.methodManualDesc}</p>}
          {!d.id && <VerticalPresets d={d} onPick={upd} />}
          <FormRow label={s.name} htmlFor="dst-name">
            <Input id="dst-name" value={d.name} placeholder={d.service} onChange={(e) => upd({ name: e.target.value })} className="h-8 max-w-sm" />
          </FormRow>
          <FormRow label={s.service}>
            <ServicePicker
              value={d.service}
              onChange={(v) => {
                const sv = services?.find((x) => x.name === v);
                upd({ service: v, server: sv?.servers[0]?.url ?? "", name: d.name || (v === CUSTOM ? "" : v) });
              }}
            />
          </FormRow>
          <FormRow label={custom ? s.serverUrl : s.server} hint={service?.recommended?.maxVideoBitrate ? fmt(s.recommended, { bitrate: service.recommended.maxVideoBitrate }) : undefined}>
            {custom ? (
              <Input value={d.server} placeholder="rtmp://…" onChange={(e) => upd({ server: e.target.value })} className="h-8 max-w-sm font-mono text-xs" />
            ) : (
              <SelectField value={d.server} onChange={(v) => upd({ server: v })} options={service!.servers.map((x) => ({ value: x.url, label: x.name }))} />
            )}
          </FormRow>
          <FormRow label={s.streamKey} htmlFor="dst-key" hint={d.id ? s.keyHint : undefined}>
            <div className="flex max-w-sm gap-1.5">
              <Input id="dst-key" type={showKey ? "text" : "password"} value={d.streamKey} placeholder={d.id ? "••••••••" : ""} onChange={(e) => upd({ streamKey: e.target.value })} className="h-8 font-mono text-xs" />
              <Button variant="outline" size="sm" className="h-8" onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff /> : <Eye />}
                {showKey ? s.hideKey : s.showKey}
              </Button>
            </div>
          </FormRow>
          <FormRow label={s.canvas}>
            <ToggleGroup type="single" variant="outline" size="sm" value={d.canvas} onValueChange={(v) => v && upd({ canvas: v as Destination["canvas"] })}>
              <ToggleGroupItem value="horizontal" className="px-3">
                {s.canvases.horizontal}
              </ToggleGroupItem>
              <ToggleGroupItem value="vertical" className="px-3">
                {s.canvases.vertical}
              </ToggleGroupItem>
            </ToggleGroup>
          </FormRow>
          <FormRow>
            <div className="flex items-center gap-2">
              <Checkbox
                id="dst-enc"
                checked={!!d.encoderOverride}
                onCheckedChange={(v) => upd({ encoderOverride: v ? { encoder: encoders?.find((e) => e.type === "video" && e.hardware)?.id ?? "obs_x264", settings: {} } : null })}
              />
              <Label htmlFor="dst-enc" className="font-normal">
                {s.encoderOverride}
              </Label>
            </div>
          </FormRow>
          {d.encoderOverride && (
            <div className="grid max-h-72 gap-3 overflow-y-auto rounded-md border p-3">
              <FormRow label={s.encoder}>
                <SelectField value={d.encoderOverride.encoder} onChange={(v) => upd({ encoderOverride: { encoder: v, settings: {} } })} options={encoderOptions(encoders, "video", t.settings.output)} />
              </FormRow>
              <EncoderSettings encoder={d.encoderOverride.encoder} settings={d.encoderOverride.settings} onChange={(st) => upd({ encoderOverride: { ...d.encoderOverride!, settings: st } })} />
            </div>
          )}
        </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {accountMode ? t.common.close : t.common.cancel}
          </Button>
          {!accountMode && (
            <Button onClick={save} disabled={!d.server.trim() || (!d.id && !d.streamKey.trim())} data-testid="dest-save">
              {t.common.save}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
