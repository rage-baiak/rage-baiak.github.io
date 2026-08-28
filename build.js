/* Gera index.html: baixa o bundle atual do Baiak, extrai o catalogo de monstros
   (loot table), COMPARA com o snapshot anterior (data.json) pra detectar nerf/buff,
   e injeta drops + mudancas no template.html. Rodado pelo workflow de auto-refresh. */
const fs = require("fs");
const HERE = __dirname;

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

function readJSON(f, def) {
  try { return JSON.parse(fs.readFileSync(HERE + "/" + f, "utf8")); } catch { return def; }
}

// monstro -> {item: chance}
function chanceMap(data) {
  const map = {};
  for (const m of data) { const mm = {}; for (const [n, c] of m.l) mm[n] = c; map[m.n] = mm; }
  return map;
}

function diff(oldD, newD) {
  const O = chanceMap(oldD), N = chanceMap(newD);
  const nerf = [], buff = [], add = [], rem = [], newmon = [], remmon = [];
  for (const mon in N) {
    if (!(mon in O)) { newmon.push([mon, Object.keys(N[mon]).length]); continue; }
    const on = O[mon], nn = N[mon];
    for (const it in nn) {
      if (!(it in on)) add.push([mon, it, nn[it]]);
      else if (on[it] !== nn[it]) (nn[it] < on[it] ? nerf : buff).push([mon, it, on[it], nn[it]]);
    }
    for (const it in on) if (!(it in nn)) rem.push([mon, it]);
  }
  for (const mon in O) if (!(mon in N)) remmon.push([mon]);
  return { nerf, buff, add, rem, newmon, remmon };
}

(async () => {
  const UA = { "user-agent": "Mozilla/5.0 baiak-drops-builder" };
  const page = await (await fetch("https://baiakidle.com/jogar/", { headers: UA })).text();
  const bm = page.match(/\/jogar\/assets\/index-[^"']+\.js/);
  if (!bm) throw new Error("bundle nao encontrado");
  console.log("bundle:", bm[0]);
  const src = await (await fetch("https://baiakidle.com" + bm[0], { headers: UA })).text();

  const anchor = src.indexOf('{troll:{name:"Troll"');
  if (anchor < 0) throw new Error("catalogo de monstros nao encontrado (jogo mudou?)");
  const mons = (0, eval)("(" + matchBalanced(src, anchor) + ")");
  const data = [];
  for (const id in mons) {
    const m = mons[id];
    if (!m || !m.loot || !m.loot.length) continue;
    data.push({ n: m.name || id, hp: m.hp || 0, exp: m.exp || 0,
      l: m.loot.map(x => [x.name, x.chance, x.max || 1]) });
  }
  data.sort((a, b) => a.n.localeCompare(b.n));
  console.log("monstros com loot:", data.length);

  // diff vs snapshot anterior
  const prev = readJSON("data.json", null);
  let changes = readJSON("changes.json", []);
  if (prev) {
    const d = diff(prev, data);
    const total = d.nerf.length + d.buff.length + d.add.length + d.rem.length + d.newmon.length + d.remmon.length;
    if (total > 0) {
      const day = new Date().toISOString().slice(0, 10);
      // se ja tem entrada de hoje, funde (rerun no mesmo dia)
      changes = changes.filter(c => c.d !== day);
      changes.unshift({ d: day, ...d });
      changes = changes.slice(0, 40);
      console.log(`mudancas: ${d.nerf.length} nerf, ${d.buff.length} buff, ${d.add.length} add, ${d.rem.length} rem`);
    } else {
      console.log("nenhuma mudanca de drop.");
    }
  } else {
    console.log("primeiro build — sem baseline pra comparar (proximo run ja detecta).");
  }

  fs.writeFileSync(HERE + "/data.json", JSON.stringify(data));
  fs.writeFileSync(HERE + "/changes.json", JSON.stringify(changes));

  let tpl = fs.readFileSync(HERE + "/template.html", "utf8");
  tpl = tpl.replace("const M = __DATA__;", "const M = " + JSON.stringify(data) + ";");
  tpl = tpl.replace("const CHANGES = __CHANGES__;", "const CHANGES = " + JSON.stringify(changes) + ";");
  tpl = tpl.replace(/Taxa de drop de <b>\d+<\/b>/, `Taxa de drop de <b>${data.length}</b>`);
  fs.writeFileSync(HERE + "/index.html", tpl);
  console.log("index.html gerado:", fs.statSync(HERE + "/index.html").size, "bytes");
})();
