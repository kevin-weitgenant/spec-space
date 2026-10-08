// nav/dnd.js — pointer-based drag & drop: a "ghost" of the row follows the
// cursor, folders light up as targets, collapsed folders auto-expand on
// hover, and dropping on a file row reorders (inserts before it).
var DN = window.docsNav;

var drag = null; // {entry, li, ghost, startX, startY, active, target, openTimer}

function canDrop(t) {
  if (!drag || !t) return false;
  if (t.kind === "folder") {
    if (t.path === drag.entry.path) return false;
    if (drag.entry.isFolder && t.path.startsWith(drag.entry.path + "/")) return false; // folder into itself
    return DN.dirname(drag.entry.path) !== t.path; // no-op move → refuse
  }
  if (t.kind === "root") return DN.dirname(drag.entry.path) !== "";
  return true; // file target = reorder (and/or move) before that file
}

function clearDropHints() {
  var els = document.querySelectorAll(".dl-drop, .dl-ins");
  for (var i = 0; i < els.length; i++) els[i].classList.remove("dl-drop", "dl-ins");
}

function setDropTarget(t) {
  if (drag.target && t && drag.target.kind === t.kind && drag.target.path === t.path && drag.target.li === t.li) return;
  clearDropHints();
  if (drag.openTimer) { clearTimeout(drag.openTimer); drag.openTimer = null; }
  drag.target = t;
  if (!t) return;
  if (t.kind === "folder") {
    t.el.classList.add("dl-drop");
    drag.openTimer = setTimeout(function () { DN.expandFolder(t.path); }, 600);
  } else if (t.kind === "file") {
    t.el.classList.add("dl-ins"); // blue insertion line above the row
  } else {
    t.el.classList.add("dl-drop"); // the panel itself → root
  }
}

function onDragMove(e) {
  if (!drag) return;
  if (!drag.active) {
    if (Math.abs(e.clientX - drag.startX) < 5 && Math.abs(e.clientY - drag.startY) < 5) return;
    drag.active = true;
    drag.ghost = document.createElement("div");
    drag.ghost.className = "dl-ghost";
    drag.ghost.textContent = (drag.entry.isFolder ? "\ud83d\udcc1 " : "\ud83d\udcc4 ") + DN.basename(drag.entry.path);
    document.body.appendChild(drag.ghost);
    drag.li.classList.add("dl-dragging");
    document.body.classList.add("dl-grabbing");
  }
  drag.ghost.style.left = (e.clientX + 14) + "px";
  drag.ghost.style.top = (e.clientY + 12) + "px";
  drag.ghost.style.display = "none";
  var el = document.elementFromPoint(e.clientX, e.clientY);
  drag.ghost.style.display = "";
  var t = null;
  if (el && !drag.li.contains(el)) {
    var li = el.closest ? el.closest("#docList li") : null;
    if (li && li !== drag.li) {
      var head = li.querySelector(":scope > .dl-folder");
      if (head) {
        t = { kind: "folder", path: head.dataset.path, el: head, li: li }; // drop into the folder
      } else {
        var a = li.querySelector(":scope > a");
        if (a) t = { kind: "file", path: a.dataset.path, el: li, li: li }; // reorder before this file
      }
    }
  }
  if (!t && el && DN.navAside && DN.navAside.contains(el) && !drag.li.contains(el)) {
    t = { kind: "root", path: "", el: DN.list, li: null }; // empty space → root
  }
  if (t && !canDrop(t)) t = null;
  setDropTarget(t);
}

function onDragUp() {
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragUp);
  var d = drag; drag = null;
  if (!d) return;
  if (d.openTimer) clearTimeout(d.openTimer);
  if (d.ghost) d.ghost.remove();
  d.li.classList.remove("dl-dragging");
  document.body.classList.remove("dl-grabbing");
  clearDropHints();
  if (d.active && d.target) {
    if (d.target.kind === "file") doReorder(d.entry, d.target);
    else DN.moveTo(d.entry, d.target.path);
  }
}

// Drop on a file row = "insert before it" (reorder inside the same folder,
// or move to that folder + reorder when coming from elsewhere).
function doReorder(entry, target) {
  var dir = DN.dirname(target.path);
  var names = [];
  var lis = target.li.parentElement.querySelectorAll(":scope > li");
  for (var i = 0; i < lis.length; i++) {
    var a = lis[i].querySelector(":scope > a");
    var h = lis[i].querySelector(":scope > .dl-folder");
    if (a) names.push(DN.basename(a.dataset.path));
    else if (h) names.push(DN.basename(h.dataset.path));
  }
  var dragName = DN.basename(entry.path);
  names = names.filter(function (n) { return n !== dragName; });
  var idx = names.indexOf(DN.basename(target.path));
  if (idx < 0) idx = names.length;
  names.splice(idx, 0, dragName);
  var from = entry.path;
  var to = (dir ? dir + "/" : "") + dragName;
  var step = from === to ? Promise.resolve() : DN.api("/__rename__", { from: from, to: to });
  step.then(function () {
    return DN.api("/__order__", { folder: dir, order: names });
  }).then(function () {
    DN.afterPathChange(from, to);
    DN.refresh();
  }).catch(function (err) { DN.toast("Reorder failed: " + err.message, true); });
}

DN.enableDrag = function (li, entry) {
  li.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest("button, input, .dl-edit")) return;
    if (li.classList.contains("dl-editing")) return;
    e.stopPropagation(); // the innermost row (file) wins — don't let ancestor folders hijack
    drag = { entry: entry, li: li, startX: e.clientX, startY: e.clientY, active: false, target: null, openTimer: null };
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragUp);
    e.preventDefault(); // no text selection while dragging
  });
};
