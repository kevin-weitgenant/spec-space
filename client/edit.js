// spec-space inline editor — injected into every doc (not the shell).
// A small "Editar" toggle (fixed, top-right) turns the rendered document into
// a WYSIWYG surface via contenteditable: click any text, type, Ctrl+S saves the
// page back to its file through POST /__save__. The user never sees HTML.
(function () {
  // The shell (sidebar + iframe) is not an editable doc.
  if (document.getElementById("docList")) return;
  var BASE = window.DOCS_BASE || ""; // "" single-root, "/<slug>/" under the manager
  var me = location.pathname.replace(/^\/+/, "") || "index.html";
  // strip the manager prefix so /__save__ gets the path relative to the docs root
  var baseRel = decodeURI(BASE).replace(/^\/+|\/+$/g, "");
  if (baseRel && me.toLowerCase().indexOf(baseRel.toLowerCase() + "/") === 0)
    me = me.slice(baseRel.length + 1) || "index.html";
  if (!/\.html?$/i.test(me)) return; // only edit real docs

  var editing = false;
  var dirty = false;
  var justSaved = false;

  // ── UI (everything we create carries data-injected so saving can strip it) ──
  var style = document.createElement("style");
  style.setAttribute("data-injected", "");
  style.textContent =
    ".dl-edit-toggle{position:fixed;top:12px;right:14px;z-index:1000;font:700 .8rem -apple-system,'Segoe UI',Roboto,sans-serif;" +
    "padding:6px 14px;border-radius:999px;border:1px solid #d9dee6;background:#fff;color:#5b6472;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.12)}" +
    ".dl-edit-toggle:hover{background:#f6f7f9}" +
    ".dl-edit-toggle.on{background:#1f6feb;border-color:#1f6feb;color:#fff}" +
    ".dl-edit-toggle.dirty{border-color:#cf222e;color:#cf222e}" +
    ".dl-edit-toggle.dirty.on{background:#cf222e;border-color:#cf222e;color:#fff}" +
    "body[contenteditable] :is(h1,h2,h3,h4,p,li,td,th,caption,figcaption,blockquote){outline:1px dashed transparent;outline-offset:3px;transition:outline-color .1s}" +
    "body[contenteditable] :is(h1,h2,h3,h4,p,li,td,th,caption,figcaption,blockquote):hover{outline-color:#93b4f5}" +
    "body[contenteditable] pre{outline:1px dashed #93b4f5;outline-offset:3px}";

  var btn = document.createElement("button");
  btn.setAttribute("data-injected", "");
  btn.type = "button";
  btn.className = "dl-edit-toggle";
  btn.textContent = "✏ Editar";
  btn.title = "Editar este documento (Ctrl+E) — Ctrl+S para salvar";

  function mount() {
    if (!document.body) return document.addEventListener("DOMContentLoaded", mount), false;
    document.head && document.head.appendChild(style);
    document.body.appendChild(btn);
    return true;
  }

  // ── edit mode ────────────────────────────────────────────────────────────
  function startEdit() {
    editing = true;
    dirty = false;
    btn.classList.add("on");
    btn.classList.remove("dirty");
    btn.textContent = "✏ Editando — Ctrl+S salva";
    btn.contentEditable = "false";
    document.body.setAttribute("contenteditable", "true");
    // code blocks: edit as plain text so Enter/space don't inject tags
    document.querySelectorAll("pre").forEach(function (p) {
      p.setAttribute("contenteditable", "plaintext-only");
    });
  }

  function stopEdit(reload) {
    editing = false;
    dirty = false;
    if (reload) { justSaved = true; location.reload(); return; }
    document.body.removeAttribute("contenteditable");
    document.querySelectorAll("pre[contenteditable]").forEach(function (p) {
      p.removeAttribute("contenteditable");
    });
    btn.classList.remove("on", "dirty");
    btn.textContent = "✏ Editar";
  }

  // ── save ─────────────────────────────────────────────────────────────────
  function serialize() {
    var clone = document.documentElement.cloneNode(true);
    // strip everything the viewer injected (script tags, this toggle, styles)
    clone.querySelectorAll("[data-injected]").forEach(function (el) { el.remove(); });
    // strip edit-mode attributes: the page is serialized mid-edit, so the body
    // still carries contenteditable=true (and pre's plaintext-only) — leaving
    // them in would bake "editable without the toggle" into the file on disk.
    var body = clone.querySelector("body");
    if (body) body.removeAttribute("contenteditable");
    clone.querySelectorAll("pre[contenteditable]").forEach(function (p) {
      p.removeAttribute("contenteditable");
    });
    var doctype = document.doctype
      ? "<!DOCTYPE " + document.doctype.name +
        (document.doctype.publicId ? ' PUBLIC "' + document.doctype.publicId + '"' : "") +
        (document.doctype.systemId ? ' "' + document.doctype.systemId + '"' : "") + ">\n"
      : "<!DOCTYPE html>\n";
    return doctype + clone.outerHTML;
  }

  function save() {
    if (!editing) return;
    var html = serialize();
    fetch(BASE.replace(/\/+$/, "") + "/__save__", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: me, html: html }),
    }).then(function (r) {
      if (!r.ok) throw new Error("save failed: " + r.status);
      return r.json();
    }).then(function () {
      // the file watcher will also fire a reload — harmless once we reload first
      stopEdit(true);
    }).catch(function (e) {
      alert("Não foi possível salvar: " + e.message);
    });
  }

  // ── events ───────────────────────────────────────────────────────────────
  btn.addEventListener("click", function () {
    if (editing) {
      if (dirty && !confirm("Há alterações não salvas. Descartar e sair do modo edição?")) return;
      stopEdit(false);
    } else {
      startEdit();
    }
  });

  document.addEventListener("input", function () {
    if (!editing || dirty) return;
    dirty = true;
    btn.classList.add("dirty");
  });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      if (!editing) return;
      e.preventDefault();
      save();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
      e.preventDefault();
      btn.click();
    }
    if (e.key === "Escape" && editing && !dirty) stopEdit(false);
  });

  window.addEventListener("beforeunload", function (e) {
    if (editing && dirty && !justSaved) { e.preventDefault(); e.returnValue = ""; }
  });

  mount();
})();
