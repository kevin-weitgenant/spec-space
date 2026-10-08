// nav/rename.js — file/folder mutation: inline edit (rename / new folder),
// delete, move (popover + the shared moveTo the drag & drop reuses).
// (Named "rename" to not collide with client/edit.js, the WYSIWYG editor.)
var DN = window.docsNav;

// target: the element whose text becomes the input (a / .dl-folder div)
// ext: fixed suffix shown next to the input (".html") or "" for folders
DN.startEdit = function (target, initial, ext, onConfirm) {
  var li = target.closest ? target.closest("li") : null;
  if (li) li.classList.add("dl-editing");
  var original = target.textContent;
  target.classList.add("dl-edit");
  target.textContent = "";
  var input = document.createElement("input");
  input.type = "text";
  input.value = initial;
  target.appendChild(input);
  if (ext) {
    var s = document.createElement("span");
    s.className = "dl-ext";
    s.textContent = ext;
    target.appendChild(s);
  }
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  var done = false;
  function finish(value) {
    if (done) return;
    done = true;
    target.classList.remove("dl-edit");
    target.textContent = original; // the manifest refresh will render the truth
    if (li) li.classList.remove("dl-editing");
    if (value != null) onConfirm(value);
  }
  input.addEventListener("keydown", function (e) {
    e.stopPropagation();
    if (e.key === "Enter") finish(input.value);
    else if (e.key === "Escape") finish(null);
  });
  input.addEventListener("blur", function () { setTimeout(function () { finish(input.value); }, 0); });
  input.addEventListener("click", function (e) { e.stopPropagation(); });
  return input;
};

DN.startRename = function (entry) {
  var raw = DN.basename(entry.path);        // raw filename, not the humanized label
  var ext = entry.isFolder ? "" : (raw.match(/\.html?$/i) || [""])[0];
  var stem = ext ? raw.slice(0, -ext.length) : raw;
  var input = DN.startEdit(entry.labelEl, stem, ext, function (name) {
    var n = DN.validName(name, entry.isFolder);
    if (!n) { DN.toast("Invalid name", true); return; }
    var dir = DN.dirname(entry.path);
    var to = (dir ? dir + "/" : "") + n + ext;
    if (to === entry.path) return;
    DN.api("/__rename__", { from: entry.path, to: to }).then(function () {
      DN.afterPathChange(entry.path, to);
      DN.refresh();
    }).catch(function (err) { DN.toast("Rename failed: " + err.message, true); });
  });
  // mark bad input live
  input.addEventListener("input", function () {
    input.classList.toggle("dl-bad", !DN.validName(input.value, entry.isFolder));
  });
};

DN.doDelete = function (entry) {
  DN.api("/__delete__", { path: entry.path }).then(function () {
    var cur = DN.curPath();
    if (cur === entry.path || cur.startsWith(entry.path + "/")) {
      DN.fetchManifest(function (tree) {
        var f = DN.firstDoc(tree);
        if (f) DN.go(f, false);
      });
    }
    DN.refresh();
  }).catch(function (err) {
    DN.toast(entry.isFolder ? "Folder is not empty — move its files out first" : "Delete failed: " + err.message, true);
  });
};

function collectFolders(nodes, skipPath, out, depth) {
  out = out || []; depth = depth || 0;
  (nodes || []).forEach(function (n) {
    if (n.type !== "folder") return;
    if (skipPath && (n.path === skipPath || skipPath.startsWith(n.path + "/"))) return; // self / descendants
    out.push({ path: n.path, name: n.name, depth: depth });
    collectFolders(n.children, skipPath, out, depth + 1);
  });
  return out;
}
DN.collectFolders = collectFolders;

DN.showMovePopover = function (anchor, entry) {
  var curDir = DN.dirname(entry.path);
  var targets = [{ path: "", name: "(root)", depth: -1 }].concat(collectFolders(DN.currentTree, entry.path));
  var pop = document.createElement("div");
  pop.className = "dl-pop";
  targets.forEach(function (t) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = new Array(Math.max(0, t.depth) + 1).join("\u00a0\u00a0") + (t.depth >= 0 ? "\u25b8 " : "") + t.name;
    if (t.path === curDir) b.classList.add("dl-cur");
    b.addEventListener("click", function () {
      removePop();
      DN.moveTo(entry, t.path);
    });
    pop.appendChild(b);
  });
  function removePop() { pop.remove(); document.removeEventListener("click", outside, true); window.removeEventListener("blur", removePop); }
  function outside(e) { if (!pop.contains(e.target)) removePop(); }
  document.addEventListener("click", outside, true);
  window.addEventListener("blur", removePop); // click moved into the iframe
  document.body.appendChild(pop);
  var r = anchor.getBoundingClientRect();
  var pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8)) + "px";
  pop.style.top = (r.bottom + ph > window.innerHeight - 8 ? Math.max(8, r.top - ph) : r.bottom + 4) + "px";
};

DN.moveTo = function (entry, destDir) {
  var to = (destDir ? destDir + "/" : "") + DN.basename(entry.path);
  if (to === entry.path) return; // already there
  DN.api("/__rename__", { from: entry.path, to: to }).then(function () {
    DN.afterPathChange(entry.path, to);
    DN.refresh();
  }).catch(function (err) { DN.toast("Move failed: " + err.message, true); });
};

// If the currently displayed doc was renamed/moved (or lived inside a moved
// folder), update the iframe + address bar so nothing 404s on reload.
DN.afterPathChange = function (from, to) {
  var cur = DN.curPath();
  if (cur === from || cur.startsWith(from + "/")) {
    DN.go(to + cur.slice(from.length), false);
  }
};

// "＋ Folder" toolbar action: optimistic inline-edit row at the top of the
// tree; mkdir only on confirm.
DN.createFolder = function () {
  var li = document.createElement("li");
  var head = document.createElement("div");
  head.className = "dl-folder";
  head.textContent = "New folder";
  li.appendChild(head);
  DN.list.insertBefore(li, DN.list.firstChild);
  DN.startEdit(head, "New folder", "", function (name) {
    li.remove();
    var n = DN.validName(name, true);
    if (!n) { DN.toast("Invalid folder name", true); return; }
    DN.api("/__mkdir__", { path: n }).then(function () {
      DN.refresh();
    }).catch(function (err) { DN.toast("Could not create folder: " + err.message, true); });
  });
};
