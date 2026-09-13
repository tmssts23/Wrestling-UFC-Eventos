// No TMDB cada PPV e um filme solto ("WWE Royal Rumble 2025", "AEW All Out 2024").
// Aqui agrupamos esses filmes por evento recorrente, para alem de os mostrarmos
// individualmente: cada grupo vira uma serie sintetica em que a temporada e o ano
// e os episodios sao as edicoes desse ano.

const FRANCHISES = {
  wwe: [
    'WrestleMania', 'Royal Rumble', 'SummerSlam', 'Survivor Series', 'Money in the Bank',
    'Elimination Chamber', 'Backlash', 'Hell in a Cell', 'Extreme Rules', 'TLC',
    'Payback', 'Fastlane', 'Clash at the Castle', 'Clash of Champions', 'Night of Champions',
    'Crown Jewel', 'Bad Blood', 'Bash in Berlin', 'King and Queen of the Ring', 'King of the Ring',
    "Saturday Night's Main Event", 'Wrestlepalooza', 'Evolution', 'In Your House',
    'No Mercy', 'Judgment Day', 'Unforgiven', 'Armageddon', 'No Way Out', 'Vengeance',
    'Great American Bash', 'Battleground', 'Roadblock', 'Stomping Grounds', 'Over the Limit',
    'Capitol Punishment', 'Breaking Point', 'Bragging Rights', 'Cyber Sunday', 'Taboo Tuesday',
    'One Night Stand', 'December to Dismember', 'Barely Legal', 'Halloween Havoc', 'Starrcade',
    'Bash at the Beach', 'Fall Brawl', 'Spring Stampede', 'Slamboree', 'Uncensored',
    'Souled Out', 'SuperBrawl', 'World War 3', 'Greed', 'Road Wild', 'Mayhem', 'New Blood Rising',
    'TakeOver', 'Stand & Deliver', 'Deadline', 'Vengeance Day', 'Heatwave', "New Year's Evil",
    'WarGames', 'Guilty as Charged', 'November to Remember', 'Hardcore Heaven', 'Heat Wave',
    'Anarchy Rulz', 'Living Dangerously', 'Massacre on 34th Street', 'Cyberslam',
  ],
  aew: [
    'Double or Nothing', 'All Out', 'Full Gear', 'Revolution', 'All In', 'Forbidden Door',
    'WrestleDream', 'Grand Slam', 'Worlds End', 'Dynasty', 'Blood & Guts', 'Fyter Fest',
    'Fight for the Fallen', 'Beach Break', 'Winter is Coming', 'Holiday Bash',
    'Battle of the Belts', 'Homecoming', "St. Patrick's Day Slam", 'Road Rager',
    'Bash at the Beach', 'Fight Forever', 'Title Tuesday',
  ],
  tna: [
    'Bound for Glory', 'Slammiversary', 'Hard to Kill', 'Rebellion', 'Victory Road',
    'Sacrifice', 'No Surrender', 'Genesis', 'Against All Odds', 'Emergence', 'Turning Point',
    'Final Resolution', 'Lockdown', 'Destination X', 'Under Siege', 'Overdrive',
    'One Night Only', 'Bash at the Brewery', 'Redemption', 'Unbreakable', 'Hardcore Justice',
  ],
};

// Marcas dentro de uma promocao que tem historias proprias (WCW Halloween Havoc
// e NXT Halloween Havoc sao eventos diferentes). WWF conta como WWE.
const BRANDS = {
  wwe: [
    ['nxt', 'NXT'],
    ['wcw', 'WCW'],
    ['ecw', 'ECW'],
  ],
};

// Tokens que confirmam que um titulo e mesmo da promocao.
const PROMO_TOKENS = {
  wwe: /\b(wwe|wwf|wcw|ecw|nxt)\b/i,
  aew: /\b(aew|all elite)\b/i,
  tna: /\b(tna|impact)\b/i,
};

// Programas paralelos, especiais de antevisao e documentarios que nao sao o evento.
const COMPANION = new RegExp(
  [
    'zero hour', 'kick ?off', 'pre-?show', 'post-?show', 'pre-?game', 'prelims', 'preliminares',
    'countdown', 'press event', 'press conference', 'conference', 'highlights', 'best of',
    'top \\d+', 'recap', 'rewind', '24/7', 'buy[- ]?in', 'tailgate', 'showdown', 'years of',
    'anthology', 'collection', 'history of', 'greatest', 'documentary', 'behind the',
    'making of', 'watch along', 'reaction', 'unreleased', 'the lost', 'road to',
  ].join('|'),
  'i'
);

// Generos do TMDB que denunciam falsos positivos (animacao e familia).
const NOISE_GENRES = new Set([16, 10751, 10762]);

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’']/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

function slugify(text) {
  return normalize(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function isCompanion(title) {
  return COMPANION.test(String(title || ''));
}

function isNoiseGenre(item) {
  return Array.isArray(item && item.genreIds) && item.genreIds.some((id) => NOISE_GENRES.has(id));
}

function brandFor(promoKey, title) {
  for (const [token, label] of BRANDS[promoKey] || []) {
    if (new RegExp(`\\b${token}\\b`, 'i').test(String(title || ''))) return label;
  }
  return null;
}

function franchiseName(promoKey, title) {
  const haystack = normalize(title);
  let best = null;
  for (const name of FRANCHISES[promoKey] || []) {
    const needle = normalize(name);
    if (!needle || !haystack.includes(needle)) continue;
    if (!best || needle.length > normalize(best).length) best = name;
  }
  return best;
}

// Garante que o titulo pertence a promocao: ou traz o nome da promocao, ou
// comeca pelo nome de um dos seus eventos (ex.: "Survivor Series: WarGames").
function belongsTo(promoKey, title) {
  const tokens = PROMO_TOKENS[promoKey];
  if (!tokens) return true;
  if (tokens.test(String(title || ''))) return true;
  const franchise = franchiseName(promoKey, title);
  return Boolean(franchise && normalize(title).startsWith(normalize(franchise)));
}

// Evento recorrente a que o filme pertence, com a marca (null se for avulso).
function match(promoKey, title, promoName) {
  const franchise = franchiseName(promoKey, title);
  if (!franchise) return null;
  const brand = brandFor(promoKey, title);
  const prefix = brand || promoName || promoKey.toUpperCase();
  const name = normalize(franchise).startsWith(normalize(prefix)) ? franchise : `${prefix} ${franchise}`;
  return { franchise, brand, name, slug: slugify(name) };
}

module.exports = {
  FRANCHISES,
  match,
  belongsTo,
  brandFor,
  slugify,
  normalize,
  isCompanion,
  isNoiseGenre,
};
