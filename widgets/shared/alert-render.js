/*
 * Vexcast alert renderer (shared by the alert box widget and the alert designer).
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 *   var a = VexcastAlertRender.render(design, event, { mode: "play" | "static", audio: false, mediaUrl: fn });
 *   container.appendChild(a.el);   // a.el is design.width x design.height px: scale it to fit
 *   a.stop(function () { ... });   // plays the exit animations, then calls back
 *
 * A design is a canvas with layers (text, image, video, shape) or custom HTML/CSS/JS.
 * Text supports {user} {amount} {currency} {message} {months} {platform} {type}.
 */
(function (global) {
  "use strict";

  var ANIMS_IN = ["none", "fadeIn", "zoomIn", "zoomOutIn", "pop", "slideUp", "slideDown", "slideLeft", "slideRight", "bounceIn", "dropIn", "flipIn", "rotateIn", "blurIn", "typewriter", "letterPop", "letterRise", "letterDrop", "letterFade"];
  var ANIMS_OUT = ["none", "fadeOut", "zoomOut", "slideUpOut", "slideDownOut", "slideLeftOut", "slideRightOut", "flipOut", "rotateOut", "blurOut"];
  var LOOPS = ["none", "pulse", "float", "shake", "wobble", "glow", "spin", "heartbeat", "swing"];
  var TEXT_EFFECTS = ["none", "wave", "bounce", "jelly", "rainbow", "flicker", "shake"];
  var PARTICLE_TYPES = ["confetti", "sparkles", "hearts", "stars", "snow", "bubbles", "emoji"];
  var SYSTEM_FONTS = ["arial", "impact", "verdana", "tahoma", "georgia", "times new roman", "courier new", "segoe ui", "trebuchet ms", "comic sans ms", "system-ui", "sans-serif", "serif", "monospace"];

  var CSS =
    ".vxa{position:relative;overflow:hidden;pointer-events:none}" +
    ".vxa-layer{position:absolute;box-sizing:border-box}" +
    ".vxa-inner{width:100%;height:100%;box-sizing:border-box}" +
    ".vxa-text{display:flex;width:100%;height:100%;overflow-wrap:anywhere;white-space:pre-wrap}" +
    ".vxa-media{width:100%;height:100%;display:block}" +
    // in
    "@keyframes vxa-fadeIn{from{opacity:0}to{opacity:1}}" +
    "@keyframes vxa-zoomIn{from{opacity:0;transform:scale(.3)}to{opacity:1;transform:none}}" +
    "@keyframes vxa-zoomOutIn{from{opacity:0;transform:scale(2.2)}to{opacity:1;transform:none}}" +
    "@keyframes vxa-pop{0%{opacity:0;transform:scale(.3)}60%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:none}}" +
    "@keyframes vxa-slideUp{from{opacity:0;transform:translateY(60%)}to{opacity:1;transform:none}}" +
    "@keyframes vxa-slideDown{from{opacity:0;transform:translateY(-60%)}to{opacity:1;transform:none}}" +
    "@keyframes vxa-slideLeft{from{opacity:0;transform:translateX(60%)}to{opacity:1;transform:none}}" +
    "@keyframes vxa-slideRight{from{opacity:0;transform:translateX(-60%)}to{opacity:1;transform:none}}" +
    "@keyframes vxa-bounceIn{0%{opacity:0;transform:scale(.3)}50%{opacity:1;transform:scale(1.1)}70%{transform:scale(.92)}85%{transform:scale(1.03)}100%{opacity:1;transform:none}}" +
    "@keyframes vxa-dropIn{0%{opacity:0;transform:translateY(-120%)}60%{opacity:1;transform:translateY(8%)}80%{transform:translateY(-3%)}100%{opacity:1;transform:none}}" +
    "@keyframes vxa-flipIn{from{opacity:0;transform:perspective(800px) rotateX(90deg)}to{opacity:1;transform:none}}" +
    "@keyframes vxa-rotateIn{from{opacity:0;transform:rotate(-200deg) scale(.4)}to{opacity:1;transform:none}}" +
    "@keyframes vxa-blurIn{from{opacity:0;filter:blur(24px)}to{opacity:1;filter:none}}" +
    // out
    "@keyframes vxa-fadeOut{to{opacity:0}}" +
    "@keyframes vxa-zoomOut{to{opacity:0;transform:scale(.3)}}" +
    "@keyframes vxa-slideUpOut{to{opacity:0;transform:translateY(-60%)}}" +
    "@keyframes vxa-slideDownOut{to{opacity:0;transform:translateY(60%)}}" +
    "@keyframes vxa-slideLeftOut{to{opacity:0;transform:translateX(-60%)}}" +
    "@keyframes vxa-slideRightOut{to{opacity:0;transform:translateX(60%)}}" +
    "@keyframes vxa-flipOut{to{opacity:0;transform:perspective(800px) rotateX(-90deg)}}" +
    "@keyframes vxa-rotateOut{to{opacity:0;transform:rotate(200deg) scale(.4)}}" +
    "@keyframes vxa-blurOut{to{opacity:0;filter:blur(24px)}}" +
    // loops
    "@keyframes vxa-l-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}" +
    "@keyframes vxa-l-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4%)}}" +
    "@keyframes vxa-l-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-2%)}40%,80%{transform:translateX(2%)}}" +
    "@keyframes vxa-l-wobble{0%,100%{transform:rotate(0)}25%{transform:rotate(-3deg)}75%{transform:rotate(3deg)}}" +
    "@keyframes vxa-l-glow{0%,100%{filter:drop-shadow(0 0 0 rgba(255,255,255,0))}50%{filter:drop-shadow(0 0 18px rgba(255,255,255,.75))}}" +
    "@keyframes vxa-l-spin{to{transform:rotate(360deg)}}" +
    "@keyframes vxa-l-heartbeat{0%,40%,100%{transform:scale(1)}15%{transform:scale(1.12)}25%{transform:scale(.97)}}" +
    "@keyframes vxa-l-swing{0%,100%{transform:rotate(0)}50%{transform:rotate(6deg)}}" +
    "@keyframes vxa-caret{50%{border-color:transparent}}" +
    // progress bar
    ".vxa-bar{position:absolute;left:0;bottom:0;border-radius:inherit;transition:width 1.1s cubic-bezier(.2,.8,.2,1),height 1.1s cubic-bezier(.2,.8,.2,1)}" +
    ".vxa-bar.st{animation:vxa-stripes 1s linear infinite}" +
    "@keyframes vxa-stripes{to{background-position:40px 0,0 0}}" +
    // per letter
    ".vxa-w{display:inline-block;white-space:nowrap}" +
    ".vxa-ch,.vxa-cl{display:inline-block;white-space:pre}" +
    "@keyframes vxa-ch-letterPop{0%{opacity:0;transform:scale(0)}70%{opacity:1;transform:scale(1.3)}100%{opacity:1;transform:none}}" +
    "@keyframes vxa-ch-letterRise{from{opacity:0;transform:translateY(.8em)}to{opacity:1;transform:none}}" +
    "@keyframes vxa-ch-letterDrop{0%{opacity:0;transform:translateY(-1.2em)}60%{opacity:1;transform:translateY(.12em)}100%{opacity:1;transform:none}}" +
    "@keyframes vxa-ch-letterFade{from{opacity:0;filter:blur(6px)}to{opacity:1;filter:none}}" +
    "@keyframes vxa-fx-wave{0%,100%{transform:translateY(0)}50%{transform:translateY(-.22em)}}" +
    "@keyframes vxa-fx-bounce{0%,60%,100%{transform:translateY(0)}20%{transform:translateY(-.45em) scale(1.08)}40%{transform:translateY(0) scaleY(.9)}}" +
    "@keyframes vxa-fx-jelly{0%,100%{transform:scale(1,1)}25%{transform:scale(1.25,.8)}50%{transform:scale(.85,1.15)}75%{transform:scale(1.08,.95)}}" +
    "@keyframes vxa-fx-rainbow{0%{color:#ff5e7e}17%{color:#ffb84d}33%{color:#ffe14d}50%{color:#5ef08a}67%{color:#4cc9f0}83%{color:#9b5de5}100%{color:#ff5e7e}}" +
    "@keyframes vxa-fx-flicker{0%,18%,22%,25%,53%,57%,100%{opacity:1}20%,24%,55%{opacity:.25}}" +
    "@keyframes vxa-fx-shake{0%,100%{transform:translate(0,0) rotate(0)}25%{transform:translate(-.04em,.03em) rotate(-3deg)}50%{transform:translate(.03em,-.04em) rotate(2deg)}75%{transform:translate(.04em,.02em) rotate(-1deg)}}";

  var FX = { wave: [1400, 90, "ease-in-out"], bounce: [1600, 80, "ease-out"], jelly: [1200, 70, "ease-in-out"], rainbow: [2400, 120, "linear"], flicker: [3000, 230, "steps(1,end)"], shake: [380, 50, "linear"] };

  var LOOP_MS = { pulse: 1600, float: 3000, shake: 600, wobble: 1400, glow: 2000, spin: 4000, heartbeat: 1400, swing: 2000 };

  function injectCss() {
    if (document.getElementById("vxa-css")) return;
    var s = document.createElement("style");
    s.id = "vxa-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var loadedFonts = {};
  /** Load a Google font by family name (system fonts are left alone). */
  function loadFont(family) {
    var f = String(family || "").trim();
    if (!f || loadedFonts[f] || SYSTEM_FONTS.indexOf(f.toLowerCase()) >= 0) return;
    loadedFonts[f] = 1;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + encodeURIComponent(f).replace(/%20/g, "+") + ":ital,wght@0,400;0,600;0,700;0,800;0,900;1,700&display=swap";
    document.head.appendChild(l);
  }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(amount, currency) {
    var V = global.Vexcast;
    if (V && V.formatMoney) return V.formatMoney(amount, currency);
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
    } catch (e) {
      return amount + " " + (currency || "");
    }
  }

  var MONEY = { donation: 1, kofi: 1, superchat: 1 };

  /** Values for the {placeholders}. */
  function vars(ev) {
    var amount = "";
    if (ev.amount !== null && ev.amount !== undefined) {
      amount = MONEY[ev.type] && ev.currency ? money(ev.amount, ev.currency) : String(Math.round(ev.amount * 100) / 100);
    }
    return {
      user: ev.user || "Anónimo",
      amount: amount,
      currency: ev.currency || "",
      message: ev.message || "",
      months: ev.type === "subscription" || ev.type === "member" ? amount : "",
      platform: ev.platform || "",
      type: ev.type || "",
      title: ev.title || "",
      current: ev.goal ? goalMoney(ev.current, ev.currency) : "",
      target: ev.goal ? goalMoney(ev.target, ev.currency) : "",
      remaining: ev.goal ? goalMoney(Math.max(0, (Number(ev.target) || 0) - (Number(ev.current) || 0)), ev.currency) : "",
      percent: ev.goal ? Math.floor(goalPct(ev)) + "%" : "",
    };
  }
  function goalMoney(n, cur) {
    n = Math.round((Number(n) || 0) * 100) / 100;
    return cur ? money(n, cur) : String(n);
  }
  function goalPct(ev) {
    if (typeof ev.percent === "number") return Math.max(0, Math.min(100, ev.percent));
    var t = Number(ev.target) || 0;
    return t > 0 ? Math.max(0, Math.min(100, ((Number(ev.current) || 0) / t) * 100)) : 0;
  }

  /** Template → HTML with {user}/{amount} highlighted. */
  function textHtml(tpl, v, highlight) {
    return esc(tpl).replace(/\{(user|amount|currency|message|months|platform|type|title|current|target|remaining|percent)\}/g, function (m, k) {
      var val = esc(v[k]);
      if ((k === "user" || k === "amount" || k === "current") && highlight) return '<span style="color:' + esc(highlight) + '">' + val + "</span>";
      return val;
    });
  }

  function plainVars(s, v) {
    return String(s || "").replace(/\{\{?\s*(user|name|amount|currency|message|months|platform|type|title|current|target|remaining|percent)\s*\}?\}/g, function (m, k) {
      return k === "name" ? v.user : v[k];
    });
  }

  function layerVisible(l, ev) {
    if (l.visible === false) return false;
    if (l.showWhen === "message") return !!ev.message;
    if (l.showWhen === "amount") return ev.amount !== null && ev.amount !== undefined;
    if (l.showWhen === "reached") return !!ev.reached;
    if (l.showWhen === "notReached") return !ev.reached;
    return true;
  }

  function buildLayer(l, ev, v, opts) {
    var el = document.createElement("div");
    el.className = "vxa-layer";
    el.dataset.layer = l.id || "";
    el.style.left = (l.x || 0) + "px";
    el.style.top = (l.y || 0) + "px";
    el.style.width = Math.max(1, l.w || 1) + "px";
    el.style.height = Math.max(1, l.h || 1) + "px";
    if (l.rotation) el.style.transform = "rotate(" + l.rotation + "deg)";
    el.style.opacity = l.opacity === undefined ? 1 : l.opacity;

    // anim wrapper (in/out) → inner (loop) → content
    var anim = document.createElement("div");
    anim.className = "vxa-inner";
    var inner = document.createElement("div");
    inner.className = "vxa-inner";
    anim.appendChild(inner);
    el.appendChild(anim);

    var kind = l.kind || "text";
    if (kind === "text") {
      loadFont(l.fontFamily);
      var t = document.createElement("div");
      t.className = "vxa-text";
      var align = l.align || "center";
      var valign = l.valign || "middle";
      t.style.justifyContent = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
      t.style.alignItems = valign === "top" ? "flex-start" : valign === "bottom" ? "flex-end" : "center";
      t.style.textAlign = align;
      var span = document.createElement("span");
      span.innerHTML = textHtml(l.text || "", v, l.highlight);
      span.setAttribute("data-html", span.innerHTML);
      var st = span.style;
      st.fontFamily = l.fontFamily ? '"' + String(l.fontFamily).replace(/"/g, "") + '", system-ui, sans-serif' : "system-ui, sans-serif";
      st.fontSize = (l.fontSize || 48) + "px";
      st.fontWeight = String(l.fontWeight || 700);
      st.fontStyle = l.italic ? "italic" : "normal";
      st.textTransform = l.uppercase ? "uppercase" : "none";
      st.color = l.color || "#fff";
      st.lineHeight = String(l.lineHeight || 1.15);
      st.letterSpacing = (l.letterSpacing || 0) + "px";
      if (l.strokeWidth > 0 && l.strokeColor) {
        st.webkitTextStroke = l.strokeWidth + "px " + l.strokeColor;
        st.paintOrder = "stroke fill";
      }
      if (l.shadowColor && (l.shadowBlur || l.shadowX || l.shadowY)) st.textShadow = (l.shadowX || 0) + "px " + (l.shadowY || 0) + "px " + (l.shadowBlur || 0) + "px " + l.shadowColor;
      var letterIn = /^letter/.test(l.animIn || "") && opts.mode === "play";
      var fx = FX[l.textEffect] && opts.mode === "play" ? l.textEffect : "";
      if ((letterIn || fx) && l.animIn !== "typewriter") {
        splitLetters(span, letterIn ? l.animIn : "", l.animInMs || 900, l.animInDelay || 0, fx);
      }
      if (l.animIn === "typewriter" && opts.mode === "play") {
        // Reveal letter by letter (keeps the highlighted spans).
        var full = span.innerHTML;
        span.innerHTML = "";
        typewriter(span, full, l.animInMs || 1200, l.animInDelay || 0);
      }
      t.appendChild(span);
      inner.appendChild(t);
    } else if (kind === "image" || kind === "video") {
      if (l.src) {
        var src = opts.mediaUrl ? opts.mediaUrl(l.src) : l.src;
        var m;
        if (kind === "video") {
          m = document.createElement("video");
          m.autoplay = true;
          m.playsInline = true;
          m.loop = !!l.loopMedia || opts.mode === "static";
          // The core mixes alert audio into the stream; the overlay only plays it with ?audio=1.
          m.muted = opts.mode === "static" || !opts.audio || !!l.muted;
          m.setAttribute("playsinline", "");
          if (m.muted) m.setAttribute("muted", "");
        } else {
          m = document.createElement("img");
          m.alt = "";
        }
        m.className = "vxa-media";
        m.style.objectFit = l.fit || "contain";
        m.src = src;
        inner.appendChild(m);
      }
    } else if (kind === "progress") {
      var ts = inner.style;
      ts.position = "relative";
      ts.overflow = "hidden";
      ts.background = l.trackColor || "rgba(255,255,255,.12)";
      ts.borderRadius = (l.radius || 0) + "px";
      if (l.borderWidth > 0) ts.border = l.borderWidth + "px solid " + (l.borderColor || "#fff");
      var bar = document.createElement("div");
      bar.className = "vxa-bar" + (l.barStripes ? " st" : "");
      var c1 = l.fill || "#7c5cff";
      var grad = "linear-gradient(" + (l.barVertical ? "0deg" : "90deg") + "," + c1 + "," + (l.barColor2 || c1) + ")";
      bar.style.backgroundImage = (l.barStripes ? "linear-gradient(45deg,rgba(255,255,255,.2) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.2) 50%,rgba(255,255,255,.2) 75%,transparent 75%)," : "") + grad;
      if (l.barStripes) bar.style.backgroundSize = "40px 40px,100% 100%";
      if (l.barGlow) bar.style.boxShadow = "0 0 18px " + c1;
      if (l.barVertical) bar.style.width = "100%";
      else bar.style.height = "100%";
      inner.appendChild(bar);
      var pct = goalPct(ev);
      if (opts.mode === "play") {
        setBar(bar, 0, l.barVertical);
        setTimeout(function () { setBar(bar, pct, l.barVertical); }, (l.animInDelay || 0) + 120);
      } else {
        bar.style.transition = "none";
        setBar(bar, pct, l.barVertical);
      }
    } else if (kind === "particles") {
      particles(l, inner, opts);
    } else if (kind === "shape") {
      var s = inner.style;
      s.background = l.fill || "transparent";
      s.borderRadius = (l.radius || 0) + "px";
      if (l.borderWidth > 0) s.border = l.borderWidth + "px solid " + (l.borderColor || "#fff");
    }

    if (opts.mode === "play") {
      var ain = l.animIn || "none";
      if (ain !== "none" && ain !== "typewriter" && !(kind === "text" && /^letter/.test(ain))) {
        anim.style.animation = "vxa-" + ain + " " + (l.animInMs || 600) + "ms cubic-bezier(.2,.8,.2,1) " + (l.animInDelay || 0) + "ms both";
      }
      var loop = l.animLoop || "none";
      if (loop !== "none" && LOOP_MS[loop]) {
        inner.style.animation = "vxa-l-" + loop + " " + LOOP_MS[loop] + "ms ease-in-out " + ((l.animInMs || 600) + (l.animInDelay || 0)) + "ms infinite" + (loop === "spin" ? "" : "");
        if (loop === "spin") inner.style.animationTimingFunction = "linear";
      }
    }
    return el;
  }

  /** Wrap every letter (keeping highlight spans) for per-letter entry and loop effects. */
  function splitLetters(span, entry, ms, delay, fx) {
    var nodes = [];
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) nodes.push(c);
        else if (c.nodeType === 1) walk(c);
      }
    })(span);
    var total = 0;
    nodes.forEach(function (n) {
      total += Array.from(n.nodeValue.replace(/\s+/g, "")).length;
    });
    total = Math.max(1, total);
    var stepIn = Math.max(18, Math.min(140, (ms * 0.7) / total));
    var durIn = Math.max(250, ms - stepIn * (total - 1));
    var fxc = FX[fx];
    var i = 0;
    nodes.forEach(function (n) {
      var frag = document.createDocumentFragment();
      n.nodeValue.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) return frag.appendChild(document.createTextNode(part));
        var w = document.createElement("span");
        w.className = "vxa-w";
        Array.from(part).forEach(function (ch) {
          var o = document.createElement("span");
          o.className = "vxa-ch";
          var c = document.createElement("span");
          c.className = "vxa-cl";
          c.textContent = ch;
          if (entry) o.style.animation = "vxa-ch-" + entry + " " + Math.round(durIn) + "ms cubic-bezier(.2,.8,.2,1) " + Math.round(delay + i * stepIn) + "ms both";
          if (fxc) c.style.animation = "vxa-fx-" + fx + " " + fxc[0] + "ms " + fxc[2] + " " + Math.round((entry ? delay + ms : 0) + i * fxc[1]) + "ms infinite";
          o.appendChild(c);
          w.appendChild(o);
          i++;
        });
        frag.appendChild(w);
      });
      n.parentNode.replaceChild(frag, n);
    });
  }

  // ---------- particles ----------
  var PALETTE = ["#ff5e7e", "#ffd166", "#06d6a0", "#4cc9f0", "#9b5de5", "#ffffff", "#f15bb5"];
  function clamp(v, a, b) {
    v = Number(v);
    return isFinite(v) ? Math.max(a, Math.min(b, v)) : a;
  }
  function seeded(str) {
    var h = 2166136261;
    for (var k = 0; k < str.length; k++) h = Math.imul(h ^ str.charCodeAt(k), 16777619);
    return function () {
      h = (h + 0x6d2b79f5) | 0;
      var t = Math.imul(h ^ (h >>> 15), 1 | h);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function graphemes(s) {
    s = String(s || "").replace(/\s+/g, "");
    if (global.Intl && Intl.Segmenter) {
      var out = [];
      var it = new Intl.Segmenter().segment(s)[Symbol.iterator]();
      for (var r = it.next(); !r.done; r = it.next()) out.push(r.value.segment);
      return out;
    }
    return Array.from(s);
  }
  function starPath(ctx, r, points, inner) {
    ctx.beginPath();
    for (var k = 0; k < points * 2; k++) {
      var rr = k % 2 ? r * inner : r;
      var a = (k * Math.PI) / points - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }
  function heartPath(ctx, r) {
    ctx.beginPath();
    ctx.moveTo(0, r * 0.35);
    ctx.bezierCurveTo(-r * 1.1, -r * 0.45, -r * 0.45, -r * 1.15, 0, -r * 0.45);
    ctx.bezierCurveTo(r * 0.45, -r * 1.15, r * 1.1, -r * 0.45, 0, r * 0.35);
    ctx.closePath();
  }

  /** Canvas particles inside the layer box: burst (one shot), fountain or rain (continuous). */
  function particles(l, box, opts) {
    var W = Math.max(1, Math.round(l.w || 1));
    var H = Math.max(1, Math.round(l.h || 1));
    var cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    cv.className = "vxa-media";
    box.appendChild(cv);
    var ctx = cv.getContext("2d");
    if (!ctx) return;
    var type = PARTICLE_TYPES.indexOf(l.particleType) >= 0 ? l.particleType : "confetti";
    var mode = l.particleMode === "fountain" || l.particleMode === "rain" ? l.particleMode : "burst";
    var count = Math.round(clamp(l.particleCount || 120, 1, 600));
    var size = clamp(l.particleSize || 18, 2, 240);
    var speed = clamp(l.particleSpeed || 1, 0.1, 5);
    var colors = String(l.particleColors || "").split(/[,\s]+/).filter(function (c) { return /^#[0-9a-f]{3,8}$/i.test(c); });
    if (!colors.length) colors = type === "snow" ? ["#ffffff", "#e6f0ff"] : type === "hearts" ? ["#ff5e7e", "#ff8fab", "#f15bb5", "#ffffff"] : type === "sparkles" || type === "stars" ? ["#fff6c2", "#ffd166", "#ffffff", "#c7b8ff"] : PALETTE;
    var emojis = type === "emoji" ? graphemes(l.particleEmoji || "🎉") : [];
    if (type === "emoji" && !emojis.length) emojis = ["🎉"];
    var rnd = seeded((l.id || "p") + type + mode);
    var M = Math.min(W, H);
    var up = type === "bubbles";
    var emitMs = mode === "burst" ? 0 : l.particleDurationMs > 0 ? l.particleDurationMs : 1e9;
    var delay = opts.mode === "play" ? l.animInDelay || 0 : 0;
    var list = [];

    function make(t) {
      var p = { born: t, s: size * (0.6 + rnd() * 0.8), c: colors[(rnd() * colors.length) | 0], e: emojis.length ? emojis[(rnd() * emojis.length) | 0] : "", rot: rnd() * 6.28, vr: (rnd() - 0.5) * 8, ph: rnd() * 6.28 };
      if (mode === "burst") {
        var a = rnd() * 6.28;
        var v = (0.35 + rnd() * 0.85) * M * 1.5 * speed;
        p.x = W / 2;
        p.y = H / 2;
        p.vx = Math.cos(a) * v;
        p.vy = Math.sin(a) * v - M * 0.35 * speed;
        p.life = 2.2 + rnd() * 1.6;
      } else if (mode === "fountain") {
        var b = -Math.PI / 2 + (rnd() - 0.5) * 0.9;
        var u = (0.75 + rnd() * 0.5) * H * 1.35 * speed;
        p.x = W / 2 + (rnd() - 0.5) * W * 0.06;
        p.y = up ? 0 : H;
        p.vx = Math.cos(b) * u * 0.6;
        p.vy = up ? -Math.sin(b) * u : Math.sin(b) * u;
        p.life = 2.6 + rnd();
      } else {
        p.x = rnd() * W;
        p.y = up ? H + p.s : -p.s;
        p.vx = (rnd() - 0.5) * 30 * speed;
        p.vy = (up ? -1 : 1) * (0.12 + rnd() * 0.22) * H * speed * (type === "snow" ? 0.6 : 1);
        p.life = (H + p.s * 2) / Math.abs(p.vy) + 0.2;
      }
      return p;
    }
    var gravity = (type === "snow" || type === "bubbles" ? 0 : type === "sparkles" || type === "stars" ? 0.45 : 1) * H * 1.1 * speed * speed;
    var drag = type === "confetti" || type === "emoji" ? 0.985 : 0.992;
    var spawnEvery = mode === "burst" ? 0 : mode === "rain" ? Math.max(0.01, (H / (0.23 * H * speed)) / count) : Math.max(0.008, 2.8 / count);
    var nextSpawn = 0;
    var spawned = 0;

    function step(t, dt) {
      if (mode === "burst") {
        if (!spawned) {
          for (var k = 0; k < count; k++) list.push(make(t));
          spawned = count;
        }
      } else if (t * 1000 < emitMs) {
        while (nextSpawn <= t) {
          if (mode === "rain" && t === 0 && !spawned) {
            // Pre-fill the sky so rain doesn't start empty.
            for (var j = 0; j < count; j++) {
              var q = make(0);
              q.born = -rnd() * q.life;
              list.push(q);
            }
            spawned = count;
          } else list.push(make(nextSpawn));
          nextSpawn += spawnEvery;
        }
      }
      for (var i = list.length - 1; i >= 0; i--) {
        var p = list[i];
        var age = t - p.born;
        if (age > p.life) {
          list.splice(i, 1);
          continue;
        }
        if (age < 0) continue;
        p.vx *= drag;
        p.vy = p.vy * drag + (up ? -gravity * 0.15 : gravity) * dt * (mode === "rain" ? 0 : 1);
        if (type === "confetti") p.vy = Math.min(p.vy, H * 0.45 * speed);
        p.x += (p.vx + (type === "snow" || type === "bubbles" || type === "confetti" ? Math.sin(t * 2 + p.ph) * 22 * speed : 0)) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
      }
    }

    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var age = t - p.born;
        if (age < 0) continue;
        var fade = Math.min(1, age / 0.15, (p.life - age) / 0.6);
        if (fade <= 0) continue;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        var r = p.s / 2;
        if (type === "confetti") {
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(t * 6 + p.ph));
          ctx.fillStyle = p.c;
          ctx.fillRect(-r, -r * 0.45, p.s, p.s * 0.45);
        } else if (type === "sparkles") {
          ctx.globalAlpha = fade * (0.55 + 0.45 * Math.sin(t * 9 + p.ph));
          ctx.rotate(p.rot * 0.2);
          ctx.fillStyle = p.c;
          ctx.shadowColor = p.c;
          ctx.shadowBlur = count <= 160 ? r : 0;
          starPath(ctx, r, 4, 0.28);
          ctx.fill();
        } else if (type === "stars") {
          ctx.rotate(p.rot * 0.4);
          ctx.fillStyle = p.c;
          starPath(ctx, r, 5, 0.45);
          ctx.fill();
        } else if (type === "hearts") {
          ctx.rotate(Math.sin(t * 3 + p.ph) * 0.3);
          ctx.fillStyle = p.c;
          heartPath(ctx, r);
          ctx.fill();
        } else if (type === "snow") {
          ctx.globalAlpha = fade * 0.85;
          ctx.fillStyle = p.c;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.5, 0, 6.283);
          ctx.fill();
        } else if (type === "bubbles") {
          ctx.strokeStyle = p.c;
          ctx.lineWidth = Math.max(1, r * 0.12);
          ctx.globalAlpha = fade * 0.75;
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, 6.283);
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,.55)";
          ctx.beginPath();
          ctx.arc(-r * 0.35, -r * 0.35, r * 0.18, 0, 6.283);
          ctx.fill();
        } else {
          ctx.rotate(p.rot * 0.25);
          ctx.font = p.s + "px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(p.e, 0, 0);
        }
        ctx.restore();
      }
    }

    if (opts.mode !== "play") {
      // Editor / thumbnail: one frozen frame that shows the look.
      var T = mode === "burst" ? 0.45 : mode === "fountain" ? 1.4 : 0;
      for (var s = 0; s <= T + 1e-6; s += 1 / 30) step(s, 1 / 30);
      draw(T);
      return;
    }
    var start = 0;
    var last = 0;
    function frame(now) {
      if (!cv.isConnected && start) return; // alert removed
      if (!start) start = now + delay;
      var t = Math.max(0, (now - start) / 1000);
      var dt = Math.min(0.05, t - last);
      last = t;
      if (now >= start) {
        step(t, dt);
        draw(t);
      }
      if (list.length || now < start || t * 1000 < emitMs || !spawned) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }

  function setBar(bar, pct, vertical) {
    if (vertical) bar.style.height = pct + "%";
    else bar.style.width = pct + "%";
  }

  function typewriter(span, html, ms, delay) {
    // Split into characters while keeping tags.
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var total = tmp.textContent.length || 1;
    var step = Math.max(15, ms / total);
    var shown = 0;
    setTimeout(function tick() {
      shown++;
      span.innerHTML = cut(html, shown);
      if (shown < total) setTimeout(tick, step);
    }, delay);
  }

  /** First n visible characters of an HTML string (tags kept). */
  function cut(html, n) {
    var out = "";
    var count = 0;
    var i = 0;
    var open = [];
    while (i < html.length && count < n) {
      if (html[i] === "<") {
        var end = html.indexOf(">", i);
        var tag = html.slice(i, end + 1);
        out += tag;
        if (tag[1] === "/") open.pop();
        else open.push(tag);
        i = end + 1;
      } else if (html[i] === "&") {
        var e = html.indexOf(";", i);
        out += html.slice(i, e + 1);
        i = e + 1;
        count++;
      } else {
        out += html[i++];
        count++;
      }
    }
    for (var k = open.length - 1; k >= 0; k--) out += "</span>";
    return out;
  }

  function render(design, ev, opts) {
    injectCss();
    opts = opts || {};
    var d = design || {};
    var W = d.width || 1920;
    var H = d.height || 1080;
    var root = document.createElement("div");
    root.className = "vxa";
    root.style.width = W + "px";
    root.style.height = H + "px";
    var v = vars(ev || {});
    var slots = [];

    if (d.customEnabled) {
      var style = document.createElement("style");
      style.textContent = plainVars(d.customCss, v);
      root.appendChild(style);
      var box = document.createElement("div");
      box.className = "vxa-custom";
      box.style.cssText = "position:absolute;inset:0";
      box.innerHTML = plainVars(d.customHtml, v);
      root.appendChild(box);
      if (d.customJs && opts.mode === "play") {
        setTimeout(function () {
          try {
            // eslint-disable-next-line no-new-func
            new Function("alert", "root", "vars", d.customJs)(ev, box, v);
          } catch (e) {
            console.error("[vexcast] custom alert js:", e);
          }
        }, 0);
      }
    } else {
      // One slot per layer (a marker keeps the stacking order) so update() can show/hide layers later.
      (d.layers || []).forEach(function (l) {
        var mark = document.createComment("");
        root.appendChild(mark);
        var el = layerVisible(l, ev || {}) ? buildLayer(l, ev || {}, v, opts) : null;
        if (el) root.insertBefore(el, mark);
        slots.push({ l: l, el: el, mark: mark });
      });
    }

    /** New values (goal progress): refresh texts and bars, show/hide reached layers without restarting. */
    function update(nev) {
      if (stopped || d.customEnabled) return;
      var e2 = nev || {};
      var v2 = vars(e2);
      slots.forEach(function (s) {
        var vis = layerVisible(s.l, e2);
        if (vis && !s.el) {
          s.el = buildLayer(s.l, e2, v2, opts);
          root.insertBefore(s.el, s.mark);
        } else if (!vis && s.el) {
          if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
          s.el = null;
        } else if (vis && s.el) {
          var k = s.l.kind || "text";
          if (k === "text") {
            var span = s.el.querySelector(".vxa-text > span");
            var html = textHtml(s.l.text || "", v2, s.l.highlight);
            if (span && span.getAttribute("data-html") !== html) {
              span.setAttribute("data-html", html);
              span.innerHTML = html;
              if (FX[s.l.textEffect] && opts.mode === "play") splitLetters(span, "", 0, 0, s.l.textEffect);
            }
          } else if (k === "progress") {
            var bar = s.el.querySelector(".vxa-bar");
            if (bar) setBar(bar, goalPct(e2), s.l.barVertical);
          }
        }
      });
    }

    var stopped = false;
    function stop(cb) {
      if (stopped) return;
      stopped = true;
      var longest = 0;
      if (opts.mode === "play" && !d.customEnabled) {
        (d.layers || []).forEach(function (l) {
          var el = root.querySelector('[data-layer="' + (l.id || "") + '"] > .vxa-inner');
          var out = l.animOut || "none";
          if (!el || out === "none") return;
          var ms = l.animOutMs || 500;
          longest = Math.max(longest, ms);
          el.style.animation = "vxa-" + out + " " + ms + "ms cubic-bezier(.5,0,.75,0) both";
        });
      } else if (opts.mode === "play") {
        root.style.transition = "opacity .5s";
        root.style.opacity = "0";
        longest = 500;
      }
      setTimeout(function () {
        root.querySelectorAll("video").forEach(function (m) {
          try {
            m.pause();
          } catch (e) {
            /* ignore */
          }
        });
        if (cb) cb();
      }, longest + 30);
    }

    return { el: root, width: W, height: H, stop: stop, update: update };
  }

  global.VexcastAlertRender = { render: render, ANIMS_IN: ANIMS_IN, ANIMS_OUT: ANIMS_OUT, LOOPS: LOOPS, TEXT_EFFECTS: TEXT_EFFECTS, PARTICLE_TYPES: PARTICLE_TYPES, loadFont: loadFont };
})(window);
