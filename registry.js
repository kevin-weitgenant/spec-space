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
    console.warn(`[spec-space] não foi possível gravar o registry (${e.message}) — o manager não verá esta pasta.`);
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

// ── Layout (apresentação: ordem + pastas) ──────────────────────────────────
// Vivendo na chave `layout` do registry, separada do registro (`docs`):
// se faltar ou estiver inválida, a UI degrada para "tudo solto, na ordem do
// array docs" — o comportamento antigo. `order` intercala ids de grupo e
// caminhos de docs; `assign` diz em que grupo cada doc está.

// Revalida o layout contra os docs realmente registrados (a "higiene"):
// poda caminhos fora de docs, grupos sem definição e referências órfãs;
// acrescenta no fim o que ainda não consta (docs novas, grupos novos).
function saneLayout(data) {
  const dirs = data.docs.map((d) => path.resolve(d)); // map passa (val,idx,arr) — lambda explícito
  const raw = (data.layout && typeof data.layout === "object") ? data.layout : {};
  const groups = {};
  if (raw.groups && typeof raw.groups === "object" && !Array.isArray(raw.groups)) {
    for (const [id, g] of Object.entries(raw.groups)) {
      if (typeof id === "string" && id && g && typeof g === "object" &&
          typeof g.name === "string" && g.name.trim())
        groups[id] = { name: g.name.trim().slice(0, 80) };
    }
  }
  const assign = {};
  if (raw.assign && typeof raw.assign === "object" && !Array.isArray(raw.assign)) {
    for (const [d, g] of Object.entries(raw.assign)) {
      if (dirs.includes(path.resolve(d)) && groups[g]) assign[path.resolve(d)] = g;
    }
  }
  const collapsed = {};
  if (raw.collapsed && typeof raw.collapsed === "object" && !Array.isArray(raw.collapsed)) {
    for (const [g, v] of Object.entries(raw.collapsed)) {
      if (groups[g] && v === true) collapsed[g] = true;
    }
  }
  let order = Array.isArray(raw.order) ? raw.order.filter((x) => typeof x === "string") : [];
  order = order.filter((x) => dirs.includes(x) || groups[x]);
  for (const d of dirs) if (!order.includes(d)) order.push(d);      // docs novas → fim, soltas
  for (const g of Object.keys(groups)) if (!order.includes(g)) order.push(g);
  return { order, groups, assign, collapsed };
}

function getLayout() {
  return saneLayout(load());
}

// Grava o layout enviado pela UI (validado aqui: o servidor nunca confia
// cegamente no payload) e devolve o layout saneado como nova verdade.
function saveLayout(incoming) {
  const data = load();
  data.layout = (incoming && typeof incoming === "object") ? incoming : {};
  const sane = saneLayout(data);
  data.layout = sane;
  save(data);
  return sane;
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

module.exports = { slugify, load, save, add, remove, list, slugsFor, cardInfo, getLayout, saveLayout, FILE, DIR };
