// spec-space export — freeze a docs folder for static hosting (Surge,
// GitHub Pages, Netlify drop...). What the dev server decides per-request
// (manifest, which scripts to inject), the export decides ONCE and writes
// to disk:
//
//   1. copy the whole source folder into the output dir
//   2. buildTree(src) → manifest.json at the output root (order + icons baked in)
//   3. copy client/ → __docs__/ (same path the injected tags reference)
//   4. rewrite every .html with the injected tags (no reload, no edit;
//      shell gets nav.js + the DOCS_EXPORT flag, docs get mermaid-zoom when
//      the heuristic fires)
//   5. ensure index.html exists (built-in shell if the folder has none)
//
// Result: plain files, zero server, sidebar + pan/zoom fully working.

const fs = require("node:fs");
const path = require("node:path");
const { buildTree } = require("./manifest.js");
const { SHELL } = require("./shell.js");
const { injectScripts } = require("./inject.js");
const { readConfig, applyShellConfig } = require("./config.js");

const CLIENT_DIR = path.join(__dirname, "client");

// Settings are baked into the output (manifest.json/index.html), not shipped:
// the static site has no server, so _config.json itself would be dead weight.
const SKIP_FILES = new Set(["_config.json", "_order.json", "_icons.json"]);

function copyDir(src, dest, skipAbs) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name);
    if (skipAbs && path.resolve(from) === path.resolve(skipAbs)) continue; // don't copy output into itself
    if (SKIP_FILES.has(e.name)) continue; // config files don't belong in the export
    const to = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(from, to, null);
    else fs.copyFileSync(from, to);
  }
}

function collectHtml(dir, rel, out) {
  out = out || []; rel = rel || "";
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) collectHtml(path.join(dir, e.name), childRel, out);
    else if (e.isFile() && /\.html?$/i.test(e.name)) out.push(childRel);
  }
  return out;
}

function run(root, outDir) {
  const src = path.resolve(root);
  const out = path.resolve(outDir);
  if (!fs.existsSync(src)) {
    console.error(`erro: pasta não encontrada: ${src}`);
    process.exit(1);
  }

  // 1 — copy everything
  copyDir(src, out, out);

  // 2 — manifest.json (tree with order/icons already applied, title for the
  //     client's per-doc tab titles). The export NEVER writes to the source.
  const cfg = readConfig(src);
  const anim = ["reveal", "slide", "guide"].includes(cfg.sidebarAnim) ? cfg.sidebarAnim : "guide";
  const manifest = { root: "", sep: "/", anim, title: typeof cfg.title === "string" ? cfg.title : "", tree: buildTree(src) };
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  // 3 — client/ → __docs__/
  copyDir(CLIENT_DIR, path.join(out, "__docs__"));

  // 5 — ensure the shell exists BEFORE injecting, so it gets nav.js too;
  //     bake title/favicon from the config into it (dev server does this per
  //     request — here it's written to disk once)
  const idx = path.join(out, "index.html");
  if (!fs.existsSync(idx)) fs.writeFileSync(idx, applyShellConfig(SHELL, cfg));
  else fs.writeFileSync(idx, applyShellConfig(fs.readFileSync(idx, "utf8"), cfg));

  // 4 — rewrite HTMLs with the injected tags (static mode: no reload, no edit)
  for (const rel of collectHtml(out)) {
    const file = path.join(out, rel);
    const html = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, injectScripts(html, { staticMode: true }), "utf8");
  }

  console.log(`spec-space · exportado ${src}`);
  console.log(`  → ${out}`);
  console.log(`  deploy: surge ${out}   (ou arraste a pasta no Netlify Drop / GitHub Pages)`);
}

module.exports = { run };
