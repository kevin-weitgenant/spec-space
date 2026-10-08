// nav/tree.js — sidebar tree rendering + collapse state + active highlighting.
// The DOM is rebuilt from the manifest tree by nav.js's applyTree (only when
// the entry signature changed); collapse state lives in localStorage.
var DN = window.docsNav;

var collapsed = {};
var hadSavedState = false;
try {
  collapsed = JSON.parse(localStorage.getItem("docs-in-html:collapsed") || "{}");
  hadSavedState = !!localStorage.getItem("docs-in-html:collapsed");
} catch (e) { collapsed = {}; }
function save() { try { localStorage.setItem("docs-in-html:collapsed", JSON.stringify(collapsed)); } catch (e) {} }
function isOpen(p) { return !collapsed[p]; }
DN.isOpen = isOpen;
DN.closeFolderState = function (p) { collapsed[p] = true; save(); };

// default: everything collapsed (first visit / no saved state)
function markAllCollapsed(n) {
  if (n.type === "folder") { collapsed[n.path] = true; (n.children || []).forEach(markAllCollapsed); }
}

DN.renderNode = function (n) {
  if (n.type === "folder") {
    var li = document.createElement("li");
    var hasKids = n.children && n.children.length;
    var head = document.createElement("div");
    head.className = "dl-folder" + (isOpen(n.path) ? "" : " closed");
    head.dataset.path = n.path;
    head.dataset.name = n.name;
    var chev = DN.chevEl();
    if (!hasKids) chev.style.visibility = "hidden"; // nothing to collapse
    head.appendChild(chev);
    var ico = DN.iconEl(n.icon, true);
    if (ico) head.appendChild(ico);
    var label = document.createElement("span");
    label.className = "dl-label";
    label.textContent = n.name;
    head.appendChild(label);
    var entry = { path: n.path, isFolder: true, labelEl: label };
    head.addEventListener("click", function (e) {
      if (head.classList.contains("dl-edit")) return; // renaming
      collapsed[n.path] = isOpen(n.path); // toggle
      save();
      head.classList.toggle("closed", !isOpen(n.path)); // CSS does the animating
    });
    // double-click a folder name → rename it (desktop convention)
    head.addEventListener("dblclick", function (e) {
      e.preventDefault();
      if (DN.EXPORT) return; // read-only in the static export
      if (!head.classList.contains("dl-edit")) DN.startRename(entry);
    });
    li.appendChild(head);
    if (!DN.EXPORT) {
      head.appendChild(DN.makeKebab(entry));
      DN.enableDrag(li, entry);
    }
    if (hasKids) {
      var wrap = document.createElement("div"); // animated "frame" around the list
      wrap.className = "dl-wrap";
      var ul = document.createElement("ul");
      ul.className = "dl-nested";
      n.children.forEach(function (c) { ul.appendChild(DN.renderNode(c)); });
      wrap.appendChild(ul);
      li.appendChild(wrap);
    }
    return li;
  }
  var li2 = document.createElement("li");
  var a = document.createElement("a");
  a.href = DN.BASEP + "/" + n.path;
  a.setAttribute("draggable", "false"); // links drag natively — kills our mousemove drag
  a.dataset.path = n.path;
  var label2 = document.createElement("span");
  label2.className = "dl-label";
  label2.textContent = n.name;
  a.appendChild(label2);
  var entry2 = { path: n.path, isFolder: false, labelEl: label2 };
  a.addEventListener("click", function (e) {
    if (a.classList.contains("dl-edit")) return; // renaming
    e.preventDefault(); DN.go(n.path);
  });
  // double-click a file name → rename it (desktop convention)
  a.addEventListener("dblclick", function (e) {
    e.preventDefault();
    if (DN.EXPORT) return; // read-only in the static export
    if (!a.classList.contains("dl-edit")) DN.startRename(entry2);
  });
  li2.appendChild(a);
  if (!DN.EXPORT) {
    a.appendChild(DN.makeKebab(entry2));
    DN.enableDrag(li2, entry2);
  }
  return li2;
};

DN.build = function (nodes) {
  if (!hadSavedState) nodes.forEach(markAllCollapsed);
  var frag = document.createDocumentFragment();
  nodes.forEach(function (n) { frag.appendChild(DN.renderNode(n)); });
  DN.list.innerHTML = "";
  DN.list.appendChild(frag);
  DN.badges.apply(); // a rebuild must not lose pending change badges
};

DN.expandFolder = function (p) {
  if (isOpen(p)) return;
  collapsed[p] = false; save();
  var heads = DN.list.querySelectorAll(".dl-folder");
  for (var i = 0; i < heads.length; i++) {
    if (heads[i].dataset.path === p) {
      heads[i].classList.remove("closed"); // CSS does the animating
      break;
    }
  }
};

DN.setActive = function (path) {
  DN.badges.activePath = path;
  DN.badges.markSeen(path); // viewing it = its own inline highlights take over
  var links = DN.list.querySelectorAll("a");
  var found = null;
  for (var i = 0; i < links.length; i++) {
    if (links[i].dataset.path === path) { links[i].classList.add("active"); links[i].classList.remove("dl-changed"); found = links[i]; }
    else links[i].classList.remove("active");
  }
  if (!found) return;
  // expand every ancestor folder
  var node = found;
  while (node && node !== DN.list) {
    var head = node.querySelector(":scope > .dl-folder");
    if (head) {
      var fp = head.dataset.path;
      if (!isOpen(fp)) {
        collapsed[fp] = false; save();
        head.classList.remove("closed"); // CSS does the animating
      }
    }
    node = node.parentElement;
  }
};

DN.firstDoc = function (nodes) {
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].type === "doc") return nodes[i].path;
    if (nodes[i].type === "folder") { var f = DN.firstDoc(nodes[i].children || []); if (f) return f; }
  }
  return null;
};

// Entry-set signature: applyTree (nav.js) rebuilds the DOM only when this
// changes — ordinary content edits keep your collapse/scroll/active state.
DN.signature = function (nodes) {
  var out = [];
  (function walk(arr) {
    (arr || []).forEach(function (n) {
      out.push((n.type === "folder" ? "d:" : "f:") + n.path + (n.icon ? "|" + n.icon : "")); // icon changes rebuild too
      if (n.type === "folder") walk(n.children);
    });
  })(nodes);
  return out.join("|");
};
