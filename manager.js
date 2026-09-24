// manager.js — multi-root dev server + UI. ONE process serves every docs
// folder in the registry, each at /<slug>/ (slug from the folder's
// _config.json title). Requests are routed by prefix: /api/... → manager
// endpoints, /<slug>/... → that root's context (roots.js handles everything
// inside it), / → the cards page (client/manager.html).

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createRoot } = require("./roots.js");
const registry = require("./registry.js");
const { managerBaseUrl } = require("./delegation.js");

// ── Warp launcher resolution ─────────────────────────────────────────────
// `warp <dir>` opens the directory in Warp. Warp's CLI shim isn't always on
// PATH (the Windows installer puts warp.exe in %LOCALAPPDATA%/Programs/Warp
// without touching PATH), so we resolve the binary ourselves.
// Behavior of `warp <dir>` (per warpdotdev/docs): it launches Warp with that
// working directory — a NEW WINDOW if none is running. When Warp is already
// open, Warp's single-instance handling may reuse the existing window as a
// NEW TAB; there is no CLI flag to force one or the other. For explicit
// control, Warp's URI scheme supports warp://settings/new_window and tab
// configs like `warp://tab_config/my_tab?new_window=true`, and launch
// configurations (~/.warp/launch_configurations or
// %APPDATA%/warp/Warp/data/launch_configurations) define windows/tabs with
// cwd per pane. We keep the simple `warp <dir>` form.
const WARP_SEARCH_PATHS =
  process.platform === "win32"
    ? [
        path.join(process.env.LOCALAPPDATA || "", "Programs", "Warp", "warp.exe"),
        path.join(process.env.LOCALAPPDATA || "", "Warp", "warp.exe"),
      ].filter((p) => !p.startsWith("\\"))
    : process.platform === "darwin"
      ? ["/Applications/Warp.app/Contents/MacOS/warp", path.join(process.env.HOME || "", ".local", "bin", "warp")]
      : ["/usr/local/bin/warp", "/usr/bin/warp", path.join(process.env.HOME || "", ".local", "bin", "warp")];

let warpBinCache; // resolved once per process (null = not found, string = path)
function resolveWarp(cb) {
  if (warpBinCache !== undefined) return setImmediate(() => cb(warpBinCache));
  // 1) $WARP_BIN wins — explicit user override (documented in serve.js help).
  const candidates = [];
  if (process.env.WARP_BIN) candidates.push(process.env.WARP_BIN);
  // 2) canonical per-platform install locations.
  candidates.push(...WARP_SEARCH_PATHS);
  const found = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (found) { warpBinCache = found; return cb(found); }
  // 3) fall back to `where`/`which` on PATH.
  const finder = process.platform === "win32" ? "where" : "which";
  const { execFile } = require("node:child_process");
  execFile(finder, [process.platform === "win32" ? "warp.exe" : "warp"], (err, stdout) => {
    const hit = !err && stdout.trim().split(/\r?\n/)[0];
    warpBinCache = hit || null;
    cb(warpBinCache);
  });
}

function start(opts = {}) {
  const port = opts.port || 4400;

  // dir → { ctx, slug } — rebuilt from the registry; hot add/remove via API.
  // All roots fan their change events into ONE multiplexed SSE (/__reload__
  // at the manager level): one connection per browser tab-leader, regardless
  // of how many roots exist — HTTP/1.1 caps this origin at ~6 connections.
  const managerClients = new Set();
  function hubBroadcast(base, relPath) {
    if (!managerClients.size) return;
    const msg = `data: ${JSON.stringify({ base, path: relPath })}\n\n`;
    for (const res of managerClients) res.write(msg);
  }
  const roots = new Map();
  function makeRoot(dir, slug) {
    return createRoot(dir, { base: "/" + slug, onReload: (rel) => hubBroadcast("/" + slug, rel) });
  }
  function syncRoots() {
    const dirs = registry.list();
    const assign = new Map(registry.slugsFor(dirs).map((x) => [x.dir, x.slug]));
    // drop removed roots (close their watchers/SSE)
    for (const [dir, r] of roots) {
      if (!assign.has(dir)) { r.ctx.reload.close(); roots.delete(dir); }
    }
    // add new ones; a root whose slug CHANGED gets a fresh ctx (its base
    // prefix is baked into shell/reload wiring — reusing would serve stale URLs)
    const next = new Map();
    for (const [dir, slug] of assign) {
      const prev = roots.get(dir);
      if (prev && prev.slug === slug) next.set(dir, { ctx: prev.ctx, slug });
      else {
        if (prev) prev.ctx.reload.close(); // slug changed — drop old watcher/SSE
        next.set(dir, { ctx: makeRoot(dir, slug), slug });
      }
    }
    roots.clear();
    for (const [dir, r] of next) roots.set(dir, r);
    return assign;
  }
  syncRoots();

  function apiDocs() {
    const docs = [...roots.entries()].map(([dir, r]) => {
      const info = registry.cardInfo(dir);
      return { slug: r.slug, dir, title: info.title, favicon: info.favicon };
    });
    // mural pronto: cards + layout saneado (ordem/pastas)
    return { docs, layout: registry.getLayout() };
  }

  function readJsonBody(req, cb, cap = 1024 * 1024) {
    let body = "";
    req.on("error", () => {}); // client abort mid-body must not crash us
    req.on("data", (c) => { body += c; if (body.length > cap) req.destroy(); });
    req.on("end", () => { let j; try { j = JSON.parse(body); } catch (e) { return cb(null); } cb(j); });
    req.on("aborted", () => {});
  }

  const server = http.createServer((req, res) => {
    const raw = (req.url || "/").split("?")[0];

    // ── multiplexed live-reload SSE (one per browser, all roots) ──────────
    if (raw === "/__reload__") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      managerClients.add(res);
      req.on("close", () => { managerClients.delete(res); });
      return;
    }

    // ── manager API ────────────────────────────────────────────────────
    // POST guard: require a JSON content-type. A cross-origin form/no-cors
    // fetch can't set it — blocks drive-by calls from random websites.
    const isJson = /application\/json/i.test(String(req.headers["content-type"] || ""));
    if (raw === "/api/ping") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (raw === "/api/docs") {
      syncRoots(); // pick up registry changes made outside the API (CLI, edits)
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(JSON.stringify(apiDocs()));
    }
    if (req.method === "POST" && raw === "/api/layout") {
      // um único endpoint atômico: recebe o mural inteiro (order+groups+assign+collapsed),
      // valida contra os docs registrados e devolve o layout saneado
      return readJsonBody(req, (j) => {
        if (!isJson || !j || typeof j.layout !== "object") { res.writeHead(400); return res.end("400 Bad Request"); }
        const sane = registry.saveLayout(j.layout);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, layout: sane }));
      });
    }
    if (req.method === "POST" && raw === "/api/add") {
      return readJsonBody(req, (j) => {
        if (!isJson || !j || typeof j.dir !== "string") { res.writeHead(400); return res.end("400 Bad Request"); }
        const abs = path.resolve(j.dir);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
          res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
          return res.end(JSON.stringify({ error: "not a directory" }));
        }
        registry.add(abs);
        const assign = syncRoots();
        const slug = assign.get(abs) || "";
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ slug }));
      });
    }
    if (req.method === "POST" && raw === "/api/remove") {
      return readJsonBody(req, (j) => {
        if (!isJson || !j || typeof j.dir !== "string") { res.writeHead(400); return res.end("400 Bad Request"); }
        const target = roots.get(path.resolve(j.dir));
        if (!target) { res.writeHead(404); return res.end("404 Not Found"); }
        registry.remove(target.ctx.root);
        syncRoots();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
      });
    }
    // reveal/open-warp only act on REGISTERED roots — never arbitrary paths
    function registeredDir(p) {
      if (typeof p !== "string") return null;
      const abs = path.resolve(p);
      return roots.has(abs) ? abs : null;
    }
    // the PROJECT folder is the parent of the docs root. If the docs sits at
    // a filesystem root (no useful parent), fall back to the docs dir itself.
    function projectDir(dir) {
      const parent = path.dirname(dir);
      return parent && parent !== dir ? parent : dir;
    }
    if (req.method === "POST" && raw === "/api/reveal") {
      return readJsonBody(req, (j) => {
        const dir = isJson ? registeredDir(j && j.dir) : null;
        if (!dir) { res.writeHead(400); return res.end("400"); }
        if (process.platform === "win32")
          spawn("explorer", [dir], { detached: true, stdio: "ignore" }).unref();
        else if (process.platform === "darwin")
          spawn("open", [dir], { detached: true, stdio: "ignore" }).unref();
        else
          spawn("xdg-open", [dir], { detached: true, stdio: "ignore" }).unref();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
      });
    }
    if (req.method === "POST" && raw === "/api/open-warp") {
      return readJsonBody(req, (j) => {
        const dir = isJson ? registeredDir(j && j.dir) : null;
        if (!dir) { res.writeHead(400); return res.end("400"); }
        const proj = projectDir(dir); // open the PROJECT, not the docs folder
        // warp <dir> — no shell: args as an array, and dir derives from a
        // registered root, so nothing user-typed ever reaches a command line.
        resolveWarp((bin) => {
          if (!bin) {
            const searched = [
              ...(process.env.WARP_BIN ? [`$WARP_BIN (${process.env.WARP_BIN})`] : ["$WARP_BIN (não definido)"]),
              ...WARP_SEARCH_PATHS,
              "PATH (where/which warp)",
            ].join(", ");
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            return res.end(JSON.stringify({
              ok: false,
              error: `warp não encontrado. Procurado em: ${searched}. Instale o Warp ou aponte WARP_BIN para o executável.`,
            }));
          }
          // Windows Warp parses the positional arg as a URI — a bare "C:\\..."
          // reads as scheme "c" ("custom URI is invalid"). A file:// URL works.
          const target = process.platform === "win32" ? require("node:url").pathToFileURL(proj).href : proj;
          spawn(bin, [target], { detached: true, stdio: "ignore" }).unref();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, bin, dir: proj }));
        });
      });
    }
    if (req.method === "POST" && raw === "/api/scan") {
      return readJsonBody(req, (j) => {
        if (!isJson) { res.writeHead(400); return res.end("400"); }
        const extra = j && Array.isArray(j.extraDirs) ? j.extraDirs.filter((s) => typeof s === "string") : [];
        require("./scan.js").scan({ extraDirs: extra }).then((found) => {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ found }));
        });
      });
    }

    // ── cards page ───────────────────────────────────────────────────────
    if (raw === "/" || raw === "/index.html" || raw === "/__manager__") {
      const html = fs.readFileSync(path.join(__dirname, "client", "manager.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }

    // ── route to a docs root by slug prefix ──────────────────────────────
    const seg = raw.split("/")[1];
    if (seg) {
      for (const [, r] of roots) {
        if (r.slug === seg) {
          const rest = raw.slice(1 + seg.length) || "/"; // keep the leading "/"
          req.url = rest + ((req.url || "").includes("?") ? "?" + req.url.split("?")[1] : "");
          return r.ctx.handle(req, res);
        }
      }
    }

    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`404 — no docs served at <code>${raw}</code>. <a href="/">← manager</a>`);
    syncRoots(); // maybe a registry change made after boot explains the miss
  });

  server.once("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`erro: porta ${port} já está em uso.`);
      console.error("       pode ser outro docs-in-html manager; feche-o, ou use $DOCS_MANAGER_PORT/--port.");
      process.exit(1);
    }
    console.error(`erro: ${err.message}`);
    process.exit(1);
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    // persist the port so CLI delegation finds us even without the env var
    const data = registry.load();
    data.managerPort = port;
    registry.save(data);
    console.log(`docs-in-html manager · ${roots.size} docs${roots.size ? ": " + [...roots.values()].map((r) => r.slug).join(", ") : ""}`);
    console.log(`  → ${url}`);
    if (opts.doOpen) {
      const cmd = process.platform === "win32" ? `start "" "${url}"`
        : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
      require("node:child_process").exec(cmd, () => {});
    }
  });

  process.on("SIGINT", () => { for (const [, r] of roots) r.ctx.reload.close(); server.close(() => process.exit(0)); });
  process.on("SIGTERM", () => { for (const [, r] of roots) r.ctx.reload.close(); server.close(() => process.exit(0)); });

  return server;
}

module.exports = { start };
