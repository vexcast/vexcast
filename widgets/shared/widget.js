/*!
 * Vexcast widget runtime
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Tiny, dependency-free runtime shared by every overlay widget.
 *
 *   Vexcast.on(type, fn)       subscribe to ServerEvent types ("state", "alert",
 *                              "chat", "chat_deleted", "tts", "caption", ...),
 *                              plus "connection" ({connected:boolean}) and "*".
 *   Vexcast.state              latest AppState (null until received)
 *   Vexcast.settings(name)     widgets[name] merged over defaults + query overrides
 *   Vexcast.url(path)          resolve a core-relative URL and append ?token=
 *   Vexcast.isDemo             true with ?demo=1 (fake events, no core needed)
 *   Vexcast.escapeHtml, formatMoney, formatNumber, icon(platform), t(key)
 *
 * Query parameters: token, core (base URL, default same origin), demo=1,
 * lang=es|en, audio=1 (play sounds/TTS locally; silent by default), and any primitive setting key of the widget (e.g. ?theme=solid).
 */
(function (global) {
  "use strict";

  var params = new URLSearchParams(global.location.search);
  var token = params.get("token") || "";
  var isDemo = /^(1|true|yes)$/i.test(params.get("demo") || "");
  // The core mixes alert sounds and TTS into the stream itself, so widgets stay
  // silent unless ?audio=1 (e.g. when used as a browser source in OBS).
  var audioEnabled = /^(1|true|yes|on)$/i.test(params.get("audio") || "");

  // ---------------------------------------------------------------------
  // Core base URL
  // ---------------------------------------------------------------------
  function computeCoreBase() {
    var core = params.get("core");
    if (core) {
      if (!/^https?:\/\//i.test(core)) core = "http://" + core;
      return core.replace(/\/+$/, "");
    }
    if (/^https?:$/.test(global.location.protocol)) return global.location.origin;
    return ""; // file:// without ?core= -> no live connection possible
  }
  var coreBase = computeCoreBase();

  function url(path) {
    if (!path) return "";
    if (/^(data|blob):/i.test(path)) return path;
    var abs = /^https?:\/\//i.test(path) ? path : coreBase + (path.charAt(0) === "/" ? "" : "/") + path;
    var sameCore = coreBase && abs.indexOf(coreBase) === 0;
    if (token && sameCore && !/[?&]token=/.test(abs)) {
      abs += (abs.indexOf("?") === -1 ? "?" : "&") + "token=" + encodeURIComponent(token);
    }
    return abs;
  }

  // ---------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------
  var handlers = {};
  function on(type, fn) {
    (handlers[type] = handlers[type] || []).push(fn);
    return function off() {
      var list = handlers[type] || [];
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }
  function emit(type, data) {
    var list = (handlers[type] || []).concat(handlers["*"] || []);
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](data, type);
      } catch (err) {
        if (global.console) console.warn("[vexcast] handler for '" + type + "' failed:", err);
      }
    }
  }

  function dispatch(msg) {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "state") Vexcast.state = msg.data || null;
    if (msg.type === "status" && Vexcast.state) Vexcast.state.status = msg.data;
    emit(msg.type, msg.data);
  }

  // ---------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------
  // Per-variant defaults (follower / subscriber / bits goals).
  var SUB_DEFAULTS = {
    "goal.followers": { title: "Meta de seguidores", target: 50, currency: "", color: "#22c55e", color2: "#a3e635" },
    "goal.subs": { title: "Meta de suscriptores", target: 10, currency: "", color: "#8b5cf6", color2: "#ec4899" },
    "goal.bits": { title: "Meta de bits", target: 1000, currency: "", color: "#a855f7", color2: "#22d3ee" }
  };

  var DEFAULTS = {
    alertBox: {
      enabled: true,
      durationMs: 7000,
      templates: {},
      soundUrl: null,
      soundVolume: 0.6,
      ttsEnabled: true,
      ttsMinAmount: 0,
      animation: "pop",
      accentColor: "#7c5cff",
      variations: {},
      designs: [],
      groups: []
    },
    chatBox: {
      maxMessages: 12,
      fadeAfterSec: 0,
      showPlatformIcons: true,
      showBadges: true,
      fontSize: 22,
      theme: "glass",
      fontFamily: "",
      textColor: "#ffffff",
      nameColorMode: "user",
      nameColor: "#9b87ff",
      bgColor: "#16161f",
      bgOpacity: 0.72,
      radius: 0.8,
      spacing: 0.42,
      animation: "slide",
      direction: "up",
      align: "left",
      hideCommands: false,
      hideBots: false,
      hiddenUsers: [],
      showTime: false,
      showNewBadge: true
    },
    goal: {
      title: "Meta de donaciones",
      current: 0,
      target: 100,
      currency: "EUR",
      autoTrack: true,
      style: "glass",
      color: "#7c5cff",
      color2: "#22d3ee",
      textColor: "#ffffff",
      fontFamily: "",
      bgOpacity: 0.75,
      barHeight: 2.1,
      rounded: true,
      stripes: true,
      showIcon: true,
      showAmounts: true,
      showPercent: true,
      celebrate: true,
      reachedText: ""
    },
    captions: {
      enabled: true,
      translateTo: "",
      fontSize: 40,
      position: "bottom",
      theme: "box",
      fontFamily: "",
      textColor: "#ffffff",
      accentColor: "#5ce1e6",
      bgColor: "#08080e",
      bgOpacity: 0.72,
      maxLines: 3,
      hideAfterSec: 4,
      showPrevious: true,
      uppercase: false
    },
    events: {
      layout: "list",
      maxEvents: 10,
      showTitle: true,
      titleText: "",
      fontSize: 18,
      fontFamily: "",
      textColor: "#ffffff",
      theme: "glass",
      bgColor: "#1a1828",
      bgOpacity: 0.7,
      radius: 0.8,
      color: "#7c5cff",
      color2: "#22d3ee",
      showTime: true,
      showIcons: true,
      showPlatform: true,
      fadeOld: true,
      types: [],
      speed: 90,
      keepHistory: true
    },
    highlight: {
      durationSec: 15,
      theme: "glass",
      fontFamily: "",
      fontSize: 34,
      textColor: "#ffffff",
      accentColor: "#7c5cff",
      bgColor: "#14121f",
      bgOpacity: 0.85,
      animation: "slide",
      showPlatform: true,
      showBadges: true
    },
    labels: {
      fontFamily: "",
      fontSize: 32,
      fontWeight: 800,
      textColor: "#ffffff",
      userColor: "",
      strokeColor: "#000000",
      strokeWidth: 0,
      shadow: true,
      align: "center",
      uppercase: false,
      animation: "slide",
      emptyText: "—",
      templates: {}
    },
    poll: {
      theme: "glass",
      fontFamily: "",
      fontSize: 26,
      textColor: "#ffffff",
      color: "#7c5cff",
      color2: "#22d3ee",
      bgColor: "#14121f",
      bgOpacity: 0.85,
      showVotes: true,
      showPercent: true,
      showHint: true,
      hideAfterSec: 20
    },
    giveaway: {
      theme: "glass",
      fontFamily: "",
      fontSize: 28,
      textColor: "#ffffff",
      accentColor: "#f59e0b",
      bgColor: "#14121f",
      bgOpacity: 0.88,
      confetti: true
    },
    songs: {
      showCard: true,
      showVideo: false,
      theme: "glass",
      fontFamily: "",
      fontSize: 24,
      textColor: "#ffffff",
      accentColor: "#22d3ee",
      bgColor: "#14121f",
      bgOpacity: 0.85
    },
    credits: {
      title: "¡Gracias por ver el directo!",
      subtitle: "",
      outro: "¡Nos vemos en el próximo!",
      speed: 60,
      repeat: true,
      fontFamily: "",
      fontSize: 34,
      textColor: "#ffffff",
      accentColor: "#a78bfa",
      bgColor: "#0b0b12",
      bgOpacity: 0,
      sections: ["donations", "subs", "gifts", "bits", "follows", "raids", "chatters"],
      showAmounts: true
    }
  };

  // Google font loader shared by the widgets (system fonts are left alone).
  var SYSTEM_FONT = /^(arial|impact|verdana|tahoma|georgia|times new roman|courier new|segoe ui|trebuchet ms|comic sans ms|system-ui|sans-serif|serif|monospace)$/i;
  var loadedFonts = {};
  function loadFont(f) {
    f = String(f || "").trim();
    if (!f || loadedFonts[f] || SYSTEM_FONT.test(f)) return;
    loadedFonts[f] = 1;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":wght@400;600;700;800;900&display=swap";
    document.head.appendChild(l);
  }
  function fontStack(f) {
    return f ? "'" + String(f).replace(/['"]/g, "") + "', system-ui, sans-serif" : "";
  }
  /** "#rrggbb" + alpha -> rgba(). */
  function rgba(hex, a) {
    var m = /^#?([0-9a-f]{6})/i.exec(String(hex || ""));
    var n = m ? parseInt(m[1], 16) : 0;
    a = Number(a);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + (isFinite(a) ? Math.max(0, Math.min(1, a)) : 1) + ")";
  }

  function coerce(raw, sample) {
    if (typeof sample === "number") {
      var n = parseFloat(raw);
      return isNaN(n) ? sample : n;
    }
    if (typeof sample === "boolean") return /^(1|true|yes|on)$/i.test(raw);
    return raw;
  }

  // Live preview: the settings panel sends the unsaved draft (only when embedded in a page).
  var previewDraft = {};
  if (global.parent && global.parent !== global) {
    global.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.type !== "vexcast:preview" || typeof d.widget !== "string" || !d.settings || typeof d.settings !== "object") return;
      previewDraft[d.widget] = d.settings;
      emit("state", Vexcast.state);
    });
  }

  /**
   * Widget settings: defaults ← saved ← unsaved preview draft ← query string.
   * `sub` reads a keyed variant, e.g. settings("goal", "followers") = widgets.goals.followers.
   */
  function settings(name, sub) {
    var base = DEFAULTS[name] || {};
    var w = (Vexcast.state && Vexcast.state.widgets) || {};
    var live = (sub ? (w[name + "s"] || {})[sub] : w[name]) || {};
    var draft = previewDraft[sub ? name + "s." + sub : name] || {};
    var out = {};
    var k;
    for (k in base) out[k] = base[k];
    if (sub && SUB_DEFAULTS[name + "." + sub]) {
      var sd = SUB_DEFAULTS[name + "." + sub];
      for (k in sd) out[k] = sd[k];
    }
    for (k in live) if (live[k] !== undefined && live[k] !== null) out[k] = live[k];
    for (k in draft) if (draft[k] !== undefined && draft[k] !== null) out[k] = draft[k];
    // Query-string overrides (primitive keys only), handy for OBS and previews.
    for (k in base) {
      if (params.has(k) && (base[k] === null || typeof base[k] !== "object")) {
        out[k] = coerce(params.get(k), base[k] === null ? "" : base[k]);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // i18n (Spanish first)
  // ---------------------------------------------------------------------
  var STRINGS = {
    es: {
      "chat.new": "Nuevo",
      pollHint: "Escribe el número en el chat para votar",
      pollVotes: "{n} votos",
      pollClosed: "Cerrada",
      predHint: "!apostar <número> <cantidad>",
      predPool: "{people} apuestas · {n} {unit}",
      predClosed: "Apuestas cerradas",
      predRefunded: "Cancelada",
      gwKicker: "Sorteo",
      gwType: "Escribe",
      gwClosed: "Inscripciones cerradas",
      gwEntries: "{n} participantes",
      gwDrawing: "Sorteando…",
      gwWinner: "¡Ganador!",
      songBy: "pedida por {user}",
      "credits.follows": "Nuevos seguidores",
      "credits.subs": "Suscripciones",
      "credits.gifts": "Subs regaladas",
      "credits.bits": "Bits",
      "credits.donations": "Donaciones",
      "credits.raids": "Raids",
      "credits.chatters": "Los que más han hablado",
      creditsMsgs: "{n} mensajes",
      creditsEmpty: "Gracias a todos los que habéis estado",
      "tpl.follow": "¡{user} te sigue!",
      "tpl.subscription": "¡{user} se ha suscrito!",
      "tpl.gift_sub": "¡{user} regaló {amount} suscripciones!",
      "tpl.raid": "¡Raid de {user} con {amount} espectadores!",
      "tpl.bits": "¡{user} envió {amount} bits!",
      "tpl.superchat": "¡Superchat de {user}: {amount}!",
      "tpl.donation": "¡{user} donó {amount}!",
      "tpl.kofi": "¡{user} invitó {amount} en Ko-fi!",
      "tpl.member": "¡{user} ahora es miembro!",
      "tpl.host": "¡{user} te está hosteando!",
      "label.follow": "Nuevo seguidor",
      "label.subscription": "Suscripción",
      "label.gift_sub": "Suscripciones regaladas",
      "label.raid": "Raid",
      "label.bits": "Bits",
      "label.superchat": "Superchat",
      "label.donation": "Donación",
      "label.kofi": "Ko-fi",
      "label.member": "Nuevo miembro",
      "label.host": "Host",
      "short.follow": "te sigue",
      "short.subscription": "se suscribió",
      "short.gift_sub": "regaló {amount} subs",
      "short.raid": "raid con {amount} espectadores",
      "short.bits": "{amount} bits",
      "short.superchat": "superchat {amount}",
      "short.donation": "donó {amount}",
      "short.kofi": "Ko-fi {amount}",
      "short.member": "nuevo miembro",
      "short.host": "te hostea",
      months: "{amount} meses",
      goalReached: "¡Meta alcanzada!",
      recentEvents: "Eventos recientes",
      noEvents: "Esperando eventos…",
      now: "ahora",
      minAgo: "hace {n} min",
      hAgo: "hace {n} h"
    },
    en: {
      "chat.new": "New",
      pollHint: "Type the number in chat to vote",
      pollVotes: "{n} votes",
      pollClosed: "Closed",
      predHint: "!apostar <number> <amount>",
      predPool: "{people} bets · {n} {unit}",
      predClosed: "Bets closed",
      predRefunded: "Cancelled",
      gwKicker: "Giveaway",
      gwType: "Type",
      gwClosed: "Entries closed",
      gwEntries: "{n} entries",
      gwDrawing: "Drawing…",
      gwWinner: "Winner!",
      songBy: "requested by {user}",
      "credits.follows": "New followers",
      "credits.subs": "Subscriptions",
      "credits.gifts": "Gifted subs",
      "credits.bits": "Bits",
      "credits.donations": "Donations",
      "credits.raids": "Raids",
      "credits.chatters": "Top chatters",
      creditsMsgs: "{n} messages",
      creditsEmpty: "Thanks to everyone who was here",
      "tpl.follow": "{user} is now following!",
      "tpl.subscription": "{user} just subscribed!",
      "tpl.gift_sub": "{user} gifted {amount} subs!",
      "tpl.raid": "{user} is raiding with {amount} viewers!",
      "tpl.bits": "{user} cheered {amount} bits!",
      "tpl.superchat": "Super Chat from {user}: {amount}!",
      "tpl.donation": "{user} donated {amount}!",
      "tpl.kofi": "{user} bought you {amount} on Ko-fi!",
      "tpl.member": "{user} is now a member!",
      "tpl.host": "{user} is hosting you!",
      "label.follow": "New follower",
      "label.subscription": "Subscription",
      "label.gift_sub": "Gifted subs",
      "label.raid": "Raid",
      "label.bits": "Bits",
      "label.superchat": "Super Chat",
      "label.donation": "Donation",
      "label.kofi": "Ko-fi",
      "label.member": "New member",
      "label.host": "Host",
      "short.follow": "followed",
      "short.subscription": "subscribed",
      "short.gift_sub": "gifted {amount} subs",
      "short.raid": "raid with {amount} viewers",
      "short.bits": "{amount} bits",
      "short.superchat": "super chat {amount}",
      "short.donation": "donated {amount}",
      "short.kofi": "Ko-fi {amount}",
      "short.member": "new member",
      "short.host": "is hosting",
      months: "{amount} months",
      goalReached: "Goal reached!",
      recentEvents: "Recent events",
      noEvents: "Waiting for events…",
      now: "now",
      minAgo: "{n} min ago",
      hAgo: "{n} h ago"
    }
  };

  function lang() {
    var l = params.get("lang") || (Vexcast.state && Vexcast.state.general && Vexcast.state.general.language) || "es";
    return STRINGS[l] ? l : "es";
  }
  function locale() {
    return lang() === "en" ? "en-US" : "es-ES";
  }
  function t(key, vars) {
    var s = STRINGS[lang()][key];
    if (s === undefined) s = STRINGS.es[key];
    if (s === undefined) return key;
    if (vars) s = s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] !== undefined ? vars[k] : m; });
    return s;
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function escapeHtml(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  function formatNumber(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return "";
    try {
      return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits === undefined ? 0 : digits }).format(n);
    } catch (e) {
      return String(n);
    }
  }

  function formatMoney(amount, currency) {
    if (amount === null || amount === undefined || isNaN(amount)) return "";
    var cur = (currency || "").toUpperCase();
    var whole = Math.round(amount) === amount;
    if (/^[A-Z]{3}$/.test(cur)) {
      try {
        return new Intl.NumberFormat(locale(), {
          style: "currency",
          currency: cur,
          minimumFractionDigits: whole ? 0 : 2,
          maximumFractionDigits: 2
        }).format(amount);
      } catch (e) { /* unknown ISO code -> fallthrough */ }
    }
    return formatNumber(amount, 2) + (cur ? " " + cur : "");
  }

  function hashColor(name) {
    var palette = ["#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#38d9a9", "#4dabf7", "#748ffc", "#b197fc", "#f783ac", "#63e6be", "#ff8787", "#74c0fc"];
    var h = 0;
    var s = String(name || "");
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return palette[Math.abs(h) % palette.length];
  }

  // Original, simplified platform marks (not official logos).
  var ICONS = {
    twitch:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="#9146ff"/>' +
      '<path d="M7 6h10.5v7.2L14.8 16H12l-2 2v-2H7z" fill="#fff"/><rect x="11" y="8.6" width="1.6" height="4" rx=".8" fill="#9146ff"/><rect x="14.2" y="8.6" width="1.6" height="4" rx=".8" fill="#9146ff"/></svg>',
    youtube:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="4" width="22" height="16" rx="5" fill="#ff1f1f"/><path d="M10 8.6v6.8l5.8-3.4z" fill="#fff"/></svg>',
    kick:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="#28d74b"/>' +
      '<path d="M7 6h3.2v4h1.4l2-2V6h3.2v3.4L15 11.2v1.6l1.8 1.8V18h-3.2v-2l-2-2h-1.4v4H7z" fill="#0b0f0c"/></svg>',
    tiktok:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="#111"/>' +
      '<path d="M13.6 5.5v8.6a2.6 2.6 0 1 1-2.6-2.6" fill="none" stroke="#25f4ee" stroke-width="2" stroke-linecap="round" transform="translate(-.7 -.5)"/>' +
      '<path d="M13.6 5.5v8.6a2.6 2.6 0 1 1-2.6-2.6" fill="none" stroke="#fe2c55" stroke-width="2" stroke-linecap="round" transform="translate(.7 .5)"/>' +
      '<path d="M13.6 5.5v8.6a2.6 2.6 0 1 1-2.6-2.6M13.6 5.5c.3 1.8 1.6 3 3.4 3.1" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
    kofi:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#29abe0"/>' +
      '<path d="M6 8.5h9.5v4.2a3.8 3.8 0 0 1-3.8 3.8H9.8A3.8 3.8 0 0 1 6 12.7z" fill="#fff"/><path d="M15.5 9.6h1.2a2 2 0 0 1 0 4h-1.4" fill="none" stroke="#fff" stroke-width="1.5"/>' +
      '<path d="M10.8 14.2l-2-1.9a1.1 1.1 0 0 1 1.6-1.5l.4.4.4-.4a1.1 1.1 0 0 1 1.6 1.5z" fill="#ff5e5b"/></svg>',
    vexcast:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="vxg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>' +
      '<rect x="1" y="1" width="22" height="22" rx="6" fill="url(#vxg)"/><path d="M6.5 7l5.5 10.5L17.5 7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    generic:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="6" fill="#4b5563"/><path d="M6 7h12v8h-6l-3 3v-3H6z" fill="#fff"/></svg>'
  };
  function icon(platform) {
    return ICONS[platform] || ICONS.generic;
  }

  // Alert-type glyphs (24x24): white shapes, ".d" fill / ".s" white stroke / ".ds" detail stroke.
  var GLYPHS = {
    donation: '<path d="M12 20.6s-7.6-4.6-9.3-9.4C1.5 7.8 3.9 4.4 7.3 4.4c2 0 3.6 1.1 4.7 2.7 1.1-1.6 2.7-2.7 4.7-2.7 3.4 0 5.8 3.4 4.6 6.8-1.7 4.8-9.3 9.4-9.3 9.4z"/>',
    follow: '<path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.4l-5.8 3 1.1-6.4-4.7-4.6 6.5-.9z"/>',
    subscription: '<path d="M2.8 7.5l4.8 4.3L12 4.6l4.4 7.2 4.8-4.3-2 11.2H4.8z"/><circle class="d" cx="12" cy="14.6" r="1.6"/><circle class="d" cx="7.6" cy="15.3" r="1.1"/><circle class="d" cx="16.4" cy="15.3" r="1.1"/>',
    gift_sub: '<rect x="3.5" y="10.5" width="17" height="10" rx="1.6"/><rect x="2.5" y="7" width="19" height="4.2" rx="1.3"/><rect class="d" x="10.9" y="7" width="2.2" height="13.5"/><path class="s" d="M12 7C10.3 3.6 6.6 3.9 7.4 6.1 8 7.4 12 7 12 7zm0 0c1.7-3.4 5.4-3.1 4.6-.9C16 7.4 12 7 12 7z"/>',
    raid: '<circle cx="9" cy="7.8" r="3.6"/><path d="M2.4 20.3c0-3.7 3-6.7 6.6-6.7s6.6 3 6.6 6.7z"/><circle cx="17.3" cy="8.8" r="2.8" opacity=".75"/><path d="M16.4 13.5c3.1-.3 5.4 2.2 5.4 5.5h-4.6c0-2.1-.3-3.9-.8-5.5z" opacity=".75"/>',
    bits: '<path d="M7 3.6h10l4.2 5.6L12 20.6 2.8 9.2z"/><path class="ds" d="M2.8 9.2h18.4M9.3 3.6 7.9 9.2 12 20.6l4.1-11.4-1.4-5.6"/>',
    superchat: '<path d="M4.2 3.8h15.6a2.2 2.2 0 0 1 2.2 2.2v9.8a2.2 2.2 0 0 1-2.2 2.2H12l-5.2 4v-4H4.2A2.2 2.2 0 0 1 2 15.8V6a2.2 2.2 0 0 1 2.2-2.2z"/><path class="ds" stroke-width="1.8" stroke-linecap="round" d="M14.4 8.2c-.4-.8-1.3-1.2-2.4-1.2-1.4 0-2.4.7-2.4 1.8 0 2.4 5 1.3 5 3.8 0 1.1-1.1 1.9-2.6 1.9-1.2 0-2.2-.5-2.6-1.4M12 5.6v1.4m0 7.8v1.3"/>',
    kofi: '<path d="M3.6 8h13.2v5.6a5.2 5.2 0 0 1-5.2 5.2H8.8a5.2 5.2 0 0 1-5.2-5.2z"/><path class="s" stroke-width="2.2" d="M16.8 9.8h1.6a2.6 2.6 0 0 1 0 5.2h-1.8"/><path class="d" d="M10.2 15.6l-2.4-2.3a1.4 1.4 0 0 1 2-1.9l.4.4.4-.4a1.4 1.4 0 0 1 2 1.9z"/><path class="s" stroke-width="1.6" d="M8 2.8c-.8 1 .8 1.6 0 2.8M12 2.8c-.8 1 .8 1.6 0 2.8"/>',
    member: '<path d="M12 2.4l8.2 3.1v6.1c0 5.1-3.5 8.8-8.2 10.1-4.7-1.3-8.2-5-8.2-10.1V5.5z"/><path class="d" d="M12 7.2l1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z"/>',
    host: '<rect x="2.4" y="4.6" width="19.2" height="12.8" rx="2.2"/><path class="s" stroke-width="2.2" d="M8 21h8M12 17.6V21"/><path class="d" d="M10 8.2v5.6l4.8-2.8z"/>'
  };
  function glyph(type) {
    return GLYPHS[type] || GLYPHS.follow;
  }
  var TYPE_COLORS = {
    donation: "#ff4f8b", follow: "#3d9bff", subscription: "#8b5cf6", gift_sub: "#c05cf6", raid: "#ff8a1f",
    bits: "#9f7aea", superchat: "#f5b301", kofi: "#29abe0", member: "#12b886", host: "#4dabf7"
  };

  var MONEY_TYPES = { donation: 1, superchat: 1, kofi: 1 };

  // ---------------------------------------------------------------------
  // WebSocket connection with exponential backoff
  // ---------------------------------------------------------------------
  var ws = null;
  var retry = 0;
  var connected = false;

  function setConnected(v) {
    if (v === connected) return;
    connected = v;
    Vexcast.connected = v;
    emit("connection", { connected: v });
  }

  function connect() {
    if (!coreBase) {
      if (global.console) console.info("[vexcast] Sin core: abre el widget desde Vexcast (o añade ?core=http://host:7420 o ?demo=1).");
      return;
    }
    var wsUrl = coreBase.replace(/^http/i, "ws") + "/api/v1/ws" + (token ? "?token=" + encodeURIComponent(token) : "");
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      scheduleReconnect();
      return;
    }
    ws.onopen = function () {
      retry = 0;
      setConnected(true);
    };
    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      dispatch(msg);
    };
    ws.onclose = function () {
      setConnected(false);
      scheduleReconnect();
    };
    ws.onerror = function () {
      try { ws.close(); } catch (e) { /* ignore */ }
    };
  }

  var reconnectTimer = null;
  function scheduleReconnect() {
    if (reconnectTimer) return;
    var delay = Math.min(15000, 500 * Math.pow(2, retry)) * (0.75 + Math.random() * 0.5);
    retry++;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  // ---------------------------------------------------------------------
  // Demo mode: fake AppState + periodic events, no core required
  // ---------------------------------------------------------------------
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function rid() {
    return Math.random().toString(36).slice(2, 10);
  }

  var DEMO_USERS = ["LunaGamer", "pixel_maria", "ElTioBits", "nightowl_07", "Sofi_Draws", "KaiserRex", "chispa", "MateoPlays", "aurora.fm", "DonQuijote_TV", "neko_chan", "Valkyria"];
  var DEMO_CHAT = [
    "¡Buenas a todos! 👋",
    "Qué buena partida, GG",
    "jajaja no puede ser",
    "¿Cuál es la build que estás usando?",
    "Saludos desde México 🇲🇽",
    "Ese salto fue increíble",
    "Primera vez por aquí, me encanta el overlay",
    "F en el chat",
    "¿A qué hora es el stream mañana?",
    "Vamos, que esta vez sí sale 💪",
    "La música está genial",
    "Clip it! Eso hay que clipearlo",
    "Saludos desde Buenos Aires",
    "Hidrátate 💧"
  ];
  var DEMO_MESSAGES = [
    "¡Sigue así, eres el mejor streamer!",
    "Para un café ☕ ¡ánimo con el directo!",
    "Saludos desde Madrid, me encanta el contenido",
    "Por todas las risas de esta semana",
    null,
    "¡Feliz cumpleaños al canal!"
  ];
  var DEMO_CAPTIONS = [
    ["Muy buenas a todos y bienvenidos al directo de hoy", "Hello everyone and welcome to today's stream"],
    ["Hoy vamos a probar el nuevo modo de juego", "Today we're going to try the new game mode"],
    ["Gracias por el apoyo, de verdad, sois increíbles", "Thanks for the support, really, you're amazing"],
    ["Si os gusta el contenido no olvidéis seguir el canal", "If you like the content don't forget to follow the channel"]
  ];

  function demoState() {
    return {
      version: "demo",
      general: { language: params.get("lang") === "en" ? "en" : "es", theme: "dark", checkForUpdates: false, remoteControlEnabled: false, kofiVerificationToken: "" },
      widgets: {
        alertBox: {
          enabled: true,
          durationMs: 5200,
          templates: {},
          soundUrl: null,
          soundVolume: 0.6,
          ttsEnabled: false,
          ttsMinAmount: 0,
          animation: "pop",
          accentColor: "#7c5cff"
        },
        chatBox: { maxMessages: 10, fadeAfterSec: 0, showPlatformIcons: true, showBadges: true, fontSize: 22, theme: "glass" },
        goal: { title: "Meta: micrófono nuevo", current: 372, target: 500, currency: "EUR", autoTrack: true },
        captions: { enabled: true, translateTo: "en", fontSize: 40 }
      },
      status: { streaming: true, streamStartedAt: Date.now() - 3600e3 }
    };
  }

  var ALERT_TYPES = ["donation", "follow", "subscription", "raid", "bits", "superchat", "kofi", "gift_sub", "member", "donation"];
  var demoAlertIndex = 0;

  function makeAlert(type) {
    type = type || ALERT_TYPES[demoAlertIndex++ % ALERT_TYPES.length];
    var platform = { superchat: "youtube", member: "youtube", kofi: "kofi", bits: "twitch", raid: "twitch", gift_sub: "twitch", subscription: "twitch", host: "twitch", donation: "vexcast", follow: pick(["twitch", "kick", "tiktok"]) }[type] || "twitch";
    var amount = null;
    var currency = null;
    var message = null;
    if (type === "donation" || type === "superchat" || type === "kofi") {
      amount = pick([3, 5, 10, 15, 20, 50, 4.5]);
      currency = type === "superchat" ? pick(["USD", "EUR", "MXN"]) : "EUR";
      message = pick(DEMO_MESSAGES);
    } else if (type === "bits") {
      amount = pick([100, 250, 500, 1000]);
      message = pick(["Cheer500 ¡vamos!", "¡Toma bits!", null]);
    } else if (type === "raid") {
      amount = pick([12, 48, 120, 356]);
    } else if (type === "gift_sub") {
      amount = pick([1, 5, 10]);
    } else if (type === "subscription") {
      amount = pick([1, 3, 12]);
      message = pick([null, "¡Un año ya! Qué rápido pasa"]);
    }
    return {
      id: rid(),
      type: type,
      platform: platform,
      user: pick(DEMO_USERS),
      amount: amount,
      currency: currency,
      message: message,
      ts: Date.now(),
      ttsUrl: null,
      test: true
    };
  }

  var BADGES = [
    [],
    [],
    [{ id: "subscriber", label: "Suscriptor" }],
    [{ id: "moderator", label: "Moderador" }],
    [{ id: "vip", label: "VIP" }],
    [{ id: "subscriber", label: "Suscriptor" }, { id: "founder", label: "Fundador" }],
    [{ id: "broadcaster", label: "Streamer" }]
  ];
  function makeChat() {
    var name = pick(DEMO_USERS);
    return {
      id: rid(),
      platform: pick(["twitch", "twitch", "youtube", "kick", "tiktok"]),
      channel: "demo",
      user: { id: name.toLowerCase(), name: name, color: Math.random() < 0.6 ? hashColor(name + "x") : null, badges: pick(BADGES) },
      text: pick(DEMO_CHAT),
      ts: Date.now(),
      isBot: false,
      flagged: false
    };
  }

  function startDemo() {
    var state = demoState();
    dispatch({ type: "state", data: state });
    setConnected(true);

    // Alerts
    var alertEvery = (state.widgets.alertBox.durationMs || 5000) + 900;
    setTimeout(function loop() {
      dispatch({ type: "alert", data: makeAlert() });
      setTimeout(loop, alertEvery);
    }, 300);

    // Chat: a quick burst, then a steady trickle
    var sent = [];
    function sendChat() {
      var m = makeChat();
      var roll = Math.random();
      if (roll < 0.06) {
        m.flagged = true;
        m.text = "mensaje moderado";
      } else if (roll < 0.1) {
        m.isBot = true;
        m.platform = "vexcast";
        m.user = { id: "vexbot", name: "VexBot", color: "#22d3ee", badges: [{ id: "bot", label: "Bot" }] };
        m.text = "¡Recuerda seguir el canal! Usa !discord para unirte a la comunidad.";
      }
      sent.push(m.id);
      dispatch({ type: "chat", data: m });
      if (sent.length > 6 && Math.random() < 0.08) {
        dispatch({ type: "chat_deleted", data: { id: sent[sent.length - 4] } });
      }
    }
    for (var i = 0; i < 6; i++) setTimeout(sendChat, 80 + i * 220);
    setTimeout(function loop() {
      sendChat();
      setTimeout(loop, 1400 + Math.random() * 1400);
    }, 1800);

    // Goal: donations push the bar, resets after reaching the target
    var hold = 0;
    setInterval(function () {
      var g = state.widgets.goal;
      if (g.current >= g.target && hold++ < 3) return;
      hold = 0;
      if (g.current >= g.target) g.current = Math.round(g.target * 0.35);
      else g.current = Math.min(g.target, g.current + pick([10, 15, 25, 40]));
      dispatch({ type: "state", data: state });
    }, 2600);

    // Captions: word-by-word partials, then final with translation
    var ci = 0;
    function nextCaption() {
      var pair = DEMO_CAPTIONS[ci++ % DEMO_CAPTIONS.length];
      var id = rid();
      var words = pair[0].split(" ");
      var n = 0;
      (function step() {
        n++;
        var done = n >= words.length;
        dispatch({
          type: "caption",
          data: { id: id, text: words.slice(0, n).join(" "), translated: done ? pair[1] : null, final: done, ts: Date.now() }
        });
        if (!done) setTimeout(step, 110 + Math.random() * 90);
        else setTimeout(nextCaption, ci % DEMO_CAPTIONS.length === 0 ? 6500 : 1600);
      })();
    }
    setTimeout(nextCaption, 200);
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------
  var Vexcast = {
    version: "1",
    params: params,
    token: token,
    coreBase: coreBase,
    isDemo: isDemo,
    audioEnabled: audioEnabled,
    connected: false,
    state: null,
    on: on,
    emit: emit,
    dispatch: dispatch,
    settings: settings,
    defaults: DEFAULTS,
    url: url,
    t: t,
    lang: lang,
    locale: locale,
    escapeHtml: escapeHtml,
    formatMoney: formatMoney,
    formatNumber: formatNumber,
    hashColor: hashColor,
    icon: icon,
    glyph: glyph,
    typeColor: function (type) { return TYPE_COLORS[type] || "#7c5cff"; },
    isMoneyAlert: function (type) { return !!MONEY_TYPES[type]; },
    param: function (name, fallback) { return params.has(name) ? params.get(name) : fallback; },
    demo: { makeAlert: makeAlert, makeChat: makeChat },
    loadFont: loadFont,
    fontStack: fontStack,
    rgba: rgba
  };
  global.Vexcast = Vexcast;

  function start() {
    if (isDemo) startDemo();
    else connect();
  }
  // Start after the widget's own script has registered its handlers.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else setTimeout(start, 0);
})(window);
