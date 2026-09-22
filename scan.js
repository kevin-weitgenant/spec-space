// scan.js — one-shot import: find docs folders (dirs with _config.json)
// under $HOME (plus extra dirs), with a skip-list and depth cap. A plain
// stat-walk every run (fast: only readdir/stat) — directory-mtime subtree
// pruning is NOT sound here: creating a folder bumps its parent's mtime but
// not the grandparent's, so a pruning walker would miss new docs. The cache
// only remembers the last found set, so the UI can highlight what's new.
// This is an IMPORT tool, not a runtime mechanism: after importing, the
// registry is the source of truth.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SKIP = new Set(["node_modules", ".git", "AppData", "Library", ".cache", ".npm", ".venv", "venv", "__pycache__", "target", "dist", "build", ".gradle"]);
const MAX_DEPTH = 6;
const { DIR } = require("./registry.js");
const CACHE_FILE = path.join(DIR, "scan-cache.json");

// A _config.json "looks like ours" when it parses and carries at least one
// known key — filters out same-named files from other tools.
function looksLikeConfig(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return !!j && typeof j === "object" &&
      ["title", "favicon", "sidebarAnim", "icons", "order"].some((k) => k in j);
  } catch { return false; }
}

async function scan({ extraDirs = [] } = {}) {
  const roots = [os.homedir(), ...extraDirs.filter((s) => typeof s === "string").map((d) => path.resolve(d))];
  const found = [];
  const seen = new Set();

  function walk(dir, depth) {
    if (seen.has(dir)) return;
    seen.add(dir);
    if (fs.existsSync(path.join(dir, "_config.json")) && looksLikeConfig(path.join(dir, "_config.json"))) {
      found.push(dir);
      return; // don't descend into a docs folder looking for nested docs
    }
    if (depth >= MAX_DEPTH) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
    }
  }

  for (const r of roots) walk(r, 0);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ lastFound: found }));
  } catch {}
  return found;
}

module.exports = { scan };
