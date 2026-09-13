// Definicao das promocoes suportadas, todas alimentadas pelo TMDB.
//
// `tvQueries` descobrem os programas com temporadas e episodios; `movieQueries`
// descobrem os eventos individuais (cada PPV e um filme no TMDB).
// `include`/`exclude` filtram os resultados pelo titulo.

const PROMOTIONS = {
  wwe: {
    key: 'wwe',
    name: 'WWE',
    label: 'WWE',
    // Eventos com data anterior a fundacao sao filmes com o mesmo nome (ex.: "Backlash" de 1947).
    founded: 1963,
    blurb: 'Eventos, Premium Live Events e programas semanais da WWE (inclui arquivo WWF, WCW e ECW).',
    // Ids TMDB sempre incluidos, mesmo sem "WWE" no titulo (o Raw chama-se so "Raw").
    pinnedTv: [4656],
    tvQueries: [
      'WWE Raw', 'WWE Monday Night Raw', 'Raw', 'WWE SmackDown', 'WWE NXT', 'WWE Main Event', 'WWE Superstars',
      'WWE Evolve', 'WWE LFG', 'NXT UK', '205 Live', 'WWE Velocity', 'WWE Heat',
      'WCW Monday Nitro', 'WCW Thunder', 'ECW Hardcore TV', 'WWF Superstars',
    ],
    movieQueries: [
      'WWE', 'WWF', 'WCW', 'ECW', 'WrestleMania', 'Royal Rumble', 'SummerSlam',
      'Survivor Series', 'Money in the Bank', 'Elimination Chamber', 'Backlash',
      'Hell in a Cell', 'Extreme Rules', 'Crown Jewel', 'Night of Champions',
      'NXT TakeOver', 'In Your House', 'Starrcade', 'Halloween Havoc', 'Bash at the Beach',
      'King of the Ring', 'WarGames', 'Clash at the Castle', 'Bad Blood', 'Wrestlepalooza',
    ],
    include: /\b(wwe|wwf|wcw|ecw|nxt|wrestlemania|royal rumble|summerslam|survivor series|money in the bank|elimination chamber|backlash|hell in a cell|extreme rules|crown jewel|night of champions|in your house|starrcade|halloween havoc|bash at the beach|king of the ring|wargames|clash at the castle|bad blood|wrestlepalooza|takeover|smackdown|monday night raw|205 live)\b/i,
    exclude: /(aew|all elite|impact wrestling|ring of honor|\broh\b|\btna\b|new japan|njpw|kitchen|greatest|classics|top \d+|superstar ink)/i,
  },
  aew: {
    key: 'aew',
    name: 'AEW',
    label: 'AEW',
    founded: 2019,
    blurb: 'Pay-per-views e programas semanais da All Elite Wrestling.',
    tvQueries: ['AEW Dynamite', 'AEW Collision', 'AEW Rampage', 'AEW Dark', 'All Elite Wrestling'],
    movieQueries: [
      'AEW', 'All Elite Wrestling', 'AEW Double or Nothing', 'AEW All Out', 'AEW Full Gear',
      'AEW Revolution', 'AEW All In', 'AEW Forbidden Door', 'AEW WrestleDream',
      'AEW Grand Slam', 'AEW Worlds End', 'AEW Dynasty', 'AEW Blood and Guts',
    ],
    include: /\b(aew|all elite wrestling)\b/i,
    exclude: null,
  },
  tna: {
    key: 'tna',
    name: 'TNA',
    label: 'TNA',
    founded: 2002,
    blurb: 'Eventos e programas da TNA / Impact Wrestling (ex-NWA: Total Nonstop Action).',
    tvQueries: ['TNA Impact', 'Impact Wrestling', 'TNA Xplosion', 'TNA Global Impact'],
    movieQueries: [
      'TNA', 'Impact Wrestling', 'TNA Bound for Glory', 'TNA Slammiversary', 'TNA Hard to Kill',
      'TNA Rebellion', 'TNA Victory Road', 'TNA Sacrifice', 'TNA No Surrender', 'TNA Genesis',
      'TNA Against All Odds', 'TNA Lockdown', 'TNA Destination X', 'TNA One Night Only',
    ],
    include: /\b(tna|impact wrestling|total nonstop action|bound for glory|slammiversary|hard to kill)\b/i,
    exclude: /\b(wwe|aew|ring of honor)\b/i,
  },
  ufcshows: {
    key: 'ufcshows',
    name: 'UFC',
    label: 'UFC (programas)',
    blurb: 'Séries e programas da UFC: The Ultimate Fighter, Embedded, documentários.',
    tvQueries: [
      'The Ultimate Fighter', 'UFC Embedded', 'UFC Unleashed', 'Dana White Contender Series',
      'UFC Countdown', 'Inside the UFC', 'UFC Primetime',
    ],
    movieQueries: [],
    include: /\b(ufc|ultimate fighter|ultimate fighting|dana white)\b/i,
    exclude: null,
  },
};

// Eventos UFC individuais (filmes do TMDB), do mais recente para o mais antigo.
const UFC_EVENTS = {
  key: 'ufc',
  name: 'UFC',
  founded: 1993,
  movieQueries: [
    'UFC', 'UFC Fight Night', 'UFC on ESPN', 'UFC on ABC', 'UFC on Fox', 'UFC on FX',
    'UFC on Versus', 'UFC Ultimate Fighter Finale', 'UFC Fight for the Troops',
  ],
  include: /^\s*ufc\b/i,
  exclude: /(embedded|countdown|primetime|road to|all access|unleashed|top \d+|best of|greatest)/i,
};

const WRESTLING_KEYS = ['wwe', 'aew', 'tna'];

function promotion(key) {
  return PROMOTIONS[key] || null;
}

module.exports = { PROMOTIONS, UFC_EVENTS, WRESTLING_KEYS, promotion };
