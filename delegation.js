// delegation.js — CLI ⇄ manager glue. The single-root CLI asks the manager
// "are you alive?" before starting its own server; if yes, it registers the
// folder there instead (the manager IS the serve for that folder).

const http = require("node:http");
const path = require("node:path");

function managerPort() {
  // env first (CLI and manager read the same variable — they agree for free);
  // registry's managerPort as a secondary source (env not set in this shell).
  let port = Number(process.env.DOCS_MANAGER_PORT) || 4400;
  if (!process.env.DOCS_MANAGER_PORT) {
    try {
      const reg = require("./registry.js").load();
      if (Number(reg.managerPort) > 0) port = Number(reg.managerPort);
    } catch {}
  }
  return port;
}

function managerBaseUrl() {
  return `http://localhost:${managerPort()}`;
}

// GET /api/ping against each candidate port (env > registry > default) with a
// short timeout — a missing manager must not delay the serve start. Resolves
// the PORT where a manager answered (number), or 0 when none did.
function pingManager(timeoutMs = 300) {
  const envSet = !!process.env.DOCS_MANAGER_PORT;
  let registryPort = 0;
  try {
    const reg = require("./registry.js").load();
    if (Number(reg.managerPort) > 0) registryPort = Number(reg.managerPort);
  } catch {}
  const candidates = [...new Set([Number(process.env.DOCS_MANAGER_PORT) || 0, registryPort, 4400].filter(Boolean))];
  return new Promise((resolve) => {
    let left = candidates.length;
    if (!left) return resolve(0);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    for (const p of candidates) {
      const req = http.get(`http://localhost:${p}/api/ping`, { timeout: timeoutMs }, (res) => {
        res.resume();
        if (res.statusCode === 200) return finish(p);
        if (--left === 0) finish(0);
      });
      req.on("timeout", () => { req.destroy(); });
      req.on("error", () => { if (--left === 0) finish(0); });
    }
  });
}

// POST /api/add {dir} → resolves the assigned slug (manager picks it, so the
// CLI prints exactly what the manager serves). port: where ping answered.
function addToManager(dir, port) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ dir: path.resolve(dir) });
    const req = http.request(`http://localhost:${port}/api/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      timeout: 1500,
    }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(body).slug || ""); } catch { resolve(""); }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve(""); });
    req.on("error", () => resolve(""));
    req.end(payload);
  });
}

module.exports = {
  MANAGER_PORT: 4400,
  managerPort,
  managerBaseUrl,
  pingManager,
  addToManager,
};
