// tests for the pure diff core (client/diff.js) — node:test, zero deps
const { test } = require("node:test");
const assert = require("node:assert");
const { diffOps, wordDiff, similarity, marks } = require("../client/diff.js");

test("diffOps: identical lists → empty ops (fully trimmed)", () => {
  assert.deepStrictEqual(diffOps(["a", "b"], ["a", "b"]), []);
});

test("diffOps: pure insertion → single + op (prefix/suffix trim)", () => {
  assert.deepStrictEqual(diffOps(["Intro", "Setup", "Uso"], ["Intro", "Setup", "Auth", "Uso"]), [
    { t: "+", b: 2 },
  ]);
});

test("diffOps: pure deletion → single - op", () => {
  assert.deepStrictEqual(diffOps(["a", "b", "c"], ["a", "c"]), [{ t: "-", a: 1 }]);
});

test("diffOps: gives up (null) past the 4e6 cell budget", () => {
  const a = new Array(2100).fill(0).map((_, i) => "x" + i);
  const b = new Array(2100).fill(0).map((_, i) => "y" + i); // no common prefix/suffix
  assert.strictEqual(diffOps(a, b), null);
});

test("diffOps: unicode text works", () => {
  const ops = diffOps(["configuração rápida"], ["configuração lenta"]);
  assert.ok(ops.some((o) => o.t === "-"));
  assert.ok(ops.some((o) => o.t === "+"));
});

test("marks: new block gets kind 'new'", () => {
  const old = ["Intro", "Setup", "Uso"];
  const now = ["Intro", "Setup", "Auth", "Uso"];
  const m = marks(diffOps(old, now), old, now);
  assert.deepStrictEqual(m, [{ b: 2, kind: "new" }]);
});

test("marks: similar delete+add pair becomes an 'edit' with the old text", () => {
  const old = ["Instale com npm install"];
  const now = ["Instale com pnpm install"];
  const m = marks(diffOps(old, now), old, now);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].kind, "edit");
  assert.strictEqual(m[0].old, "Instale com npm install");
  assert.strictEqual(m[0].b, 0);
});

test("marks: moved block is NOT marked", () => {
  const old = ["A", "B", "C"];
  const now = ["C", "A", "B"]; // C moved to the front — same texts, new order
  const m = marks(diffOps(old, now), old, now);
  assert.deepStrictEqual(m, []);
});

test("wordDiff: one-word edit yields - and + tokens for the changed word", () => {
  const w = wordDiff("Instale com npm install", "Instale com pnpm install");
  assert.ok(w);
  // common prefix/suffix (incl. whitespace separators) is trimmed away —
  // only the changed word survives as - and +
  assert.deepStrictEqual(w, [
    { t: "-", s: "npm" },
    { t: "+", s: "pnpm" },
  ]);
});

test("wordDiff: identical strings → all context", () => {
  const w = wordDiff("same text", "same text");
  assert.ok(w.every((t) => t.t === " "));
});

test("similarity: 1 for equal, 0 for disjoint, symmetric-ish", () => {
  assert.strictEqual(similarity("hello world", "hello world"), 1);
  assert.strictEqual(similarity("aaa", "bbb"), 0);
  assert.ok(similarity("one two three", "one two four") > 0.4);
});
