// Pure diff core — extracted from client/changes.js so it can be tested with
// node:test (no DOM, no window, no localStorage). Everything here is movement,
// not rewriting: the algorithms are copied verbatim, with two conscious
// differences:
//   1. the UMD guard at the bottom: same file serves <script> (attaches
//      window.DIFF) and require() (module.exports) — zero deps, no bundler
//   2. marks() takes the new-texts list as a parameter instead of reading
//      the `texts` closure variable — closing its only impurity

// ── LCS diff (with common prefix/suffix trim) → ops [{t:' '|'-'|'+', a?, b?}] ──
function diffOps(a, b) {
  var s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  var e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  var A = a.slice(s, a.length - e), B = b.slice(s, b.length - e);
  var n = A.length, m = B.length;
  if (n * m > 4e6) return null; // doc too big to diff gracefully — skip marking
  var dp = new Array(n + 1);
  for (var i = n; i >= 0; i--) {
    dp[i] = new Uint32Array(m + 1);
    if (i === n) continue; // dp[n] stays all-zero (base row)
    for (var j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  var ops = [], i2 = 0, j2 = 0;
  while (i2 < n && j2 < m) {
    if (A[i2] === B[j2]) { ops.push({ t: " ", a: s + i2, b: s + j2 }); i2++; j2++; }
    else if (dp[i2 + 1][j2] >= dp[i2][j2 + 1]) { ops.push({ t: "-", a: s + i2 }); i2++; }
    else { ops.push({ t: "+", b: s + j2 }); j2++; }
  }
  while (i2 < n) ops.push({ t: "-", a: s + i2++ });
  while (j2 < m) ops.push({ t: "+", b: s + j2++ });
  return ops;
}

// token-level diff for word highlights inside an edited block
function wordDiff(oldS, newS) {
  var ta = oldS.split(/(\s+)/), tb = newS.split(/(\s+)/);
  var ops = diffOps(ta, tb);
  if (!ops) return null;
  var out = [];
  for (var i = 0; i < ops.length; i++) {
    var o = ops[i];
    var tok = o.t === "-" ? ta[o.a] : o.t === "+" ? tb[o.b] : ta[o.a];
    if (!tok) continue;
    if (/^\s+$/.test(tok) && o.t !== " ") tok = " "; // collapse whitespace-only del/ins
    out.push({ t: o.t, s: tok });
  }
  return out;
}

function similarity(a, b) {
  var wa = a.toLowerCase().split(/\s+/), wb = b.toLowerCase().split(/\s+/);
  var set = {};
  wa.forEach(function (w) { set[w] = (set[w] || 0) + 1; });
  var hit = 0;
  wb.forEach(function (w) { if (set[w] > 0) { set[w]--; hit++; } });
  return hit / Math.max(wa.length, wb.length, 1);
}

// ── decide marks from ops: pair adjacent -/+ runs into "edited" when similar ──
function marks(ops, oldTexts, newTexts) {
  var out = []; // {b, kind:'new'|'edit', old?}
  // old blocks already "accounted for" (matched in place, or consumed below) —
  // an added block whose text matches an unaccounted old one is a MOVE, not new.
  var used = new Array(oldTexts.length).fill(false);
  for (var u = 0; u < ops.length; u++) if (ops[u].t === " ") used[ops[u].a] = true;
  var pool = {}; // unused old text → index (multiset via counts)
  for (var p = 0; p < oldTexts.length; p++)
    if (!used[p]) { (pool[oldTexts[p]] = pool[oldTexts[p]] || []).push(p); }
  function takeMoved(t) {
    var q = pool[t];
    if (q && q.length) return q.shift() + 1; // truthy index
    return 0;
  }
  var i = 0;
  while (i < ops.length) {
    if (ops[i].t !== "-") {
      if (ops[i].t === "+" && !takeMoved(newTexts[ops[i].b])) out.push({ b: ops[i].b, kind: "new" });
      i++;
      continue;
    }
    var dels = [];
    while (i < ops.length && ops[i].t === "-") dels.push(ops[i++]);
    var adds = [];
    while (i < ops.length && ops[i].t === "+") adds.push(ops[i++]);
    for (var k = 0; k < adds.length; k++) {
      var bi = adds[k].b, newT = newTexts[bi], old = null;
      var moved = takeMoved(newT);
      if (moved) continue; // block was moved/rewritten position — not a change
      for (var d = 0; d < dels.length; d++)
        if (dels[d] !== null && similarity(oldTexts[dels[d].a], newT) > 0.4) { old = oldTexts[dels[d].a]; dels[d] = null; break; }
      out.push(old ? { b: bi, kind: "edit", old: old } : { b: bi, kind: "new" });
    }
    // pure deletions: nothing to mark in the new DOM
  }
  return out;
}

// UMD guard: browser (<script> — no `module`) attaches window.DIFF, which
// changes.js consumes; Node (require) gets module.exports for node:test.
if (typeof module !== "undefined" && module.exports)
  module.exports = { diffOps: diffOps, wordDiff: wordDiff, similarity: similarity, marks: marks };
else
  window.DIFF = { diffOps: diffOps, wordDiff: wordDiff, similarity: similarity, marks: marks };
