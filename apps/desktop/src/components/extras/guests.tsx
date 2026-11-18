import { Copy, ExternalLink, Plus, Trash2, UserPlus, Video } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { fmt } from "@/lib/format";
import { usePrefs } from "@/lib/prefs";
import { act, baseSceneUuid, useStore } from "@/lib/store";
import { copyText, openExternal } from "@/lib/tauri";

/** A guest invited to the stream (camera + mic through VDO.Ninja). */
export interface Guest {
  id: string;
  name: string;
  room: string;
  password: string;
  created: number;
}

const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
const enc = encodeURIComponent;
/** What the guest opens: shares their camera and microphone. */
export const guestLink = (g: Guest) => `https://vdo.ninja/?push=${g.room}&password=${enc(g.password)}&label=${enc(g.name)}&webcam`;
/** What Vexcast shows: only that guest's video and audio, no interface. */
export const viewLink = (g: Guest) => `https://vdo.ninja/?view=${g.room}&password=${enc(g.password)}&cleanoutput`;

/** Remote page: invite someone to the stream with a link. */
export function GuestsSection() {
  const t = useT();
  const g = t.guests;
  const guests = usePrefs((p) => p.guests);
  const [name, setName] = useState("");
  const sources = useStore((s) => s.state?.sources ?? []);
  const setGuests = (list: Guest[]) => usePrefs.getState().set({ guests: list });

  const invite = async () => {
    const guest: Guest = { id: rand(8), name: name.trim() || g.defaultName, room: `vx${rand(10)}`, password: rand(12), created: Date.now() };
    setGuests([...guests, guest]);
    setName("");
    if (await copyText(guestLink(guest))) toast.success(fmt(g.copied, { name: guest.name }));
  };
  const sourceOf = (x: Guest) => sources.find((s) => typeof s.settings?.url === "string" && (s.settings.url as string).includes(`view=${x.room}`));
  const addToScene = async (x: Guest) => {
    const st = useStore.getState().state;
    const scene = st ? baseSceneUuid(st) : null;
    if (!scene) return;
    const r = await act((c) =>
      c.createSource({
        name: fmt(g.sourceName, { name: x.name }),
        kind: "browser_source",
        settings: { url: viewLink(x), width: 1280, height: 720, reroute_audio: true, fps_custom: false },
        sceneUuid: scene,
      }),
    );
    if (r) toast.success(fmt(g.added, { name: x.name }));
  };

  return (
    <div className="flex flex-col gap-3" data-testid="guests">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <Video className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{g.title}</h3>
          <p className="text-xs text-muted-foreground">{g.desc}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && invite()} placeholder={g.namePh} className="max-w-xs" />
        <Button onClick={invite} data-testid="guest-invite">
          <UserPlus /> {g.invite}
        </Button>
      </div>
      {guests.length > 0 && (
        <div className="flex flex-col divide-y rounded-lg border">
          {guests.map((x) => {
            const src = sourceOf(x);
            return (
              <div key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{x.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{guestLink(x).replace(/password=[^&]+/, "password=••••")}</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={async () => {
                    if (await copyText(guestLink(x))) toast.success(fmt(g.copied, { name: x.name }));
                  }}
                >
                  <Copy /> {g.copyLink}
                </Button>
                {src ? (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">{g.inScene}</span>
                ) : (
                  <Button size="sm" className="h-7" onClick={() => addToScene(x)}>
                    <Plus /> {g.addToScene}
                  </Button>
                )}
                <Button size="icon-sm" variant="ghost" className="size-7" title={g.preview} aria-label={g.preview} onClick={() => openExternal(viewLink(x))}>
                  <ExternalLink />
                </Button>
                <Button size="icon-sm" variant="ghost" className="size-7" title={g.remove} aria-label={g.remove} onClick={() => setGuests(guests.filter((y) => y.id !== x.id))}>
                  <Trash2 />
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">{g.privacy}</p>
    </div>
  );
}
