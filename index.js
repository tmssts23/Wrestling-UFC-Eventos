const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./lib/store');
const tmdb = require('./lib/tmdb');
const metaBuilder = require('./lib/meta');
const streams = require('./lib/streams');
const youtube = require('./lib/youtube');

// No Stremio cada addon aparece quando responde, por isso esperar mais pelo YouTube
// nao atrasa os streams dos outros addons.
const YOUTUBE_TIMEOUT_MS = 12000;

// A pesquisa no YouTube nao pode empatar a lista de streams: se demorar, a
// resposta segue sem videos e a pesquisa acaba em segundo plano (fica em cache).
async function youtubeVideos(ctx) {
  const pending = youtube.findVideos(ctx).catch(() => []);
  const timeout = new Promise((resolve) => setTimeout(() => resolve([]), YOUTUBE_TIMEOUT_MS));
  return Promise.race([pending, timeout]);
}
const catalogs = require('./lib/catalogs');
const { promotion } = require('./lib/promotions');

const DEFAULT_PORT = Number(process.env.PORT) || 7100;
const HOST = '0.0.0.0';
const LOG_PREFIX = '[WrestlingUFC]';
const MAX_PORT_RETRIES = 10;
let activePort = DEFAULT_PORT;
let remainingPortRetries = MAX_PORT_RETRIES;

const ADDON_ID = 'pt.wrestling-ufc-eventos';
const ADDON_NAME = 'Wrestling & UFC — Eventos (WWE, AEW, TNA, UFC)';
const VERSION = '1.2.0';
const PAGE_SIZE = 100;
const UFC_PAGE_SIZE = 60;
const USER_WINDOW_MS = 24 * 60 * 60 * 1000;

const activeUsers = new Map();
let totalRequests = 0;
const ANON_SALT = crypto.randomBytes(16).toString('hex');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ------------------------------- helpers -------------------------------

function originFromRequest(req) {
  const host = req.headers.host || `127.0.0.1:${activePort}`;
  const protoRaw = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const proto = protoRaw === 'https' ? 'https' : 'http';
  return `${proto}://${host}`;
}

function parseReqUrl(req) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  return { pathname: url.pathname, query: Object.fromEntries(url.searchParams.entries()) };
}

function parsePath(pathname) {
  return String(pathname || '')
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
}

function safeDecode(raw) {
  let s = String(raw || '');
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(s.replace(/\+/g, ' '));
      if (next === s) break;
      s = next;
    } catch (_) {
      break;
    }
  }
  return s;
}

function normalizeText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extras do Stremio podem vir no caminho (genre=X&skip=100) ou na query string.
function parseExtras(pathParts, startIndex, query) {
  const out = { ...query };
  for (let i = startIndex; i < pathParts.length; i++) {
    const seg = String(pathParts[i]).replace(/\.json$/i, '');
    for (const pair of seg.split('&')) {
      if (!pair) continue;
      const key = pair.split('=')[0];
      const value = pair.includes('=') ? pair.slice(pair.indexOf('=') + 1) : '';
      if (key) out[key] = safeDecode(value);
    }
  }
  return out;
}

function clientKey(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').trim();
  const ip = xff ? xff.split(',')[0].trim() : String(req.socket ? req.socket.remoteAddress : 'unknown');
  const ua = String(req.headers['user-agent'] || 'unknown');
  return crypto.createHash('sha256').update(`${ANON_SALT}|${ip}|${ua}`).digest('hex').slice(0, 20);
}

function logUsage(route, userKey, details = '') {
  const now = Date.now();
  for (const [key, ts] of activeUsers.entries()) if (now - ts > USER_WINDOW_MS) activeUsers.delete(key);
  activeUsers.set(userKey, now);
  totalRequests += 1;
  console.log(
    `${LOG_PREFIX} [uso] rota=${route} utilizadores_24h=${activeUsers.size} pedidos=${totalRequests}${details ? ` ${details}` : ''}`
  );
}

function sendJson(res, method, status, payload, cacheSeconds = 0) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
    // Sem "stale-while-revalidate": com ele a app mostrava a versao guardada e so
    // actualizava em segundo plano, e uma ficha antiga (sem episodios) continuava a
    // aparecer ate 2 h depois de corrigida. Sem cacheSeconds: "no-store".
    'Cache-Control': cacheSeconds ? `max-age=${cacheSeconds}, public` : 'no-store',
  });
  if (method === 'HEAD') return res.end();
  res.end(body);
}

function sendText(res, method, status, text, contentType = 'text/plain; charset=utf-8') {
  const body = String(text == null ? '' : text);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body, 'utf8'),
  });
  if (method === 'HEAD') return res.end();
  res.end(body);
}

// Caminhos escritos por extenso: o empacotador da Vercel (@vercel/nft) so inclui
// no deploy os ficheiros cujo caminho consegue ler no codigo. Assim o vercel.json
// nao precisa de "includeFiles" e fica igual ao do addon de animacao.
const PUBLIC_FILES = {
  'configure.html': [
    path.join(__dirname, 'public', 'configure.html'),
    path.join(__dirname, 'dist', 'public', 'configure.html'),
  ],
  'addon-logo.svg': [
    path.join(__dirname, 'public', 'addon-logo.svg'),
    path.join(__dirname, 'dist', 'public', 'addon-logo.svg'),
  ],
};

function publicFile(name) {
  for (const file of PUBLIC_FILES[name] || []) if (fs.existsSync(file)) return file;
  return null;
}

function sendPublic(res, method, name, contentType) {
  const file = publicFile(name);
  if (!file) return sendText(res, method, 404, 'Not found');
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    ...CORS,
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'max-age=3600, public',
  });
  if (method === 'HEAD') return res.end();
  res.end(body);
}

function escapeXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Poster gerado pelo addon, usado quando o TMDB nao tem imagem.
function posterSvg({ title, subtitle, tone }) {
  const palettes = {
    wwe: ['#1b2a4a', '#c8102e'],
    aew: ['#101820', '#d4af37'],
    tna: ['#0d1b2a', '#1d9bf0'],
    roh: ['#141414', '#8b0000'],
    ufc: ['#0b0b0b', '#d20a0a'],
    ufcshows: ['#0b0b0b', '#d20a0a'],
    default: ['#161b22', '#4b6cb7'],
  };
  const [from, to] = palettes[tone] || palettes.default;
  const words = String(title || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > 16) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = `${current} ${word}`;
    }
    if (lines.length >= 4) break;
  }
  if (current && lines.length < 5) lines.push(current.trim());

  const texto = lines
    .map((line, i) => `<text x="150" y="${250 + i * 44}" text-anchor="middle" class="t">${escapeXml(line)}</text>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <style>
    .t { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 34px; font-weight: 700; fill: #ffffff; }
    .s { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 20px; fill: rgba(255,255,255,.82); }
  </style>
  <rect width="300" height="450" fill="url(#g)"/>
  <rect x="18" y="18" width="264" height="414" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2" rx="10"/>
  <circle cx="150" cy="120" r="46" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="6"/>
  <path d="M124 120 h52 M150 94 v52" stroke="rgba(255,255,255,.5)" stroke-width="6" stroke-linecap="round"/>
  ${texto}
  <text x="150" y="412" text-anchor="middle" class="s">${escapeXml(subtitle || '')}</text>
</svg>`;
}

function fallbackPoster(originBase, title, subtitle, tone) {
  const params = new URLSearchParams({ t: title || '', s: subtitle || '', c: tone || 'default' });
  return `${originBase}/art/poster.svg?${params.toString()}`;
}

// ------------------------------- manifest -------------------------------

function genreOptions(def) {
  if (def.kind === 'promo') {
    return [
      metaBuilder.SHOW_TAGS.ppv,
      metaBuilder.SHOW_TAGS.weekly,
      metaBuilder.SHOW_TAGS.collection,
      metaBuilder.SHOW_TAGS.single,
      metaBuilder.SHOW_TAGS.running,
      metaBuilder.SHOW_TAGS.archive,
    ];
  }
  if (def.kind === 'ufc') return [metaBuilder.UFC_TAGS.upcoming];
  if (def.kind === 'ufcfn') {
    return [
      metaBuilder.UFC_TAGS.fightNight,
      metaBuilder.UFC_TAGS.network,
      metaBuilder.UFC_TAGS.tuf,
      metaBuilder.UFC_TAGS.upcoming,
    ];
  }
  return [];
}

function catalogExtras(def, fight) {
  const extras = [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }];
  const options = genreOptions(def);
  if (fight) {
    // Genero obrigatorio: o Stremio nao mostra estes catalogos no ecra principal,
    // so no separador Fight do Explorar, com "Todos" escolhido por omissao.
    extras.unshift({ name: 'genre', isRequired: true, options: [catalogs.ALL_GENRE, ...options] });
  } else if (options.length) {
    extras.unshift({ name: 'genre', isRequired: false, options });
  }
  return extras;
}

function getManifest(originBase, config) {
  const chosen = catalogs.selected(config);
  const logo = originBase ? `${originBase}/addon-logo.svg` : undefined;
  return {
    id: ADDON_ID,
    version: VERSION,
    name: ADDON_NAME,
    description:
      'Catálogos de eventos de wrestling e MMA a partir do TMDB: WWE, AEW e TNA com programas por temporada, eventos agrupados por ano e cada PPV individual, um catálogo com o que saiu na última semana, e todos os eventos UFC do mais recente para o mais antigo — com pósteres, descrições e datas.',
    resources: ['catalog', 'meta', 'stream'],
    // "Fight" cria o separador no Explorar; movie/series mantem-se para o ecra
    // principal, as fichas e os streams.
    types: catalogs.isClassic(config) ? ['series', 'movie'] : ['series', 'movie', catalogs.FIGHT_TYPE],
    // "tt": os eventos com id IMDb usam-no nos catalogos, para os addons de streams responderem.
    idPrefixes: [metaBuilder.ID_PREFIX, 'tt'],
    ...(logo ? { logo, icon: logo } : {}),
    catalogs: catalogs.entries(config).map((entry) => {
      // So a notacao actual ("extra" com isRequired). A antiga (extraSupported /
      // extraRequired) duplicava a informacao e o validador de manifests acusava-a
      // como campos fora da especificacao.
      return {
        type: entry.type,
        id: entry.id,
        name: entry.name,
        extra: catalogExtras(entry.def, entry.fight),
      };
    }),
    // Sem chave TMDB (nem da instalacao nem do servidor) o Stremio pede para configurar.
    behaviorHints: { configurable: true, configurationRequired: !(config && config.key) && !tmdb.envEnabled() },
  };
}

// ------------------------------- catalogos -------------------------------

function slicePage(list, extra, pageSize) {
  const skip = Math.max(0, Number(extra.skip) || 0);
  return list.slice(skip, skip + pageSize);
}

function matchesSearch(text, search) {
  if (!search) return true;
  const needle = normalizeText(search);
  if (!needle) return true;
  return normalizeText(text).includes(needle);
}

function withFallbackPoster(preview, originBase, item, promoKey, subtitle) {
  if (!preview.poster) {
    const promo = promotion(promoKey);
    preview.poster = fallbackPoster(
      originBase,
      item.name,
      subtitle || (promo ? promo.name : 'Wrestling'),
      promoKey
    );
  }
  return preview;
}

// Programas com temporadas + coleccoes por ano + eventos individuais, juntos.
async function promoCatalog(def, extra, originBase, client) {
  const promo = promotion(def.promo);
  let list = await store.promotionCatalog(def.promo, client);

  const genre = String(extra.genre || '').trim();
  if (genre) list = list.filter((item) => metaBuilder.itemTags(item).includes(genre));
  const search = String(extra.search || '').trim();
  if (search) list = list.filter((item) => matchesSearch(`${item.name} ${promo ? promo.name : ''}`, search));

  return slicePage(list, extra, PAGE_SIZE).map((item) =>
    withFallbackPoster(metaBuilder.preview(item, def.promo), originBase, item, def.promo, metaBuilder.ptDate(item.date))
  );
}

// Ultimos 7 dias: episodios emitidos e eventos lancados na semana.
async function recentCatalog(def, extra, originBase, client) {
  let list = await store.recent(def.promo, 7, client);

  const search = String(extra.search || '').trim();
  if (search) {
    list = list.filter((entry) => {
      const name = entry.kind === 'movie' ? entry.movie.name : `${entry.show.name} ${entry.episode.name || ''}`;
      return matchesSearch(name, search);
    });
  }

  return slicePage(list, extra, PAGE_SIZE).map((entry) => {
    if (entry.kind === 'movie') {
      const item = { ...entry.movie, kind: 'movie', promoKey: def.promo };
      return withFallbackPoster(
        metaBuilder.preview(item, def.promo),
        originBase,
        item,
        def.promo,
        metaBuilder.ptDate(entry.movie.date)
      );
    }
    const item = { ...entry.show, kind: 'tv', promoKey: def.promo };
    const preview = withFallbackPoster(
      metaBuilder.preview(item, def.promo, { episode: entry.episode }),
      originBase,
      item,
      def.promo,
      metaBuilder.ptDate(entry.episode.airdate)
    );
    // Abre directamente o episodio desta data, e nao a lista de temporadas.
    return { ...preview, id: metaBuilder.episodeId(entry.show.id, entry.episode) };
  });
}

// Eventos ja realizados primeiro (do mais recente para o mais antigo);
// os agendados ficam no fim da lista.
function orderUfcEvents(list) {
  const past = [];
  const upcoming = [];
  for (const event of list) (metaBuilder.isUpcoming(event) ? upcoming : past).push(event);
  past.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  upcoming.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  return [...past, ...upcoming];
}

const NUMBERED_UFC = /^UFC\s+\d+(?:\.\d+)?(?![\d.])/i;

// "ufc": so eventos numerados (UFC 330: ...), os que costumam ter streams.
// "ufcfn": Fight Night, UFC on ESPN/ABC e restantes.
async function ufcCatalog(def, extra, originBase, client) {
  const numbered = def.kind === 'ufc';
  const events = (await store.ufcEvents(client)).filter((event) => NUMBERED_UFC.test(event.name) === numbered);
  let list = orderUfcEvents(events);

  const genre = String(extra.genre || '').trim();
  if (genre) list = list.filter((event) => metaBuilder.ufcTags(event).includes(genre));
  const search = String(extra.search || '').trim();
  if (search) list = list.filter((event) => matchesSearch(event.name, search));

  return slicePage(list, extra, UFC_PAGE_SIZE).map((event) => {
    const item = { ...event, kind: 'movie', promoKey: 'ufc' };
    return withFallbackPoster(
      metaBuilder.preview(item, 'ufc'),
      originBase,
      item,
      'ufc',
      metaBuilder.ptDate(event.date)
    );
  });
}

const TOP_MEDALS = ['🥇', '🥈', '🥉'];

const TOP_SIZE = 10;

// Top 10 de eventos de uma promocao (UFC: so numerados), so no Explorar.
async function topCatalog(def, extra, originBase, client) {
  const events =
    def.promo === 'ufc'
      ? (await store.ufcEvents(client)).filter((event) => NUMBERED_UFC.test(event.name))
      : (await store.promotionData(def.promo, client)).movies;
  return store.topEvents(events, TOP_SIZE).map((event, i) => {
    const item = { ...event, kind: 'movie', promoKey: def.promo };
    const preview = withFallbackPoster(
      metaBuilder.preview(item, def.promo),
      originBase,
      item,
      def.promo,
      metaBuilder.ptDate(event.date)
    );
    return { ...preview, name: `${TOP_MEDALS[i] || `#${i + 1}`} ${preview.name}` };
  });
}

async function handleCatalog(type, id, extra, originBase, client) {
  const def = catalogs.byId(id);
  // Aceita o tipo nativo e o separador Fight, para os dois modos de instalacao.
  if (!def || (def.type !== type && type !== catalogs.FIGHT_TYPE)) return { metas: [] };
  const filters = { ...extra };
  if (filters.genre === catalogs.ALL_GENRE) delete filters.genre;
  if (def.kind === 'promo') return { metas: await promoCatalog(def, filters, originBase, client) };
  if (def.kind === 'recent') return { metas: await recentCatalog(def, filters, originBase, client) };
  if (def.kind === 'ufc' || def.kind === 'ufcfn') return { metas: await ufcCatalog(def, filters, originBase, client) };
  if (def.kind === 'top') return { metas: await topCatalog(def, filters, originBase, client) };
  return { metas: [] };
}

// ------------------------------- meta -------------------------------

async function buildMeta(metaId, originBase, client) {
  const parsed = metaBuilder.parseId(metaId);
  if (!parsed) return null;

  if (parsed.kind === 'imdb') {
    const byImdb = await store.findByImdb(parsed.imdb, client);
    if (!byImdb) return null; // titulo que nao e deste addon: fica para o Cinemeta
    const meta = metaBuilder.movieMeta(byImdb.movie, byImdb.promoKey);
    if (!meta.poster) {
      meta.poster = fallbackPoster(originBase, byImdb.movie.name, metaBuilder.ptDate(byImdb.movie.date), byImdb.promoKey);
    }
    return meta;
  }

  if (parsed.kind === 'episode') {
    const found = await store.findTv(parsed.tvId, client);
    if (!found) return null;
    const episode = await store.findEpisode(parsed.tvId, parsed.season, parsed.number, client);
    if (!episode) return null;
    const meta = metaBuilder.episodeMeta(found.show, found.promoKey, episode);
    if (!meta.poster) {
      meta.poster = fallbackPoster(originBase, found.show.name, metaBuilder.ptDate(episode.airdate), found.promoKey);
    }
    return meta;
  }

  if (parsed.kind === 'tv') {
    const found = await store.findTv(parsed.id, client);
    if (!found) return null;
    const episodes = await store.tvEpisodes(parsed.id, client);
    const meta = metaBuilder.tvMeta(found.show, found.promoKey, episodes);
    if (!episodes.length && !client.enabled) {
      meta.description = `Para ver as temporadas e os episódios, reinstala o addon com a tua chave do TMDB em ${originBase}/configure\n\n${meta.description}`;
    }
    if (!meta.poster) meta.poster = fallbackPoster(originBase, found.show.name, 'Wrestling', found.promoKey);
    return meta;
  }

  if (parsed.kind === 'franchise') {
    const group = await store.findFranchise(parsed.promoKey, parsed.slug, client);
    if (!group) return null;
    const meta = metaBuilder.franchiseMeta(group);
    if (!meta.poster) meta.poster = fallbackPoster(originBase, group.name, `${group.editions} edições`, group.promoKey);
    return meta;
  }

  const found = await store.findMovie(parsed.id, client);
  if (!found) return null;
  const meta = metaBuilder.movieMeta(found.movie, found.promoKey);
  if (!meta.poster) {
    meta.poster = fallbackPoster(originBase, found.movie.name, metaBuilder.ptDate(found.movie.date), found.promoKey);
  }
  return meta;
}

async function handleMeta(type, id, originBase, client) {
  const metaId = safeDecode(String(id || '').replace(/\.json$/i, ''));
  const meta = await buildMeta(metaId, originBase, client);
  return { meta: meta || null };
}

// ------------------------------- streams -------------------------------

// Opcoes de pesquisa pelo titulo, so para titulos deste addon. Chegam dois formatos:
//   evento:   tt123 | wwrs-mv-123
//   episodio: tt123:temporada:episodio | wwrs-tv-123:temporada:episodio
async function handleStream(type, rawId, originBase, client) {
  const id = safeDecode(String(rawId || '').replace(/\.json$/i, ''));
  const [base, seasonText, episodeText] = id.split(':');
  const isEpisode = seasonText !== undefined && episodeText !== undefined;

  if (isEpisode) {
    const season = Number(seasonText);
    const number = Number(episodeText);
    let found = null;
    if (/^tt\d+$/.test(base)) {
      found = await store.findTvByImdb(base, client);
    } else {
      const parsed = metaBuilder.parseId(base);
      if (parsed && parsed.kind === 'tv') found = await store.findTv(parsed.id, client);
    }
    if (!found) return { streams: [] };

    // Mesma fonte e numeracao das fichas (Cinemeta > TMDB > TVmaze), com ou sem chave.
    const episode = await store.findEpisode(found.show.id, season, number, client);
    const query = streams.episodeQuery(found.show, found.promoKey, episode, season, number);
    const label = `${found.show.name} · T${season} E${number}${episode && episode.name ? ` — ${episode.name}` : ''}`;
    const [providers, videos] = await Promise.all([
      client.enabled ? client.watchProviders('tv', found.show.id) : null,
      youtubeVideos({
        query,
        title: episode && !streams.isGenericEpisodeName(episode.name) ? query : found.show.name,
        showName: found.show.name,
        promoLabel: streams.withPromo('', found.promoKey).trim() || found.show.name,
        airdate: episode && episode.airdate,
        // Episodio de programa semanal: a pesquisa filtra sempre pela data de emissao.
        program: true,
        episodeName: episode ? episode.name : null,
        // Datas do Cinemeta podem vir com 1 dia de diferenca.
        dateTolerance: episode && episode.source === 'cinemeta' ? 1 : 0,
        genericEpisode: !episode || streams.isGenericEpisodeName(episode.name),
        promoKey: found.promoKey,
      }),
    ]);
    return {
      streams: streams.build({
        query,
        label,
        date: episode && episode.airdate,
        promoKey: found.promoKey,
        providers,
        videos,
      }),
    };
  }

  let found = null;
  if (/^tt\d+$/.test(base)) {
    found = await store.findByImdb(base, client);
  } else {
    const parsed = metaBuilder.parseId(base);
    if (parsed && parsed.kind === 'movie') found = await store.findMovie(parsed.id, client);
  }
  if (!found) return { streams: [] };

  const query = streams.movieQuery(found.movie, found.promoKey);
  // O ano na pesquisa separa edicoes com o mesmo nome (All In: London 2024 / 2025).
  const year = found.movie.year || (found.movie.date ? Number(found.movie.date.slice(0, 4)) : null);
  const ytQuery = year && !String(query).includes(String(year)) ? `${query} ${year}` : query;
  const [providers, videos] = await Promise.all([
    client.enabled ? client.watchProviders('movie', found.movie.id) : null,
    youtubeVideos({ query: ytQuery, title: query, year, promoKey: found.promoKey }),
  ]);
  return {
    streams: streams.build({
      query,
      label: found.movie.name,
      date: found.movie.date,
      promoKey: found.promoKey,
      providers,
      videos,
    }),
  };
}

// ------------------------------- configure -------------------------------

function configurePage(originBase) {
  const file = publicFile('configure.html');
  // Cada linha leva o texto nos dois idiomas; a pagina troca sem recarregar.
  const rows = catalogs.CATALOGS.map((def) => {
    const [nameEn, labelEn] = catalogs.EN_TEXT[def.token] || [def.name, def.label];
    return `
      <label class="row">
        <input type="checkbox" value="${def.token}" ${def.byDefault ? 'checked' : ''} />
        <span class="name" data-pt="${escapeXml(def.name)}" data-en="${escapeXml(nameEn)}">${def.name}</span>
        <span class="hint" data-pt="${escapeXml(def.label)}" data-en="${escapeXml(labelEn)}">${def.label}</span>
      </label>`;
  }).join('\n');
  const html = file ? fs.readFileSync(file, 'utf8') : '<html><body>configure.html em falta</body></html>';
  return html.replace('<!--CATALOGS-->', rows).replace(/__ORIGIN__/g, originBase);
}

// ------------------------------- router -------------------------------

async function requestHandler(req, res) {
  const method = req.method || 'GET';
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (method !== 'GET' && method !== 'HEAD') return sendText(res, method, 405, 'Method Not Allowed');

  const { pathname, query } = parseReqUrl(req);
  const originBase = originFromRequest(req);
  const userKey = clientKey(req);
  let parts = parsePath(pathname);

  // Primeiro segmento pode ser a configuracao escolhida na instalacao.
  let configRaw = '';
  if (parts.length && !catalogs.isResourceWord(parts[0])) {
    configRaw = parts[0];
    parts = parts.slice(1);
  }
  const config = catalogs.parseConfig(configRaw);
  const client = tmdb.client(config.key);
  const head = (parts[0] || '').toLowerCase();

  try {
    if (!parts.length || head === 'configure') {
      if (!parts.length && pathname !== '/' && !pathname.endsWith('/')) return sendText(res, method, 404, 'Not found');
      logUsage('configure', userKey);
      return sendText(res, method, 200, configurePage(originBase), 'text/html; charset=utf-8');
    }
    if (head === 'manifest.json') {
      logUsage('manifest', userKey, `config=${config.tokens.join(',')}`);
      return sendJson(res, method, 200, getManifest(originBase, config), 1800);
    }
    if (head === 'addon-logo.svg') return sendPublic(res, method, 'addon-logo.svg', 'image/svg+xml; charset=utf-8');
    if (head === 'health') {
      return sendJson(res, method, 200, {
        ok: true,
        version: VERSION,
        fonte: 'tmdb',
        chaveServidor: tmdb.envEnabled(),
        chaveInstalacao: Boolean(config.key),
        idioma: tmdb.LANG,
        utilizadores24h: activeUsers.size,
        pedidos: totalRequests,
      });
    }
    // Usado pela pagina /configure para confirmar a chave antes de instalar.
    if (head === 'validar-chave') {
      const key = String(query.k || '').trim();
      if (!tmdb.looksLikeKey(key)) return sendJson(res, method, 200, { ok: false, erro: 'formato inválido' });
      return sendJson(res, method, 200, await tmdb.validateKey(key));
    }
    if (head === 'art' && (parts[1] || '').toLowerCase() === 'poster.svg') {
      const svg = posterSvg({ title: query.t, subtitle: query.s, tone: query.c });
      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(svg, 'utf8'),
        'Cache-Control': 'max-age=86400, public',
      });
      if (method === 'HEAD') return res.end();
      return res.end(svg);
    }
    if (head === 'catalog' && parts.length >= 3) {
      const type = parts[1];
      const id = String(parts[2]).replace(/\.json$/i, '');
      const extra = parseExtras(parts, 3, query);
      logUsage(
        'catalog',
        userKey,
        `type=${type} id=${id} chave=${client.enabled ? 'sim' : 'nao'}${extra.genre ? ` genre=${extra.genre}` : ''}${extra.search ? ` search=${extra.search}` : ''}`
      );
      const out = await handleCatalog(type, id, extra, originBase, client);
      // Catalogo vazio pode ser falha passageira: cache curta.
      return sendJson(res, method, 200, out, out.metas.length ? 900 : 60);
    }
    if (head === 'meta' && parts.length >= 3) {
      const type = parts[1];
      const id = String(parts[2]).replace(/\.json$/i, '');
      const out = await handleMeta(type, id, originBase, client);
      // Com o prefixo "tt", o Stremio pergunta por todos os titulos IMDb que o
      // utilizador abre; so se regista o que e deste addon.
      const degraded =
        out.meta &&
        ((out.meta.type === 'series' && (!out.meta.videos || !out.meta.videos.length)) ||
          String(out.meta.description || '').startsWith('Para ver'));
      if (out.meta || !/^tt\d+$/.test(id)) {
        const videos = out.meta && out.meta.videos ? out.meta.videos.length : 0;
        logUsage('meta', userKey, `type=${type} id=${id} chave=${client.enabled ? 'sim' : 'nao'} videos=${videos}`);
      }
      if (!out.meta) return sendJson(res, method, 404, { meta: null });
      // Fichas sem episodios (ou com o aviso da chave) nao ficam em cache na app.
      return sendJson(res, method, 200, out, degraded ? 0 : 600);
    }
    if (head === 'stream' && parts.length >= 3) {
      const type = parts[1];
      const id = String(parts[2]).replace(/\.json$/i, '');
      const out = await handleStream(type, id, originBase, client);
      // So se regista o que e deste addon (o prefixo "tt" traz pedidos de tudo).
      if (out.streams.length) {
        logUsage('stream', userKey, `type=${type} id=${id} chave=${client.enabled ? 'sim' : 'nao'} opcoes=${out.streams.length}`);
      }
      return sendJson(res, method, 200, out, out.streams.length ? 3600 : 86400);
    }
    return sendText(res, method, 404, 'Not found');
  } catch (err) {
    const msg = (err && err.message) || String(err);
    console.error(`${LOG_PREFIX} erro HTTP: ${msg}`);
    return sendJson(res, method, 500, { error: msg });
  }
}

const server = http.createServer((req, res) => {
  requestHandler(req, res);
});

function startListening(port) {
  activePort = port;
  server.listen(activePort, HOST, () => {
    console.log(`${LOG_PREFIX} addon a correr em http://127.0.0.1:${activePort}`);
    console.log(`${LOG_PREFIX} manifest: http://127.0.0.1:${activePort}/manifest.json`);
    console.log(`${LOG_PREFIX} configurar: http://127.0.0.1:${activePort}/configure`);
    if (!tmdb.envEnabled()) {
      console.log(
        `${LOG_PREFIX} sem TMDB_API_KEY no servidor: cada instalacao usa a chave indicada em /configure.`
      );
    }
  });
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE' && remainingPortRetries > 0) {
    const nextPort = activePort + 1;
    remainingPortRetries -= 1;
    console.warn(`${LOG_PREFIX} porta ${activePort} ocupada, a tentar ${nextPort}...`);
    return setTimeout(() => startListening(nextPort), 150);
  }
  console.error(`${LOG_PREFIX} erro do servidor: ${err.message}`);
  process.exit(1);
});

if (require.main === module) startListening(activePort);

module.exports = { requestHandler, getManifest };
