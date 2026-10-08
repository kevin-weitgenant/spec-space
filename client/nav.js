// spec-space nav client — boot file. Builds the folder-tree sidebar from
// /__manifest__, handles doc switching + URL/history, the collapse toggle,
// the side-panel context menu and the editable title. File management lives
// in the nav/ modules (see nav/util.js for the window.docsNav contract).
// Loaded only into the shell (a page with #docList). No-op otherwise,
// so the static <ul> fallback still works without the server.
(function () {
  var list = document.getElementById("docList");
  var iframe = document.querySelector("iframe");
  if (!list) return;
  var DN = window.docsNav;
  DN.list = list;
  DN.iframe = iframe;
  DN.currentTree = null;

  // Static export deep link: a doc opened directly on the host bounces to
  // /?p=<path> (see inject.js) — pick it up here and open it in the iframe.
  var DEEPLINK = null; // "path/doc.html" or "path/doc.html#anchor"
  if (DN.EXPORT) {
    var dm = location.search.match(/[?&]p=([^&]+)/);
    if (dm) { try { DEEPLINK = decodeURIComponent(dm[1]); } catch (e) {} }
  }

  // Fullscreen (ex.: botão tela cheia do mermaid-zoom) exige isto no iframe —
  // shells customizados costumam omitir, então garantimos aqui.
  if (iframe) { try { iframe.allowFullscreen = true; } catch (e) {} }

  DN.navAside = list.closest("aside") || list.parentElement;

  // ── manifest ─────────────────────────────────────────────────────────────
  DN.fetchManifest = function (cb) {
    fetch(DN.EXPORT ? "/manifest.json" : DN.BASE.replace(/\/+$/, "") + "/__manifest__", { cache: DN.EXPORT ? "default" : "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && Array.isArray(data.tree)) {
          DN.ROOT_INFO = { root: data.root || "", sep: data.sep || "/", platform: data.platform || "" };
          DN.SITE_TITLE = data.title || "";
          var tEl = document.getElementById("dl-title");
          if (tEl && !tEl.classList.contains("dl-edit") && data.title) tEl.textContent = data.title;
          if (data.anim) setAnim(data.anim);
        }
        cb(data && Array.isArray(data.tree) ? data.tree : data); // old shape: bare array
      })
      .catch(function () {});
  };

  // Tab title: "Doc Name · Site Title" (site title alone when nothing is open).
  function syncTitle(path) {
    var name = null;
    (function walk(arr) {
      (arr || []).some(function (n) {
        if (n.path === path) { name = n.name; return true; }
        if (n.type === "folder") walk(n.children);
        return false;
      });
    })(DN.currentTree);
    document.title = name && DN.SITE_TITLE ? name + " · " + DN.SITE_TITLE
      : name || DN.SITE_TITLE || document.title;
  }

  // ── navigation (iframe + URL/history) ───────────────────────────────────
  var skipSyncPush = false; // suppress URL push when go() itself caused the iframe load
  DN.go = function (path, push) {
    skipSyncPush = true;
    if (iframe) iframe.src = DN.BASEP + "/" + path;
    DN.setActive(path);
    syncTitle(path);
    try {
      if (push === false) history.replaceState({ docsPath: path }, "", DN.BASEP + "/" + path);
      else history.pushState({ docsPath: path }, "", DN.BASEP + "/" + path);
    } catch (e) {}
  };

  function syncFromIframe() {
    try {
      var href = iframe.contentWindow.location.href;
      if (!href || href === "about:blank") return; // iframe not loaded yet
      var p = DN.stripBase(DN.decPath(iframe.contentWindow.location.pathname.replace(/^\/+/, "")));
      if (!p) return;
      DN.setActive(p);
      DN.badges.markSeen(p); // a reload while viewing (SSE) counts as "seen" too
      // the doc navigated itself (link inside the iframe) → keep the URL in sync
      if (!skipSyncPush && DN.BASEP + "/" + p !== location.pathname) {
        try { history.pushState({ docsPath: p }, "", DN.BASEP + "/" + p); } catch (e) {}
      }
      skipSyncPush = false;
    } catch (e) {}
  }

  // ── keep the sidebar in sync as files change ─────────────────────────────
  // We re-fetch the manifest on every change but only rebuild the DOM when the
  // set of entries actually changed — so ordinary content edits don't wipe your
  // collapse state / scroll position / active doc.
  var currentSignature = null;
  DN.applyTree = function (tree) {
    if (!tree) return;
    DN.badges.syncMtimes(tree); // mtime-based dots run on EVERY manifest refresh (not just rebuilds)
    var sig = DN.signature(tree);
    if (sig === currentSignature) return; // only content changed → keep sidebar state
    currentSignature = sig;
    DN.currentTree = tree;
    var scroller = DN.navAside || list;
    var scrollTop = scroller.scrollTop;
    DN.build(tree);
    if (iframe && !iframe.getAttribute("src")) {
      // deep link: an explicit ?p= from the bootstrap redirect wins; otherwise
      // if the current URL points at a doc in the tree, open it
      var initial = DEEPLINK || DN.curPath();
      var initialHash = "";
      var hi = initial.indexOf("#");
      if (hi >= 0) { initialHash = initial.slice(hi); initial = initial.slice(0, hi); }
      var f = null;
      if (initial) {
        var links = list.querySelectorAll("a");
        for (var i = 0; i < links.length; i++) {
          if (links[i].dataset.path === initial) { f = initial; break; }
        }
      }
      if (!f) f = DN.firstDoc(tree);
      if (f) { skipSyncPush = true; if (iframe) iframe.src = DN.BASEP + "/" + f + initialHash; DN.setActive(f); syncTitle(f);
        try { history.replaceState({ docsPath: f }, "", DN.BASEP + "/" + f + initialHash); } catch (e) {} }
    }
    syncFromIframe();
    scroller.scrollTop = scrollTop; // preserve sidebar scroll across rebuild
  };

  DN.refresh = function () {
    DN.fetchManifest(DN.applyTree);
  };

  function collapseAll() {
    var all = DN.collectFolders(DN.currentTree);
    for (var i = 0; i < all.length; i++) DN.closeFolderState(all[i].path);
    currentSignature = null; // force rebuild — the tree is unchanged, only localStorage state
    DN.applyTree(DN.currentTree);
  }
  DN.collapseAll = collapseAll;

  // ── collapse-animation variant (aside.dl-anim-*) ─────────────────────────
  // "guide" (C, default), "slide" (B) or "reveal" (A) — chosen via
  // _config.json → manifest.anim.
  var ANIMS = { reveal: 1, slide: 1, guide: 1 };
  var animClass = "dl-anim-guide";
  if (DN.navAside) DN.navAside.classList.add(animClass);
  function setAnim(name) {
    if (!ANIMS[name]) name = "guide";
    var c = "dl-anim-" + name;
    if (c === animClass || !DN.navAside) return;
    DN.navAside.classList.remove(animClass);
    DN.navAside.classList.add(c);
    animClass = c;
  }

  // ── side-panel context menu (right-click on empty space) ────────────────
  if (DN.navAside && !DN.navAside.querySelector(".dl-ctx")) {
    var menu = document.createElement("div");
    menu.className = "dl-ctx";
    var mkItem = function (icon, label, fn) {
      var it = document.createElement("div");
      it.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + icon + "</svg>";
      it.appendChild(document.createTextNode(label));
      it.addEventListener("click", function () { hideCtx(); fn(); });
      menu.appendChild(it);
      return it;
    };
    if (!DN.EXPORT) mkItem('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', "New folder", function () { DN.createFolder(); });
    mkItem('<path d="m6 9 6 6 6-6"/>', "Collapse all", collapseAll);
    document.body.appendChild(menu);

    function hideCtx() { menu.classList.remove("on"); }
    DN.navAside.addEventListener("contextmenu", function (e) {
      if (e.target.closest && e.target.closest("#docList li")) return; // rows keep the native menu
      e.preventDefault();
      menu.classList.add("on");
      menu.style.left = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8) + "px";
      menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8) + "px";
    });
    document.addEventListener("click", hideCtx);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideCtx(); });
    window.addEventListener("blur", hideCtx);
  }

  // ── sidebar collapse toggle (whole panel) ────────────────────────────────
  var toggle = document.createElement("button");
  toggle.id = "dl-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Toggle sidebar");
  var icon = document.createElement("img");
  icon.src = DN.BASE.replace(/\/+$/, "") + "/__docs__/sidebar-left.svg";
  icon.alt = "";
  icon.width = 18;
  icon.height = 18;
  toggle.appendChild(icon);
  function renderToggle() {
    var hidden = DN.navAside && DN.navAside.classList.contains("dl-collapsed");
    toggle.title = hidden ? "Show sidebar" : "Hide sidebar";
    toggle.setAttribute("aria-pressed", String(!!hidden));
    toggle.classList.toggle("dl-off", !!hidden);
  }
  function setSidebar(hidden) {
    if (!DN.navAside) return;
    DN.navAside.classList.toggle("dl-collapsed", hidden);
    try { localStorage.setItem("docs-in-html:sidebar", hidden ? "1" : "0"); } catch (e) {}
    renderToggle();
  }
  var startHidden = false;
  try { startHidden = localStorage.getItem("docs-in-html:sidebar") === "1"; } catch (e) {}
  var header = document.querySelector("header");
  if (header) header.insertBefore(toggle, header.firstChild); // left-aligned, first item in the header
  else { toggle.className = "dl-floating"; document.body.appendChild(toggle); }
  toggle.addEventListener("click", function () {
    setSidebar(!!(DN.navAside && !DN.navAside.classList.contains("dl-collapsed")));
  });
  setSidebar(startHidden);

  // ── editable header title (#dl-title) — double-click to rename; saved to
  // _config.json via POST /__title__ (the file change refreshes the manifest,
  // which re-syncs the span and the tab title). Custom shells without the
  // span are simply not editable; the title still comes from _config.json.
  var titleEl = document.getElementById("dl-title");
  if (titleEl && !DN.EXPORT) {
    titleEl.title = "Double-click to rename";
    titleEl.addEventListener("dblclick", function () {
      if (titleEl.classList.contains("dl-edit")) return; // already editing
      DN.startEdit(titleEl, DN.SITE_TITLE || "", "", function (name) {
        var n = name.trim().slice(0, 200);
        if (!n) { DN.toast("Title cannot be empty", true); return; }
        if (n === DN.SITE_TITLE) return; // nothing changed
        DN.api("/__title__", { title: n }).catch(function (err) {
          DN.toast("Could not save title: " + err.message, true);
        });
      });
    });
  }

  // ── wire up + first paint ────────────────────────────────────────────────
  DN.menuInit(iframe);
  DN.badges.initLive();
  DN.refresh();

  // reload.js (also injected into the shell) re-broadcasts each file change here.
  if (typeof window.CustomEvent === "function") {
    window.addEventListener("docs-in-html:change", DN.refresh);
  }

  if (iframe) iframe.addEventListener("load", syncFromIframe);

  // back/forward buttons
  window.addEventListener("popstate", function (e) {
    var p = (e.state && e.state.docsPath) || DN.curPath();
    if (p && iframe) DN.go(p, false);
  });
})();
