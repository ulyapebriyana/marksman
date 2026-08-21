import { describe, it, expect } from "vitest";
import {
  evaluateTokenSecurity,
  evaluateVolumeSustainability,
  calculateFeeTvlEfficiency,
  evaluatePairQuality,
  getMaturityRangeGuidance,
  runFunnel,
  FUNNEL_TUNABLES,
} from "./funnelScoring.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function basePool(overrides = {}) {
  return {
    address: "0xpool",
    baseToken: { address: "0xtoken", symbol: "FOO", name: "Foo" },
    quoteToken: { address: "0xusdg", symbol: "USDG", name: "USDG" },
    liquidityUsd: 100_000,
    volume: { m5: 300, h1: 4_000, h6: 24_000, h24: 100_000 },
    txns: { h1: { buys: 10, sells: 8 }, h24: { buys: 200, sells: 190 } },
    labels: [],
    marketCap: 2_000_000,
    fdv: 2_000_000,
    ageMs: 10 * DAY_MS,
    feeTierBps: 100,
    ...overrides,
  };
}

describe("evaluateTokenSecurity", () => {
  it("passes a clean, adequately-liquid pool with only unverifiable checks remaining", () => {
    const result = evaluateTokenSecurity(basePool());
    expect(result.passed).toBe(true);
    expect(result.autoFailReasons).toEqual([]);
    const statuses = result.checks.map((c) => c.status);
    expect(statuses.filter((s) => s === "unverifiable").length).toBe(result.unverifiableCount);
    expect(statuses).toContain("pass");
  });

  it("auto-fails on a danger label", () => {
    const result = evaluateTokenSecurity(basePool({ labels: ["honeypot"] }));
    expect(result.passed).toBe(false);
    expect(result.autoFailReasons).toContain("danger_label");
  });

  it("auto-fails below the security liquidity floor", () => {
    const result = evaluateTokenSecurity(basePool({ liquidityUsd: 1_000 }));
    expect(result.passed).toBe(false);
    expect(result.autoFailReasons).toContain("liquidity_below_security_floor");
  });

  it("never marks an unverifiable check as passed", () => {
    const result = evaluateTokenSecurity(basePool());
    for (const check of result.checks) {
      expect(["pass", "fail", "unverifiable"]).toContain(check.status);
    }
    expect(result.checks.some((c) => c.key === "holder_concentration" && c.status === "unverifiable")).toBe(true);
  });
});

describe("evaluateVolumeSustainability", () => {
  it("passes sustained, corroborated volume", () => {
    const result = evaluateVolumeSustainability(basePool());
    expect(result.continuity).toBe("sustained");
    expect(result.passed).toBe(true);
  });

  it("flags a 5-minute spike with no preceding hourly activity", () => {
    const result = evaluateVolumeSustainability(
      basePool({ volume: { m5: 50_000, h1: 100, h6: 200, h24: 60_000 }, txns: { h1: { buys: 1, sells: 0 }, h24: { buys: 50, sells: 40 } } })
    );
    expect(result.continuity).toBe("spike_only");
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("five_minute_spike_not_corroborated");
  });

  it("fails below the 24h volume floor", () => {
    const result = evaluateVolumeSustainability(basePool({ volume: { m5: 10, h1: 50, h6: 200, h24: 500 } }));
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain("volume_24h_below_floor");
  });

  it("reports no_data for a pool with zero 24h volume", () => {
    const result = evaluateVolumeSustainability(basePool({ volume: { m5: 0, h1: 0, h6: 0, h24: 0 } }));
    expect(result.continuity).toBe("no_data");
    expect(result.passed).toBe(false);
  });
});

describe("calculateFeeTvlEfficiency", () => {
  it("matches the worked example from the methodology", () => {
    // volume $500K, fee tier 1%, TVL $250K -> fee pool ~$5,000/day, fee/TVL ~2%/day, ratio 2x
    const result = calculateFeeTvlEfficiency(basePool({ volume: { m5: 0, h1: 0, h6: 0, h24: 500_000 }, liquidityUsd: 250_000, feeTierBps: 100 }));
    expect(result.dailyFeeUsd).toBe(5_000);
    expect(result.feeToTvlPct).toBeCloseTo(2, 5);
    expect(result.volumeToTvlRatio).toBeCloseTo(2, 5);
    expect(result.bucket).toBe("strong");
  });

  it("buckets below 0.25x as weak", () => {
    const result = calculateFeeTvlEfficiency(basePool({ volume: { m5: 0, h1: 0, h6: 0, h24: 10_000 }, liquidityUsd: 100_000 }));
    expect(result.volumeToTvlRatio).toBeCloseTo(0.1, 5);
    expect(result.bucket).toBe("weak");
  });

  it("buckets above 5x as suspicious", () => {
    const result = calculateFeeTvlEfficiency(basePool({ volume: { m5: 0, h1: 0, h6: 0, h24: 600_000 }, liquidityUsd: 100_000 }));
    expect(result.bucket).toBe("suspicious");
  });

  it("falls back to the default fee tier and flags it as assumed", () => {
    const result = calculateFeeTvlEfficiency(basePool({ feeTierBps: null }));
    expect(result.feeTierKnown).toBe(false);
    expect(result.feeTierBps).toBe(FUNNEL_TUNABLES.defaultFeeTierBps);
  });
});

describe("evaluatePairQuality", () => {
  it("recognises a stablecoin-quoted pool", () => {
    const result = evaluatePairQuality(basePool(), []);
    expect(result.isStablePair).toBe(true);
    expect(result.quoteSymbol).toBe("USDG");
  });

  it("flags a WETH pair as not stable", () => {
    const result = evaluatePairQuality(basePool({ quoteToken: { address: "0xweth", symbol: "WETH", name: "Wrapped ETH" } }), []);
    expect(result.isStablePair).toBe(false);
  });

  it("identifies the largest-TVL pool among siblings sharing a base token", () => {
    const pool = basePool({ address: "0xbig", liquidityUsd: 500_000 });
    const siblings = [basePool({ address: "0xsmall1", liquidityUsd: 10_000 }), basePool({ address: "0xsmall2", liquidityUsd: 20_000 })];
    const result = evaluatePairQuality(pool, siblings);
    expect(result.isLargestTvlForToken).toBe(true);
    expect(result.tvlRank).toBe(1);
    expect(result.poolCountForToken).toBe(3);
  });

  it("ranks a smaller pool below its bigger siblings", () => {
    const pool = basePool({ address: "0xsmall", liquidityUsd: 5_000 });
    const siblings = [basePool({ address: "0xbig", liquidityUsd: 500_000 })];
    const result = evaluatePairQuality(pool, siblings);
    expect(result.isLargestTvlForToken).toBe(false);
    expect(result.tvlRank).toBe(2);
  });
});

describe("getMaturityRangeGuidance", () => {
  it("classifies an established token", () => {
    const result = getMaturityRangeGuidance(basePool({ marketCap: 5_000_000, ageMs: 10 * DAY_MS }));
    expect(result.tier).toBe("established");
    expect(result.suggestedLowerRangePct).toEqual([30, 50]);
  });

  it("classifies a strong-but-volatile token", () => {
    const result = getMaturityRangeGuidance(basePool({ marketCap: 700_000, ageMs: 4 * DAY_MS }));
    expect(result.tier).toBe("strong_but_volatile");
    expect(result.suggestedLowerRangePct).toEqual([60, 70]);
  });

  it("classifies a very new token and offers no numeric suggestion", () => {
    const result = getMaturityRangeGuidance(basePool({ marketCap: 5_000_000, ageMs: 1 * DAY_MS }));
    expect(result.tier).toBe("new");
    expect(result.suggestedLowerRangePct).toBeNull();
  });
});

describe("runFunnel", () => {
  it("marks a clean, sustained, well-paired, top-TVL pool as a candidate", () => {
    const pool = basePool({ volume: { m5: 1_500, h1: 20_000, h6: 100_000, h24: 400_000 }, liquidityUsd: 200_000 });
    const result = runFunnel(pool, { siblingPools: [] });
    expect(result.verdict).toBe("candidate");
    expect(result.failedAt).toBeNull();
    expect(result.stagesPassed).toEqual(["security", "volume", "feeTvl", "pairQuality"]);
  });

  it("rejects outright on a danger label regardless of how good later stages look", () => {
    const pool = basePool({
      labels: ["honeypot"],
      volume: { m5: 1_500, h1: 20_000, h6: 100_000, h24: 400_000 },
      liquidityUsd: 200_000,
    });
    const result = runFunnel(pool, { siblingPools: [] });
    expect(result.verdict).toBe("rejected");
    expect(result.failedAt).toBe("security");
  });

  it("rejects on volume even when security passes", () => {
    const pool = basePool({ volume: { m5: 50_000, h1: 0, h6: 0, h24: 60_000 }, txns: { h1: { buys: 0, sells: 0 }, h24: { buys: 5, sells: 4 } } });
    const result = runFunnel(pool, { siblingPools: [] });
    expect(result.verdict).toBe("rejected");
    expect(result.failedAt).toBe("volume");
  });

  it("downgrades a suspicious fee/TVL ratio to watch instead of promoting it", () => {
    const pool = basePool({ volume: { m5: 6_000, h1: 60_000, h6: 300_000, h24: 700_000 }, liquidityUsd: 100_000 });
    const result = runFunnel(pool, { siblingPools: [] });
    expect(result.feeTvl.bucket).toBe("suspicious");
    expect(result.verdict).toBe("watch");
    expect(result.caveats).toContain("fee_tvl_ratio_suspicious");
  });

  it("downgrades to watch when it isn't the largest-TVL pool for its token", () => {
    const pool = basePool({
      address: "0xsmall",
      volume: { m5: 400, h1: 5_000, h6: 25_000, h24: 100_000 },
      liquidityUsd: 50_000,
    });
    const bigger = basePool({ address: "0xbig", liquidityUsd: 500_000 });
    const result = runFunnel(pool, { siblingPools: [bigger] });
    expect(result.verdict).toBe("watch");
    expect(result.failedAt).toBe("pairQuality");
  });

  it("includes all nine checklist items with valid statuses", () => {
    const result = runFunnel(basePool(), { siblingPools: [] });
    expect(result.checklist).toHaveLength(9);
    for (const item of result.checklist) {
      expect(["pass", "fail", "unverifiable", "reminder"]).toContain(item.status);
      expect(typeof item.detail).toBe("string");
    }
  });
});
