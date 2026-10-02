// roots.test.js — unit tests for the security guards and the endpoint
// dispatch table. No HTTP server, no port, no fetch: pure function calls.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { safeRelPath, resolveIn, ENDPOINTS, createRoot, readJsonBody } = require("./roots.js");

// ── safeRelPath ────────────────────────────────────────────────────────────

test("safeRelPath accepts normal nested paths", () => {
  assert.strictEqual(safeRelPath("guides/v2"), "guides/v2");
  assert.strictEqual(safeRelPath("a.html"), "a.html");
  assert.strictEqual(safeRelPath("Active plan/doc.html"), "Active plan/doc.html");
});

test("safeRelPath rejects traversal, absolute, backslash and junk", () => {
  for (const bad of [
    "../../etc/passwd",       // traversal
    "/etc/passwd",            // absolute
    "a\\b",                   // backslash
    "..", "a/../b",           // dot segments
    ".hidden", "_config",     // dot/underscore prefixes
    'a<b', 'a"b', "a|b", "a?b", "a*b", "a:b", // forbidden chars
    "", null, undefined, 42,  // non-strings / empty
  ]) {
    assert.strictEqual(safeRelPath(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

// ── resolveIn ──────────────────────────────────────────────────────────────

test("resolveIn resolves inside root and rejects escapes", () => {
  const root = os.tmpdir();
  const ok = resolveIn(root, "guides/v2");
  assert.ok(ok);
  assert.strictEqual(ok.rel, "guides/v2");
  assert.strictEqual(ok.abs, path.resolve(root, "guides/v2"));
  assert.ok(ok.abs.startsWith(root + path.sep) || path.dirname(ok.abs) === root);

  assert.strictEqual(resolveIn(root, "../../etc/passwd"), null);
  assert.strictEqual(resolveIn(root, "/etc/passwd"), null);
  assert.strictEqual(resolveIn(root, null), null);
});

// ── ENDPOINTS table ────────────────────────────────────────────────────────

test("ENDPOINTS maps every /__*__ path to a named function + method", () => {
  const expected = {
    "/__manifest__": "GET",
    "/__delete__": "POST",
    "/__rename__": "POST",
    "/__mkdir__": "POST",
    "/__save__": "POST",
    "/__reveal__": "POST",
    "/__order__": "POST",
    "/__title__": "POST",
  };
  assert.deepStrictEqual(Object.fromEntries(Object.entries(ENDPOINTS).map(([k, v]) => [k, v.method])), expected);
  for (const v of Object.values(ENDPOINTS)) assert.strictEqual(typeof v.fn, "function");
});

// ── delete endpoint: malicious path dies at the guard, fs never touched ────

test("endpointDelete rejects traversal before any filesystem op", (t, done) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roots-test-"));
  const { handle } = createRoot(root, { base: "" });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let ended = false;
  const res = {
    writeHead(status) { this.status = status; },
    end() {
      if (ended) return; ended = true;
      // 400 = guard rejected it; the fs call inside must never have run
      assert.strictEqual(this.status, 400);
      done();
    },
  };  const body = JSON.stringify({ path: "../../etc/passwd" });
  const req = new (require("node:stream").Readable)({ read() { this.push(body); this.push(null); } });
  req.method = "POST";
  req.url = "/__delete__";
  req.headers = {};
  handle(req, res);
});

// ── readJsonBody ───────────────────────────────────────────────────────────

test("readJsonBody parses valid JSON and nulls out junk", () => {
  const mk = (s) => { const r = new (require("node:stream").Readable)({ read() { this.push(s); this.push(null); } }); return r; };
  readJsonBody(mk('{"a":1}'), (j) => assert.deepStrictEqual(j, { a: 1 }));
  readJsonBody(mk("not json"), (j) => assert.strictEqual(j, null));
});
