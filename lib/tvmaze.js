// Episodios do TVmaze (sem chave), para programas que nao tem IMDb nem Cinemeta.
// A ligacao a cada programa e manual: ver `tvmazeFallback` em lib/promotions.js.
const { getJson } = require('./httpx');
const cache = require('./cache');

const HOUR = 60 * 60 * 1000;

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .trim();
}

async function episodes(tvmazeId) {
  if (!tvmazeId) return [];
  return cache.memo(
    `tvmaze:eps:${tvmazeId}`,
    6 * HOUR,
    async () => {
      const list = await getJson(`https://api.tvmaze.com/shows/${tvmazeId}/episodes`, { timeout: 15000, retries: 1 });
      if (!Array.isArray(list)) return [];
      return list
        .map((ep) => ({
          season: Number(ep.season),
          number: Number(ep.number) || 0,
          name: String(ep.name || '').trim(),
          airdate: ep.airdate || null,
          airstamp: ep.airstamp || null,
          runtime: ep.runtime || null,
          summary: stripHtml(ep.summary),
          image: ep.image ? ep.image.original || ep.image.medium : null,
          rating: null,
          source: 'tvmaze',
        }))
        .filter((ep) => ep.season > 0 && ep.number > 0);
    },
    { staleMs: 3 * 24 * HOUR }
  );
}

module.exports = { episodes };
