// Shared script-injection logic — used by BOTH the dev server (injects into
// each HTTP response) and the export command (writes the tags into the files
// on disk). One heuristic, two destinations: a fix here applies to both.

// Splice dev scripts into HTML:
//  - reload client (dev only — nothing to reload in a static export)
//  - nav client (only the shell — a page with #docList)
//  - edit client (dev only; every doc EXCEPT the shell — inline WYSIWYG,
//    needs POST /__save__ so it's meaningless in a static export)
//  - mermaid-zoom (docs with Mermaid blocks OR standalone diagram SVGs:
//    <figure>, or .panzoom/.diagram/.zoomable — that don't already have pan/zoom)
// Detection is tag-context only: a page that merely *mentions* "id=\"docList\""
// or "mermaid-zoom" in prose (e.g. docs about this very package) must not
// be mistaken for a shell or for a page that ships its own pan/zoom.
// Every injected tag carries data-injected: the editor strips them before
// saving the page back to disk via /__save__.
//
// opts.staticMode: true for the export — defines window.DOCS_EXPORT (read by
// nav.js to pick /manifest.json and enter read-only mode) and drops the
// reload/edit clients. Static docs ALSO get a small bootstrap (in <head>,
// before anything renders): on a static host a deep link serves the raw doc
// — outside the shell's iframe, hence no sidebar. If we're the top window,
// bounce to the shell as /?p=<doc path>; the shell picks it up and opens it
// inside the iframe (see nav.js).
function deepLinkBootstrap() {
  return (
    '<script data-injected>try{if(window.top===window.self&&!window.frameElement&&location.pathname!=="/"&&/\\.html?$/i.test(location.pathname))' +
    'location.replace("/?p="+encodeURIComponent(decodeURIComponent(location.pathname.replace(/^\\/+/,""))+location.hash))}catch(e){}</scr' + "ipt>"
  );
}
function injectScripts(html, opts = {}) {
  const { staticMode = false, base = "" } = opts; // base: "" (single root) or "/<slug>" (manager)
  const isShell = /<[^>]+\bid\s*=\s*["']docList["']/i.test(html);
  if (staticMode && !isShell) {
    html = /<head[^>]*>/i.test(html)
      ? html.replace(/<head[^>]*>/i, (m) => m + deepLinkBootstrap())
      : deepLinkBootstrap() + html;
  }
  const tags = [];
  // dev clients read window.DOCS_BASE to prefix their /__... API calls
  if (!staticMode && base) tags.push(`<script>window.DOCS_BASE=${JSON.stringify(base + "/")}</script>`);
  if (staticMode) tags.push(`<script>window.DOCS_EXPORT=true</script>`);
  else tags.push(`<script src="${base}/__docs__/reload.js" data-injected></script>`);
  if (isShell) tags.push(`<script src="${base}/__docs__/nav.js" data-injected></script>`);
  else if (!staticMode) tags.push(`<script src="${base}/__docs__/edit.js" data-injected defer></script>`);
  const wantsZoom =
    /\bclass\s*=\s*["'][^"']*\bmermaid\b/.test(html) ||
    /<figure[\s>]/i.test(html) ||
    /class\s*=\s*["'][^"']*\b(panzoom|diagram|zoomable)\b/i.test(html);
  const hasOwnZoom = /<script[^>]+src\s*=\s*["'][^"']*(?:mermaid-zoom|svg-pan-zoom)/i.test(html);
  if (wantsZoom && !hasOwnZoom) {
    tags.push(`<script src="${base}/__docs__/mermaid-zoom.js" data-injected defer></script>`);
  }
  const block = tags.join("");
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, block + "$&") : html + block;
}

module.exports = { injectScripts };
