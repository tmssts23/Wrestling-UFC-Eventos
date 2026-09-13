const store = new Map();
const inflight = new Map();
const MAX_ENTRIES = 600;

function now() {
  return Date.now();
}

function prune() {
  if (store.size <= MAX_ENTRIES) return;
  const excess = store.size - MAX_ENTRIES;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    if (++removed >= excess) break;
  }
}

function get(key) {
  return store.get(key) || null;
}

function set(key, value, ttlMs) {
  store.set(key, { value, expires: now() + ttlMs, stored: now() });
  prune();
}

// stale-while-revalidate: devolve o valor em cache de imediato e, se estiver
// expirado mas ainda dentro de `staleMs`, actualiza em segundo plano.
async function memo(key, ttlMs, loader, { staleMs = 0 } = {}) {
  const entry = store.get(key);
  if (entry && entry.expires > now()) return entry.value;

  if (entry && staleMs > 0 && entry.expires + staleMs > now()) {
    refresh(key, ttlMs, loader);
    return entry.value;
  }

  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    try {
      const value = await loader();
      if (value !== null && value !== undefined) set(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

function refresh(key, ttlMs, loader) {
  if (inflight.has(key)) return;
  const promise = (async () => {
    try {
      const value = await loader();
      if (value !== null && value !== undefined) set(key, value, ttlMs);
    } catch (_) {
      /* mantem o valor antigo */
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
}

module.exports = { get, set, memo, refresh };
