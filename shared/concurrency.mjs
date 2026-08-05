// Bounded-concurrency async map: runs `fn` over `items` with at most `limit`
// in flight at once, instead of Promise.all-everything (which would blow
// past upstream rate limits) or a fully serial loop (too slow).

/**
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {number} limit
 * @returns {Promise<R[]>} results in the same order as `items`
 */
export async function mapWithConcurrency(items, fn, limit = 6) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
