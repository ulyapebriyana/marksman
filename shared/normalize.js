// Pure mapping from raw upstream API shapes into the one consistent
// "internal pool" shape the rest of the app (scoring, transitions, API,
// frontend) works with. Deliberately kept separate from the raw shapes so a
// DexScreener or GeckoTerminal response-format change only touches this file.

const MAJOR_QUOTE_SYMBOLS = new Set(["USDC", "USDT", "WETH", "WBTC", "DAI"]);

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function lower(address) {
  return typeof address === "string" ? address.toLowerCase() : address;
}

/**
 * @param {object} raw a single "pair" object from DexScreener's /latest/dex/pairs response
 * @param {object} ctx
 * @param {number} ctx.now epoch ms "current time" (injectable for tests)
 * @param {Record<string, {ticker:string, name?:string}>} ctx.tokenMap lowercased address -> stock info
 * @returns {object} internal pool shape, pre-enrichment
 */
export function normalizeDexScreenerPair(raw, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const tokenMap = ctx.tokenMap ?? {};

  const baseAddress = lower(raw?.baseToken?.address);
  const quoteSymbol = String(raw?.quoteToken?.symbol ?? "").toUpperCase();
  const stockInfo = baseAddress ? tokenMap[baseAddress] : undefined;
  const isTokenizedStock = Boolean(stockInfo);

  const pairCreatedAt = numOrNull(raw?.pairCreatedAt);

  return {
    // raw identity, untouched
    address: raw?.pairAddress,
    chainId: raw?.chainId,
    dexId: raw?.dexId,
    url: raw?.url,

    baseToken: {
      address: baseAddress,
      symbol: raw?.baseToken?.symbol ?? null,
      name: raw?.baseToken?.name ?? null,
    },
    quoteToken: {
      address: lower(raw?.quoteToken?.address),
      symbol: raw?.quoteToken?.symbol ?? null,
      name: raw?.quoteToken?.name ?? null,
    },

    priceUsd: numOrNull(raw?.priceUsd),
    liquidityUsd: num(raw?.liquidity?.usd, 0),

    volume: {
      m5: num(raw?.volume?.m5, 0),
      h1: num(raw?.volume?.h1, 0),
      h6: num(raw?.volume?.h6, 0),
      h24: num(raw?.volume?.h24, 0),
    },
    priceChange: {
      m5: numOrNull(raw?.priceChange?.m5),
      h1: numOrNull(raw?.priceChange?.h1),
      h6: numOrNull(raw?.priceChange?.h6),
      h24: numOrNull(raw?.priceChange?.h24),
    },
    txns: {
      h1: { buys: num(raw?.txns?.h1?.buys, 0), sells: num(raw?.txns?.h1?.sells, 0) },
      h24: { buys: num(raw?.txns?.h24?.buys, 0), sells: num(raw?.txns?.h24?.sells, 0) },
    },

    fdv: numOrNull(raw?.fdv),
    marketCap: numOrNull(raw?.marketCap),

    pairCreatedAt,
    ageMs: pairCreatedAt != null ? now - pairCreatedAt : null,

    labels: Array.isArray(raw?.labels) ? raw.labels : [],

    isKnownToken: isTokenizedStock || MAJOR_QUOTE_SYMBOLS.has(quoteSymbol),
    isTokenizedStock,
    stockTicker: stockInfo?.ticker ?? null,
    stockName: stockInfo?.name ?? null,

    // Filled in by applyEnrichment(); left absent here so downstream code
    // can distinguish "not yet enriched" from "enriched with no data".
    priceChange1h: undefined,
    sparkline: [],
    underlyingPrice: null,
    premiumPct: null,
    dataQuality: { hasCandles: false, hasUnderlyingPrice: false },
  };
}

/**
 * @param {object} raw a resolved pool object from geckoterminal.mjs's fetchBulkPools/getPoolsPage
 * @param {object} ctx
 * @param {number} ctx.now epoch ms "current time" (injectable for tests)
 * @param {string} [ctx.chainId] chain slug used to synthesize a DexScreener URL (cosmetic only)
 * @param {Record<string, {ticker:string, name?:string}>} ctx.tokenMap lowercased address -> stock info
 * @returns {object} internal pool shape, pre-enrichment — same shape as normalizeDexScreenerPair
 */
export function normalizeGeckoTerminalPool(raw, ctx = {}) {
  const now = ctx.now ?? Date.now();
  const tokenMap = ctx.tokenMap ?? {};
  const chainId = ctx.chainId ?? "robinhood";

  const baseAddress = lower(raw?.baseToken?.address);
  const quoteSymbol = String(raw?.quoteToken?.symbol ?? "").toUpperCase();
  const stockInfo = baseAddress ? tokenMap[baseAddress] : undefined;
  const isTokenizedStock = Boolean(stockInfo);

  const pairCreatedAt = raw?.poolCreatedAt ? Date.parse(raw.poolCreatedAt) : null;
  const address = raw?.address;

  return {
    address,
    chainId,
    dexId: raw?.dexName ?? null,
    url: address ? `https://dexscreener.com/${chainId}/${address}` : null,

    baseToken: {
      address: baseAddress,
      symbol: raw?.baseToken?.symbol ?? null,
      name: raw?.baseToken?.name ?? null,
    },
    quoteToken: {
      address: lower(raw?.quoteToken?.address),
      symbol: raw?.quoteToken?.symbol ?? null,
      name: raw?.quoteToken?.name ?? null,
    },

    priceUsd: numOrNull(raw?.priceUsd),
    liquidityUsd: num(raw?.liquidityUsd, 0),

    volume: {
      m5: num(raw?.volume?.m5, 0),
      h1: num(raw?.volume?.h1, 0),
      h6: num(raw?.volume?.h6, 0),
      h24: num(raw?.volume?.h24, 0),
    },
    priceChange: {
      m5: numOrNull(raw?.priceChange?.m5),
      h1: numOrNull(raw?.priceChange?.h1),
      h6: numOrNull(raw?.priceChange?.h6),
      h24: numOrNull(raw?.priceChange?.h24),
    },
    txns: {
      h1: { buys: num(raw?.txns?.h1?.buys, 0), sells: num(raw?.txns?.h1?.sells, 0) },
      h24: { buys: num(raw?.txns?.h24?.buys, 0), sells: num(raw?.txns?.h24?.sells, 0) },
    },

    fdv: numOrNull(raw?.fdv),
    marketCap: numOrNull(raw?.marketCap),

    pairCreatedAt,
    ageMs: pairCreatedAt != null ? now - pairCreatedAt : null,

    // GeckoTerminal doesn't surface honeypot/danger labels the way
    // DexScreener does; a pool discovered only here just won't get that
    // particular security signal until/unless DexScreener also has it.
    labels: [],

    isKnownToken: isTokenizedStock || MAJOR_QUOTE_SYMBOLS.has(quoteSymbol),
    isTokenizedStock,
    stockTicker: stockInfo?.ticker ?? null,
    stockName: stockInfo?.name ?? null,

    priceChange1h: undefined,
    sparkline: [],
    underlyingPrice: null,
    premiumPct: null,
    dataQuality: { hasCandles: false, hasUnderlyingPrice: false },
  };
}

/**
 * Unions pools discovered from multiple sources by address, so a pool
 * matching no DexScreener seed query (found only via GeckoTerminal's
 * chain-wide listing) still makes it into the scan. When the same address
 * appears in both, the DexScreener version wins — it carries honeypot/danger
 * `labels` that GeckoTerminal doesn't provide.
 *
 * @param {object[]} dexScreenerPools normalized via normalizeDexScreenerPair
 * @param {object[]} geckoTerminalPools normalized via normalizeGeckoTerminalPool
 * @returns {object[]}
 */
export function mergePoolSources(dexScreenerPools, geckoTerminalPools) {
  const byAddress = new Map();
  for (const pool of geckoTerminalPools) {
    if (pool.address) byAddress.set(pool.address.toLowerCase(), pool);
  }
  for (const pool of dexScreenerPools) {
    if (pool.address) byAddress.set(pool.address.toLowerCase(), pool);
  }
  return [...byAddress.values()];
}

/**
 * Merges enrichment results (GeckoTerminal candles, underlying equity price)
 * into an already-normalized pool. Returns a new object; does not mutate.
 *
 * @param {object} pool output of normalizeDexScreenerPair
 * @param {object} enrichment
 * @param {{time:number, close:number}[]} [enrichment.candles] 1h candles, oldest first
 * @param {number} [enrichment.underlyingPrice] real equity price (tokenized stocks only)
 */
export function applyEnrichment(pool, enrichment = {}) {
  const next = { ...pool, dataQuality: { ...pool.dataQuality } };

  // `candles` is expected to be recent 1h-bar OHLCV, oldest first (e.g. the
  // last ~24 hourly bars). priceChange1h comes from just the last two bars
  // (a real, candle-derived hourly move); the full array feeds the sparkline
  // so the chart shows more history than the momentum figure needs.
  const candles = enrichment.candles;
  if (Array.isArray(candles) && candles.length >= 2) {
    const prev = candles[candles.length - 2]?.close;
    const curr = candles[candles.length - 1]?.close;
    if (Number.isFinite(prev) && prev !== 0 && Number.isFinite(curr)) {
      next.priceChange1h = ((curr - prev) / prev) * 100;
    }
    next.sparkline = candles.map((c) => c.close);
    next.dataQuality.hasCandles = true;
  } else {
    next.dataQuality.hasCandles = false;
  }

  if (pool.isTokenizedStock) {
    const underlyingPrice = numOrNull(enrichment.underlyingPrice);
    if (underlyingPrice != null && underlyingPrice > 0 && pool.priceUsd != null) {
      next.underlyingPrice = underlyingPrice;
      next.premiumPct = ((pool.priceUsd - underlyingPrice) / underlyingPrice) * 100;
      next.dataQuality.hasUnderlyingPrice = true;
    } else {
      next.underlyingPrice = null;
      next.premiumPct = null;
      next.dataQuality.hasUnderlyingPrice = false;
    }
  }

  return next;
}
