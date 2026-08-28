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

  // acha o container `VAR={...}` que engloba a ancora (objeto do bundle)
  function extractByContainer(anchorStr) {
    const a = src.indexOf(anchorStr);
    if (a < 0) throw new Error("nao achei no bundle: " + anchorStr + " (jogo mudou?)");
    for (let i = a; i >= 0; i--) {
      if (src[i] === "{" && src[i - 1] === "=") {
        const blk = matchBalanced(src, i);
        if (i + blk.length > a) return (0, eval)("(" + blk + ")");
      }
    }
    throw new Error("container nao encontrado pra " + anchorStr);
  }

  // Dois catalogos: o de LOOT (name/exp/loot, chave underscore) e o de COMBATE
  // (hp/dmg/armor/resist/abilities, chave com espaco). Junta pelo nome.
  const lootCat = extractByContainer('{troll:{name:"Troll"');
  const combatCat = extractByContainer('"infernal demon":{hp:');
  const norm = s => String(s).replace(/[_-]/g, " ").toLowerCase().trim();

  const merged = {};  // nome-normalizado -> registro
  const put = (k) => (merged[k] = merged[k] || { l: [] });
  for (const id in lootCat) {
    const m = lootCat[id]; if (!m || !m.hp) continue;
    const r = put(norm(m.name || id));
    r.n = m.name || id; r.exp = m.exp || 0; r.sp = m.speed || 0; r.hp = m.hp;
    if (m.loot && m.loot.length) r.l = m.loot.map(x => [x.name, x.chance, x.max || 1]);
    if (m.resist && !r.r) r.r = m.resist;               // fallback
    if (m.abilities && !r.a) r.a = m.abilities;
    if (m.dmg && !r.dm) r.dm = m.dmg;
    if (m.armor && !r.arm) r.arm = m.armor;
  }
  for (const key in combatCat) {                          // combate = autoritativo
    const m = combatCat[key]; if (!m) continue;
    const r = put(norm(key));
    if (!r.n) r.n = key.replace(/\b\w/g, c => c.toUpperCase());
    if (m.hp) r.hp = m.hp;
    if (m.dmg) r.dm = m.dmg;
    if (m.armor) r.arm = m.armor;
    if (m.resist) r.r = m.resist;
    if (m.abilities) r.a = m.abilities;
  }

  const data = [];
  for (const k in merged) {
    const r = merged[k];
    if (!r.hp) continue;
    const hasCombat = r.r || (r.a && r.a.length) || r.dm;
    if (!r.l.length && !hasCombat) continue;              // pula dummy vazio
    data.push({
      n: r.n, hp: r.hp || 0, exp: r.exp || 0, arm: r.arm || 0, sp: r.sp || 0,
      dm: r.dm || null, r: r.r || null,
      a: (r.a || []).map(x => ({
        el: x.element, mn: x.min, mx: x.max, ch: x.chance,
        // tipo do ataque, pra ficar claro o que e cada um
        ty: x.element === "healing" ? "cura"
          : x.length ? "onda"
          : x.radius ? "área"
          : x.missile != null ? "distância"
          : x.target ? "direto"
          : "corpo a corpo",
        // tamanho: raio (area), comprimento x largura (onda), ou alcance
        sz: x.radius ? ("raio " + x.radius)
          : x.length ? (x.length + (x.spread ? "×" + x.spread : "") + " tiles")
          : x.range ? ("alcance " + x.range) : "",
      })),
      l: r.l,
    });
  }
  data.sort((a, b) => a.n.localeCompare(b.n));

  // ---- hunts + recomendacao de arma (ataque) e defesa ----
  let huntsRaw = null;
  for (let i = src.indexOf('[{id:"'); i >= 0; i = src.indexOf('[{id:"', i + 1)) {
    try {
      const arr = (0, eval)("(" + matchBalanced(src, i) + ")");
      if (Array.isArray(arr) && arr[0] && arr[0].minLevel != null && Array.isArray(arr[0].monsters)) { huntsRaw = arr; break; }
    } catch (e) { /* segue procurando */ }
  }
  const ELS = ["fire", "ice", "earth", "energy", "holy", "death"];  // elementais de arma
  const inHunt = new Set();
  const hunts = [];
  for (const h of huntsRaw || []) {
    (h.monsters || []).forEach(k => inHunt.add(norm(k)));
    const mons = (h.monsters || []).map(k => merged[norm(k)]).filter(Boolean);
    // ataque: elemento que os bichos mais TOMAM (menor resist medio)
    const off = ELS.map(el => {
      let s = 0, c = 0;
      for (const m of mons) if (m.r && el in m.r) { s += m.r[el]; c++; }
      return c ? { el, avg: s / c } : null;
    }).filter(Boolean).sort((a, b) => a.avg - b.avg);
    // defesa: elemento que os bichos mais CAUSAM (melee fisico + abilities)
    const th = {};
    for (const m of mons) {
      if (m.dm) th.physical = (th.physical || 0) + (m.dm[1] || 0);
      for (const ab of (m.a || [])) {
        if (!ab.element || ab.element === "healing") continue;
        th[ab.element] = (th[ab.element] || 0) + (ab.chance || 0) * (((ab.min || 0) + (ab.max || 0)) / 2) / 100;
      }
    }
    const def = Object.entries(th).map(([el, v]) => ({ el, v })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    hunts.push({
      id: h.id, name: h.name, lv: h.minLevel || 0,
      mons: mons.map(m => m.n),
      off: off.slice(0, 3).map(x => x.el),
      ofw: off.length && off[0].avg < 0,          // true = fraqueza real (toma dano extra)
      def: def.slice(0, 3).map(x => x.el),
    });
  }
  hunts.sort((a, b) => a.lv - b.lv);
  for (const m of data) m.boss = inHunt.has(norm(m.n)) ? 0 : 1;   // fora de hunt = boss
  console.log("monstros:", data.length, "| bosses:", data.filter(m => m.boss).length, "| hunts:", hunts.length);

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
  tpl = tpl.replace("const HUNTS = __HUNTS__;", "const HUNTS = " + JSON.stringify(hunts) + ";");
  tpl = tpl.replace(/Taxa de drop de <b>\d+<\/b>/, `Taxa de drop de <b>${data.length}</b>`);
  fs.writeFileSync(HERE + "/index.html", tpl);
  console.log("index.html gerado:", fs.statSync(HERE + "/index.html").size, "bytes");
})();
