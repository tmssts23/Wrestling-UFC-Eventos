// Cliente da API do TMDB (https://developer.themoviedb.org/), a fonte de dados do addon.
//
// A chave pode vir de dois sitios:
//   1. da configuracao de cada instalacao (campo na pagina /configure), ou
//   2. das variaveis de ambiente TMDB_API_KEY / TMDB_ACCESS_TOKEN do servidor.
// Usa-se `client(chave)` para obter um cliente ligado a uma chave; a cache e
// partilhada por conteudo (nao por chave), porque a resposta do TMDB e a mesma.
const { getJson } = require('./httpx');
const cache = require('./cache');

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const HOUR = 60 * 60 * 1000;

const TTL_SEARCH = 12 * HOUR;
const TTL_DETAIL = 24 * HOUR;
const TTL_SEASON = 6 * HOUR;

const ENV_KEY = process.env.TMDB_API_KEY || '';
const ENV_TOKEN = process.env.TMDB_ACCESS_TOKEN || '';
const LANG = process.env.TMDB_LANGUAGE || 'pt-PT';
const FALLBACK_LANG = 'en-US';

// O TMDB aceita cerca de 50 pedidos por segundo; 6 em paralelo com 40ms de
// intervalo fica bem dentro do limite.
const CONCURRENCY = 6;
const SPACING_MS = 40;

// Chave v3: 32 caracteres hexadecimais. Token v4: JWT, comeca por "ey".
const V3_KEY = /^[a-f0-9]{32}$/i;
const V4_TOKEN = /^ey[A-Za-z0-9._-]{20,}$/;

function looksLikeKey(value) {
  const text = String(value || '').trim();
  return V3_KEY.test(text) || V4_TOKEN.test(text);
}

function resolveAuth(key) {
  const text = String(key || '').trim();
  if (V4_TOKEN.test(text)) return { token: text };
  if (text) return { key: text };
  if (ENV_TOKEN) return { token: ENV_TOKEN };
  if (ENV_KEY) return { key: ENV_KEY };
  return {};
}

function hasAuth(auth) {
  return Boolean(auth && (auth.key || auth.token));
}

function url(auth, pathname, params = {}) {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(name, String(value));
  }
  if (auth.key) search.set('api_key', auth.key);
  const qs = search.toString();
  return `${API}${pathname}${qs ? `?${qs}` : ''}`;
}

async function call(auth, pathname, params = {}, opts = {}) {
  if (!hasAuth(auth)) return null;
  const headers = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
  return getJson(url(auth, pathname, params), { headers, timeout: 20000, ...opts });
}

function img(path, size) {
  return path ? `${IMG}/${size}${path}` : null;
}

function year(dateIso) {
  return dateIso ? Number(String(dateIso).slice(0, 4)) : null;
}

// ------------------------------- normalizacao -------------------------------

function normalizeMovie(raw) {
  if (!raw || !raw.id) return null;
  const date = raw.release_date ? String(raw.release_date).slice(0, 10) : null;
  const external = raw.external_ids || {};
  return {
    kind: 'movie',
    id: raw.id,
    name: String(raw.title || raw.original_title || '').trim(),
    originalName: raw.original_title || null,
    date,
    year: year(date),
    summary: raw.overview ? String(raw.overview).trim() : '',
    poster: img(raw.poster_path, 'w780'),
    background: img(raw.backdrop_path, 'original'),
    runtime: raw.runtime || null,
    rating: raw.vote_average ? Number(raw.vote_average).toFixed(1) : null,
    votes: raw.vote_count || null,
    // Popularidade do TMDB (interesse recente); usada no Top 3 de cada promocao.
    popularity: raw.popularity ? Number(Number(raw.popularity).toFixed(3)) : null,
    genres: Array.isArray(raw.genres) ? raw.genres.map((g) => g.name) : [],
    genreIds: Array.isArray(raw.genre_ids)
      ? raw.genre_ids
      : Array.isArray(raw.genres)
        ? raw.genres.map((g) => g.id)
        : [],
    homepage: raw.homepage || null,
    imdb: raw.imdb_id || external.imdb_id || null,
  };
}

function normalizeEpisode(raw, seasonNumber) {
  if (!raw) return null;
  return {
    season: Number(raw.season_number == null ? seasonNumber : raw.season_number),
    number: Number(raw.episode_number) || 0,
    name: String(raw.name || '').trim(),
    airdate: raw.air_date ? String(raw.air_date).slice(0, 10) : null,
    airstamp: null,
    runtime: raw.runtime || null,
    summary: raw.overview ? String(raw.overview).trim() : '',
    image: img(raw.still_path, 'w780'),
    rating: raw.vote_average ? Number(raw.vote_average).toFixed(1) : null,
  };
}

function normalizeTv(raw) {
  if (!raw || !raw.id) return null;
  const premiered = raw.first_air_date ? String(raw.first_air_date).slice(0, 10) : null;
  const ended = raw.last_air_date ? String(raw.last_air_date).slice(0, 10) : null;
  const external = raw.external_ids || {};
  return {
    kind: 'tv',
    id: raw.id,
    name: String(raw.name || raw.original_name || '').trim(),
    originalName: raw.original_name || null,
    premiered,
    ended,
    year: year(premiered),
    status: raw.status || null,
    inProduction: raw.in_production === true,
    summary: raw.overview ? String(raw.overview).trim() : '',
    poster: img(raw.poster_path, 'w780'),
    background: img(raw.backdrop_path, 'original'),
    rating: raw.vote_average ? Number(raw.vote_average).toFixed(1) : null,
    genres: Array.isArray(raw.genres) ? raw.genres.map((g) => g.name) : [],
    network: Array.isArray(raw.networks) && raw.networks.length ? raw.networks[0].name : null,
    seasons: Array.isArray(raw.seasons)
      ? raw.seasons
          .filter((s) => Number(s.season_number) > 0)
          .map((s) => ({
            number: Number(s.season_number),
            name: s.name || null,
            episodeCount: s.episode_count || 0,
            premiered: s.air_date ? String(s.air_date).slice(0, 10) : null,
          }))
      : [],
    homepage: raw.homepage || null,
    imdb: external.imdb_id || null,
    tvdb: external.tvdb_id || null,
    lastEpisode: raw.last_episode_to_air ? normalizeEpisode(raw.last_episode_to_air) : null,
    nextEpisode: raw.next_episode_to_air ? normalizeEpisode(raw.next_episode_to_air) : null,
  };
}

// ------------------------------- pedidos -------------------------------

async function searchPaged(auth, kind, query, { maxPages = 5 } = {}) {
  return cache.memo(
    `tmdb:search:${kind}:${query.toLowerCase()}:${maxPages}:${LANG}`,
    TTL_SEARCH,
    async () => {
      const out = [];
      const normalize = kind === 'movie' ? normalizeMovie : normalizeTv;
      let pages = 1;
      for (let page = 1; page <= Math.min(maxPages, pages); page++) {
        const params = { query, page, include_adult: 'false' };
        // A pesquisa em pt-PT so traz sinopse quando ha traducao; pede-se a
        // mesma pagina em ingles e usa-se esse texto quando o pt-PT vem vazio.
        const [json, fallback] = await Promise.all([
          call(auth, `/search/${kind}`, { ...params, language: LANG }),
          call(auth, `/search/${kind}`, { ...params, language: FALLBACK_LANG }),
        ]);
        if (!json || !Array.isArray(json.results)) break;
        pages = Number(json.total_pages) || 1;
        const englishById = new Map(
          ((fallback && fallback.results) || []).map((item) => [item.id, item.overview || ''])
        );
        for (const item of json.results) {
          const norm = normalize(item);
          if (!norm || !norm.name) continue;
          if (!norm.summary && englishById.get(norm.id)) norm.summary = String(englishById.get(norm.id)).trim();
          out.push(norm);
        }
      }
      return out;
    },
    { staleMs: 7 * 24 * HOUR }
  );
}

// O TMDB deixa muitas sinopses por traduzir: se vier vazia em pt-PT, vai a EN.
async function withOverviewFallback(item, fetchFallback) {
  if (!item || item.summary) return item;
  const fallback = await fetchFallback();
  if (fallback && fallback.summary) return { ...item, summary: fallback.summary };
  return item;
}

async function movieDetails(auth, id) {
  return cache.memo(
    `tmdb:movie:${id}:${LANG}`,
    TTL_DETAIL,
    async () => {
      const norm = normalizeMovie(
        await call(auth, `/movie/${id}`, { language: LANG, append_to_response: 'external_ids' })
      );
      if (!norm) return null;
      return withOverviewFallback(norm, async () =>
        normalizeMovie(await call(auth, `/movie/${id}`, { language: FALLBACK_LANG }))
      );
    },
    { staleMs: 30 * 24 * HOUR }
  );
}

async function tvDetails(auth, id) {
  return cache.memo(
    `tmdb:tv:${id}:${LANG}`,
    TTL_DETAIL,
    async () => {
      const norm = normalizeTv(await call(auth, `/tv/${id}`, { language: LANG, append_to_response: 'external_ids' }));
      if (!norm) return null;
      return withOverviewFallback(norm, async () =>
        normalizeTv(await call(auth, `/tv/${id}`, { language: FALLBACK_LANG }))
      );
    },
    { staleMs: 30 * 24 * HOUR }
  );
}

async function seasonEpisodes(auth, tvId, seasonNumber) {
  return cache.memo(
    `tmdb:season:${tvId}:${seasonNumber}:${LANG}`,
    TTL_SEASON,
    async () => {
      const json = await call(auth, `/tv/${tvId}/season/${seasonNumber}`, { language: LANG });
      if (!json || !Array.isArray(json.episodes)) return [];
      return json.episodes.map((ep) => normalizeEpisode(ep, seasonNumber)).filter((ep) => ep && ep.number > 0);
    },
    { staleMs: 14 * 24 * HOUR }
  );
}

// Id do IMDb de um filme. A pesquisa nao o traz, e sem ele os addons de streams
// nao reconhecem o evento. Guarda-se tambem o "nao tem", para nao repetir o pedido.
async function movieExternalIds(auth, id) {
  return cache.memo(
    `tmdb:movie-ext:${id}`,
    30 * 24 * HOUR,
    async () => {
      const json = await call(auth, `/movie/${id}/external_ids`, {}, { retries: 2 });
      return json ? { imdb: json.imdb_id || null } : null;
    },
    { staleMs: 90 * 24 * HOUR }
  );
}

// Onde o titulo esta disponivel num pais (dados JustWatch servidos pelo TMDB).
async function watchProviders(auth, kind, id, country = 'PT') {
  return cache.memo(
    `tmdb:providers:${kind}:${id}:${country}`,
    24 * HOUR,
    async () => {
      const json = await call(auth, `/${kind}/${id}/watch/providers`, {}, { retries: 1 });
      if (!json) return null;
      const entry = json.results && json.results[country];
      if (!entry) return { link: null, names: [] };
      const names = [];
      for (const group of ['flatrate', 'free', 'ads', 'rent', 'buy']) {
        for (const provider of entry[group] || []) {
          if (provider.provider_name && !names.includes(provider.provider_name)) names.push(provider.provider_name);
        }
      }
      return { link: entry.link || null, names };
    },
    { staleMs: 7 * 24 * HOUR }
  );
}

// Valida a chave com um pedido barato ao TMDB.
async function validateKey(key) {
  const auth = resolveAuth(key);
  if (!hasAuth(auth)) return { ok: false, erro: 'sem chave' };
  const json = await call(auth, '/configuration', {}, { retries: 1 });
  if (json && json.images) return { ok: true };
  return { ok: false, erro: 'chave recusada pelo TMDB' };
}

// Cliente ligado a uma chave (a da instalacao ou a do servidor).
function client(key) {
  const auth = resolveAuth(key);
  return {
    enabled: hasAuth(auth),
    searchMovies: (query, opts) => searchPaged(auth, 'movie', query, opts),
    searchTv: (query, opts) => searchPaged(auth, 'tv', query, opts),
    movie: (id) => movieDetails(auth, id),
    tv: (id) => tvDetails(auth, id),
    season: (tvId, seasonNumber) => seasonEpisodes(auth, tvId, seasonNumber),
    watchProviders: (kind, id, country) => watchProviders(auth, kind, id, country),
    movieImdb: async (id) => {
      const ids = await movieExternalIds(auth, id);
      return ids ? ids.imdb : null;
    },
  };
}

function envEnabled() {
  return hasAuth(resolveAuth(''));
}

module.exports = {
  API,
  IMG,
  LANG,
  CONCURRENCY,
  SPACING_MS,
  client,
  envEnabled,
  looksLikeKey,
  validateKey,
  img,
  normalizeMovie,
  normalizeTv,
  normalizeEpisode,
};
