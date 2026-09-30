// ============================================================================
//  MEDIDOR DE PROFICIENCIA  --  cole no console do jogo (F12), LOGADO e CACANDO.
//  Antes de rodar: abra a janela de PROFICIENCIA (aba Proficiencia) e deixe
//  aberta, com a arma equipada aparecendo na lista.
//  So LE o DOM. Nao envia nada pro jogo.
//  Deixe cacando alguns minutos e depois rode:  __PROF.resumo()
// ============================================================================
(() => {
  const num = s => Number(String(s).replace(/[^\d]/g, "")) || 0;

  // le todas as barras de proficiencia: {rotulo: xpAcumulado}
  function lerProf() {
    const out = {};
    document.querySelectorAll(".prof-xpbar").forEach((b, i) => {
      const t = b.title || "";
      const xp = num(t.split("/")[0]);
      // rotulo: texto da linha da arma (ou indice, se nao achar)
      let row = b.parentElement;
      for (let k = 0; k < 4 && row; k++) {
        const txt = (row.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.length > 4) { out[txt.slice(0, 38) || ("bar" + i)] = xp; return; }
        row = row.parentElement;
      }
      out["bar" + i] = xp;
    });
    return out;
  }

  // exp que falta pro proximo nivel (numero absoluto)
  function lerFalta() {
    const el = document.getElementById("sk-xp-row");
    if (!el || !el.title) return null;
    const m = /([\d.,]+)/.exec(el.title);
    return m ? num(m[1]) : null;
  }

  let ant = lerProf(), antFalta = lerFalta(), t0 = Date.now();
  let somaProf = 0, somaExp = 0, amostras = 0;
  const log = [];

  if (!Object.keys(ant).length) {
    console.warn("Nao achei .prof-xpbar — ABRA A JANELA DE PROFICIENCIA e rode de novo.");
    return;
  }
  console.log("medindo... (" + Object.keys(ant).length + " armas na lista)"
    + (antFalta == null ? " | sem #sk-xp-row: vou medir so prof/tempo" : " | exp do char OK"));

  const timer = setInterval(() => {
    const cur = lerProf(), falta = lerFalta();
    let dProf = 0, qual = "";
    for (const k in cur) {
      const d = cur[k] - (ant[k] ?? cur[k]);
      if (d > 0) { dProf += d; qual = k; }
    }
    // exp ganha = quanto o "faltam" diminuiu (ignora se subiu de nivel)
    let dExp = null;
    if (falta != null && antFalta != null) { const d = antFalta - falta; if (d > 0) dExp = d; }

    if (dProf > 0) {
      somaProf += dProf; amostras++;
      if (dExp) somaExp += dExp;
      const linha = { t: Math.round((Date.now() - t0) / 1000), prof: dProf, exp: dExp,
                      razao: dExp ? +(dProf / dExp).toFixed(4) : null, arma: qual };
      log.push(linha);
      console.log(`+${dProf} prof` + (dExp ? `  | +${dExp} exp  | prof/exp = ${linha.razao}` : "")
        + `  (${linha.t}s)`);
    }
    ant = cur; if (falta != null) antFalta = falta;
  }, 2000);

  let expKill = 0, nomeMob = "";
  window.__PROF = {
    parar: () => { clearInterval(timer); console.log("parado."); },
    // informe a exp do bicho que voce esta matando (pega no wiki):  __PROF.monstro("Troll", 60)
    monstro: (nome, exp) => { nomeMob = nome; expKill = Number(exp) || 0;
      console.log("alvo: " + nome + " (" + expKill + " exp/kill) — kills serao estimados por Dexp/exp"); },
    log,
    resumo: () => {
      const seg = Math.max(1, Math.round((Date.now() - t0) / 1000));
      console.log("=== RESUMO ===");
      console.log("tempo: " + seg + "s | amostras com ganho: " + amostras);
      console.log("proficiencia total: " + somaProf + "  (" + Math.round(somaProf / seg * 60) + "/min)");
      if (somaExp) {
        console.log("exp total: " + somaExp + "  (" + Math.round(somaExp / seg * 60) + "/min)");
        console.log(">>> prof por exp = " + (somaProf / somaExp).toFixed(4));
      } else {
        console.log("(sem exp medida — abra o painel de skills pra ter #sk-xp-row)");
      }
      if (somaExp && expKill > 0) {
        const kills = somaExp / expKill;
        console.log("--- com " + nomeMob + " (" + expKill + " exp/kill):");
        console.log("kills estimados: ~" + kills.toFixed(1));
        console.log(">>> prof por KILL = " + (somaProf / kills).toFixed(2));
        console.log("    (compare com outra hunt de classe diferente: se prof/kill bater, e fixo por kill;");
        console.log("     se prof/exp bater, e proporcional a exp; se subir com a classe, escala por classe)");
      }
      const rs = log.filter(x => x.razao).map(x => x.razao);
      if (rs.length > 1) {
        const mn = Math.min(...rs), mx = Math.max(...rs);
        console.log("razao por amostra: min " + mn + " / max " + mx
          + (mx - mn < mx * 0.05 ? "  => CONSTANTE (prof = k x exp)" : "  => varia (nao e so exp)"));
      }
      return { somaProf, somaExp, seg, log };
    }
  };
  console.log('rodando. Pra ver o resultado: __PROF.resumo()   | pra parar: __PROF.parar()');
})();
