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
//
// The file is both a program (run via bin/node) and a module: parseArgs() and
// main() are exported and testable in-process; every side effect that used to
// run at require-time (argv parsing, process.exit, server) lives behind the
// require.main === module footer.

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const ops = require("../env/ops.js");
const { createRoot } = require("../server/roots.js");
const { readConfig, writeConfig, defaultConfig } = require("../domain/config.js");
const registry = require("../domain/registry.js");
const { MANAGER_PORT, managerPort, pingManager, addToManager } = require("../server/delegation.js");

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

// Pure argv parsing: takes an argument ARRAY (not process.argv) and returns
// options as data. -h/--help becomes mode:"help" — printing is main()'s job.
function parseArgs(argv, opts = {}) {
  const o = {
    mode: "serve",
    dir: ".",
    port: opts.defaultPort !== undefined ? opts.defaultPort : 8000,
    portWasExplicit: false,
    doOpen: true,
    outDir: "dist",
    noRegister: false,
    unregister: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.mode = "help";
    else if (a === "init") o.mode = "init";
    else if (a === "export") o.mode = "export";
    else if (a === "manager") o.mode = "manager";
    else if (a === "--out") o.outDir = argv[++i] || o.outDir;
    else if (a === "-p" || a === "--port") { o.port = Number(argv[++i]) || o.port; o.portWasExplicit = true; }
    else if (a === "--no-open") o.doOpen = false;
    else if (a === "-o" || a === "--open") o.doOpen = true;
    else if (a === "--no-register") o.noRegister = true;
    else if (a === "--unregister") o.unregister = true;
    else if (!a.startsWith("-")) o.dir = a;
  }
  return o;
}

// The CLI machine: takes parsed options (or a raw argv), returns the exit
// code. NEVER calls process.exit — the footer does. `deps` injects everything
// that touches the world, so tests can simulate EADDRINUSE, a live manager,
// or the browser opening without any of them being real.
async function main(args, deps = {}) {
  const o = Array.isArray(args) ? parseArgs(args) : args;
  const { pingManagerDep = pingManager, addToManagerDep = addToManager, openUrl = (u) => ops.openUrl(u) } = deps;
  if (o.mode === "help") { help(); return 0; }

  const ROOT = path.resolve(o.dir);

  if (o.mode === "init") {
    require("./init.js").init(ROOT);
    return 0;
  }

  if (o.mode === "export") {
    require("./export.js").run(ROOT, o.outDir);
    return 0;
  }

  if (o.mode === "manager") {
    // port precedence: explicit --port > $DOCS_MANAGER_PORT > 4400 (the CLI's
    // delegation reads the same precedence — see delegation.js managerPort()).
    require("../server/manager.js").start({ port: o.portWasExplicit ? o.port : managerPort(), portWasExplicit: o.portWasExplicit, doOpen: o.doOpen });
    return; // manager keeps the process alive (its own server)
  }

  if (o.unregister) {
    const removed = registry.remove(ROOT);
    console.log(removed
      ? `✓ removida do registry: ${ROOT}`
      : `(nada a remover — ${ROOT} não estava no registry)`);
    return 0;
  }

  return serveSingle(ROOT, o, { pingManagerDep, addToManagerDep, openUrl });
}

// ── single-root serve ──────────────────────────────────────────────────────
function serveSingle(ROOT, o, { pingManagerDep, addToManagerDep, openUrl }) {
  const { port, portWasExplicit, doOpen, noRegister } = o;

  // Delegation: if the manager is already running, don't start another
  // server — register this root there and print the link. The manager IS the
  // serve for this folder now.
  return pingManagerDep().then((managerUp) => {
    if (!noRegister && managerUp) {
      return addToManagerDep(ROOT, managerUp).then((slug) => {
        console.log(`spec-space · ${ROOT}`);
        if (portWasExplicit)
          console.log(`  ⚠ manager no ar -- --port ignorado (a docs vive no manager)`);
        console.log(`  ✓ adicionada ao manager: http://localhost:${managerUp}/${slug}/`);
        return 0;
      });
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

    return new Promise((resolve) => {
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
            if (doOpen) openUrl(url);
            // resolve undefined: the footer doesn't exit — a live server keeps
            // the process alive (same contract the pre-refactor script had)
            resolve(undefined);
          });
        });
        srv.once("error", (err) => {
          printed = true;
          if (err.code !== "EADDRINUSE") {
            const tip = err.code === "EACCES"
              ? " (porta privilegiada? tente uma alta, ex.: --port 8000)" : "";
            console.error(`erro: não foi possível abrir a porta ${attemptPort}${tip}`);
            if (err.code !== "EACCES") console.error(`       ${err.message}`);
            srv.close();
            resolve(1);
            return;
          }
          if (portWasExplicit) {
            console.error(`erro: porta ${attemptPort} já está em uso.`);
            console.error("       pode ser outra instância de spec-space; feche-a, ou rode sem --port para auto-escolher a próxima livre.");
            resolve(1);
            return;
          }
          if (attemptsLeft <= 0) {
            console.error(`erro: nenhuma porta livre a partir de ${port} (tentou até ${attemptPort}).`);
            console.error("       feche o outro servidor ou passe --port N.");
            resolve(1);
            return;
          }
          start(attemptPort + 1, attemptsLeft - 1);
        });
      }
      start(port, portWasExplicit ? 0 : MAX_FALLBACKS - 1);
    });
  });
}

// ── footer: run as a program, be silent as a module ────────────────────────
if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2), { defaultPort: Number(process.env.PORT) || 8000 });
  main(opts).then((code) => {
    if (code !== undefined) process.exit(code);
  }, (err) => {
    console.error(`erro: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, main, help };
