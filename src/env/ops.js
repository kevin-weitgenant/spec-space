// ops.js — the environment seam: the ONE door through which the project
// talks to the outside world (filesystem, OS processes, home dir). In
// production the default adapter wraps node:fs / node:child_process / node:os
// directly; tests can swap the whole thing via setOps() with an in-memory
// adapter and never touch a real disk, launch a real process, or read a real
// home directory.
//
//   const ops = require("./ops.js");
//   ops.readFileSync(...)        // looks just like fs
//   ops.openPath(abs)            // explorer / open -R / xdg-open, written once
//   ops.setOps(fakeOps)          // tests: swap the adapter
//   ops.resetOps()               // tests: back to the real thing
//
// Design notes:
// - The module IS the default adapter (a Proxy delegating to the current
//   one), so existing call sites read naturally (ops.readFile, ops.watch…).
// - setOps() swaps the adapter globally, even for modules that already
//   captured `ops` at require time — the proxy always forwards to `current`.
// - fs function names/signatures mirror node:fs exactly, so migrating a
//   call site is a rename, not a rewrite.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

function createDefaultOps() {
  return {
    // ── filesystem (same names & signatures as node:fs) ──────────────────
    existsSync: fs.existsSync,
    statSync: fs.statSync,
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    copyFileSync: fs.copyFileSync,
    mkdirSync: fs.mkdirSync,
    readdirSync: fs.readdirSync,
    stat: fs.stat,
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    rename: fs.rename,
    unlink: fs.unlink,
    mkdir: fs.mkdir,
    rmdir: fs.rmdir,
    access: fs.access,
    watch: fs.watch,

    // ── environment ───────────────────────────────────────────────────────
    homeDir() { return os.homedir(); },

    // Detached background process — fire and forget.
    spawn(bin, args) {
      return cp.spawn(bin, args, { detached: true, stdio: "ignore" }).unref();
    },

    execFile: cp.execFile,

    // Reveal a path in the OS file manager. Directory → opens itself;
    // file → opens with the file selected (Windows /select, macOS -R,
    // Linux opens the parent — xdg-open has no "select" flag).
    openPath(abs) {
      let isDir = false;
      try { isDir = fs.statSync(abs).isDirectory(); } catch {}
      if (process.platform === "win32")
        cp.spawn("explorer", isDir ? [abs] : [`/select,${abs}`], { detached: true, stdio: "ignore" }).unref();
      else if (process.platform === "darwin")
        cp.spawn("open", ["-R", abs], { detached: true, stdio: "ignore" }).unref();
      else
        cp.spawn("xdg-open", [isDir ? abs : path.dirname(abs)], { detached: true, stdio: "ignore" }).unref();
    },

    // Open a URL in the default browser.
    openUrl(url) {
      const cmd = process.platform === "win32" ? `start "" "${url}"`
        : process.platform === "darwin" ? `open "${url}"`
        : `xdg-open "${url}"`;
      cp.exec(cmd, () => {});
    },
  };
}

let current = createDefaultOps();

module.exports = new Proxy({}, {
  get(_target, prop) {
    if (prop === "setOps") return (o) => { current = o; };
    if (prop === "resetOps") return () => { current = createDefaultOps(); };
    const v = current[prop];
    return typeof v === "function" ? v.bind(current) : v;
  },
});
