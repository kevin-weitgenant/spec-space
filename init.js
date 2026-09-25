// `spec-space init [dir]` — scaffold a starter index.html (the shell) so you can customize it.

const fs = require("node:fs");
const path = require("node:path");
const { SHELL } = require("./shell.js");
const { defaultConfig, writeConfig } = require("./config.js");

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const idx = path.join(dir, "index.html");
  if (fs.existsSync(idx)) {
    console.log("index.html already exists in " + dir + " — left untouched.");
  } else {
    fs.writeFileSync(idx, SHELL, "utf8");
    console.log("✓ Created " + idx);
  }
  const cfg = path.join(dir, "_config.json");
  if (!fs.existsSync(cfg)) {
    writeConfig(dir, defaultConfig(dir));
    console.log("✓ Created " + cfg + " — tweak title/favicon there");
  }
  console.log("  Drop .html files in this folder, then run:  spec-space " + dir);
}

module.exports = { init };
