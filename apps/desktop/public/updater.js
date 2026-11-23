// Update popup (see updater.html). Talks to the Rust side with Tauri's invoke; the
// Rust side pushes progress by calling window.vxUpdate(...).
(function () {
  "use strict";

  var TEXT = {
    es: {
      title: "Nueva versión disponible",
      versions: "Tienes la {current} · nueva: {version}",
      published: "publicada el {date}",
      noNotes: "Esta versión no tiene notas.",
      install: "Actualizar ahora",
      download: "Descargar",
      later: "Más tarde",
      skip: "Omitir esta versión",
      live: "Estás en directo o grabando: al actualizar se detendrá y Vexcast se reiniciará.",
      manual: "Esta instalación se actualiza descargando el paquete nuevo desde la página de la versión.",
      downloading: "Descargando…",
      installing: "Instalando…",
      restarting: "Reiniciando Vexcast…",
      failed: "No se pudo actualizar: {error}",
      retry: "Reintentar",
      restart: "Reiniciar Vexcast",
      page: "Descargar a mano",
      close: "Cerrar",
    },
    en: {
      title: "New version available",
      versions: "You have {current} · new: {version}",
      published: "released on {date}",
      noNotes: "This version has no release notes.",
      install: "Update now",
      download: "Download",
      later: "Later",
      skip: "Skip this version",
      live: "You're live or recording: updating stops it and restarts Vexcast.",
      manual: "This install is updated by downloading the new package from the release page.",
      downloading: "Downloading…",
      installing: "Installing…",
      restarting: "Restarting Vexcast…",
      failed: "Couldn't update: {error}",
      retry: "Try again",
      restart: "Restart Vexcast",
      page: "Download manually",
      close: "Close",
    },
  };

  var $ = function (id) { return document.getElementById(id); };
  var t = TEXT.es;
  var info = null;

  function invoke(cmd, args) {
    var tauri = window.__TAURI_INTERNALS__;
    if (!tauri) return Promise.reject(new Error("Tauri unavailable"));
    return tauri.invoke(cmd, args || {});
  }

  function fmt(s, vars) {
    return s.replace(/\{(\w+)\}/g, function (_, k) { return vars[k] == null ? "" : String(vars[k]); });
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Inline markdown on already-escaped text: code, bold, italics, links.
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  }

  // Small markdown subset for release notes (headings, lists, paragraphs).
  function markdown(src) {
    var out = [];
    var list = false;
    var para = [];
    function flushPara() {
      if (para.length) out.push("<p>" + inline(para.join(" ")) + "</p>");
      para = [];
    }
    function closeList() {
      if (list) out.push("</ul>");
      list = false;
    }
    esc(src.replace(/\r/g, "")).split("\n").forEach(function (line) {
      var m;
      if (!line.trim()) { flushPara(); closeList(); return; }
      if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        flushPara(); closeList();
        var level = Math.min(4, m[1].length + 1);
        out.push("<h" + level + ">" + inline(m[2]) + "</h" + level + ">");
        return;
      }
      if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
        flushPara();
        if (!list) { out.push("<ul>"); list = true; }
        out.push("<li>" + inline(m[1]) + "</li>");
        return;
      }
      closeList();
      para.push(line.trim());
    });
    flushPara(); closeList();
    return out.join("");
  }

  function notice(kind, text) {
    var n = $("notice");
    n.className = "notice" + (kind ? " " + kind : "");
    n.textContent = text || "";
  }

  function button(id, label, onClick, hidden) {
    var b = $(id);
    b.textContent = label;
    b.onclick = onClick;
    b.hidden = !!hidden;
    b.disabled = false;
  }

  function idle() {
    $("progress").classList.remove("on");
    if (!info.canInstall) notice("warn", t.manual);
    else if (info.busyOutput) notice("warn", t.live);
    else notice("", "");
    button("skip", t.skip, function () { invoke("update_skip", { version: info.version }); });
    button("later", t.later, function () { invoke("update_close"); });
    if (info.canInstall) button("install", t.install, install);
    else button("install", t.download, function () { invoke("update_open_page", { url: info.releaseUrl }); invoke("update_close"); });
  }

  function install() {
    progress({ phase: "download", done: 0, total: null });
    invoke("update_install").catch(function () { /* the error arrives through vxUpdate */ });
  }

  function mb(n) { return (n / 1048576).toFixed(1) + " MB"; }

  function progress(msg) {
    var busy = msg.phase !== "error";
    $("progress").classList.toggle("on", busy);
    ["skip", "later", "install"].forEach(function (id) { $(id).disabled = busy; });
    if (msg.phase === "error") {
      notice("error", fmt(t.failed, { error: msg.error || "?" }));
      if (msg.restart) {
        button("skip", t.page, function () { invoke("update_open_page", { url: info.releaseUrl }); });
        button("later", "", null, true);
        button("install", t.restart, function () { invoke("update_restart"); });
      } else {
        button("skip", t.page, function () { invoke("update_open_page", { url: info.releaseUrl }); });
        button("later", t.close, function () { invoke("update_close"); });
        button("install", t.retry, install);
      }
      return;
    }
    notice(info && info.busyOutput ? "warn" : "", info && info.busyOutput ? t.live : "");
    var bar = $("bar");
    var known = msg.phase === "download" && msg.total;
    bar.classList.toggle("indeterminate", !known);
    $("fill").style.width = known ? Math.min(100, (msg.done / msg.total) * 100).toFixed(1) + "%" : "";
    $("phase").textContent = msg.phase === "download" ? t.downloading : msg.phase === "install" ? t.installing : t.restarting;
    $("amount").textContent =
      msg.phase !== "download" ? "" : known ? Math.round((msg.done / msg.total) * 100) + "% · " + mb(msg.done) + " / " + mb(msg.total) : mb(msg.done || 0);
  }

  function render() {
    t = TEXT[(info.language || "es").slice(0, 2)] || TEXT.es;
    document.documentElement.lang = t === TEXT.en ? "en" : "es";
    $("title").textContent = t.title;
    $("versions").innerHTML =
      fmt(esc(t.versions), { current: "<b>" + esc(info.current) + "</b>", version: "<b>" + esc(info.version) + "</b>" }) +
      (info.date ? " · " + esc(fmt(t.published, { date: info.date })) : "");
    $("notes").innerHTML = info.notes && info.notes.trim() ? markdown(info.notes) : '<span class="empty">' + esc(t.noNotes) + "</span>";
    idle();
  }

  function load() {
    invoke("update_details").then(function (d) {
      if (!d) { invoke("update_close"); return; }
      info = d;
      render();
    });
  }

  // Links in the notes open in the browser (only the project's GitHub pages).
  $("notes").addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a");
    if (!a) return;
    e.preventDefault();
    invoke("update_open_page", { url: a.getAttribute("href") });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !$("progress").classList.contains("on")) invoke("update_close");
  });

  window.vxUpdate = progress;
  window.vxReload = load;
  load();
})();
