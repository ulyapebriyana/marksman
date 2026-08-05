import { describe, it, expect } from "vitest";
import { calculateScore, calculateRisk, evaluatePreset, PRESETS } from "./scoring.js";

const NOW = Date.parse("2026-08-06T12:00:00Z");

function basePool(overrides = {}) {
  return {
    address: "0xpool",
    liquidityUsd: 100_000,
    volume: { h24: 200_000 },
    priceChange1h: 12,
    txns: { h24: { buys: 40, sells: 35 } },
    labels: [],
    isKnownToken: true,
    isTokenizedStock: false,
    premiumPct: null,
    pairCreatedAt: NOW - 3 * 24 * 60 * 60 * 1000, // 3 days old
    __now: NOW,
    dataQuality: { hasCandles: true, hasUnderlyingPrice: true },
    ...overrides,
  };
}

describe("calculateScore", () => {
  it("scores a healthy, active, fresh pool well above the watch threshold", () => {
    const { total, breakdown } = calculateScore(basePool());
    expect(total).toBeGreaterThan(60);
    expect(breakdown.momentum.score).toBeGreaterThan(0);
    expect(breakdown.security.score).toBe(20); // all four security checks pass
  });

  it("gives momentum=0 for flat or negative price change", () => {
    const flat = calculateScore(basePool({ priceChange1h: 0 }));
    const negative = calculateScore(basePool({ priceChange1h: -15 }));
    expect(flat.breakdown.momentum.score).toBe(0);
    expect(negative.breakdown.momentum.score).toBe(0);
  });

  it("caps momentum score at the momentumCapPct threshold", () => {
    const at30 = calculateScore(basePool({ priceChange1h: 30 }));
    const at300 = calculateScore(basePool({ priceChange1h: 300 }));
    expect(at30.breakdown.momentum.score).toBe(25);
    expect(at300.breakdown.momentum.score).toBe(25);
  });

  it("scores zero for missing priceChange1h (no fallback data)", () => {
    const { breakdown } = calculateScore(basePool({ priceChange1h: undefined, priceChange: undefined }));
    expect(breakdown.momentum.value).toBeNull();
    expect(breakdown.momentum.score).toBe(0);
  });

  it("falls back to priceChange.h1 when priceChange1h is absent", () => {
    const { breakdown } = calculateScore(
      basePool({ priceChange1h: undefined, priceChange: { h1: 20 } })
    );
    expect(breakdown.momentum.value).toBe(20);
  });

  it("penalizes thin liquidity in the security bucket", () => {
    const thin = calculateScore(basePool({ liquidityUsd: 500 }));
    expect(thin.breakdown.security.score).toBeLessThan(20);
  });

  it("penalizes unknown tokens in the security bucket", () => {
    const unknown = calculateScore(basePool({ isKnownToken: false }));
    expect(unknown.breakdown.security.score).toBeLessThan(20);
  });

  it("drops security score to zero for honeypot-labeled pools with everything else bad", () => {
    const dangerous = calculateScore(
      basePool({ isKnownToken: false, liquidityUsd: 100, txns: { h24: { buys: 1, sells: 0 } }, labels: ["honeypot"] })
    );
    expect(dangerous.breakdown.security.score).toBe(0);
  });

  it("scores freshness by age bucket, newest = best", () => {
    const veryFresh = calculateScore(basePool({ pairCreatedAt: NOW - 1000 * 60 * 60, __now: NOW })); // 1h
    const week = calculateScore(basePool({ pairCreatedAt: NOW - 5 * 24 * 60 * 60 * 1000, __now: NOW })); // 5d
    const month = calculateScore(basePool({ pairCreatedAt: NOW - 20 * 24 * 60 * 60 * 1000, __now: NOW })); // 20d
    const old = calculateScore(basePool({ pairCreatedAt: NOW - 90 * 24 * 60 * 60 * 1000, __now: NOW })); // 90d
    expect(veryFresh.breakdown.freshness.score).toBe(10);
    expect(week.breakdown.freshness.score).toBe(7);
    expect(month.breakdown.freshness.score).toBe(4);
    expect(old.breakdown.freshness.score).toBe(1);
  });

  it("treats missing age as stale (lowest freshness)", () => {
    const { breakdown } = calculateScore(basePool({ pairCreatedAt: undefined }));
    expect(breakdown.freshness.score).toBe(1);
  });

  it("never exceeds 100 total", () => {
    const maxed = calculateScore(
      basePool({
        priceChange1h: 100,
        liquidityUsd: 10_000_000,
        volume: { h24: 50_000_000 },
        pairCreatedAt: NOW - 1000,
      })
    );
    expect(maxed.total).toBeLessThanOrEqual(100);
  });
});

describe("calculateRisk", () => {
  it("returns just the base risk for a clean, healthy pool", () => {
    const { value, flags } = calculateRisk(basePool());
    expect(value).toBe(5);
    expect(flags).toEqual([]);
  });

  it("flags critical liquidity below $1k", () => {
    const { value, flags } = calculateRisk(basePool({ liquidityUsd: 500 }));
    expect(flags).toContain("liquidity_critical");
    expect(value).toBe(25);
  });

  it("flags low (but not critical) liquidity between $1k-$10k", () => {
    const { flags } = calculateRisk(basePool({ liquidityUsd: 5000 }));
    expect(flags).toContain("liquidity_low");
    expect(flags).not.toContain("liquidity_critical");
  });

  it("flags extreme momentum beyond 100%", () => {
    const { flags } = calculateRisk(basePool({ priceChange1h: 150 }));
    expect(flags).toContain("extreme_momentum");
  });

  it("flags extreme momentum on sharp drops too (abs value)", () => {
    const { flags } = calculateRisk(basePool({ priceChange1h: -120 }));
    expect(flags).toContain("extreme_momentum");
  });

  it("flags pools younger than 30 minutes", () => {
    const { flags } = calculateRisk(basePool({ pairCreatedAt: NOW - 5 * 60 * 1000, __now: NOW }));
    expect(flags).toContain("very_new_pool");
  });

  it("flags low trader count", () => {
    const { flags } = calculateRisk(basePool({ txns: { h24: { buys: 2, sells: 1 } } }));
    expect(flags).toContain("low_trader_count");
  });

  it("flags large premium for tokenized stocks", () => {
    const big = calculateRisk(basePool({ isTokenizedStock: true, premiumPct: 8 }));
    const small = calculateRisk(basePool({ isTokenizedStock: true, premiumPct: 3 }));
    const tiny = calculateRisk(basePool({ isTokenizedStock: true, premiumPct: 0.5 }));
    expect(big.flags).toContain("premium_extreme");
    expect(small.flags).toContain("premium_elevated");
    expect(tiny.flags).not.toContain("premium_elevated");
  });

  it("adds uncertainty penalty when a tokenized stock is missing an underlying price", () => {
    const { flags } = calculateRisk(basePool({ isTokenizedStock: true, premiumPct: null }));
    expect(flags).toContain("missing_underlying_price");
  });

  it("does not penalize premium for non-tokenized-stock pools even if premiumPct is set", () => {
    const { flags } = calculateRisk(basePool({ isTokenizedStock: false, premiumPct: 50 }));
    expect(flags).not.toContain("premium_extreme");
    expect(flags).not.toContain("missing_underlying_price");
  });

  it("adds uncertainty penalty for missing candle data", () => {
    const { flags } = calculateRisk(basePool({ dataQuality: { hasCandles: false } }));
    expect(flags).toContain("missing_candle_data");
  });

  it("stacks penalties from multiple simultaneous risk factors without exceeding 100", () => {
    const { value, flags } = calculateRisk(
      basePool({
        liquidityUsd: 100,
        priceChange1h: 500,
        pairCreatedAt: NOW - 1000,
        txns: { h24: { buys: 0, sells: 0 } },
        isTokenizedStock: true,
        premiumPct: 20,
        dataQuality: { hasCandles: false },
      })
    );
    expect(value).toBeLessThanOrEqual(100);
    expect(flags).toEqual(
      expect.arrayContaining([
        "liquidity_critical",
        "extreme_momentum",
        "very_new_pool",
        "low_trader_count",
        "premium_extreme",
        "missing_candle_data",
      ])
    );
  });
});

describe("evaluatePreset", () => {
  it("passes a textbook steady pool", () => {
    const pool = basePool({
      liquidityUsd: 100_000,
      volume: { h24: 80_000 },
      priceChange1h: 10,
      pairCreatedAt: NOW - 10 * 24 * 60 * 60 * 1000,
      isTokenizedStock: true,
      premiumPct: 0.5,
    });
    const { passed, misses } = evaluatePreset(pool, PRESETS.steady);
    expect(passed).toBe(true);
    expect(misses).toEqual([]);
  });

  it("fails steady when premium drifts too far even if everything else is fine", () => {
    const pool = basePool({
      liquidityUsd: 100_000,
      volume: { h24: 80_000 },
      priceChange1h: 10,
      pairCreatedAt: NOW - 10 * 24 * 60 * 60 * 1000,
      isTokenizedStock: true,
      premiumPct: 6,
    });
    const { passed, misses } = evaluatePreset(pool, PRESETS.steady);
    expect(passed).toBe(false);
    expect(misses).toContain("premium_out_of_range");
  });

  it("fails steady for pools younger than 7 days", () => {
    const pool = basePool({
      liquidityUsd: 100_000,
      volume: { h24: 80_000 },
      priceChange1h: 10,
      pairCreatedAt: NOW - 2 * 24 * 60 * 60 * 1000,
    });
    const { misses } = evaluatePreset(pool, PRESETS.steady);
    expect(misses).toContain("age_below_min");
  });

  it("passes marksman for a fresh, spicy arb pool", () => {
    const pool = basePool({
      liquidityUsd: 8_000,
      volume: { h24: 15_000 },
      priceChange1h: 25,
      pairCreatedAt: NOW - 60 * 60 * 1000,
      isTokenizedStock: true,
      premiumPct: 3,
      isKnownToken: true,
    });
    const { passed } = evaluatePreset(pool, PRESETS.marksman);
    expect(passed).toBe(true);
  });

  it("rejects marksman when premium dislocation is too small to be interesting", () => {
    const pool = basePool({
      liquidityUsd: 8_000,
      volume: { h24: 15_000 },
      priceChange1h: 25,
      isTokenizedStock: true,
      premiumPct: 0.2,
    });
    const { misses } = evaluatePreset(pool, PRESETS.marksman);
    expect(misses).toContain("premium_too_small");
  });

  it("rejects when risk exceeds the preset's maxRisk", () => {
    const pool = basePool({
      liquidityUsd: 100_000,
      volume: { h24: 80_000 },
      priceChange1h: 10,
      pairCreatedAt: NOW - 10 * 24 * 60 * 60 * 1000,
      risk: { value: 90, flags: ["liquidity_critical"] },
    });
    const { misses } = evaluatePreset(pool, PRESETS.steady);
    expect(misses).toContain("risk_above_max");
  });

  it("reports momentum_unknown when priceChange1h is missing entirely", () => {
    const pool = basePool({ priceChange1h: undefined, priceChange: undefined });
    const { misses } = evaluatePreset(pool, PRESETS.steady);
    expect(misses).toContain("momentum_unknown");
  });

  it("ignores premium checks for plain (non-tokenized-stock) pools", () => {
    const pool = basePool({
      liquidityUsd: 100_000,
      volume: { h24: 80_000 },
      priceChange1h: 10,
      pairCreatedAt: NOW - 10 * 24 * 60 * 60 * 1000,
      isTokenizedStock: false,
      premiumPct: null,
    });
    const { passed, misses } = evaluatePreset(pool, PRESETS.steady);
    expect(passed).toBe(true);
    expect(misses).not.toContain("premium_out_of_range");
  });
});
