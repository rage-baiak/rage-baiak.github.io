# Baiak Drops

Página estática com a **taxa de drop** dos monstros e bosses do Baiak Idle.
Busca por monstro (loot dele) ou por item (onde farmar). Servida via GitHub Pages.

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
