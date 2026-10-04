// _config.json — the single settings file for a docs folder:
//
//   {
//     "title": "My Project — Handbook",   // tab title + shell header
//     "favicon": "🚀",                     // emoji (data-URI SVG) or a file path
//     "sidebarAnim": "guide",              // reveal | slide | guide
//     "icons": { "guides": "book-open" },  // folder icons (was _icons.json)
//     "order": { "": ["b.html", "a.html"] }// manual drag order (was _order.json)
//   }
//
// Reading merges legacy _icons.json/_order.json as fallback (config sections
// win); the first write absorbs them — no migration command needed.
// Dev server reads it per-request (the watcher hot-reloads edits); the export
// BAKES everything into manifest.json/index.html instead of shipping the file.

const fs = require("node:fs");
const path = require("node:path");

// "auth-service.html" → "Auth Service"; "backend" → "Backend"
// Capitalize the first letter of each word. Per-word with String#toUpperCase
// (Unicode-aware) — NOT /\b\w/ which is ASCII-only and mangles "Integração".
function humanize(name) {
  return String(name)
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^./u, (c) => c.toUpperCase()))
    .join(" ")
    .trim();
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

// Full config view: _config.json + legacy _icons.json/_order.json fallback.
function readConfig(root) {
  const cfg = readJson(path.join(root, "_config.json")) || {};
  if (!cfg.icons) cfg.icons = readJson(path.join(root, "_icons.json")) || {};
  if (!cfg.order) cfg.order = readJson(path.join(root, "_order.json")) || {};
  return cfg;
}

// Write _config.json (the passed object is the full merged view, so unknown
// keys present in it are preserved naturally).
function writeConfig(root, cfg) {
  const file = path.join(root, "_config.json");
  try { fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n"); } catch {}
}

// Sensible defaults for a folder that has no config yet (auto-scaffold).
function defaultConfig(root) {
  return {
    title: humanize(path.basename(path.resolve(root))) || "Docs",
    favicon: "📚",
    sidebarAnim: "guide",
  };
}

// "🚀" → <link rel="icon" href="data:image/svg+xml,...">; "assets/f.svg" → path link.
function faviconLink(favicon) {
  if (!favicon || typeof favicon !== "string") return "";
  if (favicon.includes("/")) {
    return `<link rel="icon" href="/${favicon.replace(/^\/+/, "")}">`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="0.9em" font-size="90">${favicon}</text></svg>`;
  return `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}">`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Bake title/favicon into a shell page (built-in SHELL or the user's index.html).
// - Title: only replaces the DEFAULT <title>Docs</title> — a custom index.html
//   keeps whatever its author chose (both in serve and export).
// - Favicon: injected only when the page has no icon link of its own.
function applyShellConfig(html, cfg) {
  let out = html;
  const title = typeof cfg.title === "string" ? cfg.title.trim() : "";
  if (title) {
    out = out.replace(/<title>\s*Docs\s*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
    // built-in shell header: the editable <span id="dl-title">…</span>
    out = out.replace(/(<span id="dl-title">)[^<]*(<\/span>)/i, (m, a, b) => a + escapeHtml(title) + b);
  }
  const link = faviconLink(cfg.favicon);
  if (link && !/<link[^>]+rel\s*=\s*["']?icon/i.test(out)) {
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, link + "$&") : link + out;
  }
  return out;
}

module.exports = { humanize, readConfig, writeConfig, defaultConfig, faviconLink, applyShellConfig };
