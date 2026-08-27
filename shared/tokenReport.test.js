import { describe, it, expect } from "vitest";
import { buildTokenReport, REPORT_TUNABLES as T } from "./tokenReport.js";

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);
const HOUR = 3_600_000;

/** Minimal viable inputs; each test overrides only what it is about. */
function makeRaw({ info = {}, market = {}, pairs = [], poolDetails = [], social = null } = {}) {
  // `market: null` models the GeckoTerminal token endpoint being unavailable.
  return {
    address: "0xabc0000000000000000000000000000000000001",
    info: {
      address: "0xabc0000000000000000000000000000000000001",
      name: "Test Token",
      symbol: "TEST",
      categories: [],
      websites: [],
      holders: { count: 1000, top10Pct: 20, next20Pct: 10, next20MorePct: 5, restPct: 65 },
      developerHoldingPct: 1,
      isHoneypot: "unknown",
      launchpad: null,
      ...info,
    },
    market:
      market === null
        ? null
        : {
            priceUsd: 1,
            fdvUsd: 1_000_000,
            marketCapUsd: null,
            normalizedTotalSupply: 1_000_000,
            topPoolAddresses: [],
            ...market,
          },
    dexToken: { pairs, links: { websites: [], socials: [] } },
    poolDetails,
    social,
  };
}

function pair(over = {}) {
  return {
    address: "0xpool1",
    dexId: "uniswap",
    labels: [],
    baseToken: { symbol: "TEST" },
    quoteToken: { symbol: "WETH" },
    liquidityUsd: 100_000,
    volume: { h24: 200_000 },
    priceUsd: 1,
    priceChange: { h24: 5 },
    txns: { h24: { buys: 500, sells: 500 } },
    createdAt: NOW - 30 * 24 * HOUR,
    ...over,
  };
}

const build = (raw) => buildTokenReport(raw, { now: NOW });

describe("buildTokenReport — market aggregation", () => {
  it("sums liquidity and volume across every pool", () => {
    const r = build(makeRaw({ pairs: [pair({ address: "0xa", liquidityUsd: 60_000, volume: { h24: 10_000 } }), pair({ address: "0xb", liquidityUsd: 40_000, volume: { h24: 5_000 } })] }));
    expect(r.market.liquidityUsd).toBe(100_000);
    expect(r.market.volume24hUsd).toBe(15_000);
    expect(r.market.poolCount).toBe(2);
  });

  it("takes age from the OLDEST pool, so a new pool on an old token doesn't read as a new token", () => {
    const r = build(
      makeRaw({
        pairs: [
          pair({ address: "0xold", createdAt: NOW - 100 * 24 * HOUR }),
          pair({ address: "0xnew", createdAt: NOW - 1 * HOUR }),
        ],
      })
    );
    expect(r.market.ageHours).toBeCloseTo(2400, 0);
    expect(r.flags.map((f) => f.code)).not.toContain("very_new");
  });

  it("falls back to FDV and says so when circulating supply is unpublished", () => {
    const r = build(makeRaw({ market: { marketCapUsd: null, fdvUsd: 500_000 }, pairs: [pair()] }));
    expect(r.market.valuationBasis).toBe("fdv");
    expect(r.market.valuationUsd).toBe(500_000);
  });

  // Regression: GeckoTerminal rate-limits readily, and when its token
  // endpoint drops out the report used to lose its valuation entirely
  // because buildPools() discarded DexScreener's fdv/marketCap fields.
  it("falls back to the pools' own valuation when the token endpoint is unavailable", () => {
    const r = build(makeRaw({ market: null, pairs: [pair({ fdv: 750_000 })] }));
    expect(r.market.fdvUsd).toBe(750_000);
    expect(r.market.valuationUsd).toBe(750_000);
    expect(r.market.valuationBasis).toBe("fdv");
  });

  it("finds a valuation on any pool, not only the deepest one", () => {
    const r = build(
      makeRaw({
        market: null,
        pairs: [
          pair({ address: "0xdeep", liquidityUsd: 90_000, fdv: null, marketCap: null }),
          pair({ address: "0xshallow", liquidityUsd: 10_000, fdv: 400_000 }),
        ],
      })
    );
    expect(r.market.valuationUsd).toBe(400_000);
  });

  it("reports a null valuation basis when no source publishes one", () => {
    const r = build(makeRaw({ market: null, pairs: [pair({ fdv: null, marketCap: null })] }));
    expect(r.market.valuationUsd).toBeNull();
    expect(r.market.valuationBasis).toBeNull();
  });

  it("prefers market cap over FDV when it is published", () => {
    const r = build(makeRaw({ market: { marketCapUsd: 250_000, fdvUsd: 500_000 }, pairs: [pair()] }));
    expect(r.market.valuationBasis).toBe("market_cap");
    expect(r.market.valuationUsd).toBe(250_000);
  });
});

describe("buildTokenReport — flow", () => {
  it("treats the unique-trader count as an upper bound, making trades-per-trader a floor", () => {
    const r = build(
      makeRaw({
        pairs: [pair({ address: "0xa", txns: { h24: { buys: 100, sells: 100 } } })],
        poolDetails: [{ address: "0xa", txns: { h24: { buys: 100, sells: 100, buyers: 10, sellers: 10 } } }],
      })
    );
    expect(r.flow.trades24h).toBe(200);
    expect(r.flow.tradersUpperBound).toBe(20);
    expect(r.flow.tradesPerTraderLowerBound).toBe(10);
  });

  it("reports imbalance as a share of total trades", () => {
    const r = build(makeRaw({ pairs: [pair({ txns: { h24: { buys: 700, sells: 300 } } })] }));
    expect(r.flow.imbalancePct).toBeCloseTo(40, 5);
  });
});

describe("buildTokenReport — risk flags at their thresholds", () => {
  it("flags holder concentration high at the high threshold and medium just below it", () => {
    const high = build(makeRaw({ info: { holders: { count: 10, top10Pct: T.holderTop10HighPct } }, pairs: [pair()] }));
    expect(high.flags.find((f) => f.code === "holder_concentration").severity).toBe("tinggi");

    const mid = build(makeRaw({ info: { holders: { count: 10, top10Pct: T.holderTop10HighPct - 0.1 } }, pairs: [pair()] }));
    expect(mid.flags.find((f) => f.code === "holder_concentration").severity).toBe("sedang");
  });

  it("does not flag holder concentration below the medium threshold", () => {
    const r = build(makeRaw({ info: { holders: { count: 10, top10Pct: T.holderTop10MediumPct - 0.1 } }, pairs: [pair()] }));
    expect(r.flags.map((f) => f.code)).not.toContain("holder_concentration");
  });

  it("escalates very thin liquidity to critical", () => {
    const r = build(makeRaw({ pairs: [pair({ liquidityUsd: T.veryThinLiquidityUsd - 1 })] }));
    expect(r.flags.find((f) => f.code === "liquidity_very_thin").severity).toBe("kritis");
  });

  it("flags a danger label from the aggregator as critical", () => {
    const r = build(makeRaw({ pairs: [pair({ labels: ["honeypot"] })] }));
    expect(r.flags.find((f) => f.code === "honeypot_label").severity).toBe("kritis");
    expect(r.verdict.level).toBe("kritis");
  });

  it("only flags single-pool dependency when there is more than one pool", () => {
    const single = build(makeRaw({ pairs: [pair()] }));
    expect(single.flags.map((f) => f.code)).not.toContain("single_pool_dependency");

    const many = build(
      makeRaw({ pairs: [pair({ address: "0xa", liquidityUsd: 99_000 }), pair({ address: "0xb", liquidityUsd: 1_000 })] })
    );
    expect(many.flags.map((f) => f.code)).toContain("single_pool_dependency");
  });

  it("suppresses flow-based flags when there are too few traders to mean anything", () => {
    const r = build(
      makeRaw({
        pairs: [pair({ address: "0xa", txns: { h24: { buys: 5, sells: 0 } } })],
        poolDetails: [{ address: "0xa", txns: { h24: { buys: 5, sells: 0, buyers: 1, sellers: 0 } } }],
      })
    );
    expect(r.flags.map((f) => f.code)).not.toContain("trader_concentration");
    expect(r.flags.map((f) => f.code)).not.toContain("flow_imbalance");
  });

  it("sorts flags worst-first", () => {
    const r = build(
      makeRaw({
        info: { holders: { count: 10, top10Pct: 60 } },
        pairs: [pair({ liquidityUsd: 1_000, labels: ["danger"] })],
      })
    );
    const severities = r.flags.map((f) => f.severity);
    expect(severities[0]).toBe("kritis");
    expect(severities[severities.length - 1]).toBe("info");
  });
});

describe("buildTokenReport — verdict", () => {
  it("escalates two high flags to critical", () => {
    const r = build(
      makeRaw({
        info: { holders: { count: 10, top10Pct: 60 }, developerHoldingPct: 15 },
        pairs: [pair()],
      })
    );
    expect(r.verdict.highCount).toBeGreaterThanOrEqual(2);
    expect(r.verdict.level).toBe("kritis");
  });

  it("escalates three medium flags to high rather than averaging them away", () => {
    const r = build(
      makeRaw({
        info: { holders: { count: 10, top10Pct: 40 }, developerHoldingPct: 6 },
        pairs: [pair({ createdAt: NOW - 40 * HOUR, priceChange: { h24: -30 } })],
      })
    );
    expect(r.verdict.mediumCount).toBeGreaterThanOrEqual(3);
    expect(r.verdict.level).toBe("tinggi");
  });

  it("does not count info flags toward the verdict", () => {
    const r = build(makeRaw({ info: { launchpad: { completed: true, graduationPct: 100 } }, pairs: [pair()] }));
    expect(r.flags.some((f) => f.code === "launchpad_graduated")).toBe(true);
    expect(r.verdict.level).toBe("rendah");
  });
});

describe("buildTokenReport — security checks never fabricate a pass", () => {
  it("reports mint/freeze/blacklist as unverifiable even though the API returned null", () => {
    const r = build(makeRaw({ info: { mintAuthority: null, freezeAuthority: null }, pairs: [pair()] }));
    const check = r.checks.find((c) => c.code === "contract_authority");
    expect(check.status).toBe("unverifiable");
    expect(check.status).not.toBe("pass");
  });

  it("reports an unknown honeypot result as unverifiable, not a pass", () => {
    const r = build(makeRaw({ info: { isHoneypot: "unknown" }, pairs: [pair()] }));
    expect(r.checks.find((c) => c.code === "honeypot_label").status).toBe("unverifiable");
  });

  it("reports missing holder data as unverifiable rather than clean", () => {
    const r = build(makeRaw({ info: { holders: null }, pairs: [pair()] }));
    expect(r.checks.find((c) => c.code === "holder_concentration").status).toBe("unverifiable");
  });

  it("counts the unverifiable checks in an info flag so the gap is visible", () => {
    const r = build(makeRaw({ pairs: [pair()] }));
    const f = r.flags.find((x) => x.code === "unverifiable_checks");
    expect(f.count).toBe(r.checks.filter((c) => c.status === "unverifiable").length);
  });
});

describe("buildTokenReport — an unavailable source is not an absent fact", () => {
  const down = (reason) => ({ geckoterminal: { ok: false, reason }, dexscreener: { ok: true, reason: null } });

  it("blames the rate limit rather than the token when GeckoTerminal 429s", () => {
    const raw = { ...makeRaw({ info: { holders: null }, pairs: [pair()] }), sourceHealth: down("rate_limited") };
    const r = build(raw);
    const check = r.checks.find((c) => c.code === "holder_concentration");
    expect(check.status).toBe("unverifiable");
    expect(check.detail).toContain("membatasi permintaan");
    expect(check.detail).not.toContain("tidak dipublikasikan");
  });

  it("says the data is unpublished when the source answered but had nothing", () => {
    const raw = {
      ...makeRaw({ info: { holders: null }, pairs: [pair()] }),
      sourceHealth: { geckoterminal: { ok: true, reason: null }, dexscreener: { ok: true, reason: null } },
    };
    const r = build(raw);
    expect(r.checks.find((c) => c.code === "holder_concentration").detail).toContain("tidak dipublikasikan");
  });

  it("applies the same distinction to developer holding", () => {
    const raw = {
      ...makeRaw({ info: { holders: null, developerHoldingPct: null }, pairs: [pair()] }),
      sourceHealth: down("rate_limited"),
    };
    expect(build(raw).checks.find((c) => c.code === "developer_holding").detail).toContain("membatasi permintaan");
  });

  it("exposes sourceHealth on the report", () => {
    const raw = { ...makeRaw({ pairs: [pair()] }), sourceHealth: down("rate_limited") };
    expect(build(raw).sourceHealth.geckoterminal.ok).toBe(false);
  });
});

describe("buildTokenReport — social", () => {
  it("defaults to an explicitly unconfigured social block", () => {
    const r = build(makeRaw({ pairs: [pair()] }));
    expect(r.social.configured).toBe(false);
  });

  it("passes a configured social block straight through", () => {
    const r = build(makeRaw({ pairs: [pair()], social: { configured: true, mentions: [], provider: "x" } }));
    expect(r.social.configured).toBe(true);
    expect(r.social.provider).toBe("x");
  });
});

describe("buildTokenReport — Indonesian number formatting in flag copy", () => {
  // Bitten twice: toFixed() emits a period, which an Indonesian reader parses
  // as a thousands separator ("1.3 hari" reads as thirteen hundred days) and
  // which looks broken beside the comma decimals used everywhere else.
  it("writes decimals with a comma, never a period", () => {
    const r = build(
      makeRaw({
        info: { holders: { count: 10, top10Pct: 62.34 }, developerHoldingPct: 12.5 },
        pairs: [
          pair({ address: "0xa", liquidityUsd: 5_000, volume: { h24: 900_000 }, priceChange: { h24: -37.25 }, createdAt: NOW - 40 * HOUR }),
          // Age comes from the OLDEST pool, so this one must be recent too or
          // the "new" flag never fires and the assertion below is vacuous.
          pair({ address: "0xb", liquidityUsd: 20, createdAt: NOW - 40 * HOUR }),
        ],
      })
    );

    // A period followed by 1-2 digits is a leaked decimal point. A period
    // followed by exactly 3 is the Indonesian THOUSANDS separator ($5.020),
    // which is correct and must not trip this.
    const leakedDecimal = /\d\.\d{1,2}(?!\d)/;
    for (const flag of r.flags) {
      expect(flag.detail, `leaked decimal in ${flag.code}: ${flag.detail}`).not.toMatch(leakedDecimal);
    }

    const drawdown = r.flags.find((f) => f.code === "drawdown");
    expect(drawdown.detail).toContain("37,3%");

    const newFlag = r.flags.find((f) => f.code === "new");
    expect(newFlag.detail).toContain("1,7 hari");
  });

  it("formats the security checklist copy the same way", () => {
    const r = build(makeRaw({ info: { holders: { count: 10, top10Pct: 62.34 }, developerHoldingPct: 12.5 }, pairs: [pair()] }));
    const leakedDecimal = /\d\.\d{1,2}(?!\d)/;
    for (const check of r.checks) {
      expect(check.detail, `leaked decimal in ${check.code}: ${check.detail}`).not.toMatch(leakedDecimal);
    }
  });
});
