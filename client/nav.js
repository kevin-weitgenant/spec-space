// spec-space nav client — builds the folder-tree sidebar from /__manifest__,
// handles doc switching + active highlighting + collapse memory, and manages
// files/folders from the sidebar: rename, move (drag & drop or "Move to…"),
// create folders, delete (docs + empty folders).
// Loaded only into the shell (a page with #docList). No-op otherwise,
// so the static <ul> fallback still works without the server.
(function () {
  var list = document.getElementById("docList");
  var iframe = document.querySelector("iframe");
  if (!list) return;

  // Static export (spec-space export): the tree comes from manifest.json and
  // the sidebar is read-only — no delete/rename/mkdir/drag (those need the dev
  // server's POST endpoints, which don't exist on a static host).
  var EXPORT = window.DOCS_EXPORT === true;

  // Static export deep link: a doc opened directly on the host bounces to
  // /?p=<path> (see inject.js) — pick it up here and open it in the iframe.
  var DEEPLINK = null; // "path/doc.html" or "path/doc.html#anchor"
  if (EXPORT) {
    var dm = location.search.match(/[?&]p=([^&]+)/);
    if (dm) { try { DEEPLINK = decodeURIComponent(dm[1]); } catch (e) {} }
  }

  // Fullscreen (ex.: botão tela cheia do mermaid-zoom) exige isto no iframe —
  // shells customizados costumam omitir, então garantimos aqui.
  if (iframe) { try { iframe.allowFullscreen = true; } catch (e) {} }

  if (!document.getElementById("dl-style")) {
    var css = document.createElement("style");
    css.id = "dl-style";
    css.textContent =
      ".dl-folder{position:relative;display:flex;align-items:center;gap:6px;font-weight:600;padding:7px 8px;cursor:pointer;border-radius:6px;user-select:none;color:#1f2329}" +
      ".dl-folder:hover{background:#f6f7f9}" +
      "#docList .dl-nested{list-style:none;margin:2px 0 4px 8px;padding-left:14px;border-left:1px solid #eef1f5}" +
      "#docList a{display:block;position:relative;padding:7px 10px;border-radius:6px;text-decoration:none;color:#1f2329;cursor:pointer;font-size:.95rem;-webkit-user-drag:none;user-select:none}" +
      "#docList a:hover{background:#f6f7f9}" +
      "#docList a.active{background:#e8f0fe;color:#1f6feb;font-weight:600}" +
      // change badge: doc changed while not being viewed (docs-in-html:change)
      "#docList a.dl-changed::after{content:\"\";position:absolute;right:10px;top:50%;transform:translateY(-50%);width:7px;height:7px;border-radius:50%;background:#1a7f37;box-shadow:0 0 0 2px #fff}" +
      "#dl-toggle{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:1px solid #d9dee6;background:#fff;border-radius:7px;cursor:pointer;font-size:14px;line-height:1;color:#1f2329}" +
      "#dl-toggle:hover{background:#f6f7f9}" +
      "#dl-toggle img{display:block;width:18px;height:18px}" +
      "#dl-toggle.dl-off{background:#e8f0fe;border-color:#1f6feb}" +
      "header #dl-toggle{margin-right:8px}" +
      "#dl-toggle.dl-floating{position:fixed;top:10px;left:10px;z-index:200;box-shadow:0 1px 3px rgba(0,0,0,.12)}" +
      "aside.dl-collapsed{display:none!important}" +
      "#docList li{position:relative}" +
      // kebab button (revealed on hover, like the old delete button)
      ".dl-act{position:absolute;right:4px;top:50%;transform:translateY(-50%);display:none;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:none;background:transparent;border-radius:5px;cursor:pointer;color:#9aa4b2;font-size:15px;font-weight:700;line-height:1}" +
      ".dl-act:hover{background:#e9edf3;color:#1f2329}" +
      "#docList .dl-folder:hover>.dl-act,#docList a:hover>.dl-act,#docList .dl-act:hover,#docList .dl-act:focus-visible{display:inline-flex}" +
      // ⋯ dropdown menu
      ".dl-menu{position:fixed;z-index:400;min-width:160px;background:#fff;border:1px solid #d9dee6;border-radius:9px;box-shadow:0 4px 14px rgba(0,0,0,.14);padding:4px;font-size:.9rem}" +
      ".dl-menu button{display:block;width:100%;text-align:left;padding:7px 12px;border:none;background:transparent;border-radius:6px;cursor:pointer;color:#1f2329;font:inherit}" +
      ".dl-menu button:hover{background:#f6f7f9}" +
      ".dl-menu button.dl-danger{color:#cf222e}" +
      ".dl-menu button.dl-danger:hover{background:#ffebe9}" +
      ".dl-menu button.dl-armed{background:#ffebe9;color:#cf222e;font-weight:700}" +
      // inline edit (rename / new folder)
      ".dl-edit input{width:100%;padding:4px 8px;border:1px solid #1f6feb;border-radius:6px;font:inherit;color:#1f2329;background:#fff;outline:none}" +
      ".dl-edit input.dl-bad{border-color:#cf222e;background:#fff1f0}" +
      ".dl-ext{font-size:.8em;color:#5b6472;margin-left:4px}" +
      // ghost that follows the cursor during a drag
      ".dl-ghost{position:fixed;z-index:500;pointer-events:none;background:#fff;border:1px solid #1f6feb;border-radius:8px;padding:6px 12px;box-shadow:0 6px 18px rgba(0,0,0,.2);font-size:.9rem;color:#1f6feb;font-weight:600;opacity:.95;white-space:nowrap}" +
      "body.dl-grabbing,body.dl-grabbing *{cursor:grabbing!important}" +
      // drag & drop
      "#docList .dl-drop{background:#e8f0fe !important;outline:2px dashed #1f6feb;outline-offset:-2px;border-radius:6px}" +
      "#docList li.dl-ins::before{content:\"\";position:absolute;left:6px;right:6px;top:-3px;height:0;border-top:2px solid #1f6feb;pointer-events:none}" +
      "#docList li.dl-dragging{opacity:.35}" +
      ".dl-ctx{position:fixed;z-index:60;min-width:150px;background:#fff;border:1px solid #d9dee6;border-radius:9px;box-shadow:0 6px 20px rgba(0,0,0,.13);padding:5px;font-size:.88rem;display:none}" +
      ".dl-ctx.on{display:block}" +
      ".dl-ctx div{padding:6px 10px;border-radius:6px;cursor:pointer;display:flex;gap:8px;align-items:center;color:#1f2329}" +
      ".dl-ctx div:hover{background:#f6f7f9}" +
      ".dl-ctx hr{border:none;border-top:1px solid #eef1f5;margin:4px 2px}" +
      ".dl-ctx svg{width:14px;height:14px;color:#5b6472;flex:none}" +
      // move-to popover
      ".dl-pop{position:fixed;z-index:400;min-width:200px;max-height:260px;overflow-y:auto;background:#fff;border:1px solid #d9dee6;border-radius:9px;box-shadow:0 4px 14px rgba(0,0,0,.14);padding:4px;font-size:.9rem}" +
      ".dl-pop button{display:block;width:100%;text-align:left;padding:6px 12px;border:none;background:transparent;border-radius:6px;cursor:pointer;color:#1f2329;font:inherit;white-space:nowrap}" +
      ".dl-pop button:hover{background:#f6f7f9}" +
      ".dl-pop button.dl-cur{color:#1f6feb;font-weight:600}" +
      // toast
      ".dl-toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:500;max-width:80vw;padding:10px 18px;border-radius:9px;background:#1f2329;color:#fff;font-size:.9rem;box-shadow:0 4px 14px rgba(0,0,0,.25)}" +
      ".dl-toast.dl-err{background:#cf222e}" +
      // chevron + folder/doc icons live in their own elements (animatable, stylable)
      ".dl-chev{width:14px;height:14px;flex:none;display:inline-flex;color:#9aa4b2}" +
      ".dl-chev svg{width:100%;height:100%;transition:transform .22s cubic-bezier(.4,0,.2,1)}" +
      ".dl-folder.closed .dl-chev svg{transform:rotate(-90deg)}" +
      ".dl-ico{width:15px;height:15px;flex:none;display:inline-flex;color:#5b6472}" +
      ".dl-ico svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}" +
      ".dl-ico.dl-emoji{font-size:14px;line-height:1.15}" +
      ".dl-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      // collapse animation — the nested list sits in a .dl-wrap "frame" whose
      // grid-template-rows interpolates 1fr → 0fr (no height measuring needed)
      ".dl-wrap{display:grid;grid-template-rows:1fr;transition:grid-template-rows .24s cubic-bezier(.4,0,.2,1)}" +
      ".dl-folder.closed + .dl-wrap{grid-template-rows:0fr}" +
      ".dl-wrap>ul{overflow:hidden;min-height:0}" +
      // variant B — slide & fade (aside.dl-anim-slide)
      ".dl-anim-slide .dl-wrap>ul{transition:opacity .2s,transform .24s ease}" +
      ".dl-anim-slide .dl-folder.closed + .dl-wrap>ul{opacity:0;transform:translateX(-8px)}" +
      // variant C — guide line (aside.dl-anim-guide): the indentation rail
      // grows with the content and recedes when closing, in accent blue
      ".dl-anim-guide .dl-wrap{position:relative}" +
      ".dl-anim-guide .dl-nested{border-left:none;margin-left:8px}" +
      ".dl-anim-guide .dl-wrap::before{content:\"\";position:absolute;left:5px;top:0;bottom:0;width:2px;border-radius:2px;background:#1f6feb;opacity:.45;transition:top .26s ease,opacity .2s}" +
      ".dl-anim-guide .dl-folder.closed + .dl-wrap::before{top:100%;opacity:0}";
    document.head.appendChild(css);
  }

  // ── small utilities ─────────────────────────────────────────────────────
  function basename(p) { return p.split("/").pop(); }
  // Percent-encoded pathnames (emoji, accents, spaces...) vs. raw manifest
  // paths — always compare decoded. decode alone can't throw on "+" or
  // stray "%", but guard anyway.
  function decPath(p) { try { return decodeURIComponent(p); } catch (e) { return p; } }

  // URL base under the manager ("/<slug>"), "" when served single-root.
  // Every /__... API call and every pathname↔path conversion goes through
  // these so the same code serves both modes.
  var BASE = window.DOCS_BASE || "";
  var BASEP = BASE.replace(/\/+$/, ""); // no trailing slash — join with "/" + path
  var BASE_REL = decPath(BASE).replace(/^\/+|\/+$/g, ""); // "slug" or ""
  function stripBase(p) { // leading-slash-stripped pathname → path inside the root
    if (BASE_REL && p.toLowerCase().indexOf(BASE_REL.toLowerCase() + "/") === 0) return p.slice(BASE_REL.length + 1);
    return p;
  }
  function dirname(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function validName(name, isFolder) {
    if (typeof name !== "string") return false;
    var n = name.trim();
    if (!n || /[\\/:*?"<>|\x00-\x1f]/.test(n)) return false;
    if (n.startsWith(".") || n.startsWith("_")) return false;
    if (!isFolder && n.toLowerCase() === "index") return false; // index.html is the shell
    return n;
  }
  function api(url, body) {
    return fetch(BASE.replace(/\/+$/, "") + url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 409 ? "A file or folder with that name already exists" : "request failed (" + r.status + ")");
      return r.text();
    });
  }
  var toastTimer = null;
  function toast(msg, isErr) {
    var t = document.querySelector(".dl-toast");
    if (!t) { t = document.createElement("div"); t.className = "dl-toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.toggle("dl-err", !!isErr);
    t.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = "none"; }, 4000);
  }

  // ── icon set (embedded Lucide paths — no React, no network) ───────────────
  // Curated general-purpose set. Unknown names fall back to the default
  // folder/file rendering — failing silently and safely.
  var ICONS = {
    "folder": '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    "folder-open": '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    "file-text": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    "book-open": '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    "wrench": '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    "rocket": '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    "database": '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
    "settings": '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
    "terminal": '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    "code": '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    "git-branch": '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    "lightbulb": '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    "search": '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    "layers": '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    "user": '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    "shield": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    "lock": '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    "key": '<circle cx="7.5" cy="15.5" r="5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    "globe": '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    "mail": '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    "calendar": '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    "chart": '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    "trending-up": '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
    "package": '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    "flame": '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    "zap": '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    "heart": '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    "star": '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    "check-circle": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    "info": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    "alert-triangle": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    "home": '<path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2h-3a1 1 0 0 1-1-1v-5a2 2 0 0 0-2-2 2 2 0 0 0-2 2v5a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2z"/>',
    "image": '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    "music": '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    "video": '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
    "pen": '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    "bookmark": '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    "link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    "cloud": '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    "server": '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
    "clock": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    "map-pin": '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    "compass": '<circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36z"/>',
    "shopping-cart": '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    "briefcase": '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>'
  };
  function chevEl() {
    var s = document.createElement("span");
    s.className = "dl-chev";
    s.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
    return s;
  }
  // icon value: a name from ICONS, or any non-ASCII string (emoji → text).
  // Docs with no icon stay plain; folders fall back to the folder glyph.
  function iconEl(icon, isFolder) {
    var name = typeof icon === "string" ? icon.trim() : "";
    var el;
    if (name && /[^\u0000-\u007f]/.test(name)) {
      el = document.createElement("span");
      el.className = "dl-ico dl-emoji";
      el.textContent = name;
      return el;
    }
    var d = ICONS[name] || (isFolder ? ICONS.folder : null);
    if (!d) return null;
    el = document.createElement("span");
    el.className = "dl-ico";
    el.innerHTML = '<svg viewBox="0 0 24 24">' + d + "</svg>";
    return el;
  }

  var ROOT_INFO = { root: "", sep: "/", platform: "" }; // root path, OS separator, OS itself
  var SITE_TITLE = ""; // from _config.json → manifest.title — used for per-doc tab titles
  function fetchManifest(cb) {
    fetch(EXPORT ? "/manifest.json" : BASE.replace(/\/+$/, "") + "/__manifest__", { cache: EXPORT ? "default" : "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && Array.isArray(data.tree)) {
          ROOT_INFO = { root: data.root || "", sep: data.sep || "/", platform: data.platform || "" };
          SITE_TITLE = data.title || "";
          var tEl = document.getElementById("dl-title");
          if (tEl && !tEl.classList.contains("dl-edit") && data.title) tEl.textContent = data.title;
          if (data.anim) setAnim(data.anim);
        }
        cb(data && Array.isArray(data.tree) ? data.tree : data); // old shape: bare array
      })
      .catch(function () {});
  }

  // Tab title: "Doc Name · Site Title" (site title alone when nothing is open).
  function syncTitle(path) {
    var name = null;
    (function walk(arr) {
      (arr || []).some(function (n) {
        if (n.path === path) { name = n.name; return true; }
        if (n.type === "folder") walk(n.children);
        return false;
      });
    })(currentTree);
    document.title = name && SITE_TITLE ? name + " · " + SITE_TITLE
      : name || SITE_TITLE || document.title;
  }
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); toast(okMsg); } catch (e) { toast("Could not copy", true); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    } else fallback();
  }

  // ── ⋯ dropdown menu ──────────────────────────────────────────────────────
  var openMenu = null;
  function closeMenu() {
    if (openMenu) { openMenu.remove(); openMenu = null; }
    // drop focus from the kebab button so it doesn't stay visible on other rows
    var ae = document.activeElement;
    if (ae && ae.classList && ae.classList.contains("dl-act")) ae.blur();
  }
  document.addEventListener("click", function (e) {
    if (openMenu && !openMenu.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });
  // The iframe covers most of the page — clicks and ESC there never bubble up to
  // the shell's document. Close the menu when focus moves into it, and hook the
  // iframe's own keydown after every load (the doc is swapped on navigation).
  window.addEventListener("blur", function () { closeMenu(); });
  if (iframe) iframe.addEventListener("load", function () {
    try { iframe.contentDocument.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); }); }
    catch (e) {} // cross-origin doc: the blur hook above still covers it
  });
  function showMenu(anchor, items) {
    closeMenu();
    var m = document.createElement("div");
    m.className = "dl-menu";
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = it.label;
      if (it.danger) b.className = "dl-danger";
      if (it.armed) { // two-click confirm (delete)
        b.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!b.classList.contains("dl-armed")) {
            b.classList.add("dl-armed");
            b.textContent = "Delete for sure?";
            setTimeout(function () {
              if (b.isConnected) { b.classList.remove("dl-armed"); b.textContent = it.label; }
            }, 3000);
            return;
          }
          closeMenu();
          it.onClick();
        });
      } else {
        b.addEventListener("click", function (e) { e.stopPropagation(); closeMenu(); it.onClick(); });
      }
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    var mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + "px";
    m.style.top = (r.bottom + mh > window.innerHeight - 8 ? Math.max(8, r.top - mh) : r.bottom + 4) + "px";
    openMenu = m;
  }
  // OS-aware label for the reveal action (Explorer / Finder / Files).
  function revealLabel() {
    var name = ROOT_INFO.platform === "win32" ? "File Explorer"
      : ROOT_INFO.platform === "darwin" ? "Finder"
      : "Files";
    return "\u2197  Reveal in " + name;
  }

  function makeKebab(entry) { // entry: {path, isFolder, labelEl}
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dl-act";
    btn.title = "More actions";
    btn.setAttribute("aria-label", "Actions for " + entry.path);
    btn.textContent = "\u22ef"; // ⋯
    btn.addEventListener("dblclick", function (e) { e.stopPropagation(); });
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();
      if (openMenu) { closeMenu(); return; }
      showMenu(btn, [
        { label: "\u29c9  Copy path", onClick: function () {
            copyText(entry.path, "Copied: " + entry.path);
          } },
        { label: "\u29c9  Copy full path", onClick: function () {
            var abs = ROOT_INFO.root ? ROOT_INFO.root.replace(/[\\/]+$/, "") + ROOT_INFO.sep + entry.path.split("/").join(ROOT_INFO.sep) : entry.path;
            copyText(abs, "Copied: " + abs);
          } },
        { label: revealLabel(), onClick: function () {
            fetch("/__reveal__", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: entry.path })
            }).catch(function () {});
          } },
        { label: "\u21c4  Move to\u2026", onClick: function () { showMovePopover(btn, entry); } },
        { label: "\u2715  Delete", danger: true, armed: true, onClick: function () { doDelete(entry); } }
      ]);
    });
    return btn;
  }

  // ── inline edit (rename / new folder) ────────────────────────────────────
  // target: the element whose text becomes the input (a / .dl-folder div)
  // ext: fixed suffix shown next to the input (".html") or "" for folders
  function startEdit(target, initial, ext, onConfirm) {
    var li = target.closest ? target.closest("li") : null;
    if (li) li.classList.add("dl-editing");
    var original = target.textContent;
    target.classList.add("dl-edit");
    target.textContent = "";
    var input = document.createElement("input");
    input.type = "text";
    input.value = initial;
    target.appendChild(input);
    if (ext) {
      var s = document.createElement("span");
      s.className = "dl-ext";
      s.textContent = ext;
      target.appendChild(s);
    }
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    var done = false;
    function finish(value) {
      if (done) return;
      done = true;
      target.classList.remove("dl-edit");
      target.textContent = original; // the manifest refresh will render the truth
      if (li) li.classList.remove("dl-editing");
      if (value != null) onConfirm(value);
    }
    input.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") finish(input.value);
      else if (e.key === "Escape") finish(null);
    });
    input.addEventListener("blur", function () { setTimeout(function () { finish(input.value); }, 0); });
    input.addEventListener("click", function (e) { e.stopPropagation(); });
    return input;
  }

  // ── rename ───────────────────────────────────────────────────────────────
  function startRename(entry) {
    var raw = basename(entry.path);           // raw filename, not the humanized label
    var ext = entry.isFolder ? "" : (raw.match(/\.html?$/i) || [""])[0];
    var stem = ext ? raw.slice(0, -ext.length) : raw;
    var input = startEdit(entry.labelEl, stem, ext, function (name) {
      var n = validName(name, entry.isFolder);
      if (!n) { toast("Invalid name", true); return; }
      var dir = dirname(entry.path);
      var to = (dir ? dir + "/" : "") + n + ext;
      if (to === entry.path) return;
      api("/__rename__", { from: entry.path, to: to }).then(function () {
        afterPathChange(entry.path, to);
        refresh();
      }).catch(function (err) { toast("Rename failed: " + err.message, true); });
    });
    // mark bad input live
    input.addEventListener("input", function () {
      input.classList.toggle("dl-bad", !validName(input.value, entry.isFolder));
    });
  }

  // ── delete ───────────────────────────────────────────────────────────────
  function doDelete(entry) {
    api("/__delete__", { path: entry.path }).then(function () {
      var cur = stripBase(decPath(location.pathname.replace(/^\/+/, "")));
      if (cur === entry.path || cur.startsWith(entry.path + "/")) {
        fetchManifest(function (tree) {
          var f = firstDoc(tree);
          if (f) go(f, false);
        });
      }
      refresh();
    }).catch(function (err) {
      toast(entry.isFolder ? "Folder is not empty — move its files out first" : "Delete failed: " + err.message, true);
    });
  }

  // ── move (popover + drag & drop) ────────────────────────────────────────
  function collectFolders(nodes, skipPath, out, depth) {
    out = out || []; depth = depth || 0;
    (nodes || []).forEach(function (n) {
      if (n.type !== "folder") return;
      if (skipPath && (n.path === skipPath || skipPath.startsWith(n.path + "/"))) return; // self / descendants
      out.push({ path: n.path, name: n.name, depth: depth });
      collectFolders(n.children, skipPath, out, depth + 1);
    });
    return out;
  }
  function showMovePopover(anchor, entry) {
    var curDir = dirname(entry.path);
    var targets = [{ path: "", name: "(root)", depth: -1 }].concat(collectFolders(currentTree, entry.path));
    var pop = document.createElement("div");
    pop.className = "dl-pop";
    targets.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = new Array(Math.max(0, t.depth) + 1).join("\u00a0\u00a0") + (t.depth >= 0 ? "\u25b8 " : "") + t.name;
      if (t.path === curDir) b.classList.add("dl-cur");
      b.addEventListener("click", function () {
        removePop();
        moveTo(entry, t.path);
      });
      pop.appendChild(b);
    });
    function removePop() { pop.remove(); document.removeEventListener("click", outside, true); window.removeEventListener("blur", removePop); }
    function outside(e) { if (!pop.contains(e.target)) removePop(); }
    document.addEventListener("click", outside, true);
    window.addEventListener("blur", removePop); // click moved into the iframe
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    var pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8)) + "px";
    pop.style.top = (r.bottom + ph > window.innerHeight - 8 ? Math.max(8, r.top - ph) : r.bottom + 4) + "px";
  }
  function moveTo(entry, destDir) {
    var to = (destDir ? destDir + "/" : "") + basename(entry.path);
    if (to === entry.path) return; // already there
    api("/__rename__", { from: entry.path, to: to }).then(function () {
      afterPathChange(entry.path, to);
      refresh();
    }).catch(function (err) { toast("Move failed: " + err.message, true); });
  }

  // If the currently displayed doc was renamed/moved (or lived inside a moved
  // folder), update the iframe + address bar so nothing 404s on reload.
  function afterPathChange(from, to) {
    var cur = stripBase(decPath(location.pathname.replace(/^\/+/, "")));
    if (cur === from || cur.startsWith(from + "/")) {
      go(to + cur.slice(from.length), false);
    }
  }

  // ── drag & drop (pointer-based: a "ghost" of the row follows the cursor,
  // folders light up as targets, collapsed folders auto-expand on hover) ──
  var drag = null; // {entry, li, ghost, startX, startY, active, target, openTimer}
  function canDrop(t) {
    if (!drag || !t) return false;
    if (t.kind === "folder") {
      if (t.path === drag.entry.path) return false;
      if (drag.entry.isFolder && t.path.startsWith(drag.entry.path + "/")) return false; // folder into itself
      return dirname(drag.entry.path) !== t.path; // no-op move → refuse
    }
    if (t.kind === "root") return dirname(drag.entry.path) !== "";
    return true; // file target = reorder (and/or move) before that file
  }
  function clearDropHints() {
    var els = document.querySelectorAll(".dl-drop, .dl-ins");
    for (var i = 0; i < els.length; i++) els[i].classList.remove("dl-drop", "dl-ins");
  }
  function setDropTarget(t) {
    if (drag.target && t && drag.target.kind === t.kind && drag.target.path === t.path && drag.target.li === t.li) return;
    clearDropHints();
    if (drag.openTimer) { clearTimeout(drag.openTimer); drag.openTimer = null; }
    drag.target = t;
    if (!t) return;
    if (t.kind === "folder") {
      t.el.classList.add("dl-drop");
      drag.openTimer = setTimeout(function () { expandFolder(t.path); }, 600);
    } else if (t.kind === "file") {
      t.el.classList.add("dl-ins"); // blue insertion line above the row
    } else {
      t.el.classList.add("dl-drop"); // the panel itself → root
    }
  }
  function onDragMove(e) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.startX) < 5 && Math.abs(e.clientY - drag.startY) < 5) return;
      drag.active = true;
      drag.ghost = document.createElement("div");
      drag.ghost.className = "dl-ghost";
      drag.ghost.textContent = (drag.entry.isFolder ? "\ud83d\udcc1 " : "\ud83d\udcc4 ") + basename(drag.entry.path);
      document.body.appendChild(drag.ghost);
      drag.li.classList.add("dl-dragging");
      document.body.classList.add("dl-grabbing");
    }
    drag.ghost.style.left = (e.clientX + 14) + "px";
    drag.ghost.style.top = (e.clientY + 12) + "px";
    drag.ghost.style.display = "none";
    var el = document.elementFromPoint(e.clientX, e.clientY);
    drag.ghost.style.display = "";
    var t = null;
    if (el && !drag.li.contains(el)) {
      var li = el.closest ? el.closest("#docList li") : null;
      if (li && li !== drag.li) {
        var head = li.querySelector(":scope > .dl-folder");
        if (head) {
          t = { kind: "folder", path: head.dataset.path, el: head, li: li }; // drop into the folder
        } else {
          var a = li.querySelector(":scope > a");
          if (a) t = { kind: "file", path: a.dataset.path, el: li, li: li }; // reorder before this file
        }
      }
    }
    if (!t && el && navAside && navAside.contains(el) && !drag.li.contains(el)) {
      t = { kind: "root", path: "", el: list, li: null }; // empty space → root
    }
    if (t && !canDrop(t)) t = null;
    setDropTarget(t);
  }
  function onDragUp() {
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragUp);
    var d = drag; drag = null;
    if (!d) return;
    if (d.openTimer) clearTimeout(d.openTimer);
    if (d.ghost) d.ghost.remove();
    d.li.classList.remove("dl-dragging");
    document.body.classList.remove("dl-grabbing");
    clearDropHints();
    if (d.active && d.target) {
      if (d.target.kind === "file") doReorder(d.entry, d.target);
      else moveTo(d.entry, d.target.path);
    }
  }
  // Drop on a file row = "insert before it" (reorder inside the same folder,
  // or move to that folder + reorder when coming from elsewhere).
  function doReorder(entry, target) {
    var dir = dirname(target.path);
    var names = [];
    var lis = target.li.parentElement.querySelectorAll(":scope > li");
    for (var i = 0; i < lis.length; i++) {
      var a = lis[i].querySelector(":scope > a");
      var h = lis[i].querySelector(":scope > .dl-folder");
      if (a) names.push(basename(a.dataset.path));
      else if (h) names.push(basename(h.dataset.path));
    }
    var dragName = basename(entry.path);
    names = names.filter(function (n) { return n !== dragName; });
    var idx = names.indexOf(basename(target.path));
    if (idx < 0) idx = names.length;
    names.splice(idx, 0, dragName);
    var from = entry.path;
    var to = (dir ? dir + "/" : "") + dragName;
    var step = from === to ? Promise.resolve() : api("/__rename__", { from: from, to: to });
    step.then(function () {
      return api("/__order__", { folder: dir, order: names });
    }).then(function () {
      afterPathChange(from, to);
      refresh();
    }).catch(function (err) { toast("Reorder failed: " + err.message, true); });
  }
  function enableDrag(li, entry) {
    li.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest("button, input, .dl-edit")) return;
      if (li.classList.contains("dl-editing")) return;
      e.stopPropagation(); // the innermost row (file) wins — don't let ancestor folders hijack
      drag = { entry: entry, li: li, startX: e.clientX, startY: e.clientY, active: false, target: null, openTimer: null };
      document.addEventListener("mousemove", onDragMove);
      document.addEventListener("mouseup", onDragUp);
      e.preventDefault(); // no text selection while dragging
    });
  }
  function expandFolder(p) {
    if (isOpen(p)) return;
    collapsed[p] = false; save();
    var heads = list.querySelectorAll(".dl-folder");
    for (var i = 0; i < heads.length; i++) {
      if (heads[i].dataset.path === p) {
        heads[i].classList.remove("closed"); // CSS does the animating
        break;
      }
    }
  }

  // ── tree rendering ───────────────────────────────────────────────────────
  var collapsed = {};
  var hadSavedState = false;
  try {
    collapsed = JSON.parse(localStorage.getItem("docs-in-html:collapsed") || "{}");
    hadSavedState = !!localStorage.getItem("docs-in-html:collapsed");
  } catch (e) { collapsed = {}; }
  function save() { try { localStorage.setItem("docs-in-html:collapsed", JSON.stringify(collapsed)); } catch (e) {} }
  function isOpen(p) { return !collapsed[p]; }

  function renderNode(n) {
    if (n.type === "folder") {
      var li = document.createElement("li");
      var hasKids = n.children && n.children.length;
      var head = document.createElement("div");
      head.className = "dl-folder" + (isOpen(n.path) ? "" : " closed");
      head.dataset.path = n.path;
      head.dataset.name = n.name;
      var chev = chevEl();
      if (!hasKids) chev.style.visibility = "hidden"; // nothing to collapse
      head.appendChild(chev);
      var ico = iconEl(n.icon, true);
      if (ico) head.appendChild(ico);
      var label = document.createElement("span");
      label.className = "dl-label";
      label.textContent = n.name;
      head.appendChild(label);
      var entry = { path: n.path, isFolder: true, labelEl: label };
      head.addEventListener("click", function (e) {
        if (head.classList.contains("dl-edit")) return; // renaming
        collapsed[n.path] = isOpen(n.path); // toggle
        save();
        head.classList.toggle("closed", !isOpen(n.path)); // CSS does the animating
      });
      // double-click a folder name → rename it (desktop convention)
      head.addEventListener("dblclick", function (e) {
        e.preventDefault();
        if (EXPORT) return; // read-only in the static export
        if (!head.classList.contains("dl-edit")) startRename(entry);
      });
      li.appendChild(head);
      if (!EXPORT) {
        head.appendChild(makeKebab(entry));
        enableDrag(li, entry);
      }
      if (hasKids) {
        var wrap = document.createElement("div"); // animated "frame" around the list
        wrap.className = "dl-wrap";
        var ul = document.createElement("ul");
        ul.className = "dl-nested";
        n.children.forEach(function (c) { ul.appendChild(renderNode(c)); });
        wrap.appendChild(ul);
        li.appendChild(wrap);
      }
      return li;
    }
    var li2 = document.createElement("li");
    var a = document.createElement("a");
    a.href = "/" + n.path;
    a.setAttribute("draggable", "false"); // links drag natively — kills our mousemove drag
    a.dataset.path = n.path;
    var label2 = document.createElement("span");
    label2.className = "dl-label";
    label2.textContent = n.name;
    a.appendChild(label2);
    var entry2 = { path: n.path, isFolder: false, labelEl: label2 };
    a.addEventListener("click", function (e) {
      if (a.classList.contains("dl-edit")) return; // renaming
      e.preventDefault(); go(n.path);
    });
    // double-click a file name → rename it (desktop convention)
    a.addEventListener("dblclick", function (e) {
      e.preventDefault();
      if (EXPORT) return; // read-only in the static export
      if (!a.classList.contains("dl-edit")) startRename(entry2);
    });
    li2.appendChild(a);
    if (!EXPORT) {
      a.appendChild(makeKebab(entry2));
      enableDrag(li2, entry2);
    }
    return li2;
  }

  // ── "＋ Folder" toolbar at the top of the side panel ─────────────────────
  var navAside = list.closest("aside") || list.parentElement;
  // Collapse-animation variant (aside.dl-anim-*): "guide" (C, default),
  // "slide" (B) or "reveal" (A) — chosen via _config.json → manifest.anim.
  var ANIMS = { reveal: 1, slide: 1, guide: 1 };
  var animClass = "dl-anim-guide";
  if (navAside) navAside.classList.add(animClass);
  function setAnim(name) {
    if (!ANIMS[name]) name = "guide";
    var c = "dl-anim-" + name;
    if (c === animClass || !navAside) return;
    navAside.classList.remove(animClass);
    navAside.classList.add(c);
    animClass = c;
  }
  var ctxEl = null;
  if (navAside && !navAside.querySelector(".dl-ctx")) {
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
    if (!EXPORT) mkItem('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>', "New folder", function () { createFolder(); });
    mkItem('<path d="m6 9 6 6 6-6"/>', "Collapse all", collapseAll);
    ctxEl = menu;
    document.body.appendChild(menu);

    function hideCtx() { menu.classList.remove("on"); }
    navAside.addEventListener("contextmenu", function (e) {
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

  function collapseAll() {
    var all = collectFolders(currentTree);
    for (var i = 0; i < all.length; i++) collapsed[all[i].path] = true;
    save();
    currentSignature = null; // force rebuild — the tree is unchanged, only localStorage state
    applyTree(currentTree);
  }

  function createFolder() {
    // optimistic inline-edit row at the top of the tree; mkdir only on confirm
    var li = document.createElement("li");
    var head = document.createElement("div");
    head.className = "dl-folder";
    head.textContent = "New folder";
    li.appendChild(head);
    list.insertBefore(li, list.firstChild);
    startEdit(head, "New folder", "", function (name) {
      li.remove();
      var n = validName(name, true);
      if (!n) { toast("Invalid folder name", true); return; }
      api("/__mkdir__", { path: n }).then(function () {
        refresh();
      }).catch(function (err) { toast("Could not create folder: " + err.message, true); });
    });
  }

  // ── sidebar collapse toggle (whole panel) ────────────────────────────────
  var toggle = document.createElement("button");
  toggle.id = "dl-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Toggle sidebar");
  var icon = document.createElement("img");
  icon.src = BASE.replace(/\/+$/, "") + "/__docs__/sidebar-left.svg";
  icon.alt = "";
  icon.width = 18;
  icon.height = 18;
  toggle.appendChild(icon);
  function renderToggle() {
    var hidden = navAside && navAside.classList.contains("dl-collapsed");
    toggle.title = hidden ? "Show sidebar" : "Hide sidebar";
    toggle.setAttribute("aria-pressed", String(!!hidden));
    toggle.classList.toggle("dl-off", !!hidden);
  }
  function setSidebar(hidden) {
    if (!navAside) return;
    navAside.classList.toggle("dl-collapsed", hidden);
    try { localStorage.setItem("docs-in-html:sidebar", hidden ? "1" : "0"); } catch (e) {}
    renderToggle();
  }
  var startHidden = false;
  try { startHidden = localStorage.getItem("docs-in-html:sidebar") === "1"; } catch (e) {}
  var header = document.querySelector("header");
  if (header) header.insertBefore(toggle, header.firstChild); // left-aligned, first item in the header
  else { toggle.className = "dl-floating"; document.body.appendChild(toggle); }
  toggle.addEventListener("click", function () {
    setSidebar(!(navAside && navAside.classList.contains("dl-collapsed")));
  });
  setSidebar(startHidden);

  // ── editable header title (#dl-title) — double-click to rename; saved to
  // _config.json via POST /__title__ (the file change refreshes the manifest,
  // which re-syncs the span and the tab title). Custom shells without the
  // span are simply not editable; the title still comes from _config.json.
  var titleEl = document.getElementById("dl-title");
  if (titleEl && !EXPORT) {
    titleEl.title = "Double-click to rename";
    titleEl.addEventListener("dblclick", function () {
      if (titleEl.classList.contains("dl-edit")) return; // already editing
      startEdit(titleEl, SITE_TITLE || "", "", function (name) {
        var n = name.trim().slice(0, 200);
        if (!n) { toast("Title cannot be empty", true); return; }
        if (n === SITE_TITLE) return; // nothing changed
        api("/__title__", { title: n }).catch(function (err) {
          toast("Could not save title: " + err.message, true);
        });
      });
    });
  }

  // default: everything collapsed (first visit / no saved state)
  function markAllCollapsed(n) {
    if (n.type === "folder") { collapsed[n.path] = true; (n.children || []).forEach(markAllCollapsed); }
  }

  function build(nodes) {
    if (!hadSavedState) nodes.forEach(markAllCollapsed);
    var frag = document.createDocumentFragment();
    nodes.forEach(function (n) { frag.appendChild(renderNode(n)); });
    list.innerHTML = "";
    list.appendChild(frag);
    applyChangeDots(); // a rebuild must not lose pending change badges
  }

  // ── change badges: docs that changed since you last saw them ───────────
  // Two sources, merged into `changedDocs` (re-applied on sidebar rebuilds):
  //  1. mtime (authoritative, survives closed tabs): the manifest carries each
  //     file's mtime; we compare against "last time this browser OPENED the doc"
  //     (localStorage). New file you never opened → compared against the first
  //     time this browser saw the manifest (epoch) — so only files created/
  //     changed after you started using this get the dot.
  //  2. live SSE events (docs-in-html:change) — instant dot, no manifest round-trip.
  // The doc being viewed never gets a dot: its own inline highlights take over.
  var changedDocs = new Set();
  var activePath = null;
  var mtimes = {}; // path → mtime from the manifest
  var SEEN_KEY = "docs-in-html:seen:" + BASE;
  var EPOCH_KEY = "docs-in-html:epoch:" + BASE;
  function lsJson(k, fb) { try { return JSON.parse(localStorage.getItem(k) || "null") || fb; } catch (e) { return fb; } }
  function seenMap() { return lsJson(SEEN_KEY, {}); }
  function markSeen(path) {
    if (!path) return;
    var s = seenMap(); s[path] = Date.now();
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) {}
    changedDocs.delete(path);
    applyChangeDots();
  }
  function collectMtimes(nodes, out) {
    (nodes || []).forEach(function (n) {
      if (n.type === "folder") collectMtimes(n.children, out);
      else if (typeof n.mtime === "number") out[n.path] = n.mtime;
    });
  }
  function syncMtimeDots(tree) {
    if (!tree) return;
    mtimes = {};
    collectMtimes(tree, mtimes);
    var epoch = Number(localStorage.getItem(EPOCH_KEY) || 0);
    if (!epoch) { try { localStorage.setItem(EPOCH_KEY, String(Date.now())); } catch (e) {} return; }
    var seen = seenMap();
    for (var p in mtimes) {
      if (p === activePath) continue;
      var last = seen[p] || epoch; // never opened → dot only if newer than our first day here
      if (mtimes[p] > last + 1000) changedDocs.add(p); // +1s: same-save races
    }
    applyChangeDots();
  }
  function applyChangeDots() {
    var links = list.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      var p = links[i].dataset.path;
      links[i].classList.toggle("dl-changed", p !== activePath && changedDocs.has(p));
    }
  }
  window.addEventListener("docs-in-html:change", function (e) {
    var p = e.detail && e.detail.path;
    if (!p || !/\.html?$/i.test(p) || p === activePath) return; // non-doc / already viewing it
    changedDocs.add(p);
    applyChangeDots();
  });

  var skipSyncPush = false; // suppress URL push when go() itself caused the iframe load
  function go(path, push) {
    skipSyncPush = true;
    if (iframe) iframe.src = BASEP + "/" + path;
    setActive(path);
    syncTitle(path);
    try {
      if (push === false) history.replaceState({ docsPath: path }, "", BASEP + "/" + path);
      else history.pushState({ docsPath: path }, "", BASEP + "/" + path);
    } catch (e) {}
  }

  function setActive(path) {
    activePath = path;
    markSeen(path); // viewing it = its own inline highlights take over
    var links = list.querySelectorAll("a");
    var found = null;
    for (var i = 0; i < links.length; i++) {
      if (links[i].dataset.path === path) { links[i].classList.add("active"); links[i].classList.remove("dl-changed"); found = links[i]; }
      else links[i].classList.remove("active");
    }
    if (!found) return;
    // expand every ancestor folder
    var node = found;
    while (node && node !== list) {
      var head = node.querySelector(":scope > .dl-folder");
      if (head) {
        var fp = head.dataset.path;
        if (!isOpen(fp)) {
          collapsed[fp] = false; save();
          head.classList.remove("closed"); // CSS does the animating
        }
      }
      node = node.parentElement;
    }
  }

  function syncFromIframe() {
    try {
      var href = iframe.contentWindow.location.href;
      if (!href || href === "about:blank") return; // iframe not loaded yet
      var p = stripBase(decPath(iframe.contentWindow.location.pathname.replace(/^\/+/, "")));
      if (!p) return;
      setActive(p);
      markSeen(p); // a reload while viewing (SSE) counts as "seen" too
      // the doc navigated itself (link inside the iframe) → keep the URL in sync
      if (!skipSyncPush && BASEP + "/" + p !== location.pathname) {
        try { history.pushState({ docsPath: p }, "", BASEP + "/" + p); } catch (e) {}
      }
      skipSyncPush = false;
    } catch (e) {}
  }

  function firstDoc(nodes) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].type === "doc") return nodes[i].path;
      if (nodes[i].type === "folder") { var f = firstDoc(nodes[i].children || []); if (f) return f; }
    }
    return null;
  }

  // Keep the sidebar in sync as files/folders are added, removed, or renamed.
  // We re-fetch the manifest on every change but only rebuild the DOM when the
  // set of entries actually changed — so ordinary content edits don't wipe your
  // collapse state / scroll position / active doc.
  var currentSignature = null;
  var currentTree = null;
  function signature(nodes) {
    var out = [];
    (function walk(arr) {
      (arr || []).forEach(function (n) {
        out.push((n.type === "folder" ? "d:" : "f:") + n.path + (n.icon ? "|" + n.icon : "")); // icon changes rebuild too
        if (n.type === "folder") walk(n.children);
      });
    })(nodes);
    return out.join("|");
  }
  function applyTree(tree) {
    if (!tree) return;
    syncMtimeDots(tree); // mtime-based dots run on EVERY manifest refresh (not just rebuilds)
    var sig = signature(tree);
    if (sig === currentSignature) return;       // only content changed → keep sidebar state
    currentSignature = sig;
    currentTree = tree;
    var scroller = navAside || list;
    var scrollTop = scroller.scrollTop;
    build(tree);
    if (iframe && !iframe.getAttribute("src")) {
      // deep link: an explicit ?p= from the bootstrap redirect wins; otherwise
      // if the current URL points at a doc in the tree, open it
      var initial = DEEPLINK || stripBase(decPath(location.pathname.replace(/^\/+/, "")));
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
      if (!f) f = firstDoc(tree);
      if (f) { skipSyncPush = true; if (iframe) iframe.src = BASEP + "/" + f + initialHash; setActive(f); syncTitle(f);
        try { history.replaceState({ docsPath: f }, "", BASEP + "/" + f + initialHash); } catch (e) {} }
    }
    syncFromIframe();
    scroller.scrollTop = scrollTop;             // preserve sidebar scroll across rebuild
  }

  function refresh() {
    fetchManifest(applyTree);
  }
  refresh();

  // reload.js (also injected into the shell) re-broadcasts each file change here.
  if (typeof window.CustomEvent === "function") {
    window.addEventListener("docs-in-html:change", refresh);
  }

  if (iframe) iframe.addEventListener("load", syncFromIframe);

  // back/forward buttons
  window.addEventListener("popstate", function (e) {
    var p = (e.state && e.state.docsPath) || stripBase(decPath(location.pathname.replace(/^\/+/, "")));
    if (p && iframe) go(p, false);
  });
})();
