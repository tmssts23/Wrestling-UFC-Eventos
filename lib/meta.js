// Construcao dos objectos de metadados no formato do Stremio (usado tambem pelo Nuvio).
// Os dados vem todos do TMDB (ver lib/tmdb.js).
//
// Tres tipos de item convivem nos mesmos catalogos:
//   tv        - programa com temporadas e episodios (Raw, SmackDown, Dynamite...)
//   franchise - evento recorrente agrupado por ano (WrestleMania, All Out...)
//   movie     - evento individual (cada PPV/UFC e um filme no TMDB)
const { promotion } = require('./promotions');

const ID_PREFIX = 'wwrs-';
const TV_PREFIX = 'wwrs-tv-';
const FRANCHISE_PREFIX = 'wwrs-fr-';
const MOVIE_PREFIX = 'wwrs-mv-';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const RECENT_MONTHS = 18;

function tvId(id) {
  return `${TV_PREFIX}${id}`;
}

function franchiseId(promoKey, slug) {
  return `${FRANCHISE_PREFIX}${promoKey}-${slug}`;
}

function movieId(id) {
  return `${MOVIE_PREFIX}${id}`;
}

function parseId(metaId) {
  const clean = String(metaId || '').replace(/\.json$/i, '');
  let m = clean.match(/^(tt\d+)$/);
  if (m) return { kind: 'imdb', imdb: m[1] };
  m = clean.match(/^wwrs-ep-(\d+)-(\d+)-(\d+)$/);
  if (m) return { kind: 'episode', tvId: Number(m[1]), season: Number(m[2]), number: Number(m[3]) };
  m = clean.match(/^wwrs-tv-(\d+)/);
  if (m) return { kind: 'tv', id: Number(m[1]) };
  m = clean.match(/^wwrs-mv-(\d+)/);
  if (m) return { kind: 'movie', id: Number(m[1]) };
  m = clean.match(/^wwrs-fr-([a-z]+)-(.+)$/);
  if (m) return { kind: 'franchise', promoKey: m[1], slug: m[2] };
  return null;
}

function ptDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function ptLongDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1] || m[2]} de ${m[1]}`;
}

function releasedStamp(iso) {
  const m = String(iso || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? `${m[1]}T12:00:00.000Z` : undefined;
}

function isFresh(dateIso, months = RECENT_MONTHS) {
  if (!dateIso) return false;
  const value = Date.parse(`${dateIso}T00:00:00Z`);
  if (!Number.isFinite(value)) return false;
  return value >= Date.now() - months * 30 * 24 * 60 * 60 * 1000;
}

function isUpcoming(item) {
  const date = item && (item.date || item.airdate);
  return Boolean(date && date > new Date().toISOString().slice(0, 10));
}

function statusPt(status) {
  const map = {
    'Returning Series': 'em exibição',
    'In Production': 'em produção',
    Planned: 'planeado',
    'Post Production': 'em pós-produção',
    Ended: 'terminado',
    Canceled: 'cancelado',
    Pilot: 'piloto',
    Released: 'lançado',
  };
  return map[status] || status || null;
}

function joinLines(parts) {
  return parts.filter(Boolean).join('\n');
}

// ------------------------------- etiquetas -------------------------------

const SHOW_TAGS = {
  ppv: 'Eventos PPV / PLE',
  weekly: 'Programas semanais',
  collection: 'Coleções por ano',
  single: 'Eventos individuais',
  running: 'Em exibição',
  archive: 'Arquivo',
};

const UFC_TAGS = {
  numbered: 'Numerados (PPV)',
  fightNight: 'Fight Night',
  network: 'UFC on ESPN / ABC / Fox',
  tuf: 'The Ultimate Fighter',
  upcoming: 'Agendados',
};

function itemTags(item) {
  if (item.kind === 'tv') {
    return [SHOW_TAGS.weekly, item.inProduction ? SHOW_TAGS.running : SHOW_TAGS.archive];
  }
  if (item.kind === 'franchise') {
    return [SHOW_TAGS.ppv, SHOW_TAGS.collection, isFresh(item.date) ? SHOW_TAGS.running : SHOW_TAGS.archive];
  }
  return [SHOW_TAGS.ppv, SHOW_TAGS.single, isFresh(item.date) ? SHOW_TAGS.running : SHOW_TAGS.archive];
}

function ufcTags(event) {
  const name = String((event && event.name) || '');
  const tags = ['UFC', 'MMA'];
  if (isUpcoming(event)) tags.push(UFC_TAGS.upcoming);
  if (/^UFC\s+\d+/i.test(name)) tags.push(UFC_TAGS.numbered);
  else if (/fight night/i.test(name)) tags.push(UFC_TAGS.fightNight);
  else if (/UFC\s+on\s+/i.test(name)) tags.push(UFC_TAGS.network);
  else if (/ultimate fighter/i.test(name)) tags.push(UFC_TAGS.tuf);
  if (event && event.date) tags.push(event.date.slice(0, 4));
  return tags;
}

function genresFor(item, promoKey) {
  const promo = promotion(promoKey);
  const base = [promoKey === 'ufc' || promoKey === 'ufcshows' ? 'MMA' : 'Wrestling'];
  if (promo) base.push(promo.name);
  else if (promoKey === 'ufc') base.push('UFC');
  for (const tag of itemTags(item)) if (!base.includes(tag)) base.push(tag);
  for (const g of item.genres || []) if (!base.includes(g)) base.push(g);
  if (item.network && !base.includes(item.network)) base.push(item.network);
  return base;
}

// ------------------------------- programas (tv) -------------------------------

function tvReleaseInfo(show) {
  const start = show.premiered ? show.premiered.slice(0, 4) : null;
  if (!start) return undefined;
  if (show.inProduction) return `${start}-`;
  const end = show.ended ? show.ended.slice(0, 4) : null;
  return end && end !== start ? `${start}-${end}` : start;
}

function tvDescription(show, promoKey, episodes) {
  const promo = promotion(promoKey);
  const linhas = [];
  if (show.summary) linhas.push(show.summary, '');
  const ficha = [
    promo ? `Promoção: ${promo.name}` : null,
    show.network ? `Canal: ${show.network}` : null,
    show.premiered ? `Estreia: ${ptDate(show.premiered)}` : null,
    show.status ? `Estado: ${statusPt(show.status)}` : null,
  ].filter(Boolean);
  if (ficha.length) linhas.push(ficha.join(' | '));

  if (Array.isArray(episodes) && episodes.length) {
    const seasons = new Set(episodes.map((ep) => ep.season));
    const ultimo = episodes.reduce((a, b) => (String(b.airdate || '') > String(a.airdate || '') ? b : a));
    linhas.push(
      [
        `Temporadas: ${seasons.size}`,
        `Episódios: ${episodes.length}`,
        ultimo && ultimo.airdate ? `Último: ${ptDate(ultimo.airdate)}` : null,
      ]
        .filter(Boolean)
        .join(' | ')
    );
  }
  return joinLines(linhas).trim() || `${show.name} — episódios por temporada.`;
}

function tvMeta(show, promoKey, episodes) {
  const metaId = tvId(show.id);
  const eps = Array.isArray(episodes) ? episodes : [];
  const videos = eps
    .slice()
    .sort((a, b) => a.season - b.season || a.number - b.number)
    .map((ep) => {
      const overview = joinLines([
        ep.summary || null,
        ep.airdate ? `${show.name} | T${ep.season} E${ep.number} | ${ptLongDate(ep.airdate)}` : null,
      ]);
      const released = releasedStamp(ep.airdate);
      return {
        // Ids de stream com a numeracao IMDb (a que os addons de streams usam).
        id: show.imdb
          ? `${show.imdb}:${ep.streamSeason || ep.season}:${ep.streamNumber || ep.number}`
          : `${metaId}:${ep.season}:${ep.number}`,
        title: ep.name || `Episódio ${ep.number}`,
        season: ep.season,
        episode: ep.number,
        ...(released ? { released, firstAired: released } : {}),
        ...(ep.image ? { thumbnail: ep.image } : show.poster ? { thumbnail: show.poster } : {}),
        ...(overview ? { overview, description: overview } : {}),
      };
    });

  return {
    id: metaId,
    type: 'series',
    name: show.name,
    ...(show.poster ? { poster: show.poster } : {}),
    posterShape: 'poster',
    ...(show.background ? { background: show.background } : {}),
    description: tvDescription(show, promoKey, eps),
    ...(tvReleaseInfo(show) ? { releaseInfo: tvReleaseInfo(show) } : {}),
    genres: genresFor({ ...show, kind: 'tv' }, promoKey),
    ...(show.imdb ? { imdb_id: show.imdb } : {}),
    ...(show.rating ? { imdbRating: String(show.rating) } : {}),
    ...(show.homepage ? { website: show.homepage } : {}),
    videos,
  };
}

// Id de um episodio concreto (catalogo dos ultimos 7 dias), com a temporada e o
// numero da numeracao dos ids de stream.
function episodeId(showId, episode) {
  return `wwrs-ep-${showId}-${episode.streamSeason || episode.season}-${episode.streamNumber || episode.number}`;
}

// Ficha de um so episodio que abre directamente nos streams dessa data
// (behaviorHints.defaultVideoId), em vez da lista de temporadas do programa.
function episodeMeta(show, promoKey, episode) {
  const full = tvMeta(show, promoKey, [episode]);
  const video = full.videos[0];
  const date = episode.airdate ? ptLongDate(episode.airdate) : null;
  const titulo = episode.name && !/^(episode|episódio|episodio)\s*\d+$/i.test(episode.name) ? episode.name : null;
  return {
    ...full,
    id: episodeId(show.id, episode),
    name: `${show.name}${date ? ` — ${date}` : ''}`,
    ...(episode.image ? { background: episode.image } : {}),
    description: joinLines([
      `T${episode.season} E${episode.number}${titulo ? ` — ${titulo}` : ''}${date ? ` · emitido em ${date}` : ''}`,
      episode.summary ? `\n${episode.summary}` : null,
      show.summary ? `\n${show.summary}` : null,
    ]),
    releaseInfo: episode.airdate ? ptDate(episode.airdate) : full.releaseInfo,
    videos: [video],
    behaviorHints: { defaultVideoId: video.id },
  };
}

// ------------------------------- coleccoes por ano -------------------------------

function franchiseDescription(group) {
  const promo = promotion(group.promoKey);
  const periodo =
    group.firstYear && group.lastYear
      ? group.firstYear === group.lastYear
        ? `${group.firstYear}`
        : `${group.firstYear}-${group.lastYear}`
      : null;
  const ficha = [
    promo ? `Promoção: ${promo.name}` : null,
    `Edições: ${group.editions}`,
    periodo ? `Período: ${periodo}` : null,
    group.date ? `Última: ${ptDate(group.date)}` : null,
  ].filter(Boolean);

  return joinLines([
    `Todas as edições de ${group.name}, uma temporada por ano.`,
    '',
    ficha.join(' | '),
    group.summary ? `\n${group.summary}` : null,
  ]).trim();
}

function franchiseMeta(group) {
  const metaId = franchiseId(group.promoKey, group.slug);
  const perYear = new Map();

  const videos = group.movies
    .slice()
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .map((movie) => {
      const season = movie.year || 0;
      const index = (perYear.get(season) || 0) + 1;
      perYear.set(season, index);
      const overview = joinLines([
        movie.summary || null,
        movie.date ? `${group.name} | ${ptLongDate(movie.date)}` : null,
      ]);
      const released = releasedStamp(movie.date);
      return {
        id: movie.imdb || movieId(movie.id),
        title: movie.name,
        season,
        episode: index,
        ...(released ? { released, firstAired: released } : {}),
        ...(movie.poster ? { thumbnail: movie.background || movie.poster } : {}),
        ...(overview ? { overview, description: overview } : {}),
      };
    });

  return {
    id: metaId,
    type: 'series',
    name: group.name,
    ...(group.poster ? { poster: group.poster } : {}),
    posterShape: 'poster',
    ...(group.background ? { background: group.background } : {}),
    description: franchiseDescription(group),
    releaseInfo:
      group.firstYear && group.lastYear
        ? group.firstYear === group.lastYear
          ? `${group.firstYear}`
          : `${group.firstYear}-${group.lastYear}`
        : undefined,
    genres: genresFor(group, group.promoKey),
    ...(group.rating ? { imdbRating: String(group.rating) } : {}),
    videos,
  };
}

// ------------------------------- eventos individuais -------------------------------

function movieDescription(movie, promoKey) {
  const promo = promotion(promoKey);
  const ficha = [
    movie.date ? `Data: ${ptLongDate(movie.date)}${isUpcoming(movie) ? ' (agendado)' : ''}` : null,
    promo ? `Promoção: ${promo.name}` : promoKey === 'ufc' ? 'Promoção: UFC' : null,
    movie.runtime ? `Duração: ${movie.runtime} min` : null,
  ].filter(Boolean);
  return joinLines([ficha.join('\n'), movie.summary ? `\n${movie.summary}` : null]).trim();
}

// Com id IMDb, o evento usa-o como id: e o que os addons de streams (Stremio e
// Nuvio) pedem. Sem ele fica o id interno do addon.
function movieMeta(movie, promoKey) {
  const metaId = movie.imdb || movieId(movie.id);
  const released = releasedStamp(movie.date);
  const genres = promoKey === 'ufc' ? ufcTags(movie) : genresFor({ ...movie, kind: 'movie' }, promoKey);

  return {
    id: metaId,
    type: 'movie',
    name: movie.name,
    ...(movie.poster ? { poster: movie.poster } : {}),
    posterShape: 'poster',
    ...(movie.background ? { background: movie.background } : {}),
    description: movieDescription(movie, promoKey),
    ...(released ? { released, releaseInfo: movie.date.slice(0, 4) } : {}),
    genres,
    ...(movie.imdb ? { imdb_id: movie.imdb } : {}),
    ...(movie.rating ? { imdbRating: String(movie.rating) } : {}),
    ...(movie.runtime ? { runtime: `${movie.runtime} min` } : {}),
    ...(movie.homepage ? { website: movie.homepage } : {}),
    // Com o id do IMDb, os addons de streams conseguem responder a este evento.
    ...(movie.imdb ? { behaviorHints: { defaultVideoId: movie.imdb } } : {}),
    videos: [{ id: movie.imdb || metaId, title: movie.name, ...(released ? { released } : {}) }],
  };
}

// ------------------------------- cartoes de catalogo -------------------------------

function preview(item, promoKey, extra = {}) {
  const key = promoKey || item.promoKey;
  const episode = extra.episode || null;

  if (item.kind === 'franchise') {
    return {
      id: franchiseId(item.promoKey, item.slug),
      type: 'series',
      name: item.name,
      ...(item.poster ? { poster: item.poster } : {}),
      posterShape: 'poster',
      description: franchiseDescription(item),
      releaseInfo: item.lastYear ? `${item.firstYear}-${item.lastYear}` : undefined,
      genres: genresFor(item, item.promoKey),
      ...(item.rating ? { imdbRating: String(item.rating) } : {}),
    };
  }

  if (item.kind === 'movie') {
    return {
      id: item.imdb || movieId(item.id),
      type: 'movie',
      name: item.name,
      ...(item.poster ? { poster: item.poster } : {}),
      posterShape: 'poster',
      description: movieDescription(item, key),
      releaseInfo: item.date ? ptDate(item.date) : undefined,
      genres: key === 'ufc' ? ufcTags(item) : genresFor({ ...item, kind: 'movie' }, key),
      ...(item.rating ? { imdbRating: String(item.rating) } : {}),
    };
  }

  // programa (tv), com destaque opcional para o episodio mais recente
  const descricao = episode
    ? joinLines([
        `Episódio mais recente: T${episode.season} E${episode.number}${episode.name ? ` — ${episode.name}` : ''}`,
        episode.airdate ? `Emitido em ${ptLongDate(episode.airdate)}` : null,
        episode.summary ? `\n${episode.summary}` : null,
        item.summary ? `\n${item.summary}` : null,
      ])
    : tvDescription(item, key, null);

  return {
    id: tvId(item.id),
    type: 'series',
    name: item.name,
    ...((episode && episode.image) || item.poster ? { poster: (episode && episode.image) || item.poster } : {}),
    posterShape: 'poster',
    description: descricao,
    releaseInfo: episode && episode.airdate ? ptDate(episode.airdate) : tvReleaseInfo(item),
    genres: genresFor({ ...item, kind: 'tv' }, key),
    ...(item.rating ? { imdbRating: String(item.rating) } : {}),
  };
}

module.exports = {
  ID_PREFIX,
  TV_PREFIX,
  FRANCHISE_PREFIX,
  MOVIE_PREFIX,
  SHOW_TAGS,
  UFC_TAGS,
  tvId,
  franchiseId,
  movieId,
  parseId,
  ptDate,
  ptLongDate,
  itemTags,
  ufcTags,
  isUpcoming,
  preview,
  tvMeta,
  episodeId,
  episodeMeta,
  franchiseMeta,
  movieMeta,
};
