const https = require('https');
const http = require('http');

const UA = 'StremioWrestlingUFCAddon/1.0 (+https://github.com/)';

function rawRequest(url, { timeout = 15000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const mod = target.protocol === 'http:' ? http : https;
    const req = mod.request(
      target,
      { method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/json, text/html;q=0.9, */*;q=0.8', ...headers } },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return rawRequest(next, { timeout, headers }).then(resolve, reject);
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      }
    );
    req.setTimeout(timeout, () => req.destroy(new Error(`timeout after ${timeout}ms`)));
    req.on('error', reject);
    req.end();
  });
}

async function getWithHeaders(url, opts = {}) {
  const retries = opts.retries == null ? 2 : opts.retries;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await rawRequest(url, opts);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (res.status === 401 || res.status === 403) {
        console.warn(`[http] ${res.status} em ${url} — verifica a chave da API (TRAKT_CLIENT_ID).`);
        return null;
      }
      if (res.status >= 400) {
        if (process.env.ADDON_DEBUG) console.warn(`[http] ${res.status} em ${url}`);
        return null;
      }
      return { body: res.body, headers: res.headers, status: res.status };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(400 * (attempt + 1) + Math.floor(Math.random() * 250));
    }
  }
  if (process.env.ADDON_DEBUG) console.warn(`[http] falhou ${url}: ${lastErr && lastErr.message}`);
  return null;
}

async function getText(url, opts = {}) {
  const res = await getWithHeaders(url, opts);
  return res ? res.body : null;
}

function parseJson(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (_) {
    return null;
  }
}

async function getJson(url, opts = {}) {
  return parseJson(await getText(url, opts));
}

// Igual a getJson mas devolve tambem os cabecalhos (o Trakt pagina com X-Pagination-*).
async function getJsonWithHeaders(url, opts = {}) {
  const res = await getWithHeaders(url, opts);
  if (!res) return null;
  return { json: parseJson(res.body), headers: res.headers || {} };
}

// Descarrega um recurso binario (usado pelo proxy de imagens).
function getBuffer(url, { timeout = 20000, headers = {} } = {}) {
  return new Promise((resolve) => {
    const target = new URL(url);
    const mod = target.protocol === 'http:' ? http : https;
    const req = mod.request(target, { method: 'GET', headers: { 'User-Agent': UA, ...headers } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return getBuffer(new URL(res.headers.location, url).toString(), { timeout, headers }).then(resolve);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({ status, body: Buffer.concat(chunks), contentType: res.headers['content-type'] || null })
      );
    });
    req.setTimeout(timeout, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Executa tarefas com concorrencia limitada e um intervalo minimo entre arranques,
// para respeitar os limites de pedidos das APIs publicas (TVmaze: ~2 pedidos/seg).
async function mapLimit(items, limit, spacingMs, worker) {
  const out = new Array(items.length);
  let index = 0;
  let lastStart = 0;
  async function runner() {
    for (;;) {
      const i = index++;
      if (i >= items.length) return;
      if (spacingMs > 0) {
        const wait = lastStart + spacingMs - Date.now();
        lastStart = Date.now() + Math.max(0, wait);
        if (wait > 0) await sleep(wait);
      }
      try {
        out[i] = await worker(items[i], i);
      } catch (_) {
        out[i] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return out;
}

module.exports = { getJson, getJsonWithHeaders, getText, getBuffer, sleep, mapLimit };
