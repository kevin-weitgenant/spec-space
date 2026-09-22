// registry.js — ~/.docs-in-html/registry.json. The list of docs folders the
// manager serves. Tolerant by design: unknown keys are preserved (versions of
// the package installed side by side — e.g. different npx caches — may write
// here), missing file = empty registry, corrupt file = backed up + reset.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DIR = path.join(os.homedir(), ".docs-in-html");
const FILE = path.join(DIR, "registry.json");

// "My Project — Handbook" → "my-project-handbook" (accents stripped, any
// non-alphanumeric run collapses to one "-"). Empty → null (caller falls back).
function slugify(s) {
  const slug = String(s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || null;
}

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (data && typeof data === "object") {
      if (!Array.isArray(data.docs)) data.docs = [];
      return data;
    }
  } catch (e) {
    if (e.code !== "ENOENT") {
      // corrupt registry — back it up rather than destroying user data
      try { fs.copyFileSync(FILE, FILE + ".bak-" + Date.now()); } catch {}
    }
  }
  return { docs: [] };
}

function save(data) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
  } catch (e) {
    console.warn(`[docs-in-html] não foi possível gravar o registry (${e.message}) — o manager não verá esta pasta.`);
  }
}

function add(dir) {
  const abs = path.resolve(dir);
  const data = load();
  if (data.docs.some((d) => path.resolve(d) === abs)) return false; // already there
  data.docs.push(abs);
  save(data);
  return true;
}

function remove(dir) {
  const abs = path.resolve(dir);
  const data = load();
  const before = data.docs.length;
  data.docs = data.docs.filter((d) => path.resolve(d) !== abs);
  if (data.docs.length === before) return false;
  save(data);
  return true;
}

function list() {
  return load().docs.filter((d) => {
    try { return fs.statSync(d).isDirectory(); } catch { return false; } // drop deleted dirs from the view
  });
}

// Assign unique slugs across the live roots: slug from the folder's
// _config.json title (fallback: folder name); collisions get -2, -3…
function slugsFor(dirs) {
  const { readConfig, defaultConfig } = require("./config.js");
  const used = new Set();
  const out = [];
  for (const dir of dirs) {
    let base;
    try {
      const cfg = readConfig(dir);
      base = slugify(typeof cfg.title === "string" ? cfg.title : "") || slugify(path.basename(dir));
    } catch {
      base = slugify(path.basename(dir)) || "docs";
    }
    if (!base) base = "docs";
    if (base === "api") base = "docs-api"; // reserved: manager API lives at /api/*
    let slug = base, n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    out.push({ dir, slug });
  }
  return out;
}

// Title/favicon for the manager UI cards (read per-call: hot-reloads).
function cardInfo(dir) {
  const { readConfig, defaultConfig } = require("./config.js");
  let cfg;
  try { cfg = readConfig(dir); } catch { cfg = defaultConfig(dir); }
  return {
    title: typeof cfg.title === "string" && cfg.title.trim() ? cfg.title.trim() : path.basename(dir),
    favicon: typeof cfg.favicon === "string" ? cfg.favicon : "📚",
  };
}

module.exports = { slugify, load, save, add, remove, list, slugsFor, cardInfo, FILE, DIR };
