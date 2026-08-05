// Single-slot, time-based cache for the whole scan result. Guards against a
// cache stampede: if N requests arrive while a scan is already running (or
// while `force=1` triggers a fresh one), they all await the *same* in-flight
// promise instead of triggering N parallel scans.

/**
 * @param {{ ttlMs?: number }} [opts]
 */
export function createScanCache(opts = {}) {
  const { ttlMs = 60_000 } = opts;
  let cached = null; // { value, at }
  let inFlight = null; // Promise

  /**
   * @param {() => Promise<any>} runFn
   * @param {{ force?: boolean, now?: number }} [options]
   */
  async function getOrRun(runFn, options = {}) {
    const { force = false, now = Date.now() } = options;

    if (!force && cached && now - cached.at < ttlMs) {
      return cached.value;
    }

    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const value = await runFn();
        cached = { value, at: Date.now() };
        return value;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  function peek() {
    return cached?.value ?? null;
  }

  function invalidate() {
    cached = null;
  }

  return { getOrRun, peek, invalidate };
}
