// Live reload: SSE channel (/__reload__) + recursive file watcher.
// createReload(root, onEvent?) → { handle, close }. handle() claims the SSE
// route. onEvent(relPath) fires for every change — the manager uses it to fan
// its roots' events into ONE multiplexed SSE (one connection per browser, not
// one per root: HTTP/1.1 caps the origin at ~6).

const fs = require("node:fs");

function createReload(root, onEvent) {
  const clients = new Set();

  function broadcast(relPath) {
    if (onEvent) { try { onEvent(relPath); } catch {} }
    if (!clients.size) return;
    const msg = `data: ${JSON.stringify({ path: relPath })}\n\n`;
    for (const res of clients) res.write(msg);
  }

  // Debounce per file: Windows fires several events for one save.
  const timers = {};
  let watcher = null;
  try {
    watcher = fs.watch(root, { recursive: true }, (_e, file) => {
      if (!file) return;
      const rel = file.split(/[\\/]/).join("/"); // normalize separators
      clearTimeout(timers[rel]);
      timers[rel] = setTimeout(() => { delete timers[rel]; broadcast(rel); }, 150);
    });
    watcher.on("error", (e) => {
      console.warn(`[spec-space] hot reload watcher error: ${e.message}`);
      console.warn("                     salve um arquivo para testar; se nada acontecer, reinicie o servidor.");
    });
  } catch {
    console.warn("[spec-space] fs.watch unavailable — hot reload disabled (static serving still works).");
  }

  return {
    handle(req, res) {
      if ((req.url || "").split("?")[0] !== "/__reload__") return false;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      clients.add(res);
      req.on("close", () => { clients.delete(res); });
      return true;
    },
    close() {
      if (watcher) watcher.close();
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}

module.exports = { createReload };
