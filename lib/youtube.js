// Pesquisa no YouTube pelo titulo do evento/episodio e escolhe os videos que
// correspondem mesmo ao pedido. Os resultados vao como streams com `ytId`, que o
// Stremio reproduz no leitor interno.
//
// Nao usa chave: le os resultados da pagina publica de pesquisa. Se o YouTube
// mudar o formato da pagina, a pesquisa devolve vazio e ficam as outras opcoes.
const { getText } = require('./httpx');
const cache = require('./cache');

const HOUR = 60 * 60 * 1000;
const MAX_RESULTS = 8;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml',
  // Evita o ecra de consentimento de cookies da UE.
  Cookie: 'SOCS=CAI; CONSENT=YES+1',
};

// Canais oficiais (verificados) de cada promocao.
const OFFICIAL = {
  wwe: /\bwwe\b/i,
  aew: /(all elite wrestling|\baew\b)/i,
  tna: /(tna wrestling|impact wrestling|\btna\b)/i,
  ufc: /(\bufc\b|espn mma)/i,
};
OFFICIAL.ufcshows = OFFICIAL.ufc;

// Palavras que nao ajudam a distinguir um evento de outro.
const STOP = new Set([
  'vs', 'v', 'the', 'of', 'a', 'an', 'and', 'at', 'in', 'on', 'to', 'for', 'live', 'full', 'show',
  'event', 'wwe', 'wwf', 'aew', 'tna', 'roh', 'ufc', 'impact', 'ring', 'honor', 'all', 'elite',
  'wrestling', 'de', 'da', 'do', 'e', 'o', 'night', 'saturday', 'sunday', 'part',
]);

// Videos que falam do evento mas nao o mostram: reacoes, antevisoes, analises,
// pre-shows e anuncios de transmissao.
const OFF_TOPIC = new RegExp(
  [
    'react(ion|s|ing)?\\b', 'predictions?', 'preview', 'breakdown', 'betting', 'picks', 'odds',
    'press conference', 'media day', 'faceoffs?', 'weigh[- ]?ins?', 'tickets?', 'trailer', 'promo\\b',
    'kick ?off', 'countdown', 'podcast', 'fantasy', 'reviews?\\b', 'recap', 'results?\\b', 'asmr',
    'analysis', 'explained', 'thoughts', 'rankings?', 'ratings?', 'need to know', 'buy[- ]?in',
    'zero hour', 'pre[- ]?show', 'post[- ]?show', 'watch along', 'how to watch', 'live stream',
    'media call', 'run ?down', 'watch party', 'live chat', 'discussion', 'roundtable',
    'face to face', 'match card', 'media scrum', 'scrum', 'interview', 'open workouts?',
    // iscos do tipo "Watch ... PPV Live ... Full Show / Replay Online"
    '\\bwatch\\b.*\\blive\\b', 'replay online', 'full show live', 'free stream', 'stream free',
  ].join('|'),
  'i'
);

const MONTHS = [
  ['january', 'jan'], ['february', 'feb'], ['march', 'mar'], ['april', 'apr'], ['may', 'may'],
  ['june', 'jun'], ['july', 'jul'], ['august', 'aug'], ['september', 'sept?'], ['october', 'oct'],
  ['november', 'nov'], ['december', 'dec'],
];

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9#]+/g, ' ')
    .trim();
}

function tokens(text) {
  return normalize(text)
    .split(' ')
    .map((t) => t.replace(/^#/, ''))
    .filter((t) => t && !STOP.has(t));
}

function parseDuration(text) {
  const parts = String(text || '')
    .split(':')
    .map((n) => Number(n));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((total, n) => total * 60 + n, 0);
}

function runsText(node) {
  if (!node) return '';
  if (node.simpleText) return node.simpleText;
  return (node.runs || []).map((r) => r.text).join('');
}

function extractInitialData(html) {
  const patterns = [/var ytInitialData = (\{[\s\S]*?\});<\/script>/, /window\["ytInitialData"\] = (\{[\s\S]*?\});/];
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (!match) continue;
    try {
      return JSON.parse(match[1]);
    } catch (_) {
      /* tenta o formato seguinte */
    }
  }
  return null;
}

function collectVideos(data) {
  const out = [];
  const stack = [data];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.videoRenderer) {
      const v = node.videoRenderer;
      const badges = JSON.stringify(v.badges || []);
      const owner = JSON.stringify(v.ownerBadges || []);
      const seconds = parseDuration(runsText(v.lengthText));
      const isLive = /LIVE/.test(badges) || Boolean(v.upcomingEventData) || !v.lengthText;
      if (v.videoId && !isLive) {
        out.push({
          id: v.videoId,
          title: runsText(v.title),
          channel: runsText(v.ownerText) || runsText(v.longBylineText),
          verified: /VERIFIED|OFFICIAL_ARTIST/.test(owner),
          seconds,
          duration: runsText(v.lengthText),
          views: runsText(v.shortViewCountText) || runsText(v.viewCountText),
          published: runsText(v.publishedTimeText),
        });
      }
      continue;
    }
    for (const key of Object.keys(node)) stack.push(node[key]);
  }
  // A travessia em pilha inverte a ordem; repoe a ordem do YouTube.
  return out.reverse();
}

async function search(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  return cache.memo(
    `yt:search:${q.toLowerCase()}`,
    6 * HOUR,
    async () => {
      const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=en&gl=US`;
      const html = await getText(url, { headers: HEADERS, timeout: 12000, retries: 1 });
      const data = extractInitialData(html);
      return data ? collectVideos(data) : [];
    },
    { staleMs: 3 * 24 * HOUR }
  );
}

// ------------------------------- relevancia -------------------------------

function isOfficial(video, promoKey) {
  const pattern = OFFICIAL[promoKey];
  return Boolean(video.verified && pattern && pattern.test(video.channel));
}

// "UFC 300" vs "UFC 313": se o video refere o mesmo tipo de evento com outro numero, e outro evento.
function conflictingNumber(eventTitle, videoTitle) {
  const event = normalize(eventTitle);
  const video = normalize(videoTitle);
  const pairs = [...event.matchAll(/\b([a-z]+)\s+#?(\d{1,4})\b/g)];
  for (const [, word, number] of pairs) {
    if (STOP.has(word) && !['ufc', 'night'].includes(word)) continue;
    const others = [...video.matchAll(new RegExp(`\\b${word}\\s+#?(\\d{1,4})\\b`, 'g'))].map((m) => m[1]);
    if (others.length && !others.includes(number)) return true;
  }
  return false;
}

// "UFC 330: Makhachev vs. Machado Garry" -> [["makhachev"], ["machado", "garry"]].
// Num combate, o video tem de referir os dois lados, mas basta uma palavra de cada
// nome (os titulos dizem tanto "Ian Machado Garry" como so "Garry").
function fighters(eventTitle) {
  const text = String(eventTitle || '').split(':').pop();
  const match = text.match(/^(.*?)\s+(?:vs\.?|v\.)\s+(.*)$/iu);
  if (!match) return [];
  const side = (part) =>
    normalize(part)
      .split(' ')
      .filter((word) => word.length >= 3 && !STOP.has(word) && !/^\d+$/.test(word));
  const left = side(match[1]).slice(-3);
  const right = side(match[2]).slice(0, 3);
  return left.length && right.length ? [left, right] : [];
}

// Um video que refere outro ano e de outra edicao (ex.: Final Battle 2021 para a de 2023).
function conflictingYear(year, videoTitle) {
  if (!year) return false;
  const years = String(videoTitle || '').match(/\b(19[89]\d|20[0-4]\d)\b/g);
  return Boolean(years && !years.includes(String(year)));
}

// Datas explicitas no titulo ("September 4", "Sept. 4th", "9/4/26"). Devolve true se o
// titulo traz alguma data e nenhuma e uma das datas aceites.
function mentionsOtherDate(title, acceptedDates) {
  const text = String(title || '');
  const found = [];
  MONTHS.forEach(([full, abbr], i) => {
    const re = new RegExp(`\\b(${full}|${abbr})\\.?\\s*(\\d{1,2})(st|nd|rd|th)?\\b`, 'gi');
    let m;
    while ((m = re.exec(text))) found.push([i + 1, Number(m[2])]);
  });
  // So datas com ano (m/d/aa), para nao confundir com "5-on-5" e afins.
  const numeric = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g;
  let n;
  while ((n = numeric.exec(text))) found.push([Number(n[1]), Number(n[2])]);
  if (!found.length) return false;
  const accepted = acceptedDates
    .filter(Boolean)
    .map((iso) => [Number(String(iso).slice(5, 7)), Number(String(iso).slice(8, 10))]);
  return !found.some(([month, day]) => accepted.some(([am, ad]) => am === month && ad === day));
}

// Palavras que identificam um programa, sem as genericas da promocao e do dia:
// "TNA iMPACT!" -> ["impact"], "All Elite Wrestling: Dynamite" -> ["dynamite"],
// "WWE Saturday Night's Main Event" -> ["main", "event"].
const PROGRAM_STOP = new Set([
  'wwe', 'wwf', 'aew', 'tna', 'the', 'all', 'elite', 'wrestling', 'monday', 'friday',
  'saturday', 'sunday', 'night', 'nights', 's',
]);

function programWords(name) {
  return normalize(name)
    .split(' ')
    .map((w) => w.replace(/^#/, ''))
    .filter((w) => w.length >= 2 && !PROGRAM_STOP.has(w));
}

// "#361 - Rebel Heart: Akins Ford Arena in Athens, GA" -> "Rebel Heart"
function episodeNameCore(name) {
  return String(name || '')
    .replace(/^#?\d+\s*[-–—:]\s*/, '')
    .split(':')[0];
}

// "4 days ago", "Streamed 2 weeks ago" -> dias (aproximado); null se nao se perceber.
function publishedDaysAgo(text) {
  const m = String(text || '').match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const perUnit = { second: 0, minute: 0, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
  return n * perUnit[unit];
}

function daysSince(iso) {
  const value = Date.parse(`${String(iso || '').slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(value) ? (Date.now() - value) / (24 * HOUR) : null;
}

function shiftDate(iso, days) {
  const value = Date.parse(`${String(iso || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(value)) return null;
  return new Date(value + days * 24 * HOUR).toISOString().slice(0, 10);
}

function datePattern(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const [full, abbr] = MONTHS[month - 1];
  return new RegExp(
    `\\b(${full}|${abbr})\\.?\\s*${day}(st|nd|rd|th)?\\b|\\b${day}(st|nd|rd|th)?\\s+(of\\s+)?(${full}|${abbr})\\b|\\b${month}[/.-]${day}([/.-]\\d{2,4})?\\b`,
    'i'
  );
}

// Pontua um video face ao pedido; devolve null quando nao corresponde.
function scoreVideo(video, ctx) {
  if (video.seconds && video.seconds < 60) return null; // shorts
  const title = video.title;
  const official = isOfficial(video, ctx.promoKey);
  let score = 0;

  if (ctx.airdate && (ctx.program || ctx.genericEpisode)) {
    // Episodio de um programa semanal (com ou sem titulo proprio): tem de ser dessa
    // emissao. Aceita-se se o titulo do video traz a data (dia e mes) ou as palavras
    // do titulo do episodio; rejeita-se sempre se for de outro ano, de antes da
    // emissao ou de outro programa.
    // Datas vindas do Cinemeta podem estar 1 dia a frente: aceita-se o dia antes e
    // o dia depois (os episodios semanais estao 7 dias afastados, nao ha confusao).
    const dates = [ctx.airdate];
    // Nos programas aceita-se sempre +-1 dia (canais publicam com a data do dia seguinte);
    // como o nome do programa e obrigatorio, nao ha confusao com programas de dias seguidos.
    if (ctx.dateTolerance || ctx.program) dates.push(shiftDate(ctx.airdate, -1), shiftDate(ctx.airdate, 1));
    const hitDate = dates.some((date) => {
      const pattern = datePattern(date);
      return Boolean(pattern && pattern.test(title));
    });
    // O titulo traz uma data explicita que nao e a da emissao: e de outro episodio,
    // mesmo que o resto bata (ex.: "TNA Xplosion September 4" para o de dia 11).
    if (mentionsOtherDate(title, dates)) return null;
    // O video pode ser de outro ano com o mesmo dia e mes (ex.: NXT TakeOver de 2014).
    if (conflictingYear(Number(String(ctx.airdate).slice(0, 4)), title)) return null;
    // Carregado antes de o episodio ir para o ar: e de outra emissao (ex.: "Xplosion July 24").
    const uploadedDaysAgo = publishedDaysAgo(video.published);
    const airedDaysAgo = daysSince(ctx.airdate);
    if (uploadedDaysAgo !== null && airedDaysAgo !== null && uploadedDaysAgo > airedDaysAgo + 3) return null;
    // "WWE Main Event" nao e o "Saturday/Sunday Night's Main Event".
    if (/night'?s main event/i.test(title) && !/night'?s main event/i.test(String(ctx.showName || ''))) return null;
    // Nome do programa: todas as palavras tem de estar no titulo do video. O canal
    // oficial nao chega (o canal da WWE publica Raw, SmackDown, NXT e Evolve).
    const showTokens = programWords(ctx.showName);
    const titleWords = normalize(title).split(' ');
    const hitShow = showTokens.length > 0 && showTokens.every((t) => titleWords.includes(t));
    // Episodios com titulo proprio (ex.: "Rebel Heart"): os videos oficiais citam o
    // titulo em vez da data. Contam so as palavras que nao sao o nome do programa.
    const have = normalize(title).split(' ');
    const nameWords =
      ctx.episodeName && !ctx.genericEpisode
        ? tokens(episodeNameCore(ctx.episodeName)).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !showTokens.includes(w))
        : [];
    const nameRatio = nameWords.length ? nameWords.filter((w) => have.includes(w)).length / nameWords.length : 0;
    if (!hitDate && nameRatio < 0.5) return null;
    if (!hitShow) return null;
    score += 0.5 + (hitDate ? 0.2 : 0) + (hitShow ? 0.2 : 0) + nameRatio * 0.2;
  } else {
    if (conflictingNumber(ctx.title, title)) return null;
    if (conflictingYear(ctx.year, title)) return null;
    const sides = fighters(ctx.title);
    if (sides.length === 2) {
      const have = normalize(title).split(' ');
      if (!sides.every((words) => words.some((word) => have.includes(word)))) return null;
    }
    const wanted = tokens(ctx.title);
    if (!wanted.length) return null;
    const have = new Set(normalize(title).split(' ').map((t) => t.replace(/^#/, '')));
    const words = wanted.filter((t) => !/^\d+$/.test(t));
    const numbers = wanted.filter((t) => /^\d+$/.test(t));
    const wordHits = words.filter((t) => have.has(t)).length;
    const numberHits = numbers.filter((t) => have.has(t)).length;
    const wordRatio = words.length ? wordHits / words.length : 1;
    if (words.length && wordRatio < 0.5) return null;
    if (!words.length && numbers.length && !numberHits) return null;
    score += wordRatio * 0.6;
    if (numbers.length) score += numberHits ? 0.2 : -0.2;
  }

  if (official) score += 0.35;
  else if (video.verified) score += 0.05;
  // Penalizacao que tira ate os videos oficiais fora de tema (conferencias, antevisoes).
  if (OFF_TOPIC.test(title)) score -= 0.7;
  if (video.seconds >= 20 * 60) score += 0.15;
  else if (video.seconds >= 5 * 60) score += 0.05;

  return score >= 0.45 ? score : null;
}

function rank(results, ctx) {
  const scored = [];
  const seen = new Set();
  for (const video of results) {
    if (seen.has(video.id)) continue;
    seen.add(video.id);
    const score = scoreVideo(video, ctx);
    if (score !== null) scored.push({ ...video, score, official: isOfficial(video, ctx.promoKey) });
  }
  return scored.sort((a, b) => b.score - a.score);
}

// Data em numeros, como muitos canais a escrevem ("ROH TV | 9/10/2026").
function numericDateQuery(ctx) {
  const m = String(ctx.airdate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${ctx.promoLabel || ctx.showName} ${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

// Videos do YouTube que correspondem ao evento/episodio pedido, melhores primeiro.
async function findVideos(ctx) {
  // Episodios sem titulo: pesquisa a data por extenso e em numeros ao mesmo
  // tempo, porque cada canal escreve a data de uma maneira.
  const queries = [ctx.query];
  if (ctx.airdate && (ctx.program || ctx.genericEpisode)) {
    const numeric = numericDateQuery(ctx);
    if (numeric && numeric !== ctx.query) queries.push(numeric);
  }
  const lists = await Promise.all(queries.map((q) => search(q).catch(() => [])));
  return rank(lists.flat(), ctx).slice(0, MAX_RESULTS);
}

module.exports = {
  search,
  findVideos,
  scoreVideo,
  conflictingNumber,
  conflictingYear,
  fighters,
  extractInitialData,
  collectVideos,
};
