// nav/icons.js — row icons. Curated Lucide set, vendored as real .svg files
// under client/icons/ (served from /__docs__/icons/ — same origin, offline,
// no CDN, no build). Rendered as <img> so they work over http AND file://
// (fetch()-inlined SVG is blocked on file://, which would blank every icon
// in a locally opened export). The neutral gray (#5b6472) is baked into the
// files because <img> SVGs can't inherit currentColor.
var DN = window.docsNav;

DN.chevEl = function () {
  var s = document.createElement("span");
  s.className = "dl-chev";
  s.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
  return s;
};

// icon value: a name from client/icons/, or any non-ASCII string (emoji →
// text). Docs with no icon stay plain; folders fall back to the folder glyph.
DN.iconEl = function (icon, isFolder) {
  var name = typeof icon === "string" ? icon.trim() : "";
  if (name && /[^\u0000-\u007f]/.test(name)) {
    var em = document.createElement("span");
    em.className = "dl-ico dl-emoji";
    em.textContent = name;
    return em;
  }
  if (!name && !isFolder) return null;
  var el = document.createElement("span");
  el.className = "dl-ico";
  var img = document.createElement("img");
  img.src = DN.BASEP + "/__docs__/icons/" + (name || "folder") + ".svg";
  img.alt = "";
  img.loading = "lazy";
  // unknown name: folders still get the default glyph, docs lose the element —
  // silently and safely, exactly like the old inline dictionary did
  img.onerror = function () {
    if (isFolder && !img.dataset.fb) { img.dataset.fb = "1"; img.src = DN.BASEP + "/__docs__/icons/folder.svg"; }
    else if (el.isConnected) el.remove();
  };
  el.appendChild(img);
  return el;
};
