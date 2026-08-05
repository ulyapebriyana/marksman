import { describe, it, expect } from "vitest";
import { normalizeDexScreenerPair, normalizeGeckoTerminalPool, mergePoolSources, applyEnrichment } from "./normalize.js";

const NOW = Date.parse("2026-08-06T12:00:00Z");

function rawPair(overrides = {}) {
  return {
    chainId: "robinhood",
    dexId: "uniswap",
    pairAddress: "0xPAIR",
    url: "https://dexscreener.com/robinhood/0xpair",
    baseToken: { address: "0xBASE", symbol: "NVDAX", name: "NVIDIA Stock Token" },
    quoteToken: { address: "0xQUOTE", symbol: "USDC", name: "USD Coin" },
    priceUsd: "123.45",
    liquidity: { usd: 250_000 },
    volume: { m5: 100, h1: 1000, h6: 5000, h24: 20000 },
    priceChange: { m5: 0.1, h1: 1.2, h6: 3, h24: 5 },
    txns: { h1: { buys: 10, sells: 8 }, h24: { buys: 120, sells: 100 } },
    fdv: 1_000_000,
    marketCap: 900_000,
    pairCreatedAt: NOW - 5 * 24 * 60 * 60 * 1000,
    labels: [],
    ...overrides,
  };
}

const tokenMap = { "0xbase": { ticker: "NVDA", name: "NVIDIA Corp" } };

describe("normalizeDexScreenerPair", () => {
  it("maps all core fields and lowercases addresses", () => {
    const pool = normalizeDexScreenerPair(rawPair(), { now: NOW, tokenMap });
    expect(pool.address).toBe("0xPAIR");
    expect(pool.baseToken.address).toBe("0xbase");
    expect(pool.quoteToken.address).toBe("0xquote");
    expect(pool.priceUsd).toBe(123.45);
    expect(pool.liquidityUsd).toBe(250_000);
    expect(pool.volume).toEqual({ m5: 100, h1: 1000, h6: 5000, h24: 20000 });
    expect(pool.txns.h24).toEqual({ buys: 120, sells: 100 });
  });

  it("computes ageMs from pairCreatedAt and the injected now", () => {
    const pool = normalizeDexScreenerPair(rawPair(), { now: NOW, tokenMap });
    expect(pool.ageMs).toBe(5 * 24 * 60 * 60 * 1000);
  });

  it("marks a pool as a tokenized stock when the base token is in the tokenMap", () => {
    const pool = normalizeDexScreenerPair(rawPair(), { now: NOW, tokenMap });
    expect(pool.isTokenizedStock).toBe(true);
    expect(pool.stockTicker).toBe("NVDA");
    expect(pool.isKnownToken).toBe(true);
  });

  it("is not a tokenized stock when the base token is absent from the tokenMap", () => {
    const pool = normalizeDexScreenerPair(rawPair({ baseToken: { address: "0xOTHER", symbol: "FOO", name: "Foo" } }), {
      now: NOW,
      tokenMap,
    });
    expect(pool.isTokenizedStock).toBe(false);
    expect(pool.stockTicker).toBeNull();
  });

  it("treats a major-quote pair as known even without a tokenMap match", () => {
    const pool = normalizeDexScreenerPair(
      rawPair({ baseToken: { address: "0xrando", symbol: "RND", name: "Random" }, quoteToken: { address: "0xq", symbol: "WETH", name: "Wrapped Ether" } }),
      { now: NOW, tokenMap: {} }
    );
    expect(pool.isKnownToken).toBe(true);
  });

  it("treats an obscure quote + unmapped base as unknown", () => {
    const pool = normalizeDexScreenerPair(
      rawPair({ baseToken: { address: "0xrando", symbol: "RND", name: "Random" }, quoteToken: { address: "0xq", symbol: "SHIBX", name: "ShibaX" } }),
      { now: NOW, tokenMap: {} }
    );
    expect(pool.isKnownToken).toBe(false);
  });

  it("defaults missing numeric fields to 0 or null rather than NaN", () => {
    const pool = normalizeDexScreenerPair(rawPair({ liquidity: undefined, volume: undefined, fdv: undefined }), {
      now: NOW,
      tokenMap,
    });
    expect(pool.liquidityUsd).toBe(0);
    expect(pool.volume.h24).toBe(0);
    expect(pool.fdv).toBeNull();
  });

  it("leaves ageMs null when pairCreatedAt is missing", () => {
    const pool = normalizeDexScreenerPair(rawPair({ pairCreatedAt: undefined }), { now: NOW, tokenMap });
    expect(pool.ageMs).toBeNull();
  });

  it("starts enrichment fields empty/absent before enrichment runs", () => {
    const pool = normalizeDexScreenerPair(rawPair(), { now: NOW, tokenMap });
    expect(pool.priceChange1h).toBeUndefined();
    expect(pool.sparkline).toEqual([]);
    expect(pool.dataQuality).toEqual({ hasCandles: false, hasUnderlyingPrice: false });
  });
});

describe("applyEnrichment", () => {
  const basePool = () => normalizeDexScreenerPair(rawPair(), { now: NOW, tokenMap });

  it("computes priceChange1h and sparkline from candles", () => {
    const candles = [{ time: 1, close: 100 }, { time: 2, close: 110 }];
    const pool = applyEnrichment(basePool(), { candles });
    expect(pool.priceChange1h).toBeCloseTo(10, 5);
    expect(pool.sparkline).toEqual([100, 110]);
    expect(pool.dataQuality.hasCandles).toBe(true);
  });

  it("handles a price decline in candles as negative priceChange1h", () => {
    const candles = [{ time: 1, close: 100 }, { time: 2, close: 90 }];
    const pool = applyEnrichment(basePool(), { candles });
    expect(pool.priceChange1h).toBeCloseTo(-10, 5);
  });

  it("marks hasCandles false and leaves priceChange1h unset when candles are missing", () => {
    const pool = applyEnrichment(basePool(), {});
    expect(pool.dataQuality.hasCandles).toBe(false);
    expect(pool.priceChange1h).toBeUndefined();
  });

  it("marks hasCandles false when only a single candle is available (can't diff)", () => {
    const pool = applyEnrichment(basePool(), { candles: [{ time: 1, close: 100 }] });
    expect(pool.dataQuality.hasCandles).toBe(false);
  });

  it("derives priceChange1h from only the last two candles, while sparkline keeps the full series", () => {
    const candles = [
      { time: 1, close: 50 },
      { time: 2, close: 200 }, // big earlier swing that priceChange1h must NOT reflect
      { time: 3, close: 100 },
      { time: 4, close: 110 },
    ];
    const pool = applyEnrichment(basePool(), { candles });
    expect(pool.priceChange1h).toBeCloseTo(10, 5); // (110-100)/100
    expect(pool.sparkline).toEqual([50, 200, 100, 110]);
  });

  it("computes premiumPct for tokenized stocks with a positive on-chain premium", () => {
    const pool = applyEnrichment(basePool(), { underlyingPrice: 100 }); // priceUsd is 123.45
    expect(pool.premiumPct).toBeCloseTo(23.45, 2);
    expect(pool.dataQuality.hasUnderlyingPrice).toBe(true);
  });

  it("computes a negative premiumPct (discount) correctly", () => {
    const pool = applyEnrichment(basePool(), { underlyingPrice: 200 }); // priceUsd 123.45 < 200
    expect(pool.premiumPct).toBeLessThan(0);
  });

  it("leaves premiumPct null when the underlying price is missing for a tokenized stock", () => {
    const pool = applyEnrichment(basePool(), {});
    expect(pool.premiumPct).toBeNull();
    expect(pool.dataQuality.hasUnderlyingPrice).toBe(false);
  });

  it("never sets premiumPct for a non-tokenized-stock pool even if underlyingPrice is passed by mistake", () => {
    const plain = normalizeDexScreenerPair(rawPair({ baseToken: { address: "0xplain", symbol: "PLN", name: "Plain" } }), {
      now: NOW,
      tokenMap,
    });
    const pool = applyEnrichment(plain, { underlyingPrice: 50 });
    expect(pool.premiumPct).toBeNull();
    expect(pool.dataQuality.hasUnderlyingPrice).toBe(false);
  });

  it("does not mutate the input pool", () => {
    const pool = basePool();
    const frozenSnapshot = JSON.stringify(pool);
    applyEnrichment(pool, { candles: [{ time: 1, close: 1 }, { time: 2, close: 2 }], underlyingPrice: 5 });
    expect(JSON.stringify(pool)).toBe(frozenSnapshot);
  });
});

function rawGeckoPool(overrides = {}) {
  return {
    address: "0xCASHCAT",
    dexName: "Uniswap V3 (Robinhood)",
    baseToken: { address: "0xCASHCAT_TOKEN", symbol: "CASHCAT", name: "Cash Cat" },
    quoteToken: { address: "0xWETH", symbol: "WETH", name: "Wrapped Ether" },
    priceUsd: "0.0012",
    liquidityUsd: 45_000,
    volume: { m5: 50, h1: 800, h6: 4000, h24: 18_000 },
    priceChange: { m5: 0.2, h1: 3, h6: 8, h24: 15 },
    txns: { h1: { buys: 5, sells: 3 }, h24: { buys: 80, sells: 60 } },
    fdv: 500_000,
    marketCap: 480_000,
    poolCreatedAt: "2026-08-01T12:00:00Z",
    ...overrides,
  };
}

describe("normalizeGeckoTerminalPool", () => {
  it("maps a pool discovered only via GeckoTerminal's chain-wide listing (e.g. CASHCAT, no DexScreener seed-query match)", () => {
    const pool = normalizeGeckoTerminalPool(rawGeckoPool(), { now: NOW, tokenMap: {} });
    expect(pool.address).toBe("0xCASHCAT");
    expect(pool.baseToken.symbol).toBe("CASHCAT");
    expect(pool.liquidityUsd).toBe(45_000);
    expect(pool.volume.h24).toBe(18_000);
    expect(pool.dexId).toBe("Uniswap V3 (Robinhood)");
  });

  it("lowercases token addresses like the DexScreener normalizer does", () => {
    const pool = normalizeGeckoTerminalPool(rawGeckoPool(), { now: NOW, tokenMap: {} });
    expect(pool.baseToken.address).toBe("0xcashcat_token");
  });

  it("synthesizes a DexScreener URL from chainId + address", () => {
    const pool = normalizeGeckoTerminalPool(rawGeckoPool(), { now: NOW, chainId: "robinhood", tokenMap: {} });
    expect(pool.url).toBe("https://dexscreener.com/robinhood/0xCASHCAT");
  });

  it("computes ageMs from poolCreatedAt (ISO string, unlike DexScreener's epoch ms)", () => {
    const pool = normalizeGeckoTerminalPool(rawGeckoPool(), { now: NOW, tokenMap: {} });
    expect(pool.ageMs).toBe(5 * 24 * 60 * 60 * 1000);
  });

  it("detects tokenized stocks via the same tokenMap lookup as the DexScreener normalizer", () => {
    const pool = normalizeGeckoTerminalPool(
      rawGeckoPool({ baseToken: { address: "0xNVDA", symbol: "NVDA", name: "NVIDIA" } }),
      { now: NOW, tokenMap: { "0xnvda": { ticker: "NVDA", name: "NVIDIA Corp" } } }
    );
    expect(pool.isTokenizedStock).toBe(true);
    expect(pool.stockTicker).toBe("NVDA");
  });

  it("always has empty labels since GeckoTerminal doesn't provide honeypot/danger flags", () => {
    const pool = normalizeGeckoTerminalPool(rawGeckoPool(), { now: NOW, tokenMap: {} });
    expect(pool.labels).toEqual([]);
  });

  it("defaults missing numeric fields to 0/null rather than NaN", () => {
    const pool = normalizeGeckoTerminalPool(rawGeckoPool({ liquidityUsd: undefined, volume: undefined, fdv: undefined }), {
      now: NOW,
      tokenMap: {},
    });
    expect(pool.liquidityUsd).toBe(0);
    expect(pool.volume.h24).toBe(0);
    expect(pool.fdv).toBeNull();
  });

  it("produces a shape identical in keys to normalizeDexScreenerPair's output", () => {
    const dexPool = normalizeDexScreenerPair(rawPair(), { now: NOW, tokenMap: {} });
    const geckoPool = normalizeGeckoTerminalPool(rawGeckoPool(), { now: NOW, tokenMap: {} });
    expect(Object.keys(geckoPool).sort()).toEqual(Object.keys(dexPool).sort());
  });
});

describe("mergePoolSources", () => {
  it("includes pools found only via GeckoTerminal (e.g. CASHCAT, no DexScreener seed-query match)", () => {
    const geckoOnly = normalizeGeckoTerminalPool(rawGeckoPool(), { now: NOW, tokenMap: {} });
    const merged = mergePoolSources([], [geckoOnly]);
    expect(merged).toHaveLength(1);
    expect(merged[0].baseToken.symbol).toBe("CASHCAT");
  });

  it("includes pools found only via DexScreener", () => {
    const dexOnly = normalizeDexScreenerPair(rawPair(), { now: NOW, tokenMap: {} });
    const merged = mergePoolSources([dexOnly], []);
    expect(merged).toHaveLength(1);
  });

  it("dedupes by address, preferring the DexScreener version (it carries honeypot/danger labels)", () => {
    const address = "0xSHARED";
    const dexVersion = normalizeDexScreenerPair(rawPair({ pairAddress: address, labels: ["honeypot"] }), {
      now: NOW,
      tokenMap: {},
    });
    const geckoVersion = normalizeGeckoTerminalPool(rawGeckoPool({ address }), { now: NOW, tokenMap: {} });

    const merged = mergePoolSources([dexVersion], [geckoVersion]);
    expect(merged).toHaveLength(1);
    expect(merged[0].labels).toEqual(["honeypot"]);
  });

  it("is case-insensitive when deduping addresses", () => {
    const dexVersion = normalizeDexScreenerPair(rawPair({ pairAddress: "0xAbCdEf" }), { now: NOW, tokenMap: {} });
    const geckoVersion = normalizeGeckoTerminalPool(rawGeckoPool({ address: "0xabcdef" }), { now: NOW, tokenMap: {} });

    const merged = mergePoolSources([dexVersion], [geckoVersion]);
    expect(merged).toHaveLength(1);
  });
});
