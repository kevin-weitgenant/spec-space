// nav/badges.js — change badges: docs that changed since you last saw them.
// Two sources, merged into `badges.changed` (re-applied on sidebar rebuilds):
//  1. mtime (authoritative, survives closed tabs): the manifest carries each
//     file's mtime; we compare against "last time this browser OPENED the doc"
//     (localStorage). New file you never opened → compared against the first
//     time this browser saw the manifest (epoch) — so only files created/
//     changed after you started using this get the dot.
//  2. live SSE events (docs-in-html:change) — instant dot, no manifest round-trip.
// The doc being viewed never gets a dot: its own inline highlights take over.
var DN = window.docsNav;

DN.badges = {
  changed: new Set(), // paths with pending dots
  activePath: null,   // the doc currently displayed in the iframe
  mtimes: {}          // path → mtime from the manifest
};

var SEEN_KEY = "docs-in-html:seen:" + DN.BASE;
var EPOCH_KEY = "docs-in-html:epoch:" + DN.BASE;

function lsJson(k, fb) { try { return JSON.parse(localStorage.getItem(k) || "null") || fb; } catch (e) { return fb; } }
function seenMap() { return lsJson(SEEN_KEY, {}); }

DN.badges.markSeen = function (path) {
  if (!path) return;
  var s = seenMap(); s[path] = Date.now();
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) {}
  DN.badges.changed.delete(path);
  DN.badges.apply();
};

function collectMtimes(nodes, out) {
  (nodes || []).forEach(function (n) {
    if (n.type === "folder") collectMtimes(n.children, out);
    else if (typeof n.mtime === "number") out[n.path] = n.mtime;
  });
}

DN.badges.syncMtimes = function (tree) {
  if (!tree) return;
  DN.badges.mtimes = {};
  collectMtimes(tree, DN.badges.mtimes);
  var epoch = Number(localStorage.getItem(EPOCH_KEY) || 0);
  if (!epoch) { try { localStorage.setItem(EPOCH_KEY, String(Date.now())); } catch (e) {} return; }
  var seen = seenMap();
  for (var p in DN.badges.mtimes) {
    if (p === DN.badges.activePath) continue;
    var last = seen[p] || epoch; // never opened → dot only if newer than our first day here
    if (DN.badges.mtimes[p] > last + 1000) DN.badges.changed.add(p); // +1s: same-save races
  }
  DN.badges.apply();
};

DN.badges.apply = function () {
  var links = DN.list.querySelectorAll("a");
  for (var i = 0; i < links.length; i++) {
    var p = links[i].dataset.path;
    links[i].classList.toggle("dl-changed", p !== DN.badges.activePath && DN.badges.changed.has(p));
  }
};

// live SSE dots (instant, no manifest round-trip) — installed at boot.
DN.badges.initLive = function () {
  window.addEventListener("docs-in-html:change", function (e) {
    var p = e.detail && e.detail.path;
    if (!p || !/\.html?$/i.test(p) || p === DN.badges.activePath) return; // non-doc / already viewing it
    DN.badges.changed.add(p);
    DN.badges.apply();
  });
};
