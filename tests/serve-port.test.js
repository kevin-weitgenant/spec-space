// main()'s port-fallback machine and manager delegation — exercised with a
// fake listen and a fake pingManager, no real ports, no real manager.
const { test } = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { main } = require("../src/cli/serve.js");

function tempRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "spec-space-port-"));
  return d;
}

// deps: replace the HTTP server's listen with a controllable fake
function fakeServerDep(failCodes) {
  const attempts = [];
  return {
    attempts,
    makeServer() {
      const handlers = { once() {}, on() {}, close() {} };
      handlers.listen = function (port, cb) {
        attempts.push(port);
        if (failCodes.length) {
          const code = failCodes.shift();
          setImmediate(() => {
            const srv = { listening: false, close() {}, once() {} };
            srv.once = () => {};
            // emulate the error handler path: main attached `once("error")`
            // to the object we return here
            emulateError(handlers, port, code);
          });
          return handlers.self;
        }
        setImmediate(cb);
        return handlers.self;
      };
      handlers.self = handlers;
      return handlers;
    },
  };
}

// simpler, honest fake: build the server via createServer override
function withFakeListen(t, { fails = [], captured } = {}) {
  const http = require("node:http");
  const realCreate = http.createServer;
  t.after(() => { http.createServer = realCreate; });
  http.createServer = function (handler) {
    const listeners = {};
    const srv = {
      listening: false,
      listen(port, cb) {
        captured.ports.push(port);
        const code = fails.length && fails.shift();
        if (code) {
          setImmediate(() => listeners.error({ code, message: code }));
        } else {
          srv.listening = true;
          setImmediate(cb);
        }
        return srv;
      },
      once(ev, fn) { listeners[ev] = fn; },
      on() {},
      close() {},
    };
    return srv;
  };
}

test("no --port, listen fails twice with EADDRINUSE → lands on the 3rd port", async (t) => {
  const captured = { ports: [] };
  withFakeListen(t, { fails: ["EADDRINUSE", "EADDRINUSE"], captured });
  const code = await main(
    { mode: "serve", dir: tempRoot(), port: 9001, portWasExplicit: false, doOpen: false, noRegister: true, unregister: false, outDir: "dist" },
    { pingManagerDep: async () => null, openUrl() {} }
  );
  assert.strictEqual(code, undefined); // live server: no exit code
  assert.deepStrictEqual(captured.ports, [9001, 9002, 9003]);
});

test("explicit --port on a busy port → resolves 1 with the clear message", async (t) => {
  const captured = { ports: [] };
  withFakeListen(t, { fails: ["EADDRINUSE"], captured });
  const errs = [];
  const realErr = console.error;
  console.error = (...a) => errs.push(a.join(" "));
  t.after(() => { console.error = realErr; });
  const code = await main(
    { mode: "serve", dir: tempRoot(), port: 9005, portWasExplicit: true, doOpen: false, noRegister: true, unregister: false, outDir: "dist" },
    { pingManagerDep: async () => null, openUrl() {} }
  );
  console.error = realErr;
  assert.strictEqual(code, 1);
  assert.deepStrictEqual(captured.ports, [9005]); // no fallback — explicit is a request
  assert.ok(errs.some((e) => e.includes("já está em uso")));
});

test("manager alive → no server is created, only addToManager", async (t) => {
  let created = 0;
  const http = require("node:http");
  const realCreate = http.createServer;
  http.createServer = () => { created++; return realCreate(() => {}); };
  t.after(() => { http.createServer = realCreate; });
  const added = [];
  const code = await main(
    { mode: "serve", dir: tempRoot(), port: 8000, portWasExplicit: false, doOpen: false, noRegister: false, unregister: false, outDir: "dist" },
    {
      pingManagerDep: async () => 4478,
      addToManagerDep: async (root, p) => { added.push([path.basename(root), p]); return "slug-x"; },
      openUrl() {},
    }
  );
  assert.strictEqual(code, 0);
  assert.strictEqual(created, 0);
  assert.strictEqual(added.length, 1);
  assert.strictEqual(added[0][1], 4478);
});

test("EACCES on the port → resolves 1 with the privileged-port tip", async (t) => {
  const captured = { ports: [] };
  withFakeListen(t, { fails: ["EACCES"], captured });
  const errs = [];
  const realErr = console.error;
  console.error = (...a) => errs.push(a.join(" "));
  t.after(() => { console.error = realErr; });
  const code = await main(
    { mode: "serve", dir: tempRoot(), port: 80, portWasExplicit: true, doOpen: false, noRegister: true, unregister: false, outDir: "dist" },
    { pingManagerDep: async () => null, openUrl() {} }
  );
  console.error = realErr;
  assert.strictEqual(code, 1);
  assert.ok(errs.some((e) => e.includes("privilegiada")));
});
