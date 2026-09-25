# spec-space

[![JavaScript](https://img.shields.io/badge/JavaScript-plain-F7DF1E?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![HTML5](https://img.shields.io/badge/HTML-plain-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/HTML)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](#)
[![Status](https://img.shields.io/badge/status-in%20development-orange)](#)

**spec-space** helps you write specs that are easy to understand — and stay
organized across multiple projects.

Specs live as plain HTML folders. spec-space turns any folder into a navigable
spec site: an auto-generated sidebar tree, live reload, Mermaid/SVG pan & zoom,
and a manager that serves **all your projects** from a single URL. No build
step, no dependencies — just simple JavaScript and HTML.

> ⚠️ **In development** — the tool works day-to-day, but expect rough edges
> and breaking changes between minor versions.

## Features

1. **Auto sidebar tree** — generated from your folder structure, collapsible with collapse memory, Unicode-friendly
2. **Multi-project manager** — one process, one URL, every spec folder you own, at `http://localhost:4400/<slug>/`
3. **Serving = registering** — any `spec-space <dir>` adds the folder to the manager's registry automatically
4. **Live reload** — edit a doc, only that one reloads (sidebar state preserved)
5. **Change highlights** — new content since your last visit is tinted green, edited paragraphs show a word-diff, a minimap marks changed regions, and the browser tab gets a dot
6. **Pan/zoom/lightbox for diagrams** — Mermaid blocks and inline SVGs, with full-screen mode
7. **Inline WYSIWYG editing** — click any text, type, `Ctrl+S` saves the file in place
8. **URL sync** — the address bar always shows the current doc; back/forward and deep links work
9. **Static export** — freeze everything to plain files for Surge, Netlify, GitHub Pages…
10. **Zero dependencies, zero build** — plain JavaScript and HTML all the way down

## Install

```bash
npm install -g spec-space     # or just: npx spec-space ./my-specs
```

Requires Node ≥ 18.

## Use

```bash
spec-space ./specs                  # serve a folder (opens the browser)
spec-space ./specs --port 5000      # custom port
spec-space ./specs --no-open        # don't auto-open
spec-space init ./new-specs         # scaffold a starter index.html
spec-space export ./specs --out dist # freeze to static files
```

## Manager — all your projects, one URL

Serving folders one by one stops scaling at the second project. The manager
serves **every spec folder you own** from a single process:

```bash
spec-space manager        # cards page at :4400 (or $DOCS_MANAGER_PORT)
```

- **Cards page** at the root: title + favicon per project, one click to open.
  Actions per card: open in **Warp**, reveal in the file manager, remove from
  the registry.
- **Slug from your title** — the URL comes from `_config.json`'s `title`
  ("My Project — Handbook" → `/my-project-handbook/`); collisions get `-2`.
- **Import scan** — the scan button finds every folder with a `_config.json`
  under `$HOME` so you can register existing specs in one batch.
- **One watcher per project, one SSE per browser** — live reload works across
  all roots and any number of tabs, without hitting browser connection limits.

## Deploy (static hosting)

The dev server is only for local use — but the whole experience survives on a
static host. `export` freezes the sidebar tree and injected scripts into plain
files:

```bash
spec-space export ./specs    # → ./dist with everything baked in
surge dist                   # or Netlify Drop, GitHub Pages...
```

On the static site the sidebar and pan/zoom work; editing and live reload
stay dev-only, by design.

## Authoring

Write plain HTML. Use `<div class="mermaid">…</div>` blocks plus the Mermaid
core script tags, or drop an inline `<svg>` inside a `<figure>` — it becomes
pan/zoomable automatically. No template, no boilerplate. The same file also
renders standalone (`file://` or any static host), just without the zoom.

## License

MIT
