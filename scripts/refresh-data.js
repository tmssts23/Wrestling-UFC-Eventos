#!/usr/bin/env node
// Actualiza os dados incluidos no repositorio (data/*.json) a partir do TMDB.
//
//   npm run refresh-data                 -> promocoes + eventos UFC
//   node scripts/refresh-data.js --shows -> so as promocoes
//   node scripts/refresh-data.js --ufc   -> so os eventos UFC
//
// Precisa de TMDB_API_KEY (ou TMDB_ACCESS_TOKEN). Os dados ficam no repositorio
// para que os catalogos respondam de imediato em arranques a frio; em execucao o
// addon actualiza-se sozinho em segundo plano a partir da mesma fonte.
const fs = require('fs');
const path = require('path');

const tmdb = require('../lib/tmdb');
const store = require('../lib/store');
const { PROMOTIONS } = require('../lib/promotions');

const DATA_DIR = path.join(__dirname, '..', 'data');
const args = process.argv.slice(2);
const onlyShows = args.includes('--shows');
const onlyUfc = args.includes('--ufc');
const client = tmdb.client();

function write(name, value) {
  const file = path.join(DATA_DIR, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`, 'utf8');
  console.log(`  -> ${name} (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function resumo(list) {
  if (!list.length) return 'vazio';
  const poster = list.filter((i) => i.poster).length;
  const sinopse = list.filter((i) => i.summary).length;
  return `póster ${poster}/${list.length} | sinopse ${sinopse}/${list.length}`;
}

async function refreshShows() {
  console.log('A actualizar promoções (TMDB)...');
  const anterior = read('shows.json', {}) || {};
  const out = {};
  for (const key of Object.keys(PROMOTIONS)) {
    const data = await store.fetchPromotion(key, client);
    const previous = anterior[key] || { tv: [], movies: [] };
    if (!data.tv.length && !data.movies.length && (previous.tv || []).length) {
      console.log(`  ${key}: sem resposta, mantém o que estava guardado`);
      out[key] = previous;
      continue;
    }
    out[key] = data;
    const grupos = store.buildFranchises(key, data.movies);
    console.log(
      `  ${key}: ${data.tv.length} programas | ${data.movies.length} eventos | ` +
        `${grupos.length} coleções por ano | ${resumo(data.movies)}`
    );
    if (grupos.length) {
      const topo = grupos
        .slice(0, 4)
        .map((g) => `${g.name} (${g.editions})`)
        .join(', ');
      console.log(`      ex.: ${topo}`);
    }
  }
  write('shows.json', out);
}

async function refreshUfc() {
  console.log('A actualizar eventos UFC (TMDB)...');
  const anterior = read('ufc-events.json', []) || [];
  const list = await store.fetchUfcEvents(client);
  if (!list.length) {
    console.log(`  sem resposta, mantém ${anterior.length} eventos guardados`);
    return;
  }
  console.log(
    `  ${list.length} eventos (${list[list.length - 1].date} a ${list[0].date}) | ${resumo(list)}`
  );
  write('ufc-events.json', list);
}

(async () => {
  if (!client.enabled) {
    console.error(
      'Falta TMDB_API_KEY.\n' +
        'Cria a chave em https://www.themoviedb.org/settings/api e depois:\n' +
        '  PowerShell:  $env:TMDB_API_KEY = "a_tua_chave"\n' +
        '  bash:        export TMDB_API_KEY=a_tua_chave'
    );
    process.exit(1);
  }
  const started = Date.now();
  if (!onlyUfc) await refreshShows();
  if (!onlyShows) await refreshUfc();
  // Data da recolha: o addon usa-a para nao repetir a recolha em execucao antes de 24 h.
  write('meta.json', { generatedAt: new Date().toISOString() });
  console.log(`Concluído em ${((Date.now() - started) / 1000).toFixed(1)}s`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
