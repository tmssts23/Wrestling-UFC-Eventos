// Episodios de um programa a partir do Cinemeta, o addon oficial de metadados do
// Stremio. Nao precisa de chave e usa a numeracao de temporadas/episodios do IMDb,
// que e a que os addons de streams usam para encontrar cada episodio.
const { getJson } = require('./httpx');
const cache = require('./cache');

const HOUR = 60 * 60 * 1000;
const BASE = 'https://v3-cinemeta.strem.io';

// Data de emissao do Cinemeta. As horas que guarda nao sao coerentes entre programas
// (uns ficam no proprio dia, outros no dia seguinte em UTC), e converter para a hora
// dos EUA estragava tanto como corrigia. Usa-se a data tal como vem; as comparacoes
// por data (numeracao de streams, videos do YouTube) aceitam 1 dia de diferenca.
function usDate(stamp) {
  return stamp ? String(stamp).slice(0, 10) : null;
}

function normalizeVideo(video) {
  if (!video) return null;
  const season = Number(video.season);
  const number = Number(video.episode != null ? video.episode : video.number);
  if (!Number.isFinite(season) || season <= 0 || !Number.isFinite(number) || number <= 0) return null;
  const released = video.released || video.firstAired || null;
  return {
    season,
    number,
    name: String(video.name || video.title || '').trim(),
    airdate: usDate(released),
    airstamp: released,
    runtime: null,
    summary: String(video.overview || video.description || '').trim(),
    image: video.thumbnail || null,
    rating: null,
    source: 'cinemeta',
  };
}

async function seriesEpisodes(imdb) {
  if (!/^tt\d+$/.test(String(imdb || ''))) return [];
  return cache.memo(
    `cinemeta:series:${imdb}`,
    6 * HOUR,
    async () => {
      const json = await getJson(`${BASE}/meta/series/${imdb}.json`, { timeout: 15000, retries: 1 });
      const videos = (json && json.meta && json.meta.videos) || [];
      return videos
        .map(normalizeVideo)
        .filter(Boolean)
        .sort((a, b) => a.season - b.season || a.number - b.number);
    },
    { staleMs: 3 * 24 * HOUR }
  );
}

module.exports = { seriesEpisodes, usDate };
