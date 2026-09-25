#!/usr/bin/env node
// spec-space — zero-build dev server for folders of HTML docs.
// Auto sidebar tree (from your folders) + live reload + Mermaid pan/zoom.
//
//   spec-space [dir] [--port N] [--no-open]   serve a folder (default: current dir)
//   spec-space manager [--no-open]            serve ALL registered docs (multi-root)
//   spec-space init [dir]                     scaffold a starter index.html
//   spec-space export [dir] [--out DIR]       freeze to static files (Surge etc.)
//
// Serving a folder also registers it in ~/.docs-in-html/registry.json so the
// manager picks it up. --no-register skips that; dir --unregister removes it.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { exec } = require("node:child_process");
const { createRoot } = require("./roots.js");
const { readConfig, writeConfig, defaultConfig } = require("./config.js");
const registry = require("./registry.js");
const { MANAGER_PORT, managerBaseUrl, pingManager, addToManager } = require("./delegation.js");

// ── CLI ──────────────────────────────────────────────────────────────────
function help() {
  console.log(`spec-space — zero-build dev server for HTML docs.

Usage:
  spec-space [dir] [--port N] [--no-open]   serve a folder (default: current dir)
  spec-space manager [--no-open]            serve ALL registered docs (multi-root)
  spec-space init [dir]                     scaffold a starter index.html
  spec-space export [dir] [--out DIR]       freeze to static files (default out: ./dist)

Options:
  -p, --port N     port (default 8000, or $PORT; if the default is busy the
                   next free port is used with a warning — an explicit --port
                   must be free or the server exits with an error)
      --no-open    don't open the browser automatically
      --no-register  don't add the served folder to the manager registry
      --unregister   remove <dir> from the registry and exit
  -h, --help       show this help

Environment:
  WARP_BIN        path to the Warp terminal executable, tried first by the
                   manager's "⌨ Warp" button (then standard install locations
                   and PATH — see resolveWarp in manager.js)

The manager (spec-space manager, port ${MANAGER_PORT} or $DOCS_MANAGER_PORT)
serves every registered docs at http://localhost:<port>/<slug>/. When it is
running, serving a folder just registers it there — no extra server.
`);
}

const args = process.argv.slice(2);
let dir = ".";
let port = Number(process.env.PORT) || 8000;
let doOpen = true;
let portWasExplicit = false;
let mode = "serve";
let outDir = "dist";
let noRegister = false;
let unregister = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "-h" || a === "--help") { help(); process.exit(0); }
  else if (a === "init") mode = "init";
  else if (a === "export") mode = "export";
  else if (a === "manager") mode = "manager";
  else if (a === "--out") outDir = args[++i] || outDir;
  else if (a === "-p" || a === "--port") { port = Number(args[++i]) || port; portWasExplicit = true; }
  else if (a === "--no-open") doOpen = false;
  else if (a === "-o" || a === "--open") doOpen = true;
  else if (a === "--no-register") noRegister = true;
  else if (a === "--unregister") unregister = true;
  else if (!a.startsWith("-")) dir = a;
}

const ROOT = path.resolve(dir);

if (mode === "init") {
  require("./init.js").init(ROOT);
  process.exit(0);
}

if (mode === "export") {
  require("./export.js").run(ROOT, outDir);
  process.exit(0);
}

if (mode === "manager") {
  // port precedence: explicit --port > $DOCS_MANAGER_PORT > 4400 (the CLI's
  // delegation reads the same precedence — see delegation.js managerPort()).
  const { managerPort } = require("./delegation.js");
  require("./manager.js").start({ port: portWasExplicit ? port : managerPort(), portWasExplicit, doOpen });
  // manager keeps the process alive (its own server)
} else if (unregister) {
  const removed = registry.remove(ROOT);
  console.log(removed
    ? `✓ removida do registry: ${ROOT}`
    : `(nada a remover — ${ROOT} não estava no registry)`);
  process.exit(0);
} else {
  serveSingle();
}

// ── single-root serve ──────────────────────────────────────────────────────
async function serveSingle() {
  // Delegation: if the manager is already running, don't start another
  // server — register this root there and print the link. The manager IS the
  // serve for this folder now.
  if (!noRegister) {
    const port = await pingManager();
      if (port) {
        const slug = await addToManager(ROOT, port);
        console.log(`spec-space · ${ROOT}`);
        if (portWasExplicit)
          console.log(`  ⚠ manager no ar — --port ignorado (a docs vive no manager)`);
        console.log(`  ✓ adicionada ao manager: http://localhost:${port}/${slug}/`);
        process.exit(0);
      }
  }

  // Auto-scaffold: first serve of a folder with no _config.json creates one
  // with friendly defaults (title from the folder name).
  let scaffolded = false;
  if (!fs.existsSync(path.join(ROOT, "_config.json"))) {
    writeConfig(ROOT, defaultConfig(ROOT));
    scaffolded = true; // writeConfig swallows errors; the flag is just for the banner
  }

  if (!noRegister) registry.add(ROOT); // silent: picked up next time the manager starts

  const ctx = createRoot(ROOT, { base: "" });
  const server = http.createServer(ctx.handle);
  server.on("close", () => ctx.reload.close());

  // If --port was passed explicitly, it's a request, not a hint: succeed on
  // that exact port or die with a clear message. Otherwise fall back to the
  // next free port, with a warning.
  const MAX_FALLBACKS = 20;
  function start(attemptPort, attemptsLeft) {
    let printed = false;
    const srv = server.listen(attemptPort, () => {
      setImmediate(() => {
        if (printed) return;
        printed = true;
        const url = `http://localhost:${attemptPort}`;
        console.log(`spec-space · serving ${ROOT}`);
        if (attemptPort !== port)
          console.log(`  ⚠ porta ${port} está em uso — usando ${attemptPort}`);
        if (scaffolded)
          console.log(`  ✓ criado _config.json — ajuste title/favicon lá (hot reload pega na hora)`);
        console.log(`  → ${url}`);
        if (doOpen) {
          const cmd = process.platform === "win32" ? `start "" "${url}"`
            : process.platform === "darwin" ? `open "${url}"`
            : `xdg-open "${url}"`;
          exec(cmd, () => {});
        }
      });
    });
    srv.once("error", (err) => {
      printed = true;
      if (err.code !== "EADDRINUSE") {
        const tip = err.code === "EACCES"
          ? " (porta privilegiada? tente uma alta, ex.: --port 8000)" : "";
        console.error(`erro: não foi possível abrir a porta ${attemptPort}${tip}`);
        if (err.code !== "EACCES") console.error(`       ${err.message}`);
        process.exit(1);
      }
      if (portWasExplicit) {
        console.error(`erro: porta ${attemptPort} já está em uso.`);
        console.error("       pode ser outra instância de spec-space; feche-a, ou rode sem --port para auto-escolher a próxima livre.");
        process.exit(1);
      }
      if (attemptsLeft <= 0) {
        console.error(`erro: nenhuma porta livre a partir de ${port} (tentou até ${attemptPort}).`);
        console.error("       feche o outro servidor ou passe --port N.");
        process.exit(1);
      }
      if (srv.listening) srv.close();
      start(attemptPort + 1, attemptsLeft - 1);
    });
  }
  start(port, portWasExplicit ? 0 : MAX_FALLBACKS - 1);
}
