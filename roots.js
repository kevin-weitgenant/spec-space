// roots.js — per-root context. Everything a docs folder needs to be served:
// request handler (shell, manifest, file-management endpoints, static files),
// scoped to ONE root dir. Both consumers share it:
//   - serve.js   → single root at "/"      (base = "/")
//   - manager.js → N roots at "/<slug>/"   (base = "/<slug>/")
// The handler contract: fn(req, res) — same as an http.Server listener.

const ops = require("./ops.js");
const path = require("node:path");
const { createReload } = require("./reload.js");
const { buildTree } = require("./manifest.js");
const { SHELL } = require("./shell.js");
const { injectScripts } = require("./inject.js");
const { readConfig, writeConfig, applyShellConfig } = require("./config.js");

const CLIENT_DIR = path.join(__dirname, "client");

const MIME = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

// ── shared guards (module scope — unit-testable without a server) ─────────

// Read a JSON request body, capped at `cap` bytes. Oversized or malformed
// bodies never reach the callback's consumer logic (destroy / cb(null)).
function readJsonBody(req, cb, cap = 4096) {
  let body = "";
  req.on("error", () => {}); // client abort mid-body must not crash us
  req.on("data", (c) => { body += c; if (body.length > cap) req.destroy(); });
  req.on("end", () => { let j; try { j = JSON.parse(body); } catch (e) { return cb(null); } cb(j); });
}

// "guides/v2" → "guides/v2" | null (must stay relative, no weird names)
function safeRelPath(p) {
  if (typeof p !== "string" || p.includes("\\") || p.startsWith("/")) return null;
  const segs = p.split("/").filter(Boolean);
  if (!segs.length || segs.includes("..")) return null;
  for (const s of segs)
    if (!s || s.startsWith(".") || s.startsWith("_") || /[<>:"|?*\x00-\x1f]/.test(s)) return null;
  return segs.join("/");
}

// Resolve p inside root → { rel, abs } | null (outside root / bad name)
function resolveIn(root, p) {
  const rel = safeRelPath(p);
  if (rel === null) return null;
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return null;
  return { rel, abs };
}

// ── endpoint handlers — one named function per /__*__ endpoint ────────────
// Same shape: (ctx, req, res). ctx carries the root dir plus the per-root
// config bookkeeping (shiftIcons/pruneIcons/readAnim) the endpoints need.

function endpointManifest(ctx, req, res) {
  const cfg = readConfig(ctx.root);
  const body = JSON.stringify({ root: ctx.root, sep: path.sep, platform: process.platform, anim: ctx.readAnim(), title: typeof cfg.title === "string" ? cfg.title : "", tree: buildTree(ctx.root) });
  return send(res, 200, body, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
}

function endpointDelete(ctx, req, res) {
  readJsonBody(req, (j) => {
    const t = resolveIn(ctx.root, j && j.path);
    if (!t) return send(res, 400, "400 Bad Request");
    ops.stat(t.abs, (err, st) => {
      if (err) return send(res, 404, "404 Not Found");
      if (st.isDirectory()) {
        ops.rmdir(t.abs, (e2) => { // rmdir refuses non-empty folders — safety by design
          if (e2) return send(res, 409, "409 Folder is not empty");
          ctx.pruneIcons(t.rel);
          send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
        });
      } else {
        if (!/\.html?$/i.test(t.rel)) return send(res, 400, "400 Bad Request");
        ops.unlink(t.abs, (e2) => {
          if (e2) return send(res, 404, "404 Not Found");
          ctx.pruneIcons(t.rel);
          send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
        });
      }
    });
  });
}

function endpointRename(ctx, req, res) {
  readJsonBody(req, (j) => {
    const from = resolveIn(ctx.root, j && j.from);
    const to = resolveIn(ctx.root, j && j.to);
    if (!from || !to || from.rel === to.rel) return send(res, 400, "400 Bad Request");
    ops.stat(from.abs, (err, st) => {
      if (err || !st) return send(res, 404, "404 Not Found");
      if (st.isFile()) {
        if (!/\.html?$/i.test(from.rel) || !/\.html?$/i.test(to.rel)) return send(res, 400, "400 Bad Request");
        if (path.basename(to.rel).toLowerCase() === "index.html") return send(res, 400, "400 Bad Request");
      } else if (to.rel.startsWith(from.rel + "/")) {
        return send(res, 400, "400 Cannot move a folder into itself");
      }
      ops.access(to.abs, (e2) => {
        if (!e2) return send(res, 409, "409 Target already exists");
        ops.rename(from.abs, to.abs, (e3) => {
          if (e3) return send(res, 500, "500 Rename failed");
          ctx.shiftIcons(from.rel, to.rel);
          send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
        });
      });
    });
  });
}

function endpointMkdir(ctx, req, res) {
  readJsonBody(req, (j) => {
    const t = resolveIn(ctx.root, j && j.path);
    if (!t) return send(res, 400, "400 Bad Request");
    ops.access(t.abs, (existErr) => {
      if (!existErr) return send(res, 409, "409 Folder already exists");
      ops.mkdir(t.abs, { recursive: true }, (err) => {
        if (err) return send(res, 500, "500 mkdir failed");
        send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
      });
    });
  });
}

function endpointSave(ctx, req, res) {
  readJsonBody(req, (j) => {
    const t = resolveIn(ctx.root, j && j.path);
    if (!t || !/\.html?$/i.test(t.rel) || typeof j.html !== "string")
      return send(res, 400, "400 Bad Request");
    ops.writeFile(t.abs, j.html, "utf8", (err) => {
      if (err) return send(res, 500, "500 write failed");
      send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
    });
  }, 10 * 1024 * 1024); // whole-page HTML — allow up to 10 MB
}

function endpointReveal(ctx, req, res) {
  readJsonBody(req, (j) => {
    const t = resolveIn(ctx.root, j && j.path);
    if (!t) return send(res, 400, "400 Bad Request");
    ops.stat(t.abs, (err, st) => {
      if (err || !st) return send(res, 404, "404 Not Found");
      ops.openPath(t.abs); // explorer / open -R / xdg-open — once, in ops
      send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
    });
  });
}

function endpointOrder(ctx, req, res) {
  readJsonBody(req, (j) => {
    const folder = j && j.folder === "" ? "" : safeRelPath(j.folder);
    const order = j && Array.isArray(j.order) ? j.order : null;
    if (folder === null || !order || order.some((s) => typeof s !== "string" || !safeRelPath(s)))
      return send(res, 400, "400 Bad Request");
    const cfg = readConfig(ctx.root);
    cfg.order = cfg.order || {};
    cfg.order[folder] = order;
    try { writeConfig(ctx.root, cfg); } catch { return send(res, 500, "500 write failed"); }
    send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
  });
}

function endpointTitle(ctx, req, res) {
  readJsonBody(req, (j) => {
    const title = j && typeof j.title === "string" ? j.title.trim().slice(0, 200) : "";
    if (!title) return send(res, 400, "400 Bad Request");
    const cfg = readConfig(ctx.root);
    cfg.title = title;
    try { writeConfig(ctx.root, cfg); } catch { return send(res, 500, "500 write failed"); }
    send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
  });
}

// Dispatch table: path → { method, fn }. The whole /__*__ surface, at a glance.
const ENDPOINTS = {
  "/__manifest__": { method: "GET", fn: endpointManifest },
  "/__delete__": { method: "POST", fn: endpointDelete },
  "/__rename__": { method: "POST", fn: endpointRename },
  "/__mkdir__": { method: "POST", fn: endpointMkdir },
  "/__save__": { method: "POST", fn: endpointSave },
  "/__reveal__": { method: "POST", fn: endpointReveal },
  "/__order__": { method: "POST", fn: endpointOrder },
  "/__title__": { method: "POST", fn: endpointTitle },
};

// ── per-root context ───────────────────────────────────────────────────────

// Create the per-root context. opts.base: URL prefix ("" or "/<slug>"), used
// for the shell's <base> and the injected dev clients' DOCS_BASE.
function createRoot(root, opts = {}) {
  const base = opts.base || "";

  function readAnim() {
    const v = readConfig(root).sidebarAnim;
    return ["reveal", "slide", "guide"].includes(v) ? v : "guide";
  }

  // Keep config.icons keys in sync when files/folders are renamed/moved/deleted
  // from the sidebar — same idea as the config.order bookkeeping.
  function shiftIcons(from, to) { // rename/move: rewrite the key and descendant keys
    const cfg = readConfig(root);
    const data = cfg.icons || {};
    let changed = false;
    const out = {};
    for (const k of Object.keys(data)) {
      if (k === from) { out[to] = data[k]; changed = true; }
      else if (k.startsWith(from + "/")) { out[to + k.slice(from.length)] = data[k]; changed = true; }
      else out[k] = data[k];
    }
    if (changed) { cfg.icons = out; writeConfig(root, cfg); }
  }
  function pruneIcons(rel) { // delete: drop the key and descendant keys
    const cfg = readConfig(root);
    const data = cfg.icons || {};
    const out = {};
    let changed = false;
    for (const k of Object.keys(data)) {
      if (k === rel || k.startsWith(rel + "/")) { changed = true; continue; }
      out[k] = data[k];
    }
    if (changed) { cfg.icons = out; writeConfig(root, cfg); }
  }

  // The shell page: the user's index.html when present, otherwise the built-in
  // one. <base> keeps relative asset references resolving from the root's URL
  // prefix (single-root: "/", manager: "/<slug>/").
  function serveShell(res) {
    const idx = path.join(root, "index.html");
    let html =
      ops.existsSync(idx) && ops.statSync(idx).isFile()
        ? ops.readFileSync(idx, "utf8")
        : SHELL;
    html = applyShellConfig(html, readConfig(root)); // title + favicon from _config.json
    if (!/<base\s/i.test(html)) {
      html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (m) => m + `\n<base href="${(base || "")}/">`)
        : `<base href="${(base || "")}/">\n` + html;
    }
    send(res, 200, injectScripts(html, { base }), { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  }

  function serveFile(filePath, res) {
    ops.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) return send(res, 404, "404 Not Found");
      const ext = path.extname(filePath).toLowerCase();
      const type = MIME[ext] || "application/octet-stream";
      ops.readFile(filePath, (e, data) => {
        if (e) return send(res, 500, "500 Internal Server Error");
        const body = ext === ".html" ? injectScripts(data.toString("utf8"), { base }) : data;
        // Dev server: HTML must never come from the browser's heuristic cache,
        // or a live-reload can show a stale doc (no validators to revalidate).
        const headers = { "Content-Type": type };
        if (ext === ".html" || ext === ".htm") headers["Cache-Control"] = "no-store";
        send(res, 200, body, headers);
      });
    });
  }

  const reload = createReload(root, opts.onReload);

  // What the endpoint handlers get: the root dir plus the per-root helpers.
  const ctx = { root, base, readAnim, shiftIcons, pruneIcons };

  function handle(req, res) {
    if (reload.handle(req, res)) return; // SSE channel

    const raw = (req.url || "/").split("?")[0];

    // ── file-management endpoints: dispatch via the ENDPOINTS table ──────
    const ep = ENDPOINTS[raw];
    if (ep && (ep.method === req.method || (ep.method === "GET" && req.method === "HEAD")))
      return ep.fn(ctx, req, res);

    if (raw.startsWith("/__docs__/")) {
      const f = path.join(CLIENT_DIR, path.normalize(raw.slice("/__docs__/".length)));
      if (f !== CLIENT_DIR && !f.startsWith(CLIENT_DIR + path.sep)) return send(res, 404, "404");
      if (!ops.existsSync(f) || !ops.statSync(f).isFile()) return send(res, 404, "404");
      // dev clients change with the package — never let the browser cache them
      return send(res, 200, ops.readFileSync(f), { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    }

    let urlPath;
    try { urlPath = decodeURIComponent(raw); }
    catch { return send(res, 400, "400 Bad Request"); } // malformed %-escapes
    if (urlPath === "/") return serveShell(res);

    const filePath = path.join(root, urlPath);
    if (!filePath.startsWith(root + path.sep) && filePath !== root) return send(res, 403, "403 Forbidden");

    // Deep URL: a top-level navigation to a doc gets the shell wrapped around
    // it. The iframe's own request carries Sec-Fetch-Dest: iframe and still
    // gets the bare document. Requests without the header (curl, old browsers)
    // get the bare doc too.
    if (
      /\.html?$/i.test(urlPath) &&
      req.headers["sec-fetch-dest"] === "document" &&
      path.resolve(filePath) !== path.resolve(path.join(root, "index.html"))
    ) {
      return serveShell(res);
    }
    serveFile(filePath, res);
  }

  return { root, base, handle, reload };
}

module.exports = { createRoot, readJsonBody, safeRelPath, resolveIn, ENDPOINTS, CLIENT_DIR, MIME, send };
