// Historical USD prices for Robinhood Chain pools — on a strict call budget.
//
// Valuing a liquidity change needs the price at the moment it happened, not
// the price now: a position opened last week must be valued at last week's
// price or the P&L is fiction. GeckoTerminal indexes Uniswap v4 pools by their
// bytes32 pool id, which is exactly the identifier `ModifyLiquidity` carries,
// so no address mapping is needed.
//
// The hard constraint is quota, not correctness. GeckoTerminal's free tier is
// ~30 calls/minute and the background pool scan already keeps roughly half of
// every minute spoken for, so this layer:
//
//   * serialises every call through one queue with a minimum gap, and backs
//     off rather than hammering when it is told 429;
//   * spends exactly three calls per pool (identity, base series, quote
//     series) and shares quote series across every pool that settles in the
//     same token — in practice USDG for almost all of them;
//   * persists what it learns to disk, because a candle that has already
//     closed will never change. A restart should not cost the quota twice.

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fetchJson, UpstreamError } from "./httpClient.mjs";

const BASE_URL = "https://api.geckoterminal.com/api/v2";
const HOUR_MS = 3_600_000;

/** v4 sorts a pool's tokens by address; token0 is the lower one. */
const sortTokens = (a, b) => (a.address < b.address ? [a, b] : [b, a]);

/**
 * One queue, one call at a time, never faster than `minGapMs`. Sharing the
 * quota with the scanner means the polite thing and the reliable thing are
 * the same thing.
 */
function createThrottle({ minGapMs = 2_200, maxRetries = 3 } = {}) {
  let chain = Promise.resolve();
  let lastAt = 0;

  return function run(fn) {
    const task = chain.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = Math.max(0, lastAt + minGapMs - Date.now());
        if (wait) await new Promise((r) => setTimeout(r, wait));
        lastAt = Date.now();
        try {
          return await fn();
        } catch (err) {
          const rateLimited = err instanceof UpstreamError && err.status === 429;
          if (!rateLimited || attempt >= maxRetries) throw err;
          // Give the scanner room to finish its minute before trying again.
          await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
        }
      }
    });
    chain = task.then(() => {}, () => {});
    return task;
  };
}

async function loadDisk(path) {
  if (!path) return {};
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

async function saveDisk(path, data) {
  if (!path) return;
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, path);
  } catch {
    /* a cache that cannot persist is still a working cache */
  }
}

export function createPriceBook({
  network = "robinhood",
  cachePath = null,
  candleLimit = 1000,
  minGapMs = 2_200,
  freshMs = 6 * 3_600_000,
} = {}) {
  const throttle = createThrottle({ minGapMs });

  /** { meta: {poolId: {...}}, series: {tokenAddress: {at, candles}} } */
  let disk = null;
  let diskDirty = false;
  const seriesByToken = new Map();
  const metaById = new Map();

  async function ready() {
    if (disk) return;
    disk = await loadDisk(cachePath);
    disk.meta ??= {};
    disk.series ??= {};
    for (const [id, meta] of Object.entries(disk.meta)) metaById.set(id, meta);
    for (const [address, entry] of Object.entries(disk.series)) {
      // Stale series are kept, not dropped: an old candle is still the right
      // price for an old event. They are just refreshed when asked for again.
      if (Array.isArray(entry?.candles)) seriesByToken.set(address, entry);
    }
  }

  function candlesFrom(payload) {
    const list = payload?.data?.attributes?.ohlcv_list;
    if (!Array.isArray(list)) return [];
    return list
      .filter((row) => Array.isArray(row) && row.length >= 5)
      .map(([time, , , , close]) => ({ time: time * 1000, close: Number(close) }))
      .filter((c) => Number.isFinite(c.close) && c.close > 0)
      .sort((a, b) => a.time - b.time);
  }

  /** Pool identity: which token is 0, which is 1, decimals, and the pair name. */
  async function poolMeta(poolId) {
    await ready();
    const cached = metaById.get(poolId);
    if (cached) return cached;

    const data = await throttle(() =>
      fetchJson(`${BASE_URL}/networks/${network}/pools/${poolId}?include=base_token,quote_token`, {
        timeoutMs: 12_000,
      })
    );

    const attrs = data?.data?.attributes ?? {};
    const relationships = data?.data?.relationships ?? {};
    const baseId = relationships.base_token?.data?.id ?? "";
    const tokens = (data?.included ?? []).map((t) => ({
      address: String(t.attributes?.address ?? "").toLowerCase(),
      symbol: t.attributes?.symbol ?? "?",
      decimals: Number(t.attributes?.decimals ?? 18),
      isBase: t.id === baseId,
    }));
    if (tokens.length < 2) throw new UpstreamError(`No token metadata for pool ${poolId}`);

    const [token0, token1] = sortTokens(tokens[0], tokens[1]);
    const meta = {
      poolId,
      name: attrs.name ?? poolId,
      token0,
      token1,
      baseAddress: tokens.find((t) => t.isBase)?.address ?? token0.address,
      quoteAddress: tokens.find((t) => !t.isBase)?.address ?? token1.address,
    };

    metaById.set(poolId, meta);
    disk.meta[poolId] = meta;
    diskDirty = true;
    return meta;
  }

  /**
   * An hourly USD price series for one token, read off a pool it trades in.
   * `token=` lets one pool answer for either side, so a pool costs two series
   * calls at most and quote tokens are usually already cached from the first
   * pool that used them.
   */
  async function loadSeries(poolId, tokenAddress) {
    await ready();
    const cached = seriesByToken.get(tokenAddress);
    if (cached && Date.now() - cached.at < freshMs) return cached.candles;

    let candles;
    try {
      const payload = await throttle(() =>
        fetchJson(
          `${BASE_URL}/networks/${network}/pools/${poolId}/ohlcv/hour` +
            `?limit=${candleLimit}&currency=usd&token=${tokenAddress}`,
          { timeoutMs: 15_000 }
        )
      );
      candles = candlesFrom(payload);
    } catch {
      // Keep whatever we already had rather than replacing a real series with
      // an empty one — a transient 429 must not erase last hour's prices.
      if (cached) return cached.candles;
      candles = [];
    }

    if (candles.length > 0 || !cached) {
      const entry = { at: Date.now(), candles };
      seriesByToken.set(tokenAddress, entry);
      disk.series[tokenAddress] = entry;
      diskDirty = true;
    }
    return seriesByToken.get(tokenAddress).candles;
  }

  /** Loads identity and both price series for every pool the walk touched. */
  async function warmPools(poolIds) {
    await ready();
    const metas = new Map();

    for (const poolId of [...new Set(poolIds)]) {
      try {
        const meta = await poolMeta(poolId);
        metas.set(poolId, meta);
        await loadSeries(poolId, meta.token0.address);
        await loadSeries(poolId, meta.token1.address);
      } catch {
        /* an unpriceable pool leaves its positions flagged, never zeroed */
      }
    }

    if (diskDirty) {
      await saveDisk(cachePath, disk);
      diskDirty = false;
    }
    return metas;
  }

  /**
   * The USD price of a token at a timestamp: the close of the last hourly
   * candle at or before it. Null past either end of the series rather than
   * extrapolating — a price we do not have is not a price.
   */
  function priceAt(tokenAddress, unixSeconds) {
    const entry = seriesByToken.get(tokenAddress);
    const candles = entry?.candles;
    if (!candles || candles.length === 0) return null;

    const target = unixSeconds * 1000;
    if (target < candles[0].time - HOUR_MS) return null;

    let lo = 0;
    let hi = candles.length - 1;
    let found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (candles[mid].time <= target) {
        found = candles[mid];
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found ? found.close : null;
  }

  return {
    warmPools,
    priceAt,
    cacheSizes: () => ({ pools: metaById.size, series: seriesByToken.size }),
  };
}
