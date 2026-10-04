// The built-in shell, served when a folder has no index.html.
// Minimal, light, pleasant. The nav client renders the tree into #docList.

const SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Docs</title>
<style>
:root{--bg:#fff;--panel:#f6f7f9;--text:#1f2329;--soft:#5b6472;--border:#d9dee6;--accent:#1f6feb;--accent-soft:#e8f0fe}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--text);background:var(--bg);display:flex;flex-direction:column}
header.top{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid var(--border);background:var(--panel);font-weight:700}
#dl-title{cursor:text;border-radius:6px;padding:1px 6px;margin-left:-6px}
#dl-title:hover{background:var(--accent-soft)}
.row{display:flex;flex:1;min-height:0}
aside.nav{flex:0 0 260px;border-right:1px solid var(--border);overflow-y:auto;padding:12px 10px;background:var(--bg)}
aside.nav ul{list-style:none;margin:0;padding:0}
main.content{flex:1;min-width:0;background:var(--panel)}
main.content iframe{width:100%;height:100%;border:0;background:var(--bg)}
@media(max-width:760px){aside.nav{flex-basis:78%}}
</style>
</head>
<body>
<header class="top"><span id="dl-title">Docs</span></header>
<div class="row">
  <aside class="nav"><ul id="docList"></ul></aside>
  <main class="content"><iframe name="conteudo" id="conteudo" title="Document" allowfullscreen></iframe></main>
</div>
</body>
</html>`;

module.exports = { SHELL };
