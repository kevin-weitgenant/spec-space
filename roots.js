// roots.js — per-root context. Everything a docs folder needs to be served:
// request handler (shell, manifest, file-management endpoints, static files),
// scoped to ONE root dir. Both consumers share it:
//   - serve.js   → single root at "/"      (base = "/")
//   - manager.js → N roots at "/<slug>/"   (base = "/<slug>/")
// The handler contract: fn(req, res) — same as an http.Server listener.

const fs = require("node:fs");
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
      fs.existsSync(idx) && fs.statSync(idx).isFile()
        ? fs.readFileSync(idx, "utf8")
        : SHELL;
    html = applyShellConfig(html, readConfig(root)); // title + favicon from _config.json
    if (!/<base\s/i.test(html)) {
      html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (m) => m + `\n<base href="${(base || "")}/">`)
        : `<base href="${(base || "")}/">\n` + html;
    }
    send(res, 200, injectScripts(html, { base }), { "Content-Type": "text/html; charset=utf-8" });
  }

  function serveFile(filePath, res) {
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) return send(res, 404, "404 Not Found");
      const ext = path.extname(filePath).toLowerCase();
      const type = MIME[ext] || "application/octet-stream";
      fs.readFile(filePath, (e, data) => {
        if (e) return send(res, 500, "500 Internal Server Error");
        const body = ext === ".html" ? injectScripts(data.toString("utf8"), { base }) : data;
        send(res, 200, body, { "Content-Type": type });
      });
    });
  }

  const reload = createReload(root, opts.onReload);

  function handle(req, res) {
    if (reload.handle(req, res)) return; // SSE channel

    const raw = (req.url || "/").split("?")[0];

    if (raw === "/__manifest__") {
      const cfg = readConfig(root);
      const body = JSON.stringify({ root, sep: path.sep, platform: process.platform, anim: readAnim(), title: typeof cfg.title === "string" ? cfg.title : "", tree: buildTree(root) });
      return send(res, 200, body, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    }

    // ── file-management endpoints (delete / rename / mkdir) ──────────────
    // Shared guards: JSON body cap, relative path inside root, sane names.
    function readJsonBody(req, cb, cap = 4096) {
      let body = "";
      req.on("error", () => {}); // client abort mid-body must not crash us
      req.on("data", (c) => { body += c; if (body.length > cap) req.destroy(); });
      req.on("end", () => { let j; try { j = JSON.parse(body); } catch (e) { return cb(null); } cb(j); });
    }
    // "guides/v2" → "guides/v2" | null (must stay inside root, no weird names)
    function safeRelPath(p) {
      if (typeof p !== "string" || p.includes("\\") || p.startsWith("/")) return null;
      const segs = p.split("/").filter(Boolean);
      if (!segs.length || segs.includes("..")) return null;
      for (const s of segs)
        if (!s || s.startsWith(".") || s.startsWith("_") || /[<>:"|?*\x00-\x1f]/.test(s)) return null;
      return segs.join("/");
    }
    function resolveIn(p) {
      const rel = safeRelPath(p);
      if (rel === null) return null;
      const abs = path.resolve(root, rel);
      if (!abs.startsWith(root + path.sep)) return null;
      return { rel, abs };
    }

    if (req.method === "POST" && raw === "/__delete__") {
      return readJsonBody(req, (j) => {
        const t = resolveIn(j && j.path);
        if (!t) return send(res, 400, "400 Bad Request");
        fs.stat(t.abs, (err, st) => {
          if (err) return send(res, 404, "404 Not Found");
          if (st.isDirectory()) {
            fs.rmdir(t.abs, (e2) => { // rmdir refuses non-empty folders — safety by design
              if (e2) return send(res, 409, "409 Folder is not empty");
              pruneIcons(t.rel);
              send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
            });
          } else {
            if (!/\.html?$/i.test(t.rel)) return send(res, 400, "400 Bad Request");
            fs.unlink(t.abs, (e2) => {
              if (e2) return send(res, 404, "404 Not Found");
              pruneIcons(t.rel);
              send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
            });
          }
        });
      });
    }

    if (req.method === "POST" && raw === "/__rename__") {
      return readJsonBody(req, (j) => {
        const from = resolveIn(j && j.from);
        const to = resolveIn(j && j.to);
        if (!from || !to || from.rel === to.rel) return send(res, 400, "400 Bad Request");
        fs.stat(from.abs, (err, st) => {
          if (err || !st) return send(res, 404, "404 Not Found");
          if (st.isFile()) {
            if (!/\.html?$/i.test(from.rel) || !/\.html?$/i.test(to.rel)) return send(res, 400, "400 Bad Request");
            if (path.basename(to.rel).toLowerCase() === "index.html") return send(res, 400, "400 Bad Request");
          } else if (to.rel.startsWith(from.rel + "/")) {
            return send(res, 400, "400 Cannot move a folder into itself");
          }
          fs.access(to.abs, (e2) => {
            if (!e2) return send(res, 409, "409 Target already exists");
            fs.rename(from.abs, to.abs, (e3) => {
              if (e3) return send(res, 500, "500 Rename failed");
              shiftIcons(from.rel, to.rel);
              send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
            });
          });
        });
      });
    }

    if (req.method === "POST" && raw === "/__mkdir__") {
      return readJsonBody(req, (j) => {
        const t = resolveIn(j && j.path);
        if (!t) return send(res, 400, "400 Bad Request");
        fs.access(t.abs, (existErr) => {
          if (!existErr) return send(res, 409, "409 Folder already exists");
          fs.mkdir(t.abs, { recursive: true }, (err) => {
            if (err) return send(res, 500, "500 mkdir failed");
            send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
          });
        });
      });
    }

    if (req.method === "POST" && raw === "/__save__") {
      return readJsonBody(req, (j) => {
        const t = resolveIn(j && j.path);
        if (!t || !/\.html?$/i.test(t.rel) || typeof j.html !== "string")
          return send(res, 400, "400 Bad Request");
        fs.writeFile(t.abs, j.html, "utf8", (err) => {
          if (err) return send(res, 500, "500 write failed");
          send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
        });
      }, 10 * 1024 * 1024); // whole-page HTML — allow up to 10 MB
    }

    if (req.method === "POST" && raw === "/__reveal__") {
      return readJsonBody(req, (j) => {
        const t = resolveIn(j && j.path);
        if (!t) return send(res, 400, "400 Bad Request");
        fs.stat(t.abs, (err, st) => {
          if (err || !st) return send(res, 404, "404 Not Found");
          if (process.platform === "win32") {
            require("node:child_process").spawn("explorer", st.isDirectory() ? [t.abs] : [`/select,${t.abs}`], { detached: true, stdio: "ignore" }).unref();
          } else if (process.platform === "darwin") {
            require("node:child_process").spawn("open", ["-R", t.abs], { detached: true, stdio: "ignore" }).unref();
          } else {
            require("node:child_process").spawn("xdg-open", [st.isDirectory() ? t.abs : path.dirname(t.abs)], { detached: true, stdio: "ignore" }).unref();
          }
          send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
        });
      });
    }

    if (req.method === "POST" && raw === "/__order__") {
      return readJsonBody(req, (j) => {
        const folder = j && j.folder === "" ? "" : safeRelPath(j.folder);
        const order = j && Array.isArray(j.order) ? j.order : null;
        if (folder === null || !order || order.some((s) => typeof s !== "string" || !safeRelPath(s)))
          return send(res, 400, "400 Bad Request");
        const cfg = readConfig(root);
        cfg.order = cfg.order || {};
        cfg.order[folder] = order;
        try { writeConfig(root, cfg); } catch { return send(res, 500, "500 write failed"); }
        send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
      });
    }

    if (req.method === "POST" && raw === "/__title__") {
      return readJsonBody(req, (j) => {
        const title = j && typeof j.title === "string" ? j.title.trim().slice(0, 200) : "";
        if (!title) return send(res, 400, "400 Bad Request");
        const cfg = readConfig(root);
        cfg.title = title;
        try { writeConfig(root, cfg); } catch { return send(res, 500, "500 write failed"); }
        send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": "application/json; charset=utf-8" });
      });
    }

    if (raw.startsWith("/__docs__/")) {
      const f = path.join(CLIENT_DIR, path.normalize(raw.slice("/__docs__/".length)));
      if (f !== CLIENT_DIR && !f.startsWith(CLIENT_DIR + path.sep)) return send(res, 404, "404");
      if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, "404");
      return send(res, 200, fs.readFileSync(f), { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" });
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

module.exports = { createRoot, CLIENT_DIR, MIME, send };
