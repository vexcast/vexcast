import { GuestsSection } from "./guests";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PairingInfo, RemoteDevice } from "@vexcast/protocol";
import { Ban, KeyRound, Loader2, Monitor, Pencil, RotateCw, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useLang, useT } from "@/i18n";
import { confirmDialog, promptDialog } from "@/lib/dialogs";
import { fmt, timeAgo } from "@/lib/format";
import { act, errorMessage, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { CopyField, Field, Steps, SwitchRow } from "./shared";

function QrCanvas({ payload, size = 200 }: { payload: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) QRCode.toCanvas(ref.current, payload, { width: size, margin: 1, color: { dark: "#000000", light: "#ffffff" }, errorCorrectionLevel: "M" }).catch(() => {});
  }, [payload, size]);
  return <canvas ref={ref} style={{ width: size, height: size }} aria-label="QR" />;
}

/** Paired devices: who is connected, block / forget / rename, new devices allowed, new code. */
function DevicesSection({ onNewCode }: { onNewCode: (p: PairingInfo) => void }) {
  const t = useT();
  const r = t.remote;
  const lang = useLang();
  const client = useStore((s) => s.client);
  const allowNew = useStore((s) => s.state?.general.remoteAllowNew ?? true);
  const mutate = useStore((s) => s.mutate);
  const [devices, setDevices] = useState<RemoteDevice[] | null>(null);
  const reload = useCallback(() => {
    client
      ?.remoteDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, [client]);
  useEffect(() => {
    reload();
    const id = setInterval(reload, 3000);
    return () => clearInterval(id);
  }, [reload]);

  const setAllowNew = (remoteAllowNew: boolean) => {
    mutate((s) => ({ ...s, general: { ...s.general, remoteAllowNew } }));
    act((c) => c.setGeneral({ remoteAllowNew }));
  };
  const block = async (d: RemoteDevice, blocked: boolean) => {
    await act((c) => c.updateRemoteDevice(d.id, { blocked }), fmt(blocked ? r.blockedToast : r.unblockedToast, { name: d.name }));
    reload();
  };
  const forget = async (d: RemoteDevice) => {
    if (!(await confirmDialog({ title: fmt(r.forgetConfirm, { name: d.name }), description: r.forgetDesc, confirmLabel: r.forget, destructive: true }))) return;
    await act((c) => c.forgetRemoteDevice(d.id));
    reload();
  };
  const rename = async (d: RemoteDevice) => {
    const name = await promptDialog({ title: r.rename, label: r.name, defaultValue: d.name });
    if (name?.trim()) {
      await act((c) => c.updateRemoteDevice(d.id, { name: name.trim() }));
      reload();
    }
  };
  const newCode = async () => {
    if (!(await confirmDialog({ title: r.newCodeConfirm, description: r.newCodeDesc, confirmLabel: r.newCode, destructive: true }))) return;
    const p = await act((c) => c.resetRemoteToken(), r.newCodeDone);
    if (p) onNewCode(p);
    reload();
  };
  const connected = devices?.filter((d) => d.connected).length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{r.devices}</h3>
        <Badge variant={connected ? "default" : "outline"} className="h-5 px-1.5 text-[10px]">
          {fmt(r.connectedCount, { n: connected })}
        </Badge>
      </div>
      {devices && !devices.length && <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">{r.noDevices}</p>}
      <div className="flex flex-col divide-y rounded-lg border" data-testid="remote-devices">
        {devices?.map((d) => (
          <div key={d.id} className={cn("flex flex-wrap items-center gap-3 px-3 py-2.5", d.blocked && "opacity-70")}>
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-md", d.connected ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground")}>
              {/iphone|android|móvil|tablet|ipad|pixel|galaxy/i.test(d.name) || !d.id.startsWith("ip-") ? <Smartphone className="size-4" /> : <Monitor className="size-4" />}
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2 truncate text-sm font-medium">
                {d.name}
                {d.blocked && (
                  <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                    {r.blocked}
                  </Badge>
                )}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {d.connected ? <span className="text-emerald-600 dark:text-emerald-400">● {r.connectedNow}</span> : fmt(r.lastSeen, { when: timeAgo(d.lastSeen, lang) })} · {d.ip}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              <Select value={d.role || "admin"} onValueChange={(role) => act((c) => c.updateRemoteDevice(d.id, { role: role as "admin" | "moderator" | "viewer" }), t.roles.saved).then(() => reload())}>
                <SelectTrigger size="sm" className="h-7 w-36 text-xs" title={t.roles.hint} aria-label={t.roles.label}>
                  <SelectValue>{t.roles[(d.role || "admin") as "admin" | "moderator" | "viewer"]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(["admin", "moderator", "viewer"] as const).map((r0) => (
                    <SelectItem key={r0} value={r0} className="text-xs">
                      <div className="grid">
                        <span>{t.roles[r0]}</span>
                        <span className="text-[10px] text-muted-foreground">{t.roles[`${r0}Desc`]}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => rename(d)}>
                <Pencil /> {r.rename}
              </Button>
              <Button size="sm" variant={d.blocked ? "outline" : "ghost"} className={cn("h-7", !d.blocked && "text-destructive")} onClick={() => block(d, !d.blocked)} data-testid={`remote-block-${d.name}`}>
                {d.blocked ? <ShieldCheck /> : <Ban />} {d.blocked ? r.unblock : r.block}
              </Button>
              <Button size="icon-sm" variant="ghost" className="size-7" onClick={() => forget(d)} aria-label={r.forget} title={r.forget}>
                <Trash2 />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <SwitchRow label={r.allowNew} hint={allowNew ? r.allowNewOn : r.allowNewOff} checked={allowNew} onCheckedChange={setAllowNew} />
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">{r.newCodeHint}</div>
        <Button size="sm" variant="outline" className="h-8 text-destructive" onClick={newCode} data-testid="remote-new-code">
          <KeyRound /> {r.newCode}
        </Button>
      </div>
    </div>
  );
}

/** Tool panel: pair the mobile remote (QR code, addresses, token). */
export function RemotePanel() {
  const t = useT();
  const client = useStore((s) => s.client);
  const enabled = useStore((s) => s.state?.general.remoteControlEnabled ?? false);
  const mutate = useStore((s) => s.mutate);
  const [info, setInfo] = useState<PairingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!client) return;
    setError(null);
    client
      .pairing()
      .then(setInfo)
      .catch((e) => setError(errorMessage(e)));
  }, [client]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  const setEnabled = (remoteControlEnabled: boolean) => {
    mutate((s) => ({ ...s, general: { ...s.general, remoteControlEnabled } }));
    act((c) => c.setGeneral({ remoteControlEnabled }));
  };

  return (
    <div className="flex flex-col gap-5 p-6">
      <SwitchRow label={t.about.remoteEnabled} hint={t.about.remoteEnabledHint} checked={enabled} onCheckedChange={setEnabled} />
      <Separator />
      {!enabled ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
          <Smartphone className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">{t.about.remoteDisabled}</p>
          <p className="text-xs text-muted-foreground">{t.about.remoteDisabledDesc}</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex flex-col items-center gap-2">
            <div className="grid size-[226px] place-items-center rounded-lg border bg-white p-3">
              {info ? (
                <QrCanvas payload={info.qrPayload} />
              ) : error ? (
                <Button size="sm" variant="outline" onClick={load} className="border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100">
                  <RotateCw /> {t.common.retry}
                </Button>
              ) : (
                <Loader2 className="size-5 animate-spin text-neutral-500" />
              )}
            </div>
            {info?.name && <span className="max-w-[226px] truncate text-xs text-muted-foreground">{info.name}</span>}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">{t.about.pairTitle}</h3>
              <p className="text-xs text-muted-foreground">{t.about.pairDesc}</p>
            </div>
            <Steps steps={t.about.pairSteps} />
            {error && <p className="text-xs break-words text-destructive">{fmt(t.about.pairError, { error })}</p>}
            {info && (
              <>
                <Separator />
                <Field label={t.about.addresses}>
                  <div className="flex flex-col gap-1.5">
                    {info.addresses.map((a) => (
                      <CopyField key={a} value={`${a}:${info.port}`} />
                    ))}
                  </div>
                </Field>
                <Field label={t.about.token}>
                  <CopyField value={info.token} secret />
                </Field>
              </>
            )}
          </div>
        </div>
      )}
      {enabled && (
        <>
          <Separator />
          <DevicesSection onNewCode={setInfo} />
        </>
      )}
      <Separator />
      <GuestsSection />
    </div>
  );
}
