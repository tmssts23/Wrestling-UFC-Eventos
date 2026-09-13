// Opcoes de "stream" geradas a partir do titulo do evento ou episodio.
//
// Os addons de streams instalados recebem do Stremio apenas o id (IMDb), nunca o
// titulo; quando o evento nao tem IMDb, ficam sem resposta. Estas opcoes abrem
// uma pesquisa pelo nome nas fontes oficiais e legais de cada promocao.
const franchises = require('./franchises');
const { promotion } = require('./promotions');

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

function enc(text) {
  return encodeURIComponent(String(text || '').trim());
}

const TRILLER = {
  name: 'Triller TV',
  note: 'PPVs e eventos em direto e a pedido',
  url: (q) => `https://www.trillertv.com/search/?q=${enc(q)}`,
};

// Fontes oficiais por promocao (URLs verificados).
const OFFICIAL = {
  wwe: [
    {
      name: 'Netflix',
      note: 'Raw e Premium Live Events da WWE (precisa de conta Netflix)',
      url: (q) => `https://www.netflix.com/search?q=${enc(q)}`,
    },
  ],
  aew: [
    TRILLER,
    { name: 'AEW+', note: 'Serviço oficial da AEW', url: () => 'https://myaew.com/' },
  ],
  tna: [
    { name: 'TNA+', note: 'Serviço oficial da TNA, com o arquivo de eventos', url: () => 'https://www.tnaplus.com/' },
    TRILLER,
  ],
  ufc: [
    {
      name: 'UFC Fight Pass',
      note: 'Arquivo oficial de eventos UFC',
      url: (q) => `https://ufcfightpass.com/search?q=${enc(q)}`,
    },
  ],
};
OFFICIAL.ufcshows = OFFICIAL.ufc;

function promoLabel(promoKey) {
  const promo = promotion(promoKey);
  if (promo) return promo.name;
  return promoKey === 'ufc' ? 'UFC' : '';
}

// Garante que a pesquisa leva o nome da promocao ("Raw" -> "WWE Raw").
function withPromo(title, promoKey) {
  const label = promoLabel(promoKey);
  const text = String(title || '').trim();
  if (!label) return text;
  const brands = /\b(wwe|wwf|wcw|ecw|nxt|aew|all elite|tna|impact|roh|ring of honor|ufc)\b/i;
  return brands.test(text) ? text : `${label} ${text}`;
}

function englishDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])} ${m[1]}`;
}

function ptLongDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : '';
}

function isGenericEpisodeName(name) {
  return !name || /^(episode|episódio|episodio)\s*\d+$/i.test(String(name).trim()) || /^#?\d+$/.test(String(name).trim());
}

// Texto de pesquisa de um episodio: nome do programa + titulo do episodio, ou a
// data de emissao quando o titulo e generico ("Episódio 39").
function episodeQuery(show, promoKey, episode, season, number) {
  const base = withPromo(show.name, promoKey);
  if (episode && !isGenericEpisodeName(episode.name)) return `${base} ${episode.name}`;
  if (episode && episode.airdate) return `${base} ${englishDate(episode.airdate)}`;
  return `${base} season ${season} episode ${number}`;
}

function movieQuery(movie, promoKey) {
  return withPromo(movie.name, promoKey);
}

// Stream reproduzivel no leitor do Stremio/Nuvio a partir de um video do YouTube.
function videoStream(video) {
  const ficha = [video.channel + (video.official ? ' ✔ oficial' : ''), video.duration, video.views, video.published]
    .filter(Boolean)
    .join(' · ');
  return {
    name: video.official ? '▶ YouTube ✔' : '▶ YouTube',
    title: `${video.title}\n${ficha}`,
    ytId: video.id,
  };
}

function build({ query, label, date, promoKey, providers, videos }) {
  const quando = date ? ` · ${ptLongDate(date)}` : '';
  const alvo = label || query;
  const out = [];

  if (providers && providers.names && providers.names.length) {
    out.push({
      name: '📺 Onde ver em PT',
      title: `${alvo}${quando}\nDisponível em: ${providers.names.join(', ')}\n(lista TMDB / JustWatch)`,
      externalUrl: providers.link,
    });
  }

  for (const video of videos || []) out.push(videoStream(video));

  out.push({
    name: '🔎 YouTube',
    title: `Procurar "${query}"\nCanais oficiais, combates e resumos publicados`,
    externalUrl: `https://www.youtube.com/results?search_query=${enc(query)}`,
  });

  for (const source of OFFICIAL[promoKey] || []) {
    out.push({
      name: `🔎 ${source.name}`,
      title: `Procurar "${query}"\n${source.note}`,
      externalUrl: source.url(query),
    });
  }
  return out;
}

module.exports = {
  build,
  episodeQuery,
  movieQuery,
  withPromo,
  isGenericEpisodeName,
  normalize: franchises.normalize,
};
