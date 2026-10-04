// parseArgs matrix — pure, no process.argv/process.env reads
const { test } = require("node:test");
const assert = require("node:assert");
const { parseArgs } = require("../src/cli/serve.js");

test("defaults: serve current dir, port 8000, open browser", () => {
  const o = parseArgs([]);
  assert.deepStrictEqual(
    { mode: o.mode, dir: o.dir, port: o.port, portWasExplicit: o.portWasExplicit, doOpen: o.doOpen, outDir: o.outDir, noRegister: o.noRegister, unregister: o.unregister },
    { mode: "serve", dir: ".", port: 8000, portWasExplicit: false, doOpen: true, outDir: "dist", noRegister: false, unregister: false }
  );
});

test("defaultPort option replaces the hard-coded default", () => {
  assert.strictEqual(parseArgs([], { defaultPort: 9999 }).port, 9999);
});

test("-p/--port sets the port and marks it explicit", () => {
  assert.strictEqual(parseArgs(["-p", "1234"]).port, 1234);
  assert.strictEqual(parseArgs(["--port", "1234"]).portWasExplicit, true);
});

test("--port abc keeps the default (NaN fallback)", () => {
  const o = parseArgs(["--port", "abc"], { defaultPort: 8000 });
  assert.strictEqual(o.port, 8000);
  assert.strictEqual(o.portWasExplicit, true);
});

test("subcommands: init / export / manager", () => {
  assert.strictEqual(parseArgs(["init"]).mode, "init");
  assert.strictEqual(parseArgs(["export", "docs", "--out", "site"]).mode, "export");
  assert.strictEqual(parseArgs(["export", "docs", "--out", "site"]).outDir, "site");
  assert.strictEqual(parseArgs(["manager"]).mode, "manager");
});

test("-h and --help become mode:'help' (a decision, not a side effect)", () => {
  assert.strictEqual(parseArgs(["-h"]).mode, "help");
  assert.strictEqual(parseArgs(["--help"]).mode, "help");
});

test("boolean flags and positional dir", () => {
  const o = parseArgs(["mydocs", "--no-open", "--no-register", "--unregister"]);
  assert.strictEqual(o.dir, "mydocs");
  assert.strictEqual(o.doOpen, false);
  assert.strictEqual(o.noRegister, true);
  assert.strictEqual(o.unregister, true);
});

test("-o re-enables open", () => {
  assert.strictEqual(parseArgs(["--no-open", "-o"]).doOpen, true);
});
