// ============================================================================
//  COLETOR DA ABA GUERRA (via /profile no socket)
//  Cole no console do jogo (F12) em baiakidle.com, LOGADO e JOGANDO.
//  Pega o roster inimigo (guild.view) e roda /profile em cada conta pra
//  descobrir os PERSONAGENS reais dela (o link conta->chars so vem por socket).
//  So le. /profile nao passa pelo antibot. Ao fim, baixa war.json.
//  Leva ~3 min pra 100 contas (throttle). Deixe a aba em foco.
// ============================================================================
(async () => {
  const TOKEN = localStorage.getItem('baiak-idle-token');
  if (!TOKEN) { console.error('Sem token. Abra na aba do baiakidle.com logado.'); return; }
  const H = { authorization: 'Bearer ' + TOKEN };
  const FOE_NOME = '';   // vazio = detecta a guerra ativa. Ou force: 'Vingadores'

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const txt = el => (el && el.textContent || '').replace(/\s+/g, ' ').trim();

  async function q(route, input) {
    const u = '/api/trpc/' + route + '?batch=1&input=' + encodeURIComponent(JSON.stringify({ 0: input || {} }));
    const r = await fetch(u, { headers: H });
    const j = await r.json();
    const res = j && j[0] && j[0].result;
    if (!res) throw new Error(route + ' falhou: ' + JSON.stringify(j).slice(0, 200));
    return res.data;
  }

  // ---- 1) roster de CONTAS da guild inimiga ----
  let foeId = null, foeName = FOE_NOME, size = 0, warId = null;
  if (FOE_NOME) {
    const lst = await q('guild.list', { q: FOE_NOME, limit: 8, sort: 'level' });
    const g = (lst || []).find(x => (x.name || '').toLowerCase() === FOE_NOME.toLowerCase()) || (lst || [])[0];
    if (!g) { console.error('Nao achei a guild', FOE_NOME); return; }
    foeId = g.id; foeName = g.name;
  } else {
    const mine = await q('guild.mine', {});
    const war = mine && mine.war;
    if (!war || !war.id) { console.error('Sem guerra ativa. Preencha FOE_NOME no topo.'); window.__mine = mine; return; }
    warId = war.id;
    const ws = await q('guild.warState', { warId });
    size = (ws.war && ws.war.size) || 0;
    const meu = ws.myGuildId;
    const inimigos = (ws.participants || []).filter(p => p.guildId !== meu);
    foeId = inimigos.length ? inimigos[0].guildId : null;
  }
  if (!foeId) { console.error('Nao achei a guild inimiga.'); return; }
  const view = await q('guild.view', { id: foeId });
  foeName = foeName || (view.guild && view.guild.name) || ('Guild #' + foeId);
  const tag = (view.guild && view.guild.tag) || '';
  const contas = (view.members || []).map(m => m.name);
  console.log('Guild inimiga: ' + foeName + ' [' + tag + '] - ' + contas.length + ' contas. Rodando /profile...');

  // ---- 2) UI: dispara /profile e le os chars no #profile-overlay ----
  const input = document.getElementById('chat-input');
  if (!input) { console.error('Nao achei o chat (#chat-input). O jogo esta aberto e logado?'); return; }
  const setVal = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

  function dispara(nome) {
    const ov = document.getElementById('profile-overlay');
    if (ov) ov.remove();                       // limpa: qualquer overlay novo e a resposta desta conta
    setVal.call(input, '/profile ' + nome);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  function lerCards() {
    const ov = document.getElementById('profile-overlay');
    if (!ov) return null;
    if (ov.querySelector('.pf-empty')) return [];       // perfil aberto, mas conta sem chars
    const cards = ov.querySelectorAll('.pf-card');
    if (!cards.length) return null;
    const out = [];
    for (const c of cards) {
      const n = txt(c.querySelector('.nm'));
      const lv = parseInt((txt(c.querySelector('.lv')).match(/\d+/) || [0])[0], 10) || 0;
      if (n) out.push({ n, lv, v: '', sk: {}, res: {}, at: {} });
    }
    return out.length ? out : null;
  }

  // espera o render estabilizar (2 leituras iguais) pra nao pegar meio-render
  async function esperaChars(timeout = 3000) {
    const fim = Date.now() + timeout;
    let ant = null;
    while (Date.now() < fim) {
      const cur = lerCards();
      if (cur !== null) {
        const sig = cur.map(x => x.n).join('|');
        if (sig === ant) return cur;               // estavel
        ant = sig;
      }
      await sleep(140);
    }
    return ant === null ? null : (lerCards() || []);
  }

  // ---- 3) loop pelas contas ----
  const res = []; let ok = 0, off = 0;
  for (let i = 0; i < contas.length; i++) {
    const nome = contas[i];
    dispara(nome);
    const chars = await esperaChars();
    if (chars === null) { off++; res.push({ c: nome, ch: [], off: true }); }
    else { ok++; res.push({ c: nome, ch: chars }); }
    if ((i + 1) % 10 === 0 || i === contas.length - 1)
      console.log((i + 1) + '/' + contas.length + '  (' + ok + ' ok, ' + off + ' sem perfil)');
    await sleep(1600);   // throttle > latencia do socket, evita contaminacao
  }
  const ovf = document.getElementById('profile-overlay'); if (ovf) ovf.remove();

  // ---- 3b) vocacao de cada char (characters.profile, REST publico) ----
  const todos = [];
  for (const c of res) for (const ch of c.ch) todos.push(ch);
  console.log('Buscando vocacao de ' + todos.length + ' chars...');
  async function voc(nome) {
    for (let t = 0; t < 2; t++) {
      try {
        const u = '/api/trpc/characters.profile?batch=1&input=' + encodeURIComponent(JSON.stringify({ 0: { name: nome } }));
        const r = await fetch(u); const j = await r.json();
        const d = j && j[0] && j[0].result && j[0].result.data; if (d) return d;
      } catch (_) {}
      await sleep(300);
    }
    return null;
  }
  { let d2 = 0;
    for (const ch of todos) {
      const p = await voc(ch.n);
      if (p && p.vocation) { ch.v = p.vocation; if (p.level) ch.lv = p.level; }
      if (++d2 % 50 === 0) console.log('vocacao ' + d2 + '/' + todos.length);
      await sleep(120);
    }
  }

  // ---- 4) monta war.json (so contas com chars) ----
  const contasOut = res.filter(c => c.ch.length).map(c => ({
    c: c.c,
    ch: c.ch.slice().sort((a, b) => b.lv - a.lv),
    tot: c.ch.reduce((t, x) => t + x.lv, 0)
  })).sort((a, b) => b.tot - a.tot);
  const semPerfil = res.filter(c => !c.ch.length).map(c => c.c);

  const warOut = {
    meta: {
      id: warId || foeId, foe: foeName, tag, size: size || contasOut.length,
      at: new Date().toLocaleString('pt-BR'), media_res: [], amostra: 0
    },
    contas: contasOut
  };
  window.__WAR = warOut; window.__semPerfil = semPerfil;
  const totalChars = contasOut.reduce((t, c) => t + c.ch.length, 0);
  console.log('PRONTO: ' + contasOut.length + ' contas / ' + totalChars + ' chars. ' + semPerfil.length + ' sem perfil (off/oculto).');
  if (semPerfil.length) console.log('sem perfil: ' + semPerfil.join(', '));

  const blob = new Blob([JSON.stringify(warOut, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'war.json'; a.click();
  console.log('war.json baixado. (backup em window.__WAR). Depois clique "Atualizar fichas" no wiki.');
})();
