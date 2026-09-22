# docs-in-html

Navigate folders of **HTML docs** with an auto sidebar, live reload, and
Mermaid/SVG pan/zoom. HTML over Markdown — zero build, zero dependencies.

## Why

Docs tools like MkDocs and Docsify are Markdown-first. If you write docs as HTML
(great for AI-generated, richly-styled content), there's nothing to *render* —
you only need to **navigate** them. `docs-in-html` is a tiny dev server that does
exactly that, and adds Mermaid pan/zoom on top.

## Install

```bash
npm install -g docs-in-html     # or just: npx docs-in-html ./my-docs
```

Requires Node ≥ 18.

## Use

```bash
docs-in-html ./docs-html              # serve a folder (opens the browser)
docs-in-html ./docs --port 5000       # custom port
docs-in-html ./docs --no-open         # don't auto-open
docs-in-html init ./new-docs          # scaffold a starter index.html
docs-in-html export ./docs --out dist # freeze to static files (Surge etc.)
```

## Manager — all your docs, one process, one URL

Serving folders one by one stops scaling at the second project. The manager
serves **every docs folder you own** from a single process, each at
`http://localhost:4400/<slug>/`:

```bash
docs-in-html manager        # cards page at :4400 (or $DOCS_MANAGER_PORT)
```

- **Serving = registering.** Any `docs-in-html <dir>` (npx included) adds the
  folder to `~/.docs-in-html/registry.json` — if the manager is running, the
  CLI doesn't even start a server: it registers the folder there and prints
  the link. `--no-register` opts out; `dir --unregister` removes.
- **Slug from your title** — the URL comes from `_config.json`'s `title`
  ("My Project — Handbook" → `/my-project-handbook/`); collisions get `-2`.
- **Cards page** at the manager root: title + favicon per docs, one click to
  open. Actions per card: open in **Warp** (`warp <dir>`; set `$WARP_BIN` if
  the binary isn't in a standard location), reveal in the file manager,
  remove from the registry.
- **One watcher per docs, one SSE per browser.** The manager multiplexes
  live-reload for all roots into a single connection, and tabs elect a leader
  (Web Locks) that relays events to the rest — the browser's ~6-connections-
  per-origin limit never bites, no matter how many tabs you keep open.
- **Import scan** — the "Escanear" button finds every folder with a
  `_config.json` under `$HOME` (skip-listed, depth-capped) so you can register
  existing docs in one batch.

The single-folder mode is unchanged and works standalone, as always.

If the default port (8000, or `$PORT`) is already in use — e.g. another
`docs-in-html` instance serving a different folder — the next free port is
used automatically, with a warning:

```
⚠ porta 8000 está em uso — usando 8001
```

An explicit `--port` is a request, not a hint: if it's busy, the server exits
with a clear error instead of silently picking another port.

## Deploy (static hosting)

The dev server is only for local use — but the whole experience survives on a
static host. `export` freezes what the server decides at runtime (the sidebar
tree, the injected pan/zoom scripts) into plain files:

```bash
docs-in-html export ./docs    # → ./dist with everything baked in
surge dist                   # or Netlify Drop, GitHub Pages...
```

What `dist/` contains: your HTMLs **with the script tags already written in**,
a `manifest.json` (tree + manual order + folder icons), and `__docs__/` (the
client scripts the tags reference). On the static site the sidebar works,
pan/zoom works — but it's read-only (no delete/rename/new-folder/drag; those
need the dev server). Deep links work too: opening a doc's URL directly
bounces to the shell with the sidebar open on that doc (anchors preserved).
Publish from the root of
the output folder (absolute `/__docs__/...` paths don't survive sub-path
hosting like `user.github.io/projeto/`). Live reload and inline editing stay
dev-only, by design.

## Features

- **Auto sidebar tree** generated from your folder structure (collapsible, with collapse memory,
  Unicode-friendly — "Integração" stays "Integração")
- **URL sync** — the address bar always shows the current doc; back/forward and deep
  links work (F5 on `/docs/foo.html` reopens the shell around that doc)
- **Live reload** — edit a doc, only that one reloads (sidebar state preserved)
- **Pan/zoom/lightbox for diagrams** — Mermaid blocks **and** standalone inline SVGs
  (any `<svg>` inside a `<figure>`, or anything marked `.panzoom` / `.diagram` / `.zoomable`).
  Injected automatically; clicks inside buttons/links are never hijacked. The lightbox
  has zoom buttons and a **full-screen mode** (works inside the shell's iframe too).
- **Inline WYSIWYG editing** — an "Editar" toggle (top-right of every doc) makes the
  rendered page editable: click any text, type, `Ctrl+S` saves the file in place.
  You never see HTML tags. (`Ctrl+E` toggles; `pre`/`code` blocks edit as plain text)
- Use **your own `index.html`**, or the built-in shell when a folder has none
- **Hide the sidebar** with the toggle button, left-aligned in the header (state remembered)
- Zero dependencies, zero build

## Authoring

Write plain HTML. Use `<div class="mermaid">…</div>` blocks plus the Mermaid core
script tags (LLMs add these automatically), or just drop an inline `<svg>` inside a
`<figure>` — it becomes pan/zoomable too. Need an SVG zoomable but it's not in a
figure? Add `class="diagram"` (or `panzoom` / `zoomable`) to it or any ancestor.
No template, no boilerplate — the pan/zoom layer is injected for you. The same file
also renders standalone (`file://` or any static host), just without the zoom.

## License

MIT
