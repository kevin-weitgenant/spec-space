// ops.test.js — the environment seam. Registry/reload become testable with a
// fake ops: no real home dir touched, no real watcher, no real process.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ops = require("../src/env/ops.js");

// ── setOps / resetOps ──────────────────────────────────────────────────────

test("setOps swaps the adapter; resetOps restores the real one", () => {
  const fake = { homeDir: () => "/fake/home" };
  ops.setOps(fake);
  assert.strictEqual(ops.homeDir(), "/fake/home");
  ops.resetOps();
  assert.strictEqual(ops.homeDir(), os.homedir());
});

// ── registry via fake ops: never touches the real home ────────────────────

test("registry add/list/save with a fake in-memory ops", () => {
  // tiny in-memory fs: enough for registry (readFileSync/writeFileSync/
  // mkdirSync/copyFileSync/statSync)
  const files = new Map();
  const fake = {
    homeDir: () => "/fake/home",
    readFileSync: (f) => { if (!files.has(f)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } return files.get(f); },
    writeFileSync: (f, d) => files.set(f, d),
    mkdirSync: () => {},
    copyFileSync: (f, t) => files.set(t, files.get(f)),
    statSync: () => ({ isDirectory: () => true }),
  };
  ops.setOps(fake);
  const registry = require("../src/domain/registry.js");

  const added = registry.add("/some/docs");
  assert.strictEqual(added, true);
  assert.deepStrictEqual(registry.list(), [path.resolve("/some/docs")]);

  // duplicate add is a no-op
  assert.strictEqual(registry.add("/some/docs"), false);

  // the registry file lives in the FAKE home, and the real one is untouched
  const regFile = path.join("/fake/home", ".docs-in-html", "registry.json");
  assert.ok(files.has(regFile), "registry.json written to fake home");
  assert.strictEqual(registry.filePath(), regFile);

  ops.resetOps();
});

// ── reload via fake ops: watcher becomes deterministic ────────────────────

test("reload broadcast triggered by a fake watcher emit (no real fs.watch)", () => {
  const emitted = [];
  const fakeWatchers = [];
  const fake = {
    homeDir: () => "/fake/home",
    watch: (root, _opts, cb) => {
      const w = { cb, close() { fakeWatchers.splice(fakeWatchers.indexOf(this), 1); } };
      w.emit = (rel) => cb(null, rel);
      fakeWatchers.push(w);
      return w;
    },
  };
  ops.setOps(fake);
  // fresh module instance would be nicer, but createReload reads ops per call
  const { createReload } = require("../src/server/reload.js");
  const seen = [];
  const reload = createReload("/fake/root", (rel) => seen.push(rel));

  assert.strictEqual(fakeWatchers.length, 1, "one (fake) watcher created");
  // same file twice → debounce collapses into ONE broadcast (Windows fires
  // several events per save); a different file gets its own.
  fakeWatchers[0].emit("index.html");
  fakeWatchers[0].emit("index.html");
  fakeWatchers[0].emit("guide/a.html");
  return new Promise((resolve) => {
    // debounce is 150 ms per file
    setTimeout(() => {
      assert.deepStrictEqual(seen, ["index.html", "guide/a.html"]);
      reload.close();
      assert.strictEqual(fakeWatchers.length, 0, "watcher closed");
      ops.resetOps();
      resolve();
    }, 250);
  });
});

// ── openPath / openUrl / spawn: recorded, never launched ──────────────────

test("openPath/openUrl/spawn can be noop-recorded via setOps", () => {
  const calls = [];
  const fake = {
    homeDir: () => "/fake/home",
    statSync: () => ({ isDirectory: () => true }),
    spawn: (bin, args) => calls.push(["spawn", bin, ...args]),
    openPath: (p) => calls.push(["openPath", p]),
    openUrl: (u) => calls.push(["openUrl", u]),
  };
  ops.setOps(fake);
  // production modules call ops.*, so a recording ops sees every launch:
  ops.openPath("/docs/proj");
  ops.openUrl("http://localhost:4400");
  assert.deepStrictEqual(calls, [["openPath", "/docs/proj"], ["openUrl", "http://localhost:4400"]]);
  ops.resetOps();
});

// sanity: default adapter mirrors node:fs behavior
test("default ops reads a real file like node:fs", () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ops-test-")), "x.txt");
  fs.writeFileSync(tmp, "hello");
  assert.strictEqual(ops.readFileSync(tmp, "utf8"), "hello");
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
});
