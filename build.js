/* Gera index.html: baixa o bundle atual do Baiak, extrai o catalogo de monstros
   (loot table) e injeta no template.html. Rodado pelo workflow de auto-refresh. */
const fs = require("fs");

function matchBalanced(s, start) {
  const o = s[start], c = o === "{" ? "}" : "]";
  let d = 0, inStr = false, q = "";
  for (let i = start; i < s.length; i++) {
    const ch = s[i], p = s[i - 1];
    if (inStr) { if (ch === q && p !== "\\") inStr = false; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = true; q = ch; continue; }
    if (ch === o) d++;
    else if (ch === c) { d--; if (d === 0) return s.slice(start, i + 1); }
  }
  throw new Error("delimitador sem par");
}

(async () => {
  const UA = { "user-agent": "Mozilla/5.0 baiak-drops-builder" };
  // 1) acha o bundle atual (o hash muda entre versoes do jogo)
  const page = await (await fetch("https://baiakidle.com/jogar/", { headers: UA })).text();
  const m = page.match(/\/jogar\/assets\/index-[^"']+\.js/);
  if (!m) throw new Error("bundle nao encontrado na pagina");
  console.log("bundle:", m[0]);
  const src = await (await fetch("https://baiakidle.com" + m[0], { headers: UA })).text();

  // 2) extrai o catalogo de monstros (anchor no Troll) e monta o array compacto
  const anchor = src.indexOf('{troll:{name:"Troll"');
  if (anchor < 0) throw new Error("catalogo de monstros nao encontrado (jogo mudou?)");
  const mons = (0, eval)("(" + matchBalanced(src, anchor) + ")");
  const out = [];
  for (const id in mons) {
    const mm = mons[id];
    if (!mm || !mm.loot || !mm.loot.length) continue;
    out.push({ n: mm.name || id, hp: mm.hp || 0, exp: mm.exp || 0,
      l: mm.loot.map(x => [x.name, x.chance, x.max || 1]) });
  }
  out.sort((a, b) => a.n.localeCompare(b.n));
  console.log("monstros com loot:", out.length);

  // 3) injeta no template e grava index.html (atualiza a contagem no texto)
  let tpl = fs.readFileSync(__dirname + "/template.html", "utf8");
  tpl = tpl.replace("const M = __DATA__;", "const M = " + JSON.stringify(out) + ";");
  tpl = tpl.replace(/Taxa de drop de <b>\d+<\/b>/, `Taxa de drop de <b>${out.length}</b>`);
  fs.writeFileSync(__dirname + "/index.html", tpl);
  console.log("index.html gerado:", fs.statSync(__dirname + "/index.html").size, "bytes");
})();
