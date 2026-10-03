// tests for client/lib.js — the identity rule, testable without a browser
const { test } = require("node:test");
const assert = require("node:assert");
const lib = require("../client/lib.js");

test("me(): plain pathname under no base", () => {
  assert.strictEqual(lib.me("/guias/intro.html", ""), "guias/intro.html");
});

test("me(): strips the manager prefix (the plan's canonical example)", () => {
  assert.strictEqual(lib.me("/docs-proj/guias/intro.html", "/docs-proj/"), "guias/intro.html");
});

test("me(): prefix comparison is case-insensitive", () => {
  assert.strictEqual(lib.me("/Docs-Proj/guias/intro.html", "/docs-proj/"), "guias/intro.html");
});

test("me(): accepts base with or without trailing slash", () => {
  assert.strictEqual(lib.me("/docs-proj/a.html", "/docs-proj"), "a.html");
  assert.strictEqual(lib.me("/docs-proj/a.html", "/docs-proj/"), "a.html");
});

test("me(): root falls back to index.html", () => {
  assert.strictEqual(lib.me("/", ""), "index.html");
  assert.strictEqual(lib.me("/docs-proj/", "/docs-proj/"), "index.html");
});

test("me(): a doc NOT under the base keeps its full path (foreign prefix)", () => {
  assert.strictEqual(lib.me("/outro/a.html", "/docs-proj/"), "outro/a.html");
});

test("me(): decodes percent-encoded pathnames", () => {
  assert.strictEqual(lib.me("/pasta%20com%20espa%C3%A7o/a.html", ""), "pasta com espaço/a.html");
});

test("me(): base prefix that merely starts the name does not match", () => {
  // "/docs-projeto/x" must NOT be stripped by base "/docs-proj"
  assert.strictEqual(lib.me("/docs-projeto/x.html", "/docs-proj/"), "docs-projeto/x.html");
});

test("isShell(): no document → false (safe in Node)", () => {
  assert.strictEqual(lib.isShell(), false);
});
