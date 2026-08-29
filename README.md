# Wiki do Baiak

Wiki estática do Baiak Idle: **drops, combate e hunts** dos monstros e bosses.
Busca por monstro (loot + fraquezas + ataques), por boss, por hunt (arma e defesa
recomendadas) ou por item (onde farmar). Servida via GitHub Pages.

- **`index.html`** — a página pronta (gerada). É o que o Pages serve.
- **`template.html`** — o HTML com `const M = __DATA__;` (sem os dados).
- **`build.js`** — baixa o bundle atual do jogo, extrai o catálogo de monstros
  (loot table) e injeta no template → `index.html`.
- **`.github/workflows/refresh.yml`** — roda o `build.js` toda semana (e no botão
  Run workflow), commitando o `index.html` atualizado. Assim a página se atualiza
  sozinha quando o jogo muda os drops.

Regenerar na mão:

```bash
node build.js
```

Os dados saem do bundle público do jogo (`baiakidle.com/jogar/assets/index-*.js`),
onde cada monstro tem `loot:[{name, chance, max}]`. `chance` é sobre 100.000
(então % = chance/1000). Chance de raridade/bags não fica no cliente (é server-side).

HP/EXP replicam o catálogo real do jogo (`It`): base `ix` + override `Db` +
escala `gde` + multiplicador de exp `yde`, e por cima o **rate do servidor**
(`adminConfig.monsterMult`, config pública: monster hp ×2 / exp ×1, boss hp ×1.5).
Monstro dentro de hunt usa o rate `monster`; fora de hunt usa `boss`. A separação
monstro/boss é heurística (está numa hunt ou não), então um boss que na verdade
seja `stageBoss`/`worldBoss` pode ter HP escalado por outro fator.
