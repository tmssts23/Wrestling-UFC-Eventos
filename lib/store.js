const cache = require('./cache');
const tmdb = require('./tmdb');
const cinemeta = require('./cinemeta');
const tvmaze = require('./tvmaze');
const franchises = require('./franchises');
const { mapLimit } = require('./httpx');
const { PROMOTIONS, UFC_EVENTS, promotion } = require('./promotions');

const bakedShows = require('../data/shows.json');
const bakedUfcEvents = require('../data/ufc-events.json');
const bakedMeta = require('../data/meta.json');

// A recolha completa sao milhares de pedidos ao TMDB e gasta a quota da chave de
// quem instala. Em execucao so se refaz quando os dados guardados tem mais de 24 h,
// nunca na Vercel (cada arranque a frio repetia-a) e uma de cada vez.
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
let refreshRunning = false;

function shouldRefresh() {
  if (process.env.VERCEL || process.env.ADDON_NO_REFRESH) return false;
  const generated = Date.parse((bakedMeta && bakedMeta.generatedAt) || '');
  if (Number.isFinite(generated) && Date.now() - generated < REFRESH_AFTER_MS) return false;
  return !refreshRunning;
}

// Corre a actualizacao em segundo plano sem sobrepor outra.
function backgroundRefresh(key, ttl, loader) {
  if (!shouldRefresh()) return;
  refreshRunning = true;
  cache.refresh(key, ttl, async () => {
    try {
      return await loader();
    } finally {
      refreshRunning = false;
    }
  });
}

const HOUR = 60 * 60 * 1000;
const TTL_PROMO = 12 * HOUR;
const TTL_PROMO_SEED = 15 * 60 * 1000;
const TTL_RECENT = 45 * 60 * 1000;
const TTL_UFC_LIST = 12 * HOUR;
// Paginas de resultados lidas por pesquisa (20 por pagina). Termos genericos como
// "WWE" ou "UFC" tem centenas de resultados, por isso le-se bastante fundo.
const SEARCH_PAGES = 25;

// Cada pedido traz o seu cliente TMDB (a chave da instalacao); sem ele fica so
// o que esta guardado no repositorio.
function api(client) {
  return client && client.enabled ? client : null;
}

// Tira eventos com data anterior a fundacao da promocao: sao filmes sem relacao
// que passaram no filtro pelo nome (ex.: "Roh Membela", 1955).
function afterFounding(promo, movies) {
  const founded = promo && promo.founded;
  if (!founded) return movies;
  return movies.filter((movie) => !movie.year || movie.year >= founded);
}

function baked(promoKey) {
  const entry = bakedShows && bakedShows[promoKey];
  return {
    tv: entry && Array.isArray(entry.tv) ? entry.tv : [],
    movies: afterFounding(promotion(promoKey), entry && Array.isArray(entry.movies) ? entry.movies : []),
  };
}

function matches(promo, item) {
  const name = String((item && item.name) || '');
  if (!name) return false;
  if (promo.include && !promo.include.test(name)) return false;
  if (promo.exclude && promo.exclude.test(name)) return false;
  return true;
}

// Junta fichas com o mesmo id sem deixar que um campo vazio da ficha nova
// apague um valor que ja existia (ex.: o id IMDb guardado numa recolha anterior).
function mergeDefined(base, extra) {
  const out = { ...base };
  for (const [field, value] of Object.entries(extra)) {
    if (value !== null && value !== undefined && value !== '') out[field] = value;
  }
  return out;
}

function dedupe(list) {
  const map = new Map();
  for (const item of list || []) {
    if (!item || !item.id) continue;
    const previous = map.get(item.id);
    map.set(item.id, previous ? mergeDefined(previous, item) : item);
  }
  return [...map.values()];
}

// Preenche o id IMDb dos eventos que ainda nao o tem (necessario para streams).
async function withImdb(movies, tmdbApi) {
  if (!tmdbApi) return movies;
  const missing = movies.filter((movie) => !movie.imdb);
  const found = await mapLimit(missing, tmdb.CONCURRENCY, tmdb.SPACING_MS, (movie) => tmdbApi.movieImdb(movie.id));
  const byId = new Map(missing.map((movie, i) => [movie.id, found[i]]));
  return movies.map((movie) => (movie.imdb || !byId.get(movie.id) ? movie : { ...movie, imdb: byId.get(movie.id) }));
}

function sortTv(list) {
  return list.slice().sort((a, b) => {
    const running = (a.inProduction ? 0 : 1) - (b.inProduction ? 0 : 1);
    if (running !== 0) return running;
    const d = String(b.premiered || '').localeCompare(String(a.premiered || ''));
    if (d !== 0) return d;
    return String(a.name).localeCompare(String(b.name), 'pt');
  });
}

function sortByDateDesc(list) {
  return list.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

// ------------------------------- recolha -------------------------------

async function searchAll(client, kind, queries) {
  const results = await mapLimit(queries, tmdb.CONCURRENCY, tmdb.SPACING_MS, (query) =>
    kind === 'movie'
      ? client.searchMovies(query, { maxPages: SEARCH_PAGES })
      : client.searchTv(query, { maxPages: SEARCH_PAGES })
  );
  const out = [];
  for (const list of results) for (const item of list || []) out.push(item);
  return out;
}

async function fetchPromotion(promoKey, client) {
  const promo = promotion(promoKey);
  const tmdbApi = api(client);
  if (!promo || !tmdbApi) return { tv: [], movies: [] };

  const [tvHits, movieHits] = await Promise.all([
    searchAll(tmdbApi, 'tv', promo.tvQueries || []),
    searchAll(tmdbApi, 'movie', promo.movieQueries || []),
  ]);

  // A pesquisa nao traz estado de producao, rede nem ultimo episodio:
  // completa-se cada programa com a ficha de detalhe.
  const pinned = await mapLimit(promo.pinnedTv || [], tmdb.CONCURRENCY, tmdb.SPACING_MS, (id) => tmdbApi.tv(id));
  const tvBase = dedupe([
    ...tvHits.filter(
      (item) => matches(promo, item) && !franchises.isCompanion(item.name) && !franchises.isNoiseGenre(item)
    ),
    ...pinned.filter(Boolean),
  ]);
  const details = await mapLimit(tvBase, tmdb.CONCURRENCY, tmdb.SPACING_MS, (item) => tmdbApi.tv(item.id));
  const tv = sortTv(tvBase.map((item, i) => (details[i] ? { ...item, ...details[i] } : item)));

  const movies = sortByDateDesc(
    dedupeEditions(
      promoKey,
      dedupe(
        movieHits.filter(
          (item) =>
            matches(promo, item) &&
            item.date &&
            !franchises.isCompanion(item.name) &&
            !franchises.isNoiseGenre(item) &&
            franchises.belongsTo(promoKey, item.name)
        )
      )
    )
  );
  return { tv, movies: await withImdb(afterFounding(promo, movies), tmdbApi) };
}

function editionScore(movie) {
  return (movie.poster ? 4 : 0) + (movie.imdb ? 2 : 0) + (movie.summary ? 1 : 0) + Math.min(1, (movie.votes || 0) / 50);
}

// O TMDB tem por vezes a mesma edicao duas vezes ("AEW All Out 2019" e
// "All Elite Wrestling All Out 2019"). Fica a ficha mais completa; eventos em
// varias noites (Night 1 / Night 2) mantem-se separados.
function dedupeEditions(promoKey, movies) {
  const kept = [];
  for (const movie of movies) {
    const found = franchises.match(promoKey, movie.name);
    const multiNight = /\b(night|noite|dia|day)\s*\d|saturday|sunday|sabado|domingo/i.test(movie.name);
    if (!found || multiNight) {
      kept.push(movie);
      continue;
    }
    const twin = kept.findIndex((other) => {
      const otherMatch = franchises.match(promoKey, other.name);
      if (!otherMatch || otherMatch.slug !== found.slug) return false;
      const diff = Math.abs(Date.parse(`${other.date}T00:00:00Z`) - Date.parse(`${movie.date}T00:00:00Z`));
      return diff <= 2 * 24 * HOUR;
    });
    if (twin === -1) kept.push(movie);
    else if (editionScore(movie) > editionScore(kept[twin])) kept[twin] = movie;
  }
  return kept;
}

function mergePromotion(fresh, previous) {
  if (!fresh || (!fresh.tv.length && !fresh.movies.length)) return previous;
  return {
    tv: sortTv(dedupe([...previous.tv, ...fresh.tv])),
    movies: sortByDateDesc(dedupe([...previous.movies, ...fresh.movies])),
  };
}

// Responde de imediato com os dados guardados no repositorio e actualiza a
// partir do TMDB em segundo plano.
async function promotionData(promoKey, client) {
  if (!promotion(promoKey)) return { tv: [], movies: [] };
  const tmdbApi = api(client);
  const key = `store:promo:${promoKey}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const fallback = hit ? hit.value : baked(promoKey);
  if (fallback && (fallback.tv.length || fallback.movies.length)) {
    cache.set(key, fallback, TTL_PROMO_SEED);
    if (tmdbApi) {
      backgroundRefresh(key, TTL_PROMO, async () => mergePromotion(await fetchPromotion(promoKey, tmdbApi), fallback));
    }
    return fallback;
  }
  if (!tmdbApi) return { tv: [], movies: [] };
  return cache.memo(key, TTL_PROMO, () => fetchPromotion(promoKey, tmdbApi), { staleMs: 30 * 24 * HOUR });
}

// ------------------------------- coleccoes por ano -------------------------------

// Agrupa os filmes soltos por evento recorrente (WrestleMania, All Out, ...).
function buildFranchises(promoKey, movies) {
  const promo = promotion(promoKey);
  const groups = new Map();

  for (const movie of movies) {
    const found = franchises.match(promoKey, movie.name, promo ? promo.name : '');
    if (!found) continue;
    if (!groups.has(found.slug)) groups.set(found.slug, { name: found.name, slug: found.slug, movies: [] });
    groups.get(found.slug).movies.push(movie);
  }

  const out = [];
  for (const group of groups.values()) {
    if (group.movies.length < 2) continue; // com uma so edicao fica como evento solto
    const ordered = group.movies.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    const latest = ordered[ordered.length - 1];
    const years = [...new Set(ordered.map((m) => m.year).filter(Boolean))];
    out.push({
      kind: 'franchise',
      promoKey,
      slug: group.slug,
      id: group.slug,
      name: group.name,
      movies: ordered,
      date: latest.date,
      year: latest.year,
      firstYear: years.length ? Math.min(...years) : null,
      lastYear: years.length ? Math.max(...years) : null,
      editions: ordered.length,
      poster: latest.poster || (ordered.find((m) => m.poster) || {}).poster || null,
      background: latest.background || (ordered.find((m) => m.background) || {}).background || null,
      summary: latest.summary || '',
      rating: latest.rating || null,
    });
  }
  return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Eventos ja realizados primeiro (do mais recente para o mais antigo);
// os agendados ficam no fim, do mais proximo para o mais distante.
function pastFirst(list, dateOf = (item) => item.date) {
  const now = today();
  const past = [];
  const upcoming = [];
  for (const item of list) (String(dateOf(item) || '') > now ? upcoming : past).push(item);
  past.sort((a, b) => String(dateOf(b) || '').localeCompare(String(dateOf(a) || '')));
  upcoming.sort((a, b) => String(dateOf(a) || '').localeCompare(String(dateOf(b) || '')));
  return [...past, ...upcoming];
}

// Data da ultima edicao ja realizada de uma coleccao (ou da proxima, se nenhuma aconteceu).
function lastHeldDate(group) {
  const now = today();
  const held = group.movies.filter((m) => m.date && m.date <= now);
  return held.length ? held[held.length - 1].date : group.movies[0] && group.movies[0].date;
}

// Lista completa do catalogo de uma promocao: programas com temporadas,
// coleccoes por ano e os eventos individuais.
async function promotionCatalog(promoKey, client) {
  const data = await promotionData(promoKey, client);
  const groups = pastFirst(buildFranchises(promoKey, data.movies), lastHeldDate);
  const tv = data.tv.map((item) => ({ ...item, kind: 'tv', promoKey }));
  const movies = pastFirst(data.movies.map((item) => ({ ...item, kind: 'movie', promoKey })));
  return [...tv, ...groups, ...movies];
}

async function findTv(tvId, client) {
  const id = Number(tvId);
  if (!Number.isFinite(id)) return null;
  for (const promoKey of Object.keys(PROMOTIONS)) {
    const data = await promotionData(promoKey, client);
    const hit = data.tv.find((s) => s.id === id);
    if (hit) return { show: hit, promoKey };
  }
  const tmdbApi = api(client);
  if (!tmdbApi) return null;
  const fetched = await tmdbApi.tv(id);
  if (!fetched) return null;
  const guess = Object.values(PROMOTIONS).find((p) => matches(p, fetched)) || null;
  return { show: fetched, promoKey: guess ? guess.key : null };
}

async function findMovie(movieId, client) {
  const id = Number(movieId);
  if (!Number.isFinite(id)) return null;
  for (const promoKey of Object.keys(PROMOTIONS)) {
    const data = await promotionData(promoKey, client);
    const hit = data.movies.find((m) => m.id === id);
    if (hit) return { movie: hit, promoKey };
  }
  const events = await ufcEvents(client);
  const inUfc = events.find((m) => m.id === id);
  if (inUfc) return { movie: inUfc, promoKey: 'ufc' };
  const tmdbApi = api(client);
  if (!tmdbApi) return null;
  const fetched = await tmdbApi.movie(id);
  return fetched ? { movie: fetched, promoKey: null } : null;
}

// Programa pelo id IMDb (os episodios chegam como "tt...:temporada:episodio").
async function findTvByImdb(imdb, client) {
  if (!/^tt\d+$/.test(String(imdb || ''))) return null;
  for (const promoKey of Object.keys(PROMOTIONS)) {
    const data = await promotionData(promoKey, client);
    const hit = data.tv.find((s) => s.imdb === imdb);
    if (hit) return { show: hit, promoKey };
  }
  return null;
}

// Evento pelo id IMDb (o id usado nos catalogos quando existe).
async function findByImdb(imdb, client) {
  if (!/^tt\d+$/.test(String(imdb || ''))) return null;
  for (const promoKey of Object.keys(PROMOTIONS)) {
    const data = await promotionData(promoKey, client);
    const hit = data.movies.find((m) => m.imdb === imdb);
    if (hit) return { movie: hit, promoKey };
  }
  const events = await ufcEvents(client);
  const inUfc = events.find((m) => m.imdb === imdb);
  return inUfc ? { movie: inUfc, promoKey: 'ufc' } : null;
}

async function findFranchise(promoKey, slug, client) {
  const data = await promotionData(promoKey, client);
  return buildFranchises(promoKey, data.movies).find((g) => g.slug === slug) || null;
}

// Episodios de um programa no TMDB: uma temporada por pedido.
async function tmdbEpisodes(tvId, tmdbApi, { maxSeasons = 60 } = {}) {
  if (!tmdbApi) return [];
  const show = await tmdbApi.tv(tvId);
  if (!show) return [];
  const seasons = show.seasons.slice(-maxSeasons);
  const lists = await mapLimit(seasons, tmdb.CONCURRENCY, tmdb.SPACING_MS, (s) => tmdbApi.season(tvId, s.number));
  const out = [];
  for (const list of lists) for (const ep of list || []) out.push(ep);
  return out;
}

function latestAirdate(episodes) {
  return episodes.reduce((max, ep) => (ep.airdate && ep.airdate > max ? ep.airdate : max), '');
}

function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 24 * HOUR).toISOString().slice(0, 10);
}

// Os addons de streams pedem cada episodio pela numeracao do IMDb (a do Cinemeta).
// O TMDB numera alguns programas de outra forma (ex.: NXT com 4 episodios de
// diferenca), por isso cada episodio do TMDB recebe o numero IMDb do episodio
// emitido no mesmo dia (tolerancia de 1 dia por causa dos fusos horarios).
function withStreamNumbers(tmdbList, cinemetaList) {
  if (!cinemetaList.length) return tmdbList;
  const byDate = new Map();
  for (const ep of cinemetaList) {
    if (!ep.airdate) continue;
    if (!byDate.has(ep.airdate)) byDate.set(ep.airdate, []);
    byDate.get(ep.airdate).push(ep);
  }
  const used = new Set();
  return tmdbList.map((ep) => {
    if (!ep.airdate) return ep;
    for (const offset of [0, -1, 1]) {
      const candidates = byDate.get(addDays(ep.airdate, offset)) || [];
      const match = candidates.find((c) => !used.has(`${c.season}:${c.number}`));
      if (match) {
        used.add(`${match.season}:${match.number}`);
        return { ...ep, streamSeason: match.season, streamNumber: match.number };
      }
    }
    return ep;
  });
}

// Episodios de um programa:
//   - com chave: TMDB (titulos, imagens e sinopses em pt-PT), com a numeracao IMDb
//     do Cinemeta nos ids de stream;
//   - sem chave (ou TMDB sem episodios): Cinemeta e, para programas sem IMDb, TVmaze
//     (ligacao manual em `tvmazeFallback`), para as fichas nunca abrirem vazias.
async function tvEpisodes(tvId, client, opts = {}) {
  const found = await findTv(tvId, client);
  const show = found ? found.show : null;
  const tmdbApi = api(client);

  if (tmdbApi) {
    const fromTmdb = await tmdbEpisodes(tvId, tmdbApi, opts);
    if (fromTmdb.length) {
      if (!show || !show.imdb) return fromTmdb;
      return withStreamNumbers(fromTmdb, await cinemeta.seriesEpisodes(show.imdb));
    }
  }

  const fromCinemeta = show && show.imdb ? await cinemeta.seriesEpisodes(show.imdb) : [];
  if (fromCinemeta.length) return fromCinemeta;

  const promo = found ? promotion(found.promoKey) : null;
  const tvmazeId = promo && promo.tvmazeFallback ? promo.tvmazeFallback[tvId] : null;
  return tvmazeId ? tvmaze.episodes(tvmazeId) : [];
}

// Um episodio concreto. Os pedidos de stream chegam com a numeracao IMDb
// ("tt...:temporada:episodio"); os de programas sem IMDb, com a do TMDB.
async function findEpisode(tvId, season, number, client) {
  const s = Number(season);
  const n = Number(number);
  const pick = (episodes) =>
    episodes.find((ep) => (ep.streamSeason || ep.season) === s && (ep.streamNumber || ep.number) === n) ||
    episodes.find((ep) => ep.season === s && ep.number === n) ||
    null;
  // Primeiro so as ultimas temporadas (rapido: e onde estao os episodios recentes);
  // se nao estiver la, todas.
  return pick(await tvEpisodes(tvId, client, { maxSeasons: 2 })) || pick(await tvEpisodes(tvId, client));
}

// ------------------------------- ultimos dias -------------------------------

// Por dias de calendario: "ultimos 7 dias" inclui o dia de ha 7 dias inteiro
// (antes contava 7x24h a partir desta hora e deixava de fora eventos desse dia).
function isRecent(dateIso, days) {
  if (!dateIso) return false;
  const value = Date.parse(`${String(dateIso).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(value)) return false;
  const now = new Date();
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return value >= startOfToday - days * 24 * HOUR && value <= now.getTime() + 36 * HOUR;
}

// Top N de eventos: os mais votados no TMDB entre os realizados nos ultimos 12 meses
// (alarga a 24 meses e depois a todos, se houver menos de N). A popularidade do TMDB
// para estes eventos e quase aleatoria (valores de 1 a 7), por isso so desempata.
// Ter IMDb vale um bonus: sao os eventos que os addons de streams encontram.
function topEvents(events, size = 3) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const held = events.filter((e) => e.date && e.date <= today);
  const score = (e) =>
    (Number(e.votes) || 0) + (e.imdb ? 5 : 0) + (Number(e.rating) || 0) / 10 + (Number(e.popularity) || 0) / 100;
  for (const months of [12, 24, null]) {
    const from = months ? new Date(now - months * 30.44 * 24 * HOUR).toISOString().slice(0, 10) : '';
    const pool = held.filter((e) => e.date >= from);
    if (pool.length >= size || months === null) {
      return pool.slice().sort((a, b) => score(b) - score(a)).slice(0, size);
    }
  }
  return [];
}

// Episodios emitidos e eventos lancados nos ultimos `days` dias.
async function recent(promoKey, days = 7, client) {
  const promo = promotion(promoKey);
  if (!promo) return [];
  const tmdbApi = api(client);
  // Com e sem chave o resultado pode diferir (o TMDB completa episodios recentes),
  // por isso cada caso tem a sua entrada em cache.
  const key = `store:recent:${promoKey}:${days}:${new Date().toISOString().slice(0, 10)}:${tmdbApi ? 'chave' : 'sem-chave'}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const value = await (async () => {
    const data = await promotionData(promoKey, client);
    const out = [];

    // Eventos individuais lancados na janela.
    for (const movie of data.movies) {
      if (isRecent(movie.date, days)) out.push({ kind: 'movie', promoKey, movie, date: movie.date });
    }

    // Ultimo episodio emitido de cada programa ainda em producao, pela mesma fonte
    // das fichas (funciona com e sem chave).
    const today = new Date().toISOString().slice(0, 10);
    const candidates = data.tv.filter((s) => s.inProduction || isRecent(s.ended, 30)).slice(0, 12);
    // So as ultimas temporadas: chega para a ultima semana e poupa pedidos ao TMDB.
    const lists = await mapLimit(candidates, 4, 60, (s) => tvEpisodes(s.id, client, { maxSeasons: 2 }));
    candidates.forEach((show, i) => {
      const aired = (lists[i] || []).filter((ep) => ep.airdate && ep.airdate <= today && isRecent(ep.airdate, days));
      if (!aired.length) return;
      const episode = aired.reduce((a, b) => {
        if (b.airdate !== a.airdate) return b.airdate > a.airdate ? b : a;
        return b.season * 10000 + b.number > a.season * 10000 + a.number ? b : a;
      });
      out.push({ kind: 'episode', promoKey, show, episode, date: episode.airdate });
    });

    return out.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  })();

  cache.set(key, value, TTL_RECENT);
  return value;
}

// ------------------------------- UFC -------------------------------

function bakedEvents() {
  return Array.isArray(bakedUfcEvents) ? bakedUfcEvents : [];
}

// "UFC 330: ..." e tambem "UFC 11.5" (evento proprio, diferente do UFC 11).
const NUMBERED_UFC = /^UFC\s+(\d+(?:\.\d+)?)(?![\d.])/i;

function ufcNumber(name) {
  const m = String(name || '').match(NUMBERED_UFC);
  return m ? m[1] : null;
}

function numberedScore(event) {
  const imdbAge = event.imdb ? 1 / Number(String(event.imdb).replace(/\D/g, '') || 1) : 0;
  return (
    (event.imdb ? 4 : 0) +
    (String(event.name).includes(':') ? 2 : 0) +
    (event.poster ? 1 : 0) +
    Math.min(1, (event.votes || 0) / 50) +
    imdbAge // desempate: o id IMDb mais antigo e o que os addons de streams conhecem
  );
}

// O TMDB tem por vezes o mesmo evento numerado em duas fichas (ou um marcador
// antigo sem IMDb, ex.: "UFC 320"). Fica uma por numero, a mais completa.
function dedupeNumbered(events) {
  const best = new Map();
  const others = [];
  for (const event of events) {
    const number = ufcNumber(event.name);
    if (!number) {
      others.push(event);
      continue;
    }
    const current = best.get(number);
    if (!current || numberedScore(event) > numberedScore(current)) best.set(number, event);
  }
  return [...best.values(), ...others];
}

function isValidUfcEvent(item) {
  return matches(UFC_EVENTS, item) && item.date && !franchises.isCompanion(item.name) && !franchises.isNoiseGenre(item);
}

// A pesquisa generica "UFC" nao chega a todos os eventos numerados (ha centenas
// de Fight Nights pelo meio): procura um a um os numeros que faltam ("UFC 325").
async function fillMissingNumbered(events, tmdbApi) {
  const have = new Set();
  let max = 0;
  for (const event of events) {
    const number = ufcNumber(event.name);
    if (!number || number.includes('.')) continue;
    const n = Number(number);
    have.add(n);
    if (n > max) max = n;
  }
  const missing = [];
  for (let n = 1; n <= max + 3; n++) if (!have.has(n)) missing.push(n);

  const results = await mapLimit(missing, tmdb.CONCURRENCY, tmdb.SPACING_MS, (n) =>
    tmdbApi.searchMovies(`UFC ${n}`, { maxPages: 1 })
  );
  const added = [];
  missing.forEach((n, i) => {
    for (const item of results[i] || []) {
      if (ufcNumber(item.name) === String(n) && isValidUfcEvent(item)) added.push(item);
    }
  });
  return dedupe([...events, ...added]);
}

async function fetchUfcEvents(client) {
  const tmdbApi = api(client);
  if (!tmdbApi) return [];
  const hits = await searchAll(tmdbApi, 'movie', UFC_EVENTS.movieQueries);
  const list = dedupe(hits.filter(isValidUfcEvent));
  const complete = await fillMissingNumbered(list, tmdbApi);
  const withIds = await withImdb(complete, tmdbApi);
  const events = sortByDateDesc(dedupeNumbered(withIds));
  return events.map((item) => ({ ...item, kind: 'movie', promoKey: 'ufc' }));
}

async function ufcEvents(client) {
  const tmdbApi = api(client);
  const key = 'store:ufc:events';
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  const fallback = hit ? hit.value : bakedEvents();
  if (fallback && fallback.length) {
    cache.set(key, fallback, TTL_PROMO_SEED);
    if (tmdbApi) {
      backgroundRefresh(key, TTL_UFC_LIST, async () => {
        const fresh = await fetchUfcEvents(tmdbApi);
        return fresh.length ? sortByDateDesc(dedupeNumbered(dedupe([...fallback, ...fresh]))) : fallback;
      });
    }
    return fallback;
  }
  if (!tmdbApi) return [];
  return cache.memo(key, TTL_UFC_LIST, () => fetchUfcEvents(tmdbApi), { staleMs: 30 * 24 * HOUR });
}

module.exports = {
  baked,
  fetchPromotion,
  promotionData,
  promotionCatalog,
  buildFranchises,
  findTv,
  findMovie,
  findByImdb,
  findTvByImdb,
  findFranchise,
  tvEpisodes,
  findEpisode,
  recent,
  ufcEvents,
  fetchUfcEvents,
  topEvents,
  dedupeNumbered,
  ufcNumber,
  isRecent,
};
