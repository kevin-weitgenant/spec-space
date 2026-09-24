// docs-in-html change highlight — marks what changed in THIS doc since your
// last visit, inline in the page (no modal, no toast):
//   - new blocks  → green tint + "novo" chip
//   - edited blocks → amber tint + word-diff (old struck, new underlined)
//   - favicon gets a blue dot + "● " title prefix (the browser-tab signal)
//   - a VS Code-style minimap appears (only while there are unseen changes)
//     with markers on changed regions — click a bar to jump there
//   - sticky pill: "N mudanças · ↓ próxima · ✓ já vi tudo"
//
// How: every load, the client flattens the doc's block elements (h1..h4, p,
// pre, li, blockquote) into a text list, diffs it (LCS) against the snapshot
// stored in localStorage at the LAST visit, marks the deltas, then overwrites
// the snapshot. All client-side: works even if the doc changed while no tab
// was open or the server was restarted — the baseline is your last visit.
(function () {
  "use strict";
  // Docs render inside the shell's iframe — that's the main mode, so we run
  // there too; the tab-level signals (favicon dot, title prefix) go to the
  // TOP window, which is same-origin under both serve and manager.
  if (window.DOCS_EXPORT) return;
  var topDoc;
  try { topDoc = window.top === window.self ? document : window.top.document; }
  catch (e) { topDoc = document; }

  // ── identity: same key logic as the reload client ──
  var BASE = (window.DOCS_BASE || "").replace(/\/+$/, "");
  var me = decodeURI(location.pathname).replace(/^\/+/, "") || "index.html";
  var baseRel = BASE.replace(/^\/+/, "");
  if (baseRel && me.toLowerCase().indexOf(baseRel.toLowerCase() + "/") === 0)
    me = me.slice(baseRel.length + 1) || "index.html";
  var KEY = "docs-in-html:snap:" + BASE + ":" + me;

  // ── collect the doc's blocks (before we add any UI of our own) ──
  function collectBlocks() {
    var els = document.body.querySelectorAll("h1,h2,h3,h4,p,pre,li,blockquote");
    var out = [];
    for (var i = 0; i < els.length && out.length < 2000; i++) {
      var el = els[i];
      if (el.closest("[data-injected],.dih-ui")) continue; // our own dev scripts/UI
      var t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      out.push({ el: el, text: t.slice(0, 1000) });
    }
    return out;
  }

  var blocks = collectBlocks();
  var texts = blocks.map(function (b) { return b.text; });

  // ── snapshot I/O (localStorage; every failure = feature silently off) ──
  function loadSnap() {
    try { var j = JSON.parse(localStorage.getItem(KEY) || "null"); return Array.isArray(j) ? j : null; }
    catch (e) { return null; }
  }
  function saveSnap() {
    try { localStorage.setItem(KEY, JSON.stringify(texts)); } catch (e) { /* quota/private mode */ }
  }

  // ── LCS diff (with common prefix/suffix trim) → ops [{t:' '|'-'|'+', a?, b?}] ──
  function diffOps(a, b) {
    var s = 0;
    while (s < a.length && s < b.length && a[s] === b[s]) s++;
    var e = 0;
    while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
    var A = a.slice(s, a.length - e), B = b.slice(s, b.length - e);
    var n = A.length, m = B.length;
    if (n * m > 4e6) return null; // doc too big to diff gracefully — skip marking
    var dp = new Array(n + 1);
    for (var i = n; i >= 0; i--) {
      dp[i] = new Uint32Array(m + 1);
      if (i === n) continue; // dp[n] stays all-zero (base row)
      for (var j = m - 1; j >= 0; j--)
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    var ops = [], i2 = 0, j2 = 0;
    while (i2 < n && j2 < m) {
      if (A[i2] === B[j2]) { ops.push({ t: " ", a: s + i2, b: s + j2 }); i2++; j2++; }
      else if (dp[i2 + 1][j2] >= dp[i2][j2 + 1]) { ops.push({ t: "-", a: s + i2 }); i2++; }
      else { ops.push({ t: "+", b: s + j2 }); j2++; }
    }
    while (i2 < n) ops.push({ t: "-", a: s + i2++ });
    while (j2 < m) ops.push({ t: "+", b: s + j2++ });
    return ops;
  }

  // token-level diff for word highlights inside an edited block
  function wordDiff(oldS, newS) {
    var ta = oldS.split(/(\s+)/), tb = newS.split(/(\s+)/);
    var ops = diffOps(ta, tb);
    if (!ops) return null;
    var out = [];
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i];
      var tok = o.t === "-" ? ta[o.a] : o.t === "+" ? tb[o.b] : ta[o.a];
      if (!tok) continue;
      if (/^\s+$/.test(tok) && o.t !== " ") tok = " "; // collapse whitespace-only del/ins
      out.push({ t: o.t, s: tok });
    }
    return out;
  }

  function similarity(a, b) {
    var wa = a.toLowerCase().split(/\s+/), wb = b.toLowerCase().split(/\s+/);
    var set = {};
    wa.forEach(function (w) { set[w] = (set[w] || 0) + 1; });
    var hit = 0;
    wb.forEach(function (w) { if (set[w] > 0) { set[w]--; hit++; } });
    return hit / Math.max(wa.length, wb.length, 1);
  }

  // ── decide marks from ops: pair adjacent -/+ runs into "edited" when similar ──
  function marks(ops, oldTexts) {
    var out = []; // {b, kind:'new'|'edit', old?}
    // old blocks already "accounted for" (matched in place, or consumed below) —
    // an added block whose text matches an unaccounted old one is a MOVE, not new.
    var used = new Array(oldTexts.length).fill(false);
    for (var u = 0; u < ops.length; u++) if (ops[u].t === " ") used[ops[u].a] = true;
    var pool = {}; // unused old text → index (multiset via counts)
    for (var p = 0; p < oldTexts.length; p++)
      if (!used[p]) { (pool[oldTexts[p]] = pool[oldTexts[p]] || []).push(p); }
    function takeMoved(t) {
      var q = pool[t];
      if (q && q.length) return q.shift() + 1; // truthy index
      return 0;
    }
    var i = 0;
    while (i < ops.length) {
      if (ops[i].t !== "-") {
        if (ops[i].t === "+" && !takeMoved(texts[ops[i].b])) out.push({ b: ops[i].b, kind: "new" });
        i++;
        continue;
      }
      var dels = [];
      while (i < ops.length && ops[i].t === "-") dels.push(ops[i++]);
      var adds = [];
      while (i < ops.length && ops[i].t === "+") adds.push(ops[i++]);
      for (var k = 0; k < adds.length; k++) {
        var bi = adds[k].b, newT = texts[bi], old = null;
        var moved = takeMoved(newT);
        if (moved) continue; // block was moved/rewritten position — not a change
        for (var d = 0; d < dels.length; d++)
          if (dels[d] !== null && similarity(oldTexts[dels[d].a], newT) > 0.4) { old = oldTexts[dels[d].a]; dels[d] = null; break; }
        out.push(old ? { b: bi, kind: "edit", old: old } : { b: bi, kind: "new" });
      }
      // pure deletions: nothing to mark in the new DOM
    }
    return out;
  }

  // ── the CSS ──
  var CSS =
    ".dih-new{position:relative;background:linear-gradient(90deg,var(--dih-gs,#e7f5ec),transparent 92%);" +
      "border-left:3px solid var(--dih-g,#1a7f37);border-radius:0 6px 6px 0;padding:4px 12px 4px 12px;" +
      "margin-left:-15px;animation:dih-glow 2.4s ease}" +
    ".dih-edit{position:relative;background:linear-gradient(90deg,#fdf6e3,transparent 92%);" +
      "border-left:3px solid #9a6700;border-radius:0 6px 6px 0;padding:4px 12px 4px 12px;" +
      "margin-left:-15px;animation:dih-glow 2.4s ease}" +
    ".dih-chip{display:inline-block;vertical-align:super;font:700 .58rem/1 -apple-system,'Segoe UI',sans-serif;" +
      "letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--dih-g,#1a7f37);" +
      "border-radius:99px;padding:2px 8px;margin-right:8px;transform:translateY(-3px)}" +
    ".dih-edit .dih-chip{background:#9a6700}" +
    "@keyframes dih-glow{0%{box-shadow:0 0 0 4px rgba(26,127,55,.28)}100%{box-shadow:0 0 0 0 rgba(26,127,55,0)}}" +
    ".dih-wdel{color:#cf222e;text-decoration:line-through;background:#ffebe9;border-radius:3px;padding:0 2px}" +
    ".dih-wadd{color:#0c5a26;background:#abf2bc;border-radius:3px;padding:0 2px}" +
    ".dih-bar{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483000;" +
      "display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.96);border:1px solid #1a7f37;" +
      "border-radius:99px;padding:5px 8px 5px 15px;font:600 .82rem -apple-system,'Segoe UI',sans-serif;" +
      "color:#1f2329;box-shadow:0 2px 14px rgba(26,127,55,.22)}" +
    ".dih-bar button{font:500 .78rem -apple-system,'Segoe UI',sans-serif;border:1px solid #d9dee6;background:#fff;" +
      "border-radius:99px;padding:3px 12px;cursor:pointer;color:#1f2329}" +
    ".dih-bar button:hover{border-color:#1f6feb;color:#1f6feb}" +
    ".dih-bar .dih-done{border-color:#1a7f37;color:#1a7f37}" +
    ".dih-map{position:fixed;top:0;right:0;bottom:0;width:64px;z-index:2147482000;" +
      "border-left:1px solid rgba(0,0,0,.08);background:rgba(251,252,253,.9);display:flex;flex-direction:column;" +
      "gap:3px;padding:10px 0;box-sizing:border-box}" +
    ".dih-map .dih-mb{border-radius:2px;background:#c8d0db;margin:0 9px;cursor:pointer;transition:background .15s}" +
    ".dih-map .dih-mb:hover{background:#1f6feb}" +
    ".dih-map .dih-mb.h{background:#8a94a3}" +
    ".dih-map .dih-mb.new{background:#1a7f37}" +
    ".dih-map .dih-mb.edit{background:#9a6700}";

  // ── favicon dot + title prefix (the tab signal — lives on the TOP window) ──
  // The TOP window does NOT reload when the iframe doc does, so the dotted
  // favicon/“● ” title would be captured as “original” on the next visit and
  // stack (● ●). Keep the pristine baseline in sessionStorage (per tab).
  var SS = "docs-in-html:tabbase";
  function tabBase() {
    var b = null;
    try { b = JSON.parse(sessionStorage.getItem(SS) || "null"); } catch (e) {}
    if (!b || typeof b.fav !== "string") {
      b = { fav: "" }; // the pristine favicon survives iframe reloads via SS; the
      // title does not need caching — each doc sets its own, just strip our dot
      try { sessionStorage.setItem(SS, JSON.stringify(b)); } catch (e) {}
    }
    return b;
  }
  var favLink = topDoc.querySelector("link[rel~='icon']") || (function () {
    var l = topDoc.createElement("link"); l.rel = "icon"; topDoc.head.appendChild(l); return l;
  })();
  var favOrig = favLink.getAttribute("href") || "";
  if (/^data:image\/png/i.test(favOrig)) favOrig = ""; // likely our own dot from a previous iframe load — don't adopt it
  function faviconDot(on) {
    var base = tabBase();
    var restore = favOrig || base.fav || "";
    var done = function (url) { try { if (url) favLink.href = url; } catch (e) {} };
    if (!on) {
      topDoc.title = (topDoc.title || "").replace(/^●\s*/, "");
      if (favOrig) {
        base.fav = favOrig;
        try { sessionStorage.setItem(SS, JSON.stringify(base)); } catch (e) {}
      }
      return done(restore);
    }
    topDoc.title = "● " + (topDoc.title || "").replace(/^●\s*/, "");
    try {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement("canvas"); c.width = c.height = 64;
          var x = c.getContext("2d");
          x.drawImage(img, 0, 0, 64, 64);
          x.beginPath(); x.arc(48, 48, 15, 0, 7);
          x.fillStyle = "#1f6feb"; x.fill();
          x.lineWidth = 4; x.strokeStyle = "#fff"; x.stroke();
          done(c.toDataURL("image/png"));
        } catch (e) { /* tainted canvas — title prefix still works */ }
      };
      img.onerror = function () { /* external icon — leave as is */ };
      img.src = favOrig;
    } catch (e) {}
  }

  // ── build ──
  var oldTexts = loadSnap();
  saveSnap(); // this visit becomes the new baseline

  var pending = [];
  if (oldTexts) {
    var ops = diffOps(oldTexts, texts);
    if (ops) pending = marks(ops, oldTexts);
  }

  if (pending.length) applyUI(pending);

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function applyUI(list) {
    var style = document.createElement("style");
    style.setAttribute("data-injected", "");
    style.textContent = CSS;
    document.head.appendChild(style);

    var originals = new Map(); // edited elements → original innerHTML (restored on dismiss)

    list.forEach(function (mk) {
      var el = blocks[mk.b].el;
      if (mk.kind === "edit") originals.set(el, el.innerHTML); // BEFORE the chip goes in
      el.classList.add(mk.kind === "new" ? "dih-new" : "dih-edit");
      var chip = document.createElement("span");
      chip.className = "dih-chip";
      chip.textContent = mk.kind === "new" ? "novo" : "editado";
      if (mk.kind === "edit") {
        var w = wordDiff(mk.old, blocks[mk.b].text);
        if (w) {
          var html = "";
          for (var i = 0; i < w.length; i++) {
            var t = w[i];
            html += t.t === "-" ? '<span class="dih-wdel">' + esc(t.s) + "</span>"
              : t.t === "+" ? '<span class="dih-wadd">' + esc(t.s) + "</span>"
              : esc(t.s);
          }
          el.innerHTML = html;
        }
      }
      el.insertBefore(chip, el.firstChild); // after any innerHTML rewrite, so it survives
    });

    // pill
    var bar = document.createElement("div");
    bar.className = "dih-ui dih-bar";
    var nNew = list.filter(function (m) { return m.kind === "new"; }).length;
    var nEdit = list.length - nNew;
    var txt = nNew ? nNew + (nNew === 1 ? " bloco novo" : " blocos novos") : "";
    if (nEdit) txt += (txt ? " · " : "") + nEdit + (nEdit === 1 ? " editado" : " editados");
    bar.innerHTML = "<span>✨ " + esc(txt) + " desde a última visita</span>";
    var bNext = document.createElement("button"); bNext.textContent = "↓ próxima";
    var bDone = document.createElement("button"); bDone.className = "dih-done"; bDone.textContent = "✓ já vi tudo";
    bar.appendChild(bNext); bar.appendChild(bDone);
    document.body.appendChild(bar);

    // minimap
    var map = document.createElement("div");
    map.className = "dih-ui dih-map";
    var byEl = new Map();
    blocks.forEach(function (b) {
      var d = document.createElement("div");
      d.className = "dih-mb" + (/^h[1-4]$/i.test(b.el.tagName) ? " h" : b.el.tagName === "PRE" ? " code" : "");
      if (b.el.classList.contains("dih-new")) d.classList.add("new");
      else if (b.el.classList.contains("dih-edit")) d.classList.add("edit");
      d.style.height = (/^h[1-4]$/i.test(b.el.tagName) ? 7 : b.el.tagName === "PRE" ? 22 : 12) + "px";
      d.title = (b.text || "").slice(0, 70);
      d.onclick = function () { b.el.scrollIntoView({ behavior: "smooth", block: "center" }); };
      map.appendChild(d);
      byEl.set(b.el, d);
    });
    // scale down if taller than the viewport
    var avail = window.innerHeight - 60;
    var nat = map.scrollHeight;
    if (nat > avail) map.style.transform = "scaleY(" + (avail / nat) + ")";
    map.style.transformOrigin = "top";
    document.body.appendChild(map);

    faviconDot(true);

    // actions
    var idx = 0;
    bNext.onclick = function () {
      var els = list.map(function (m) { return blocks[m.b].el; });
      els[idx % els.length].scrollIntoView({ behavior: "smooth", block: "center" });
      idx = (idx + 1) % els.length;
    };
    bDone.onclick = function () {
      list.forEach(function (mk) {
        var el = blocks[mk.b].el;
        el.classList.remove("dih-new", "dih-edit");
        var c = el.querySelector(":scope > .dih-chip"); if (c) c.remove();
        if (originals.has(el)) el.innerHTML = originals.get(el); // edited: back to real HTML
      });
      bar.remove(); map.remove();
      faviconDot(false);
    };
  }
})();
