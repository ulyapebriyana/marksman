// GeckoTerminal (no API key). Tighter rate limit (~30/min) than DexScreener.
//
// Network slug confirmed live against the API: "robinhood" (same slug
// DexScreener uses for Robinhood Chain).
//
// Unlike DexScreener's keyword-only search, GeckoTerminal exposes a real
// chain-wide pool listing (`/networks/{network}/pools`, ranked by liquidity,
// 3 pages = ~60 pools; `/networks/{network}/new_pools` for freshly created
// ones). This is the PRIMARY bulk-scan/intake source — it catches pools
// whose name/symbol wouldn't match any DexScreener seed query (e.g. a token
// with no "robinhood" or stock-ticker branding at all). DexScreener remains
// a secondary source layered on top for its honeypot/danger `labels`, which
// GeckoTerminal doesn't provide.

import { fetchJson } from "./httpClient.mjs";

const BASE_URL = "https://api.geckoterminal.com/api/v2";
const DEFAULT_TIMEOUT_MS = 8000;

function resolveIncluded(included) {
  const byId = new Map();
  for (const item of included ?? []) {
    byId.set(`${item.type}:${item.id}`, item);
  }
  return byId;
}

function resolveToken(byId, ref) {
  const id = ref?.data?.id;
  if (!id) return { address: null, symbol: null, name: null };
  const token = byId.get(`token:${id}`);
  return {
    address: token?.attributes?.address?.toLowerCase() ?? null,
    symbol: token?.attributes?.symbol ?? null,
    name: token?.attributes?.name ?? null,
  };
}

/**
 * One page of the chain-wide pool listing, resolved (JSON:API `included`
 * flattened) into self-contained objects — no follow-up token lookups needed.
 *
 * @param {string} network
 * @param {{ page?: number, isNew?: boolean, timeoutMs?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function getPoolsPage(network, opts = {}) {
  const { page = 1, isNew = false, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const path = isNew ? "new_pools" : "pools";
  const url = `${BASE_URL}/networks/${network}/${path}?page=${page}&include=base_token,quote_token,dex`;

  const data = await fetchJson(url, { timeoutMs });
  const rows = Array.isArray(data?.data) ? data.data : [];
  const byId = resolveIncluded(data?.included);

  return rows.map((row) => {
    const a = row.attributes ?? {};
    const dexRef = row.relationships?.dex?.data?.id;
    return {
      address: row.attributes?.address ?? row.id?.split("_").slice(1).join("_") ?? null,
      dexName: byId.get(`dex:${dexRef}`)?.attributes?.name ?? null,
      baseToken: resolveToken(byId, row.relationships?.base_token),
      quoteToken: resolveToken(byId, row.relationships?.quote_token),
      priceUsd: a.base_token_price_usd,
      liquidityUsd: a.reserve_in_usd,
      volume: { m5: a.volume_usd?.m5, h1: a.volume_usd?.h1, h6: a.volume_usd?.h6, h24: a.volume_usd?.h24 },
      priceChange: {
        m5: a.price_change_percentage?.m5,
        h1: a.price_change_percentage?.h1,
        h6: a.price_change_percentage?.h6,
        h24: a.price_change_percentage?.h24,
      },
      txns: {
        h1: { buys: a.transactions?.h1?.buys, sells: a.transactions?.h1?.sells },
        h24: { buys: a.transactions?.h24?.buys, sells: a.transactions?.h24?.sells },
      },
      fdv: a.fdv_usd,
      marketCap: a.market_cap_usd,
      poolCreatedAt: a.pool_created_at,
    };
  });
}

/**
 * Chain-wide bulk pool scan: top pools by liquidity (paginated) unioned with
 * the newest pools, deduped by address. This is what makes a pool like
 * "CASHCAT/WETH" — which matches no DexScreener seed query — show up at all.
 *
 * @param {string} network
 * @param {{ pages?: number, includeNewPools?: boolean, timeoutMs?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function fetchBulkPools(network, opts = {}) {
  const { pages = 3, includeNewPools = true, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  const pageNumbers = Array.from({ length: pages }, (_, i) => i + 1);
  const topPages = await Promise.all(
    pageNumbers.map((page) => getPoolsPage(network, { page, timeoutMs }).catch(() => []))
  );
  const newPage = includeNewPools ? await getPoolsPage(network, { page: 1, isNew: true, timeoutMs }).catch(() => []) : [];

  const seen = new Map();
  for (const pool of [...topPages.flat(), ...newPage]) {
    const key = pool.address?.toLowerCase();
    if (key && !seen.has(key)) seen.set(key, pool);
  }
  return [...seen.values()];
}

/**
 * Recent OHLCV candles for one pool, oldest-first.
 *
 * @param {string} network GeckoTerminal network slug, e.g. "robinhood"
 * @param {string} poolAddress
 * @param {{ timeframe?: 'hour'|'minute'|'day', aggregate?: number, limit?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<{time:number, open:number, high:number, low:number, close:number, volume:number}[]>}
 */
export async function getPoolOhlcv(network, poolAddress, opts = {}) {
  const { timeframe = "hour", aggregate = 1, limit = 24, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const url =
    `${BASE_URL}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}` +
    `?aggregate=${aggregate}&limit=${limit}&currency=usd`;

  const data = await fetchJson(url, { timeoutMs });
  const list = data?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];

  // GeckoTerminal returns [unixSeconds, open, high, low, close, volume],
  // newest-first. Normalize to ms and sort ascending (oldest first) so
  // downstream code can always assume that ordering.
  const candles = list
    .filter((row) => Array.isArray(row) && row.length >= 5)
    .map(([time, open, high, low, close, volume]) => ({
      time: time * 1000,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume) || 0,
    }));

  candles.sort((a, b) => a.time - b.time);
  return candles;
}
