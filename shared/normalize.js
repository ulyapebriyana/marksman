// Pure mapping from raw upstream API shapes into the one consistent
// "internal pool" shape the rest of the app (scoring, transitions, API,
// frontend) works with. Deliberately kept separate from the raw shapes so a
// DexScreener or GeckoTerminal response-format change only touches this file.

const MAJOR_QUOTE_SYMBOLS = new Set(["USDC", "USDT", "WETH", "WBTC", "DAI"]);

/** Trailing fee tier in a GeckoTerminal pool name, e.g. "USDG / WETH 0.01%". */
const FEE_TIER_IN_NAME = /(\d+(?:\.\d+)?)\s*%\s*$/;

/**
 * Fee tier in basis points, parsed from a pool name. This is the only place
 * the tier is published for Robinhood Chain pools, and it matters a lot: an
 * LP's entire fee income scales linearly with it, so assuming 30 bp for a
 * 1 bp pool overstates yield by 30x.
 *
 * @param {string|null|undefined} name
 * @returns {number|null} basis points, or null when the name carries no tier
 */
export function parseFeeTierBps(name) {
  if (typeof name !== "string") return null;
  const match = name.match(FEE_TIER_IN_NAME);
  if (!match) return null;
  const percent = Number(match[1]);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
  return percent * 100;
}

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

function externalHttpUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function dexScreenerLinks(raw) {
  const websites = Array.isArray(raw?.info?.websites) ? raw.info.websites : [];
  const socials = Array.isArray(raw?.info?.socials) ? raw.info.socials : [];

  const website =
    websites.find((item) => /website|official|site/i.test(String(item?.label ?? ""))) ?? websites[0];

  // Fabriq treats an X profile as the project's community link, but gives a
  // real X Community priority when both are present. Preserve the URL only;
  // the frontend chooses the single-person/group icon from the path.
  const xLinks = socials
    .map((item) => ({ type: String(item?.type ?? "").toLowerCase(), url: externalHttpUrl(item?.url) }))
    .filter((item) => item.url && (item.type === "twitter" || item.type === "x" || /(?:x|twitter)\.com\//i.test(item.url)));
  const community = xLinks.find((item) => /\/i\/communities\//i.test(item.url)) ?? xLinks[0];

  return {
    website: externalHttpUrl(website?.url),
    community: community?.url ?? null,
  };
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

    // DexScreener doesn't publish the tier; mergePoolSources backfills it from
    // the GeckoTerminal copy of the same pool when one exists.
    feeTierBps: null,

    labels: Array.isArray(raw?.labels) ? raw.labels : [],
    links: dexScreenerLinks(raw),

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

    feeTierBps: parseFeeTierBps(raw?.name),

    // GeckoTerminal doesn't surface honeypot/danger labels the way
    // DexScreener does; a pool discovered only here just won't get that
    // particular security signal until/unless DexScreener also has it.
    labels: [],
    links: { website: null, community: null },

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
 * `labels` that GeckoTerminal doesn't provide — except for `feeTierBps`,
 * which only GeckoTerminal publishes (in the pool name) and which the winning
 * DexScreener record would otherwise drop to null.
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
    if (!pool.address) continue;
    const key = pool.address.toLowerCase();
    const gecko = byAddress.get(key);
    byAddress.set(key, {
      ...pool,
      feeTierBps: pool.feeTierBps ?? gecko?.feeTierBps ?? null,
    });
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
