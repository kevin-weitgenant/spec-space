// Build a tree of the docs folder: folders (collapsible) + .html files.
// Hides dotfiles, _-prefixed names, and index.html (the shell).
// Empty folders are kept so the sidebar can create/reveal them (mkdir feature).

const fs = require("node:fs");
const path = require("node:path");
const { humanize, readConfig } = require("./config.js");

// "auth-service.html" → "Auth Service"; "backend" → "Backend"
// (moved to config.js — shared with the auto-scaffold default title)

function buildTree(root) {
  // All settings live in _config.json (icons/order sections); legacy
  // _icons.json/_order.json are merged in as fallback by readConfig.
  const cfg = readConfig(root);
  const order = cfg.order || {};
  const icons = cfg.icons || {};
  const sortByOrder = (rel, entries) => {
    const ord = order[rel || ""] || [];
    return entries.slice().sort((a, b) => {
      const ia = ord.indexOf(a.name), ib = ord.indexOf(b.name);
      if (ia !== -1 && ib !== -1) return ia - ib;              // both pinned → saved order
      if (ia !== -1) return -1;                                 // pinned first
      if (ib !== -1) return 1;
      return a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1;
    });
  };
  function walk(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    entries = sortByOrder(rel, entries);
    const nodes = [];
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name.startsWith("_")) continue; // hidden / template
      const childRel = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) {
        const children = walk(path.join(dir, e.name), childRel);
        const node = { type: "folder", name: humanize(e.name), path: childRel, children }; // keep even when empty
        if (typeof icons[childRel] === "string") node.icon = icons[childRel];
        nodes.push(node);
      } else if (e.isFile() && /\.html?$/i.test(e.name)) {
        if (e.name.toLowerCase() === "index.html") continue; // the shell itself
        let mtime = 0;
        try { mtime = fs.statSync(path.join(dir, e.name)).mtimeMs; } catch {}
        nodes.push({ type: "doc", name: humanize(e.name), path: childRel, mtime }); // mtime feeds the sidebar's changed-dot
      }
    }
    return nodes;
  }
  return walk(root, "");
}

module.exports = { buildTree };
