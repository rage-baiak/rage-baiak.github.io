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

// Catalogo de EQUIPAMENTO (oa): todo item com `slot`, dropando ou nao. Ancorado por
// conteudo estavel ("leather helmet") e nao por nome de var (que re-minifica).
const EQUIP_SLOTS = { weapon: "Arma", shield: "Escudo", armor: "Armadura", helmet: "Elmo", legs: "Pernas", boots: "Botas", ring: "Anel", amulet: "Amuleto" };
function extractEquip(src) {
  const anchor = src.indexOf('"leather helmet":{id:');
  if (anchor < 0) throw new Error("catalogo de equip nao encontrado (jogo mudou o bundle?)");
  let blk = null;
  for (let i = anchor; i >= anchor - 4000000 && i >= 0; i--) {
    if (src[i] === "{" && src[i - 1] === "=") {
      const b = matchBalanced(src, i);
      if (i + b.length > anchor) { blk = b; break; }
    }
  }
  if (!blk) throw new Error("container do catalogo de equip nao delimitado");
  const oa = (0, eval)("(" + blk + ")");
  const idByName = {};
  for (const [name, it] of Object.entries(oa)) if (it && typeof it === "object" && it.id) idByName[name.replace(/[_-]/g, " ").toLowerCase().trim()] = it.id;
  const out = [];
  for (const [name, it] of Object.entries(oa)) {
    if (!it || typeof it !== "object" || !EQUIP_SLOTS[it.slot]) continue;
    out.push({
      n: name, id: it.id || 0, slot: it.slot, lv: it.level || 0, voc: it.vocs || null,
      atk: it.atk || 0, def: it.def || 0, arm: it.arm || 0,
      wt: it.wt || null, two: it.twoHanded ? 1 : 0,
      el: it.elementType || null, elA: it.elementAtk || 0, range: it.range || 0,
      r: it.absorb || null, mel: it.magicEl || null, sk: it.skills || null,
      cc: it.critChance || 0, cd: it.critDmg || 0, ll: it.lifeLeech || 0, ml: it.manaLeech || 0,
      ms: it.moveSpeed || 0, hpr: it.hpRegen || 0, mpr: it.mpRegen || 0, refl: it.reflect || 0,
      imb: it.imb && it.imb.slots ? it.imb.slots : 0, dur: it.durationSec || 0,
    });
  }
  out.sort((a, b) => a.slot.localeCompare(b.slot) || a.lv - b.lv || a.n.localeCompare(b.n));
  return { equip: out, idByName };
}

// Monta o catalogo final `It` do jogo, descobrindo os nomes minificados por ESTRUTURA
// (nao por nome fixo — o bundle re-minifica a cada deploy e embaralha os nomes de objeto).
function assembleCatalog(src) {
  const need = (re, what) => { const m = re.exec(src); if (!m) throw new Error("estrutura nao encontrada: " + what + " (o jogo mudou o bundle?)"); return m; };
  const objByName = (name) => { const m = need(new RegExp("\\b" + name + "=([{\\[])"), name); return matchBalanced(src, m.index + name.length + 1); };

  // nomes de objeto (mudam por build) — descobertos por conteudo/estrutura estavel
  const ixName = need(/([A-Za-z_$][\w$]*)=\{troll:\{name:"Troll"/, "catalogo base ix")[1];
  const DbName = need(new RegExp("=" + ixName + "\\[\\w+\\],\\w+=([\\w$]+)\\[\\w+\\.name\\.toLowerCase"), "override Db")[1];
  const gdeName = need(/const ([\w$]+)=\{training_machine/, "escala gde")[1];
  const w = need(/([\w$]+)=Object\.fromEntries\(([\w$]+)\.map\(\w+=>\[\w+,([\w$]+)\[([\w$]+)\[\w+\]\?\?""\]\?\?1\]\)\)/, "wde/IG/yde/NG");
  const IGName = w[2], ydeName = w[3], NGName = w[4];

  // helpers chamados dentro do gde (nomes de funcao, ex: gn/Pt/At) — extrai o source de cada
  const gdeSrc = matchBalanced(src, src.indexOf("{", src.indexOf("const " + gdeName + "=")));
  const helperNames = [...new Set([...gdeSrc.matchAll(/\.\.\.([\w$]+)\(/g)].map(m => m[1]))];
  const helperSrc = helperNames.map(fn => {
    const i = src.indexOf("function " + fn + "(");
    if (i < 0) throw new Error("helper nao encontrado no bundle: " + fn);
    const bodyStart = src.indexOf("{", src.indexOf(")", i));
    return "function " + fn + src.slice(src.indexOf("(", i), bodyStart) + matchBalanced(src, bodyStart);
  }).join("\n");

  const blob = `
    const ${ixName}=${objByName(ixName)};
    const ${DbName}=${objByName(DbName)};
    ${helperSrc}
    const ${gdeName}=${gdeSrc};
    const ${IGName}=${objByName(IGName)}, ${ydeName}=${objByName(ydeName)}, ${NGName}=${objByName(NGName)};
    const __wm=Object.fromEntries(${IGName}.map(e=>[e,${ydeName}[${NGName}[e]??""]??1]));
    return { ix:${ixName}, Db:${DbName}, gde:${gdeName}, wde:__wm };
  `;
  const G = new Function(blob)();

  const It = {};
  for (const [k, t] of Object.entries(G.ix)) {
    if (!t || !t.hp) continue;
    const a = G.Db[t.name.toLowerCase()] || {}, n = G.gde[k] || {}, o = G.wde[k] ?? 1;
    It[k] = { ...t, ...a, ...n, ...(o !== 1 ? { exp: Math.round(t.exp * o) } : {}) };
  }
  return It;
}

// monstro -> {item: chance}
function chanceMap(data) {
  const map = {};
  for (const m of data) { const mm = {}; for (const [n, c] of m.l) mm[n] = c; map[m.n] = mm; }
  return map;
}

// Bosses de raid/world que vivem so no catalogo de combate (Db) e NAO estao no catalogo
// ja montado (`haveNames`). Tem combate (hp/dmg/resist/ataques), sem loot.
function extractRaidBosses(src, haveNames) {
  const ixName = (/([A-Za-z_$][\w$]*)=\{troll:\{name:"Troll"/.exec(src) || [])[1];
  if (!ixName) return [];
  const DbName = (new RegExp("=" + ixName + "\\[\\w+\\],\\w+=([\\w$]+)\\[\\w+\\.name\\.toLowerCase").exec(src) || [])[1];
  if (!DbName) return [];
  const nrm = s => String(s).replace(/[_-]/g, " ").toLowerCase().trim();
  const m0 = new RegExp("\\b" + DbName + "=\\{").exec(src);
  const Db = (0, eval)("(" + matchBalanced(src, m0.index + DbName.length + 1) + ")");
  const out = [];
  for (const [key, m] of Object.entries(Db)) {
    if (!m || !m.hp || haveNames.has(nrm(key))) continue;
    if (!m.resist && !(m.abilities && m.abilities.length) && !m.dmg) continue;
    out.push({ key, m });
  }
  return out;
}
const titleCase = s => s.replace(/(^|\s)\w/g, c => c.toUpperCase());

// Catalogo de MAGIAS: extrai a cadeia `const hh=...,IP=...,yr=[...]` inteira (com as
// FUNCOES de dano/cura) e devolve um IIFE que retorna o array. Injetado cru na pagina
// pra as formulas rodarem ao vivo (JSON perderia as funcoes). Ancorado por conteudo.
function extractSpellsSrc(src) {
  const anchor = src.indexOf('[{words:"exura"');
  if (anchor < 0) throw new Error("catalogo de magias nao encontrado (jogo mudou o bundle?)");
  const arrName = (/([A-Za-z_$][\w$]*)=\[\{words:"exura"/.exec(src) || [])[1];
  if (!arrName) throw new Error("nome do array de magias nao encontrado");
  const hhIdx = src.lastIndexOf("Math.max(e[0]", anchor);   // helper hh, logo antes do array
  const start = src.lastIndexOf("const ", hhIdx);
  const arrEnd = anchor + matchBalanced(src, anchor).length;
  const chain = src.slice(start, arrEnd);                   // const hh=...,IP=...,<arr>=[...]
  return "(function(){" + chain + ";return " + arrName + ";})()";
}

// Itens compraveis por GOLD: varre as tabelas priceGold do bundle (aneis/amuleto de
// loja, municao, aljavas, bags, pocoes de boost). Chave = nome normalizado. A loja de
// BOSS TOKEN vem do endpoint publico adminConfig.bossShop (server-side), buscada no main.
function extractShopGold(src, norm) {
  const out = {};
  // forma array: {name:"x",priceGold:N}
  let re = /name:"([^"]+)",priceGold:([0-9.eE+]+)/g, m;
  while ((m = re.exec(src))) out[norm(m[1])] = Number(m[2]);
  // forma objeto: "x":{ ...priceGold:N }  (pocoes)
  re = /"([a-z][a-z '.\-]+)":\{[^{}]*?priceGold:([0-9.eE+]+)/g;
  while ((m = re.exec(src))) { const k = norm(m[1]); if (!(k in out)) out[k] = Number(m[2]); }
  return out;
}

// Forja: dois sistemas. (1) Forja de tier — tabela de custo `tde` + constantes `ka`
// (fusão/convergência/transferência/conversão). (2) Bancada de receitas — linha umbral
// (Ome) e doom (zme), com armas (eV/wM) e multiplicador de custo por tier (Rme).
function extractForge(src) {
  // resolve valores que são identificadores minificados (ex: gold:P6 -> gold:1e8)
  const resolveIdents = s => s.replace(/:([A-Za-z_$][\w$]*)([,}\]])/g, (m, id, tail) => {
    const mm = new RegExp("\\b" + id + "=([0-9][0-9eE.+]*)(?![\\w$])").exec(src);
    return mm ? ":" + mm[1] + tail : m;
  });
  const lit = (openIdx, pre) => {
    if (openIdx < 0) throw new Error("forja: literal nao encontrado");
    let s = matchBalanced(src, openIdx);
    if (pre) s = pre(s);
    return (0, eval)("(" + s + ")");
  };
  const at = (needle) => src.indexOf(needle);

  const cost = lit(src.search(/\{1:\{1:\{gold:\d/));                         // tde
  const ka = lit(at("{dustPerSliverBatch"));                                 // ka
  const stripGain = s => resolveIdents(s.replace(/gain:[A-Za-z_$][\w$]*\("([^"]+)"\)/g, 'gain:"$1"'));
  const umbral = lit(at('[{kind:"umbral",step:1'), resolveIdents);           // Ome
  const doom = lit(at('[{kind:"doom",step:1'), stripGain);                   // zme
  const umbralWeapons = lit(at('[{key:"axe",crude:"crude umbral axe"'));     // eV
  const doomWeapons = lit(at('["inferniarch arbalest","inferniarch battleaxe"')); // wM
  const tmIdx = src.search(/\{0:1,1:1\.5,2:2,3:3,4:4\.5,5:6\}/);
  const tierMult = tmIdx >= 0 ? lit(tmIdx) : { 0: 1, 1: 1.5, 2: 2, 3: 3, 4: 4.5, 5: 6 };

  return {
    tier: { cost, ka },
    bench: {
      tierMult,
      umbral: { weapons: umbralWeapons, steps: umbral },
      doom: { weapons: doomWeapons, steps: doom },
    },
  };
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

  // ---- catalogo final do jogo (It): base ix + Db override + gde (escala hp/dmg/abil) + exp x yde ----
  // Replica o assembler do bundle. `Yne=It` e o catalogo que a UI mostra.
  const norm = s => String(s).replace(/[_-]/g, " ").toLowerCase().trim();
  const It = assembleCatalog(src);

  // charms ofensivos: elemento -> nome do charm (escolhe-se pela fraqueza do bicho).
  // O charm da dano do elemento, entao vale o charm do elemento que o alvo mais TOMA.
  const elemCharm = {};
  for (const m of src.matchAll(/key:"\w+",name:"([^"]+)",category:"\w+",kind:"offensive",element:"(\w+)"/g)) elemCharm[m[2]] = m[1];
  const opm = /key:"overpower",name:"([^"]+)"/.exec(src);
  const sbm = /key:"savage[_a-z]*",name:"([^"]+)"/.exec(src);
  const fhm = /key:"fatal[_a-z]*",name:"([^"]+)"/.exec(src);
  const CHARMS = {
    elem: elemCharm,
    pure: opm ? opm[1] : "Overpower",
    boss: [sbm ? sbm[1] : "Savage Blow", fhm ? fhm[1] : "Fatal Hold"],  // crit no boss da hunt
  };
  console.log("charms:", Object.keys(elemCharm).length, "elementais +", CHARMS.pure, "+ boss", CHARMS.boss.join("/"));

  // rate do servidor (config publica de admin): hp/exp/atk/def por categoria, igual pra todos
  let rate = null;
  try {
    const rr = await fetch("https://baiakidle.com/api/trpc/adminConfig.monsterMult?batch=1&input=%7B%220%22%3A%7B%7D%7D", { headers: UA });
    rate = (await rr.json())[0].result.data.config;
    console.log("rate servidor: monster", JSON.stringify(rate.monster), "| boss", JSON.stringify(rate.boss));
  } catch (e) { console.log("rate do servidor indisponivel, usando base 100%:", e.message); }
  const mul = (v, cat, kind) => rate && rate[cat] ? Math.round(v * (rate[cat][kind] ?? 100) / 100) : v;

  // ---- loja: comprar por gold (bundle) + por boss token (endpoint publico) ----
  const SHOP = {};
  const shopGold = extractShopGold(src, norm);
  for (const [k, v] of Object.entries(shopGold)) (SHOP[k] ||= {}).g = v;
  try {
    const bs = await fetch("https://baiakidle.com/api/trpc/adminConfig.bossShop?batch=1&input=%7B%220%22%3A%7B%7D%7D", { headers: UA });
    const offers = (await bs.json())[0].result.data.config?.offers || [];
    for (const o of offers) if (o && o.name) (SHOP[norm(o.name)] ||= {}).b = o.priceTokens;
    console.log("loja: gold", Object.keys(shopGold).length, "| boss token", offers.length);
  } catch (e) { console.log("bossShop indisponivel:", e.message); }

  // ---- forja (tier + bancada) ----
  let FORGE = null;
  try {
    FORGE = extractForge(src);
    console.log("forja: tier tabela classes", Object.keys(FORGE.tier.cost).join("/"),
      "| bancada umbral", FORGE.bench.umbral.steps.length, "etapas /",
      FORGE.bench.umbral.weapons.length, "armas | doom", FORGE.bench.doom.steps.length, "etapas /",
      FORGE.bench.doom.weapons.length, "armas");
  } catch (e) { console.log("forja indisponivel:", e.message); FORGE = { tier: null, bench: null }; }

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
    (h.monsters || []).forEach(k => inHunt.add(k));
    const mons = (h.monsters || []).map(k => It[k]).filter(Boolean);
    // ataque: elemento que os bichos mais TOMAM (menor resist medio)
    const off = ELS.map(el => {
      let s = 0, c = 0;
      for (const m of mons) if (m.resist && el in m.resist) { s += m.resist[el]; c++; }
      return c ? { el, avg: s / c } : null;
    }).filter(Boolean).sort((a, b) => a.avg - b.avg);
    // defesa: elemento que os bichos mais CAUSAM (melee fisico + abilities)
    const th = {};
    for (const m of mons) {
      if (m.dmg) th.physical = (th.physical || 0) + (m.dmg[1] || 0);
      for (const ab of (m.abilities || [])) {
        if (!ab.element || ab.element === "healing") continue;
        th[ab.element] = (th[ab.element] || 0) + (ab.chance || 0) * (((ab.min || 0) + (ab.max || 0)) / 2) / 100;
      }
    }
    const defRaw = Object.entries(th).map(([el, v]) => ({ el, v })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    const defTot = defRaw.reduce((s, x) => s + x.v, 0);
    const def = defRaw.map(x => ({ el: x.el, pct: defTot ? Math.round(x.v / defTot * 100) : 0 }))
      .filter(x => x.pct > 0).slice(0, 5);
    hunts.push({
      id: h.id, name: h.name, lv: h.minLevel || 0,
      mons: mons.map(m => m.name),
      boss: h.bossKey ? (It[h.bossKey] || {}).name || null : null,   // boss da hunt (Savage Blow + Fatal Hold)
      off: off.slice(0, 3).map(x => x.el),
      ofw: off.length && off[0].avg < 0,          // true = fraqueza real (toma dano extra)
      def,                                         // [{el, pct}] ameaca agregada da hunt
    });
  }
  hunts.sort((a, b) => a.lv - b.lv);

  // ---- data: aplica o rate por categoria (in-hunt = "monster", senao = "boss") ----
  const data = [];
  for (const [k, m] of Object.entries(It)) {
    const hasCombat = m.resist || (m.abilities && m.abilities.length) || m.dmg;
    const hasLoot = m.loot && m.loot.length;
    if (!hasLoot && !hasCombat) continue;                 // pula dummy vazio
    const boss = inHunt.has(k) ? 0 : 1;
    const cat = boss ? "boss" : "monster";
    data.push({
      n: m.name || k, boss,
      hp: mul(m.hp || 0, cat, "hp"),
      exp: mul(m.exp || 0, cat, "exp"),
      arm: m.armor || 0, sp: m.speed || 0,
      dm: m.dmg || null, r: m.resist || null,
      a: (m.abilities || []).map(x => ({
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
      l: (m.loot || []).map(x => [x.name, x.chance, x.max || 1]),
    });
  }

  // raid/world bosses (so no catalogo de combate, sem loot) — categoria boss
  const haveNames = new Set(data.map(m => norm(m.n)));
  const raid = extractRaidBosses(src, haveNames);
  for (const { key, m } of raid) {
    data.push({
      n: titleCase(key), boss: 1, raid: 1,
      hp: mul(m.hp || 0, "boss", "hp"), exp: 0,
      arm: m.armor || 0, sp: m.speed || 0,
      dm: m.dmg || null, r: m.resist || null,
      a: (m.abilities || []).map(x => ({
        el: x.element, mn: x.min, mx: x.max, ch: x.chance,
        ty: x.element === "healing" ? "cura" : x.length ? "onda" : x.radius ? "área" : x.missile != null ? "distância" : x.target ? "direto" : "corpo a corpo",
        sz: x.radius ? ("raio " + x.radius) : x.length ? (x.length + (x.spread ? "×" + x.spread : "") + " tiles") : x.range ? ("alcance " + x.range) : "",
      })),
      l: [],
    });
  }
  console.log("raid bosses adicionados:", raid.length);
  data.sort((a, b) => a.n.localeCompare(b.n));

  // ---- equipamento (todo item com slot, dropando ou nao) ----
  const { equip, idByName } = extractEquip(src);
  const droppedNames = new Set();
  for (const m of data) for (const l of m.l) droppedNames.add(norm(l[0]));
  for (const e of equip) e.drop = droppedNames.has(norm(e.n)) ? 1 : 0;
  // sprite id por nome, so pros itens que aparecem em loot (aba Item / loot dos monstros)
  const ITEMID = {};
  for (const nm of droppedNames) if (idByName[nm]) ITEMID[nm] = idByName[nm];
  const eBySlot = {}; for (const e of equip) eBySlot[e.slot] = (eBySlot[e.slot] || 0) + 1;
  // ---- magias (com as formulas de dano/cura por level+skills) ----
  const spellsIife = extractSpellsSrc(src);
  const spells = new Function("return " + spellsIife)();  // valida
  console.log("magias:", spells.length, "|", JSON.stringify(spells.reduce((a, s) => (a[s.type] = (a[s.type] || 0) + 1, a), {})));
  console.log("monstros:", data.length, "| bosses:", data.filter(m => m.boss).length, "| hunts:", hunts.length);
  console.log("equip:", equip.length, "| dropam:", equip.filter(e => e.drop).length, "|", JSON.stringify(eBySlot));

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
  tpl = tpl.replace("const CHARMS = __CHARMS__;", "const CHARMS = " + JSON.stringify(CHARMS) + ";");
  tpl = tpl.replace("const EQUIP = __EQUIP__;", "const EQUIP = " + JSON.stringify(equip) + ";");
  tpl = tpl.replace("const ITEMID = __ITEMID__;", "const ITEMID = " + JSON.stringify(ITEMID) + ";");
  tpl = tpl.replace("const SHOP = __SHOP__;", "const SHOP = " + JSON.stringify(SHOP) + ";");
  tpl = tpl.replace("const FORGE = __FORGE__;", "const FORGE = " + JSON.stringify(FORGE) + ";");
  tpl = tpl.replace("const SPELLS = __SPELLS__;", "const SPELLS = " + spellsIife + ";");
  tpl = tpl.replace("__COUNT__", data.length);
  fs.writeFileSync(HERE + "/index.html", tpl);
  console.log("index.html gerado:", fs.statSync(HERE + "/index.html").size, "bytes");
})();
