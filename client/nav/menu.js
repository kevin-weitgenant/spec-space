// nav/menu.js — the ⋯ dropdown (kebab) menu: open/close plumbing, positioning
// and the per-row actions (copy path, reveal, move, delete).
var DN = window.docsNav;

var openMenu = null;
DN.closeMenu = function () {
  if (openMenu) { openMenu.remove(); openMenu = null; }
  // drop focus from the kebab button so it doesn't stay visible on other rows
  var ae = document.activeElement;
  if (ae && ae.classList && ae.classList.contains("dl-act")) ae.blur();
};

DN.showMenu = function (anchor, items) {
  DN.closeMenu();
  var m = document.createElement("div");
  m.className = "dl-menu";
  items.forEach(function (it) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = it.label;
    if (it.danger) b.className = "dl-danger";
    if (it.armed) { // two-click confirm (delete)
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!b.classList.contains("dl-armed")) {
          b.classList.add("dl-armed");
          b.textContent = "Delete for sure?";
          setTimeout(function () {
            if (b.isConnected) { b.classList.remove("dl-armed"); b.textContent = it.label; }
          }, 3000);
          return;
        }
        DN.closeMenu();
        it.onClick();
      });
    } else {
      b.addEventListener("click", function (e) { e.stopPropagation(); DN.closeMenu(); it.onClick(); });
    }
    m.appendChild(b);
  });
  document.body.appendChild(m);
  var r = anchor.getBoundingClientRect();
  var mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + "px";
  m.style.top = (r.bottom + mh > window.innerHeight - 8 ? Math.max(8, r.top - mh) : r.bottom + 4) + "px";
  openMenu = m;
};

// OS-aware label for the reveal action (Explorer / Finder / Files).
function revealLabel() {
  var name = DN.ROOT_INFO.platform === "win32" ? "File Explorer"
    : DN.ROOT_INFO.platform === "darwin" ? "Finder"
    : "Files";
  return "\u2197  Reveal in " + name;
}

DN.makeKebab = function (entry) { // entry: {path, isFolder, labelEl}
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dl-act";
  btn.title = "More actions";
  btn.setAttribute("aria-label", "Actions for " + entry.path);
  btn.textContent = "\u22ef"; // ⋯
  btn.addEventListener("dblclick", function (e) { e.stopPropagation(); });
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    e.preventDefault();
    if (openMenu) { DN.closeMenu(); return; }
    DN.showMenu(btn, [
      { label: "\u29c9  Copy path", onClick: function () {
          DN.copyText(entry.path, "Copied: " + entry.path);
        } },
      { label: "\u29c9  Copy full path", onClick: function () {
          var abs = DN.ROOT_INFO.root ? DN.ROOT_INFO.root.replace(/[\\/]+$/, "") + DN.ROOT_INFO.sep + entry.path.split("/").join(DN.ROOT_INFO.sep) : entry.path;
          DN.copyText(abs, "Copied: " + abs);
        } },
      { label: revealLabel(), onClick: function () {
          fetch("/__reveal__", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: entry.path })
          }).catch(function () {});
        } },
      { label: "\u21c4  Move to\u2026", onClick: function () { DN.showMovePopover(btn, entry); } },
      { label: "\u2715  Delete", danger: true, armed: true, onClick: function () { DN.doDelete(entry); } }
    ]);
  });
  return btn;
};

// Installed once, at boot (nav.js). The iframe covers most of the page —
// clicks and ESC there never bubble up to the shell's document. Close the
// menu when focus moves into it, and hook the iframe's own keydown after
// every load (the doc is swapped on navigation).
DN.menuInit = function (iframe) {
  document.addEventListener("click", function (e) {
    if (openMenu && !openMenu.contains(e.target)) DN.closeMenu();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") DN.closeMenu(); });
  window.addEventListener("blur", function () { DN.closeMenu(); });
  if (iframe) iframe.addEventListener("load", function () {
    try { iframe.contentDocument.addEventListener("keydown", function (e) { if (e.key === "Escape") DN.closeMenu(); }); }
    catch (e) {} // cross-origin doc: the blur hook above still covers it
  });
};
