// tabs.js — desktop-shell bridge (injected into every dev page).
// When spec-space runs inside the Tauri desktop shell, this script lets the
// host page know about link activations that should open NEW TABS
// (Ctrl/Cmd+click, middle click) and about navigations (so the host can
// update the tab title). In a regular browser there is no host listening —
// every message is ignored and the script is a harmless no-op.

(function () {
  if (window.parent === window.self) return; // top-level: no host above us

  var desktop = false; // true once the Tauri shell answers our handshake

  function post(msg) {
    try { window.top.postMessage(msg, "*"); } catch (e) { /* cross-origin */ }
  }
  post({ type: "spec-ping" });
  addEventListener("message", function (e) {
    if (!e.data || typeof e.data.type !== "string") return;
    if (e.data.type === "spec-pong") desktop = true;
    // fake-fullscreen toggled at the shell — sizes changed. Resize events
    // don't reliably reach NESTED iframes (doc inside the project shell),
    // so relay the nudge down the chain and fire a local resize so
    // mermaid-zoom's refit() re-fits the diagram to the new viewport.
    if (e.data.type === "spec-fs-toggled") {
      document.querySelectorAll("iframe").forEach(function (f) {
        try { f.contentWindow.postMessage({ type: "spec-fs-toggled" }, "*"); } catch (err) {}
      });
      dispatchEvent(new Event("resize"));
    }
  });

  // report where we are (tab title keeps itself fresh after every load)
  addEventListener("load", function () {
    post({ type: "spec-tab-nav", href: location.href, title: document.title || location.pathname });
  });

  // Ctrl/Cmd+click and middle click on links → ask the host for a new tab
  document.addEventListener("click", function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    e.preventDefault();
    post({ type: "spec-tab-open", href: a.href });
  }, true);

  document.addEventListener("auxclick", function (e) {
    if (e.button !== 1) return; // middle button only
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    e.preventDefault();
    post({ type: "spec-tab-open", href: a.href });
  }, true);

  // keyboard focus lives INSIDE the iframe — the host shell never sees
  // Ctrl+W / Ctrl+T / ESC. Forward them up so tabs work wherever the cursor is.
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { post({ type: "spec-key", key: "escape" }); return; }
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === "w" || e.key === "W") { e.preventDefault(); post({ type: "spec-key", key: "w" }); }
    else if (e.key === "t" || e.key === "T") { e.preventDefault(); post({ type: "spec-key", key: "t" }); }
  }, true);

  // NOTE: native requestFullscreen() is now allowed to run as-is. During
  // fase 2 debugging every "freeze" turned out to be a corrupted WebView2
  // localStorage (LevelDB) hanging saveState() — not the Fullscreen API.
  // The outer iframe already carries allow="fullscreen".
})();
