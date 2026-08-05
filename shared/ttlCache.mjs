// Generic per-key TTL cache with separate (shorter) negative-caching for
// failures, so a flaky upstream doesn't get hammered every scan cycle but a
// real recovery is still picked up reasonably quickly.

/**
 * @param {{ successTtlMs?: number, failureTtlMs?: number }} [opts]
 */
export function createTtlCache(opts = {}) {
  const { successTtlMs = 55_000, failureTtlMs = 20_000 } = opts;
  const store = new Map(); // key -> { expiresAt, ok, value, error }

  /**
   * @param {string} key
   * @param {() => Promise<any>} fetchFn
   * @param {number} [now]
   */
  async function getOrFetch(key, fetchFn, now = Date.now()) {
    const entry = store.get(key);
    if (entry && entry.expiresAt > now) {
      if (entry.ok) return entry.value;
      throw entry.error;
    }

    try {
      const value = await fetchFn();
      store.set(key, { expiresAt: now + successTtlMs, ok: true, value });
      return value;
    } catch (err) {
      store.set(key, { expiresAt: now + failureTtlMs, ok: false, error: err });
      throw err;
    }
  }

  function clear() {
    store.clear();
  }

  function size() {
    return store.size;
  }

  return { getOrFetch, clear, size };
}
