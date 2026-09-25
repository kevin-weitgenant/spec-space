// spec-space reload client — injected into every HTML while the dev server runs.
// Reloads THIS page only when its own file (or a shared asset) changes.
//
// Browser note: HTTP/1.1 allows only ~6 connections per origin. A naive
// "one SSE per tab" design makes the 7th docs tab stall forever. So tabs of
// the same origin elect ONE leader (Web Locks) that holds the single SSE and
// relays EVERY raw event to all tabs over a BroadcastChannel — each receiver
// then filters by its own root (base). When the leader tab closes, the lock
// moves to the next tab automatically. The manager's /__reload__ carries all
// roots ({base, path}); a single-root serve sends just {path}.
(function () {
  if (window.top === window.self) console.log("[spec-space] hot reload connected");

  var BASE = window.DOCS_BASE || ""; // "" single-root, "/<slug>/" under the manager
  var BASE_N = BASE.replace(/\/+$/, ""); // normalized: "/slug" or ""

  // Who am I? The shell (a page with #docList) may also live at a deep URL
  // (/docs/foo.html) after F5 — identify it by structure, not by pathname.
  var isShell = !!document.getElementById("docList");
  var me = (isShell ? "index.html" : decodeURI(location.pathname).replace(/^\/+/, "")) || "index.html";
  var baseRel = decodeURI(BASE).replace(/^\/+|\/+$/g, "");
  if (baseRel && me.toLowerCase().indexOf(baseRel.toLowerCase() + "/") === 0)
    me = me.slice(baseRel.length + 1) || "index.html";

  function shouldReload(changed) {
    if (changed === me) return true;             // my own file changed
    if (me === "index.html") return false;       // the shell only reacts to itself (keeps sidebar state)
    return /\.(?:js|mjs|css)$/i.test(changed);   // shared dev asset → reload the doc being viewed
  }

  // One raw event, filtered by MY root, then acted on.
  function onEvent(d) {
    if (!d || !d.path) return;
    if (typeof d.base === "string" && d.base.replace(/\/+$/, "") !== BASE_N) return; // another root
    try { window.dispatchEvent(new CustomEvent("docs-in-html:change", { detail: { path: d.path } })); } catch (_) {}
    if (shouldReload(d.path)) location.reload();
  }

  function openSSE(onRaw) {
    // The origin-root /__reload__: under the manager it multiplexes every
    // root; single-root it's just this root. Either way: one SSE per browser.
    var es = new EventSource("/__reload__");
    es.onmessage = function (e) {
      var d;
      try { d = JSON.parse(e.data); } catch (_) { return; }
      onRaw(d);
    };
    return es;
  }

  var canElect = "BroadcastChannel" in window && navigator.locks && navigator.locks.request;

  if (canElect) {
    var bc = new BroadcastChannel("spec-space");
    bc.onmessage = function (e) { onEvent(e.data); };
    // Everyone queues; the first tab becomes leader and holds the lock until
    // it closes — the next pending request takes over. The leader relays ALL
    // events (all roots) — receivers filter by their own base.
    navigator.locks.request("spec-space-sse", { mode: "exclusive" }, function (lock) {
      if (!lock) return; // not granted — stay follower
      openSSE(function (raw) {
        try { bc.postMessage(raw); } catch (_) {} // no loop-back to sender
        onEvent(raw);
      });
      return new Promise(function () {}); // hold the lock for the life of this page
    }).catch(function () {});
  } else {
    openSSE(onEvent); // legacy browsers: direct SSE (fine with few tabs)
  }
})();
