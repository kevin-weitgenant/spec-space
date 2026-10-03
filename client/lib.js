// spec-space client lib — the page's identity, in one place.
// The "who am I?" block (strip leading slash, strip the manager prefix
// case-insensitively, fall back to index.html) used to be copied verbatim in
// reload.js, changes.js and edit.js; the fetch wrapper (BASE + /__...__ path,
// JSON body) lived in nav.js and edit.js. They all live here now.
//
// Interface (fits on a postcard):
//   me(pathname?, base?)  → path relative to the docs root ("guias/a.html")
//   api(path, body?)      → fetch(POST BASE_N + path, JSON body) — response
//                           handling stays with each caller (editor alerts,
//                           nav maps 409): extraction moves what's common,
//                           not what's local
//   isShell()             → !!document.getElementById("docList")
//   BASE / BASE_N         → window.DOCS_BASE raw and without trailing slash
//
// UMD: <script> tag publishes window.docsLib; require() gets module.exports —
// so the prefix rule is testable with plain node --test, no browser.
(function () {
  "use strict";

  function me(pathname, base) {
    if (pathname === undefined) pathname = location.pathname;
    if (base === undefined) base = window.DOCS_BASE || "";
    var m = decodeURI(pathname).replace(/^\/+/, "") || "index.html";
    var baseRel = decodeURI(base).replace(/^\/+|\/+$/g, "");
    if (baseRel && m.toLowerCase().indexOf(baseRel.toLowerCase() + "/") === 0)
      m = m.slice(baseRel.length + 1) || "index.html";
    return m;
  }

  function api(path, body) {
    return fetch((window.DOCS_BASE || "").replace(/\/+$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function isShell() {
    return !!(typeof document !== "undefined" && document.getElementById("docList"));
  }

  var lib = {
    me: me,
    api: api,
    isShell: isShell,
    BASE: (typeof window !== "undefined" && window.DOCS_BASE) || "",
    BASE_N: ((typeof window !== "undefined" && window.DOCS_BASE) || "").replace(/\/+$/, ""),
  };

  if (typeof module !== "undefined" && module.exports) module.exports = lib;
  else window.docsLib = lib;
})();
