/** Alert designer helpers: defaults, new layers and starting templates. */
import type { AlertDesign, AlertLayer, AlertLayerKind, AlertType } from "@vexcast/protocol";

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export const ANIMS_IN = ["none", "fadeIn", "zoomIn", "zoomOutIn", "pop", "slideUp", "slideDown", "slideLeft", "slideRight", "bounceIn", "dropIn", "flipIn", "rotateIn", "blurIn", "typewriter", "letterPop", "letterRise", "letterDrop", "letterFade"] as const;
export const ANIMS_OUT = ["none", "fadeOut", "zoomOut", "slideUpOut", "slideDownOut", "slideLeftOut", "slideRightOut", "flipOut", "rotateOut", "blurOut"] as const;
export const LOOPS = ["none", "pulse", "float", "shake", "wobble", "glow", "spin", "heartbeat", "swing"] as const;
export const TEXT_EFFECTS = ["none", "wave", "bounce", "jelly", "rainbow", "flicker", "shake"] as const;
export const PARTICLE_TYPES = ["confetti", "sparkles", "hearts", "stars", "snow", "bubbles", "emoji"] as const;
export const PARTICLE_MODES = ["burst", "fountain", "rain"] as const;
export const GOOGLE_FONTS = [
  "Inter",
  "Montserrat",
  "Poppins",
  "Roboto",
  "Bebas Neue",
  "Oswald",
  "Anton",
  "Bangers",
  "Luckiest Guy",
  "Press Start 2P",
  "Orbitron",
  "Audiowide",
  "Russo One",
  "Righteous",
  "Permanent Marker",
  "Pacifico",
  "Lobster",
  "Fredoka",
  "Rubik",
  "Teko",
  "Black Ops One",
  "Bungee",
  "Creepster",
  "Silkscreen",
];

export const DEFAULT_LAYER: Omit<AlertLayer, "id" | "kind"> = {
  name: "",
  visible: true,
  locked: false,
  x: 0,
  y: 0,
  w: 400,
  h: 120,
  rotation: 0,
  opacity: 1,
  showWhen: "always",
  text: "",
  fontFamily: "Inter",
  fontSize: 64,
  fontWeight: 800,
  italic: false,
  uppercase: false,
  color: "#ffffff",
  highlight: "#a78bfa",
  align: "center",
  valign: "middle",
  lineHeight: 1.15,
  letterSpacing: 0,
  strokeColor: "",
  strokeWidth: 0,
  shadowColor: "rgba(0,0,0,0.6)",
  shadowBlur: 8,
  shadowX: 0,
  shadowY: 3,
  src: "",
  fit: "contain",
  loopMedia: false,
  muted: false,
  fill: "#7c5cff",
  borderColor: "",
  borderWidth: 0,
  radius: 16,
  animIn: "fadeIn",
  animInMs: 600,
  animInDelay: 0,
  animOut: "fadeOut",
  animOutMs: 500,
  animLoop: "none",
  textEffect: "none",
  particleType: "confetti",
  particleMode: "burst",
  particleEmoji: "🎉✨",
  particleCount: 120,
  particleSize: 18,
  particleSpeed: 1,
  particleColors: "",
  particleDurationMs: 0,
  barColor2: "#22d3ee",
  trackColor: "rgba(255,255,255,0.12)",
  barStripes: true,
  barGlow: true,
  barVertical: false,
};

/** Starting design for the donation goal editor. */
export function createGoalDesign(name: string, reachedText: string): AlertDesign {
  return normalizeDesign({
    name,
    type: "donation",
    width: 1000,
    height: 240,
    durationMs: 8000,
    layers: [
      newLayer("shape", { name: "Fondo", x: 20, y: 30, w: 960, h: 180, fill: "rgba(20,18,34,0.82)", radius: 28, borderColor: "rgba(255,255,255,0.12)", borderWidth: 2, animIn: "fadeIn" }),
      newLayer("text", { name: "Título", text: "{title}", x: 60, y: 52, w: 560, h: 60, fontSize: 40, align: "left", animIn: "slideRight" }),
      newLayer("text", { name: "Cantidades", text: "{current} / {target}", x: 560, y: 52, w: 380, h: 60, fontSize: 36, align: "right", highlight: "#a78bfa", animIn: "slideLeft" }),
      newLayer("progress", { name: "Barra", x: 60, y: 128, w: 880, h: 52, fill: "#7c5cff", radius: 26, animIn: "fadeIn" }),
      newLayer("text", { name: "Porcentaje", text: "{percent}", x: 60, y: 128, w: 880, h: 52, fontSize: 28, animIn: "fadeIn", animInDelay: 300 }),
      newLayer("particles", { name: "Confeti", x: 0, y: 0, w: 1000, h: 240, showWhen: "reached", particleCount: 140, animIn: "none" }),
      newLayer("text", { name: "Meta conseguida", text: reachedText, x: 300, y: 0, w: 400, h: 50, fontSize: 32, color: "#ffe066", showWhen: "reached", animIn: "bounceIn", animLoop: "pulse", shadowColor: "rgba(255,176,32,0.9)", shadowBlur: 18, shadowY: 0, textEffect: "wave" }),
    ],
  });
}

export function newLayer(kind: AlertLayerKind, patch: Partial<AlertLayer> = {}): AlertLayer {
  return { ...DEFAULT_LAYER, id: uid(), kind, ...patch };
}

/** Fill missing fields (designs imported from older/other versions). */
export function normalizeDesign(d: Partial<AlertDesign>): AlertDesign {
  return {
    id: d.id || uid(),
    name: d.name ?? "Alerta",
    type: d.type ?? "follow",
    enabled: d.enabled ?? true,
    minAmount: d.minAmount ?? 0,
    maxAmount: d.maxAmount ?? 0,
    priority: d.priority ?? 0,
    weight: d.weight ?? 1,
    width: d.width || 1920,
    height: d.height || 1080,
    durationMs: d.durationMs || 8000,
    sound: d.sound ?? "",
    soundVolume: d.soundVolume ?? 0.8,
    tts: d.tts ?? "default",
    layers: (d.layers ?? []).map((l) => ({ ...DEFAULT_LAYER, ...l, id: l.id || uid(), kind: l.kind || "text" })),
    customEnabled: d.customEnabled ?? false,
    customHtml: d.customHtml ?? "",
    customCss: d.customCss ?? "",
    customJs: d.customJs ?? "",
    ownSource: d.ownSource ?? false,
  };
}

export type TemplateId = "blank" | "imageText" | "banner" | "textOnly" | "code";
export const TEMPLATES: TemplateId[] = ["blank", "imageText", "banner", "textOnly", "code"];

/** A new design of `type` from a starting template. `title` is the type's sentence ("¡{user} te sigue!"). */
export function createDesign(type: AlertType, template: TemplateId, name: string, title: string): AlertDesign {
  const base = normalizeDesign({ name, type });
  const message = newLayer("text", { name: "Mensaje", text: "{message}", showWhen: "message", x: 460, y: 760, w: 1000, h: 110, fontSize: 36, fontWeight: 600, animIn: "slideUp", animInDelay: 500 });
  switch (template) {
    case "imageText":
      base.layers = [
        newLayer("image", { name: "Imagen", x: 760, y: 140, w: 400, h: 400, animIn: "bounceIn", animLoop: "float" }),
        newLayer("text", { name: "Título", text: title, x: 260, y: 570, w: 1400, h: 140, fontSize: 72, animIn: "pop", animInDelay: 250 }),
        message,
      ];
      break;
    case "banner":
      base.layers = [
        newLayer("shape", { name: "Fondo", x: 410, y: 820, w: 1100, h: 190, fill: "rgba(14,12,26,0.88)", borderColor: "#7c5cff", borderWidth: 4, radius: 28, animIn: "slideUp", animOut: "slideDownOut" }),
        newLayer("shape", { name: "Acento", x: 410, y: 820, w: 18, h: 190, fill: "#7c5cff", radius: 9, animIn: "slideUp", animOut: "slideDownOut" }),
        newLayer("text", { name: "Título", text: title, x: 470, y: 840, w: 1010, h: 90, fontSize: 56, align: "left", animIn: "fadeIn", animInDelay: 300, animOut: "fadeOut" }),
        newLayer("text", { ...message, id: uid(), x: 470, y: 925, w: 1010, h: 70, fontSize: 32, align: "left", color: "#d4d4f5", animIn: "fadeIn", animInDelay: 500 }),
      ];
      break;
    case "textOnly":
      base.layers = [newLayer("text", { name: "Título", text: title, x: 160, y: 400, w: 1600, h: 200, fontSize: 110, fontFamily: "Bebas Neue", fontWeight: 400, letterSpacing: 2, animIn: "zoomOutIn", animLoop: "pulse" }), message];
      break;
    case "code":
      base.customEnabled = true;
      base.customHtml = '<div class="card">\n  <div class="title"><b>{{user}}</b> {{amount}}</div>\n  <div class="msg">{{message}}</div>\n</div>';
      base.customCss =
        ".card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 40px 64px; border-radius: 32px;\n  background: linear-gradient(135deg, #7c5cff, #22d3ee); color: #fff; font: 800 64px/1.1 system-ui; text-align: center;\n  animation: in .7s cubic-bezier(.2,.8,.2,1) both; }\n.msg { font-size: 36px; font-weight: 600; margin-top: 12px; }\n@keyframes in { from { opacity: 0; transform: translate(-50%, -30%) scale(.8); } }";
      base.customJs = "// alert: { user, amount, currency, message, type, platform }\n// root: the alert's container · vars: the formatted values\nconsole.log('alerta', alert.user);";
      break;
    default:
      break;
  }
  return base;
}

/** URL of a design's own browser source (alerts.html?design=<id>). */
export function designUrl(widgetUrl: string, id: string): string {
  return widgetUrl + (widgetUrl.includes("?") ? "&" : "?") + "design=" + encodeURIComponent(id);
}

export function duplicateDesign(d: AlertDesign, suffix: string): AlertDesign {
  return { ...structuredClone(d), id: uid(), name: `${d.name} (${suffix})`, layers: d.layers.map((l) => ({ ...structuredClone(l), id: uid() })) };
}
