// export.run() — the missing-folder path throws (it used to process.exit,
// killing the test runner); the happy path produces a real static export.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { run } = require("../export.js");

test("missing folder: throws instead of exiting the process", () => {
  assert.throws(() => run(path.join(os.tmpdir(), "no-such-spec-space-dir"), "out"), /pasta não encontrada/);
});

test("happy path: manifest.json + __docs__/ + injected tags on disk", () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "spec-space-exp-"));
  const out = path.join(src, "site");
  fs.writeFileSync(path.join(src, "index.html"), '<html><body><nav id="docList"></nav></body></html>');
  fs.writeFileSync(path.join(src, "guia.html"), "<html><body><p>olá</p></body></html>");
  fs.writeFileSync(path.join(src, "_config.json"), JSON.stringify({ title: "Meu Site" }));

  run(src, out);

  assert.ok(fs.existsSync(path.join(out, "manifest.json")), "manifest.json");
  assert.ok(fs.existsSync(path.join(out, "__docs__", "lib.js")), "client copied to __docs__/");
  assert.ok(!fs.existsSync(path.join(out, "_config.json")), "config NOT shipped");

  const shell = fs.readFileSync(path.join(out, "index.html"), "utf8");
  assert.ok(shell.includes("/__docs__/lib.js"));
  assert.ok(shell.includes("/__docs__/nav.js"));
  assert.ok(shell.includes("window.DOCS_EXPORT"), "static flag");
  assert.ok(!shell.includes("reload.js"), "no reload client in the export");

  const doc = fs.readFileSync(path.join(out, "guia.html"), "utf8");
  assert.ok(doc.includes("data-injected"), "docs get injected tags");

  // the source folder is NEVER written to
  const srcGuia = fs.readFileSync(path.join(src, "guia.html"), "utf8");
  assert.ok(!srcGuia.includes("data-injected"));
});
