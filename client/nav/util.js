// nav/util.js — shared context + small utilities for the nav client modules.
// Everything the sidebar needs hangs off window.docsNav ("DN" here): nav.js
// (the boot file) fills in DN.list/iframe/navAside at boot; each module
// attaches its functions before that. Modules load first, nav.js runs last,
// so cross-module calls (DN.edit.moveTo, DN.refresh, …) resolve at runtime
// with no load-order coupling.
var DN = window.docsNav = window.docsNav || {};

// Static export (spec-space export): the tree comes from manifest.json and
// the sidebar is read-only — no delete/rename/mkdir/drag (those need the dev
// server's POST endpoints, which don't exist on a static host).
DN.EXPORT = window.DOCS_EXPORT === true;
DN.ROOT_INFO = { root: "", sep: "/", platform: "" }; // root path, OS separator, OS itself
DN.SITE_TITLE = ""; // from _config.json → manifest.title — used for per-doc tab titles

DN.basename = function (p) { return p.split("/").pop(); };
// Percent-encoded pathnames (emoji, accents, spaces...) vs. raw manifest
// paths — always compare decoded. decode alone can't throw on "+" or
// stray "%", but guard anyway.
DN.decPath = function (p) { try { return decodeURIComponent(p); } catch (e) { return p; } };

// URL base under the manager ("/<slug>"), "" when served single-root.
// Every /__... API call and every pathname↔path conversion goes through
// these so the same code serves both modes.
DN.BASE = window.DOCS_BASE || "";
DN.BASEP = DN.BASE.replace(/\/+$/, ""); // no trailing slash — join with "/" + path
var BASE_REL = DN.decPath(DN.BASE).replace(/^\/+|\/+$/g, ""); // "slug" or ""
DN.stripBase = function (p) { // leading-slash-stripped pathname → path inside the root
  if (BASE_REL && p.toLowerCase().indexOf(BASE_REL.toLowerCase() + "/") === 0) return p.slice(BASE_REL.length + 1);
  return p;
};
DN.dirname = function (p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); };
// the doc the browser is currently showing (URL → path inside the root)
DN.curPath = function () { return DN.stripBase(DN.decPath(location.pathname.replace(/^\/+/, ""))); };

DN.validName = function (name, isFolder) {
  if (typeof name !== "string") return false;
  var n = name.trim();
  if (!n || /[\\/:*?"<>|\x00-\x1f]/.test(n)) return false;
  if (n.startsWith(".") || n.startsWith("_")) return false;
  if (!isFolder && n.toLowerCase() === "index") return false; // index.html is the shell
  return n;
};

DN.api = function (url, body) {
  // delegate the URL/method/JSON wiring to lib.js; keep the response policy
  // in the nav (409 → friendly message) — it's local to it
  return window.docsLib.api(url, body).then(function (r) {
    if (!r.ok) throw new Error(r.status === 409 ? "A file or folder with that name already exists" : "request failed (" + r.status + ")");
    return r.text();
  });
};

var toastTimer = null;
DN.toast = function (msg, isErr) {
  var t = document.querySelector(".dl-toast");
  if (!t) { t = document.createElement("div"); t.className = "dl-toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.toggle("dl-err", !!isErr);
  t.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.style.display = "none"; }, 4000);
};

DN.copyText = function (text, okMsg) {
  function fallback() {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); DN.toast(okMsg); } catch (e) { DN.toast("Could not copy", true); }
    ta.remove();
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { DN.toast(okMsg); }, fallback);
  } else fallback();
};
