// Catalogos disponiveis e leitura da configuracao escolhida na instalacao.
const CATALOGS = [
  {
    token: 'wwe',
    id: 'wwe_events',
    type: 'series',
    kind: 'promo',
    promo: 'wwe',
    name: 'WWE — Eventos e Programas',
    label: 'WWE — todos os eventos (temporadas e episódios)',
    byDefault: true,
  },
  {
    token: 'wwe7',
    id: 'wwe_recent',
    type: 'series',
    kind: 'recent',
    promo: 'wwe',
    name: 'WWE — Últimos 7 Dias',
    label: 'WWE — episódio mais recente da última semana',
    byDefault: true,
  },
  {
    token: 'wwetop',
    id: 'top_wwe',
    type: 'movie',
    kind: 'top',
    promo: 'wwe',
    name: 'WWE — Top 10 Eventos',
    label: 'WWE — os 10 eventos em destaque (só no Explorar)',
    byDefault: true,
    fightOnly: true,
  },
  {
    token: 'aew',
    id: 'aew_events',
    type: 'series',
    kind: 'promo',
    promo: 'aew',
    name: 'AEW — Eventos e Programas',
    label: 'AEW — todos os eventos (temporadas e episódios)',
    byDefault: true,
  },
  {
    token: 'aew7',
    id: 'aew_recent',
    type: 'series',
    kind: 'recent',
    promo: 'aew',
    name: 'AEW — Últimos 7 Dias',
    label: 'AEW — episódio mais recente da última semana',
    byDefault: true,
  },
  {
    token: 'aewtop',
    id: 'top_aew',
    type: 'movie',
    kind: 'top',
    promo: 'aew',
    name: 'AEW — Top 10 Eventos',
    label: 'AEW — os 10 eventos em destaque (só no Explorar)',
    byDefault: true,
    fightOnly: true,
  },
  {
    token: 'tna',
    id: 'tna_events',
    type: 'series',
    kind: 'promo',
    promo: 'tna',
    name: 'TNA — Eventos e Programas',
    label: 'TNA — todos os eventos (temporadas e episódios)',
    byDefault: true,
  },
  {
    token: 'tna7',
    id: 'tna_recent',
    type: 'series',
    kind: 'recent',
    promo: 'tna',
    name: 'TNA — Últimos 7 Dias',
    label: 'TNA — episódio mais recente da última semana',
    byDefault: true,
  },
  {
    token: 'tnatop',
    id: 'top_tna',
    type: 'movie',
    kind: 'top',
    promo: 'tna',
    name: 'TNA — Top 10 Eventos',
    label: 'TNA — os 10 eventos em destaque (só no Explorar)',
    byDefault: true,
    fightOnly: true,
  },
  {
    token: 'ufc',
    id: 'ufc_events',
    type: 'movie',
    kind: 'ufc',
    name: 'UFC — Eventos Numerados (mais recentes primeiro)',
    label: 'UFC 330, UFC 329…: eventos numerados (PPV), do mais recente para o mais antigo',
    byDefault: true,
  },
  {
    token: 'ufcfn',
    id: 'ufc_fightnight',
    type: 'movie',
    kind: 'ufcfn',
    name: 'UFC — Fight Night e Outros Eventos',
    label: 'UFC Fight Night, UFC on ESPN/ABC e afins (poucos têm streams disponíveis)',
    byDefault: false,
  },
  {
    token: 'ufctop',
    id: 'top_ufc',
    type: 'movie',
    kind: 'top',
    promo: 'ufc',
    name: 'UFC — Top 10 Eventos',
    label: 'UFC — os 10 eventos numerados em destaque (só no Explorar)',
    byDefault: true,
    fightOnly: true,
  },
  {
    token: 'ufcshows',
    id: 'ufc_shows',
    type: 'series',
    kind: 'promo',
    promo: 'ufcshows',
    name: 'UFC — Programas e Documentários',
    label: 'UFC — séries e programas (Fight Night, TUF, documentários)',
    byDefault: false,
  },
];

// Nome e descricao de cada catalogo em ingles, para a pagina de configuracao.
const EN_TEXT = {
  wwe: ['WWE — Events & Shows', 'WWE — every event (seasons and episodes)'],
  wwe7: ['WWE — Last 7 Days', 'WWE — latest episode from the past week'],
  wwetop: ['WWE — Top 10 Events', 'WWE — the 10 featured events (Discover only)'],
  aew: ['AEW — Events & Shows', 'AEW — every event (seasons and episodes)'],
  aew7: ['AEW — Last 7 Days', 'AEW — latest episode from the past week'],
  aewtop: ['AEW — Top 10 Events', 'AEW — the 10 featured events (Discover only)'],
  tna: ['TNA — Events & Shows', 'TNA — every event (seasons and episodes)'],
  tna7: ['TNA — Last 7 Days', 'TNA — latest episode from the past week'],
  tnatop: ['TNA — Top 10 Events', 'TNA — the 10 featured events (Discover only)'],
  ufc: ['UFC — Numbered Events (newest first)', 'UFC 330, UFC 329…: numbered events (PPV), newest to oldest'],
  ufcfn: ['UFC — Fight Night & Other Events', 'UFC Fight Night, UFC on ESPN/ABC and more (few have streams available)'],
  ufctop: ['UFC — Top 10 Events', 'UFC — the 10 featured numbered events (Discover only)'],
  ufcshows: ['UFC — Shows & Documentaries', 'UFC — series and shows (Fight Night, TUF, documentaries)'],
};

const BY_TOKEN = new Map(CATALOGS.map((c) => [c.token, c]));
const BY_ID = new Map(CATALOGS.map((c) => [c.id, c]));

const RESOURCE_WORDS = new Set([
  'manifest.json',
  'catalog',
  'meta',
  'stream',
  'subtitles',
  'configure',
  'art',
  'addon-logo.svg',
  'favicon.ico',
  'health',
  'validar-chave',
]);

function defaultTokens() {
  return CATALOGS.filter((c) => c.byDefault).map((c) => c.token);
}

// Separador proprio no Explorar do Stremio. Os itens dentro dele continuam a ser
// filmes e series, para os addons de streams responderem normalmente.
const FIGHT_TYPE = 'Fight';

// Nomes curtos dentro do separador "Fight" (a promocao ja diz tudo).
const SHORT_NAMES = {
  wwe: 'WWE',
  wwe7: 'WWE · Últimos 7 dias',
  aew: 'AEW',
  aew7: 'AEW · Últimos 7 dias',
  tna: 'TNA',
  tna7: 'TNA · Últimos 7 dias',
  wwetop: 'WWE · Top 10',
  aewtop: 'AEW · Top 10',
  tnatop: 'TNA · Top 10',
  ufctop: 'UFC · Top 10',
  ufc: 'UFC',
  ufcfn: 'UFC · Fight Night',
  ufcshows: 'UFC · Programas',
};

// No separador Fight os catalogos levam genero obrigatorio (para nao aparecerem no
// ecra principal); "Todos" e a opcao por omissao e nao filtra nada.
const FIGHT_PREFIX = 'fight_';
const ALL_GENRE = 'Todos';

// layout "fight" (predefinicao): tudo no separador Fight.
// layout "classic": catalogos em Filmes e Series, para apps sem separadores proprios.
function isClassic(config) {
  return Boolean(config && config.layout === 'classic');
}

function catalogType(def, config) {
  return isClassic(config) ? def.type : FIGHT_TYPE;
}

function catalogName(def, config) {
  return isClassic(config) ? def.name : SHORT_NAMES[def.token] || def.name;
}

function encodeConfig(config) {
  const payload = { c: config.tokens || defaultTokens() };
  if (config.key) payload.k = config.key;
  if (isClassic(config)) payload.l = 'classic';
  return Buffer.from(JSON.stringify(payload), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function decodeConfig(text) {
  try {
    const base64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    if (!json || typeof json !== 'object') return null;
    const wanted = Array.isArray(json.c) ? json.c : [];
    const tokens = wanted.map((t) => String(t).toLowerCase()).filter((t) => BY_TOKEN.has(t));
    return {
      tokens: tokens.length ? tokens : defaultTokens(),
      key: json.k ? String(json.k).trim() : '',
      layout: json.l === 'classic' ? 'classic' : 'fight',
    };
  } catch (_) {
    return null;
  }
}

// A configuracao viaja no primeiro segmento do URL, em dois formatos:
//   /wwe,wwe7,ufc/manifest.json          lista simples de catalogos
//   /<base64>/manifest.json              catalogos + chave TMDB da instalacao
function parseConfig(raw) {
  const text = String(raw || '').trim();
  if (!text || text === 'all' || text === 'todos') {
    return { tokens: CATALOGS.map((c) => c.token), key: '', layout: 'fight', raw: text };
  }

  if (!text.includes(',') && text.length > 24) {
    const decoded = decodeConfig(text);
    if (decoded) return { ...decoded, raw: text };
  }

  const wanted = text
    .split(/[,+|]/)
    .map((t) => decodeURIComponent(t).trim().toLowerCase())
    .filter(Boolean);
  const tokens = wanted.filter((t) => BY_TOKEN.has(t));
  if (!tokens.length) return { tokens: defaultTokens(), key: '', layout: 'fight', raw: text };
  return { tokens, key: '', layout: 'fight', raw: text };
}

function isResourceWord(segment) {
  return RESOURCE_WORDS.has(String(segment || '').toLowerCase());
}

function selected(config) {
  const tokens = new Set((config && config.tokens) || defaultTokens());
  return CATALOGS.filter((c) => tokens.has(c.token));
}

function isFightId(id) {
  return String(id || '').startsWith(FIGHT_PREFIX);
}

function byId(id) {
  const clean = String(id || '').replace(new RegExp(`^${FIGHT_PREFIX}`), '');
  return BY_ID.get(clean) || null;
}

// Catalogos a declarar no manifest:
//   - os de sempre (tipo movie/series, nomes completos): ecra principal;
//   - no modo "fight", uma copia no tipo Fight com nomes curtos, so no Explorar.
function entries(config) {
  const chosen = selected(config);
  const classic = isClassic(config);
  // Os Top 10 so vivem no Explorar (separador Fight); no modo classico, sem separador,
  // entram com os restantes.
  const out = chosen
    .filter((def) => classic || !def.fightOnly)
    .map((def) => ({ def, id: def.id, type: def.type, name: def.name, fight: false }));
  if (!classic) {
    for (const def of chosen) {
      out.push({
        def,
        id: `${FIGHT_PREFIX}${def.id}`,
        type: FIGHT_TYPE,
        name: SHORT_NAMES[def.token] || def.name,
        fight: true,
      });
    }
  }
  return out;
}

module.exports = {
  CATALOGS,
  EN_TEXT,
  FIGHT_TYPE,
  FIGHT_PREFIX,
  ALL_GENRE,
  entries,
  isFightId,
  catalogType,
  catalogName,
  isClassic,
  parseConfig,
  encodeConfig,
  decodeConfig,
  isResourceWord,
  selected,
  byId,
  defaultTokens,
};
