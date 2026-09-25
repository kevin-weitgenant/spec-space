#!/usr/bin/env node
// docs-in-html is now spec-space. This stub forwards the CLI so
// `docs-in-html <dir>` / `npx docs-in-html` keep working.
let serve;
try {
  serve = require.resolve("spec-space/serve.js");
} catch (_) {
  // fallback: resolve from the project the user ran the command in
  serve = require.resolve("spec-space/serve.js", { paths: [process.cwd()] });
}
require(serve);
