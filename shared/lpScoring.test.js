import { describe, it, expect } from "vitest";
import {
  calculateLpMetrics,
  calculateLpScore,
  evaluateLpPreset,
  describeLpVerdict,
  realizedVolatility,
  probabilityInRange,
  equitySessionState,
  LP_PRESETS,
  LP_TUNABLES,
} from "./lpScoring.js";

const NOW = Date.parse("2026-08-17T14:00:00Z"); // Monday, 10:00 ET — market open

/**
 * Deterministic close series that oscillates by `ampPct` each hour, so the
 * hourly log-return standard deviation is ~ln(1 + ampPct/100) and every
 * volatility-derived number in the suite is hand-checkable.
 */
function oscillatingCloses(count, ampPct) {
  const closes = [];
  for (let i = 0; i < count; i++) closes.push(i % 2 === 0 ? 100 : 100 * (1 + ampPct / 100));
  return closes;
}

function basePool(overrides = {}) {
  return {
    address: "0xpool",
    liquidityUsd: 100_000,
    volume: { h24: 200_000 },
    txns: { h24: { buys: 100, sells: 96 } },
    labels: [],
    isKnownToken: true,
    isTokenizedStock: false,
    premiumPct: null,
    sparkline: oscillatingCloses(24, 1),
    dataQuality: { hasCandles: true, hasUnderlyingPrice: false },
    __now: NOW,
    ...overrides,
  };
}

describe("realizedVolatility", () => {
  it("recovers the hourly sigma of a known oscillating series", () => {
    const vol = realizedVolatility(oscillatingCloses(24, 1));
    // Alternating +1%/-1% moves give |r| = ln(1.01) = 0.00995. 24 closes leave
    // 23 returns — an odd count, so the mean is slightly positive and the
    // Bessel-corrected sigma lands a touch above |r|.
    expect(vol.sigmaHourly).toBeCloseTo(0.01016, 4);
    expect(vol.samples).toBe(23);
  });

  it("returns null rather than zero for a flat series", () => {
    // A dead pool has no measurable volatility; that is different from "calm",
    // and callers must not treat it as sigma = 0 (which would imply zero LVR).
    expect(realizedVolatility([100, 100, 100, 100, 100, 100])).toBeNull();
  });

  it("returns null below the minimum sample count", () => {
    expect(realizedVolatility([100, 101, 102])).toBeNull();
  });

  it("skips non-positive and non-finite closes instead of producing NaN", () => {
    const vol = realizedVolatility([100, 0, 101, null, 100, 101, 100, 101]);
    expect(vol).not.toBeNull();
    expect(Number.isFinite(vol.sigmaHourly)).toBe(true);
  });
});

describe("probabilityInRange", () => {
  it("gives a +/-1 sigma band only ~36% hold odds, not the naive 68%", () => {
    // The path breaks the range, not the endpoint — this is the single most
    // commonly mis-set expectation in concentrated liquidity.
    const oneSigmaWidthPct = (Math.exp(0.1) - 1) * 100;
    expect(probabilityInRange(oneSigmaWidthPct, 0.01, 100)).toBeCloseTo(0.365, 2);
  });

  it("gives a +/-2 sigma band ~91% hold odds", () => {
    const twoSigmaWidthPct = (Math.exp(0.2) - 1) * 100;
    expect(probabilityInRange(twoSigmaWidthPct, 0.01, 100)).toBeCloseTo(0.909, 2);
  });

  it("returns null on unusable inputs rather than a misleading number", () => {
    expect(probabilityInRange(0, 0.01, 24)).toBeNull();
    expect(probabilityInRange(10, 0, 24)).toBeNull();
    expect(probabilityInRange(10, 0.01, 0)).toBeNull();
  });
});

describe("equitySessionState", () => {
  it("reports the regular session during US market hours", () => {
    const s = equitySessionState(Date.parse("2026-08-17T14:00:00Z")); // Mon 10:00 ET
    expect(s.open).toBe(true);
    expect(s.phase).toBe("regular");
  });

  it("reports overnight before the open on a weekday", () => {
    const s = equitySessionState(Date.parse("2026-08-17T08:00:00Z")); // Mon 04:00 ET
    expect(s.open).toBe(false);
    expect(s.phase).toBe("overnight");
  });

  it("treats Friday after the close as the weekend gap", () => {
    const s = equitySessionState(Date.parse("2026-08-14T21:00:00Z")); // Fri 17:00 ET
    expect(s.phase).toBe("weekend");
    expect(s.sessionKnown).toBe(true);
  });

  it("reports the weekend on Saturday", () => {
    const s = equitySessionState(Date.parse("2026-08-15T14:00:00Z")); // Sat
    expect(s.open).toBe(false);
    expect(s.phase).toBe("weekend");
  });
});

describe("calculateLpMetrics — fee engine", () => {
  it("derives turnover, daily fee yield, and fee APR from volume over TVL", () => {
    const m = calculateLpMetrics(basePool());
    expect(m.turnover).toBe(2); // 200k / 100k
    expect(m.feeYieldDailyPct).toBeCloseTo(0.6, 3); // 2 x 30bp
    expect(m.feeAprPct).toBeCloseTo(219, 0); // 0.6% x 365
  });

  it("flags an assumed fee tier and uses a reported one when present", () => {
    expect(calculateLpMetrics(basePool()).caveats).toContain("fee_tier_assumed");

    const known = calculateLpMetrics(basePool({ feeTierBps: 5 }));
    expect(known.feeTierKnown).toBe(true);
    expect(known.feeTierBps).toBe(5);
    expect(known.caveats).not.toContain("fee_tier_assumed");
  });
});

describe("calculateLpMetrics — LVR and the verdict", () => {
  it("prices LVR at sigma^2/8 per day", () => {
    const m = calculateLpMetrics(basePool());
    // sigma_hourly 0.01016 -> sigma_daily 0.01016*sqrt(24) = 0.0498
    //             -> LVR = 0.0498^2 / 8 = 0.031% per day
    expect(m.sigmaDailyPct).toBeCloseTo(4.98, 1);
    expect(m.lvrDailyPct).toBeCloseTo(0.031, 3);
  });

  it("calls 'covers' when fee income clears LVR by more than the error band", () => {
    const m = calculateLpMetrics(basePool());
    expect(m.netEdgeDailyBps).toBeCloseTo(57.0, 0);
    expect(m.verdict).toBe("covers");
    expect(m.netEdgeDailyBps).toBeGreaterThan(m.netEdgeMarginBps);
  });

  it("calls 'shortfall' when a violent pool out-earns its own fees", () => {
    const m = calculateLpMetrics(
      basePool({ volume: { h24: 5_000 }, sparkline: oscillatingCloses(24, 5) })
    );
    expect(m.netEdgeDailyBps).toBeLessThan(0);
    expect(m.verdict).toBe("shortfall");
  });

  it("calls 'inconclusive' when the edge sits inside the error band", () => {
    // Turnover tuned so daily fee income (~3.0 bp) lands within a whisker of
    // LVR (~3.1 bp) — a real result the data cannot resolve either way.
    const m = calculateLpMetrics(basePool({ volume: { h24: 10_000 } }));
    expect(m.verdict).toBe("inconclusive");
    expect(Math.abs(m.netEdgeDailyBps)).toBeLessThanOrEqual(m.netEdgeMarginBps);
  });

  it("reports 'unmeasured' — never a guess — with no candles", () => {
    const m = calculateLpMetrics(basePool({ sparkline: [] }));
    expect(m.verdict).toBe("unmeasured");
    expect(m.netEdgeDailyBps).toBeNull();
    expect(m.lvrDailyPct).toBeNull();
    expect(m.caveats).toContain("volatility_unmeasured");
  });

  it("narrows the band when the fee tier is known rather than assumed", () => {
    const assumed = calculateLpMetrics(basePool());
    const known = calculateLpMetrics(basePool({ feeTierBps: 30 }));
    expect(known.netEdgeDailyBps).toBeCloseTo(assumed.netEdgeDailyBps, 5);
    expect(known.netEdgeMarginBps).toBeLessThan(assumed.netEdgeMarginBps);
  });
});

describe("calculateLpMetrics — apr_mirage", () => {
  it("flags a triple-digit APR that does not survive its own LVR", () => {
    const m = calculateLpMetrics(
      basePool({
        liquidityUsd: 20_000,
        volume: { h24: 60_000 },
        sparkline: oscillatingCloses(24, 10),
      })
    );
    expect(m.feeAprPct).toBeGreaterThan(LP_TUNABLES.aprMirageThresholdPct);
    expect(m.verdict).toBe("shortfall");
    expect(m.caveats).toContain("apr_mirage");
  });

  it("does not flag a high APR that genuinely clears LVR", () => {
    const m = calculateLpMetrics(basePool());
    expect(m.feeAprPct).toBeGreaterThan(LP_TUNABLES.aprMirageThresholdPct);
    expect(m.caveats).not.toContain("apr_mirage");
  });
});

describe("calculateLpMetrics — dilution", () => {
  it("shows the APR a reference ticket would actually receive", () => {
    // A $1k ticket into a $1k pool doubles TVL and halves the yield per dollar.
    const m = calculateLpMetrics(basePool({ liquidityUsd: 1_000, volume: { h24: 2_000 } }), {
      ticketUsd: 1_000,
    });
    expect(m.aprRetentionPct).toBeCloseTo(50, 1);
    expect(m.projectedAprPct).toBeCloseTo(m.feeAprPct / 2, 1);
  });

  it("leaves a deep pool's APR essentially intact", () => {
    const m = calculateLpMetrics(basePool({ liquidityUsd: 1_000_000 }), { ticketUsd: 1_000 });
    expect(m.aprRetentionPct).toBeGreaterThan(99);
  });

  it("flags thin TVL as a dilution hazard", () => {
    expect(calculateLpMetrics(basePool({ liquidityUsd: 5_000 })).caveats).toContain(
      "thin_tvl_dilution"
    );
    expect(calculateLpMetrics(basePool()).caveats).not.toContain("thin_tvl_dilution");
  });
});

describe("calculateLpMetrics — flow", () => {
  it("reads balanced two-way flow as low imbalance", () => {
    const m = calculateLpMetrics(basePool({ txns: { h24: { buys: 100, sells: 100 } } }));
    expect(m.flowImbalance).toBe(0);
    expect(m.caveats).not.toContain("directional_flow");
  });

  it("flags one-directional flow", () => {
    const m = calculateLpMetrics(basePool({ txns: { h24: { buys: 190, sells: 10 } } }));
    expect(m.flowImbalance).toBeCloseTo(0.9, 2);
    expect(m.caveats).toContain("directional_flow");
  });

  it("declines to judge flow below the activity floor", () => {
    const m = calculateLpMetrics(basePool({ txns: { h24: { buys: 3, sells: 2 } } }));
    expect(m.flowImbalance).toBeNull();
    expect(m.caveats).toContain("flow_unmeasured");
  });
});

describe("calculateLpMetrics — range guidance", () => {
  it("derives three bands from measured volatility, widest holding best", () => {
    const m = calculateLpMetrics(basePool());
    expect(m.ranges).toHaveLength(3);
    const [tight, balanced, wide] = m.ranges;
    expect(tight.halfWidthPct).toBeLessThan(balanced.halfWidthPct);
    expect(balanced.halfWidthPct).toBeLessThan(wide.halfWidthPct);
    expect(tight.holdProbability).toBeLessThan(wide.holdProbability);
  });

  it("allocates 50/30/20 across tight, balanced, and wide", () => {
    const m = calculateLpMetrics(basePool());
    expect(m.ranges.map((r) => r.allocationPct)).toEqual([50, 30, 20]);
  });

  it("widens the bands for a more volatile pool", () => {
    const calm = calculateLpMetrics(basePool({ sparkline: oscillatingCloses(24, 1) }));
    const wild = calculateLpMetrics(basePool({ sparkline: oscillatingCloses(24, 5) }));
    expect(wild.ranges[0].halfWidthPct).toBeGreaterThan(calm.ranges[0].halfWidthPct);
  });

  it("omits range guidance entirely when volatility is unmeasured", () => {
    expect(calculateLpMetrics(basePool({ sparkline: [] })).ranges).toBeNull();
  });
});

describe("calculateLpMetrics — tokenized stock hazards", () => {
  const stock = (overrides = {}) =>
    basePool({ isTokenizedStock: true, premiumPct: 0.2, ...overrides });

  it("carries no session flag while the equity market is open", () => {
    const m = calculateLpMetrics(stock(), { now: Date.parse("2026-08-17T14:00:00Z") });
    expect(m.session.phase).toBe("regular");
    expect(m.caveats).not.toContain("session_gap_overnight");
    expect(m.caveats).not.toContain("session_gap_weekend");
  });

  it("flags the weekend gap — the token trades while the exchange is shut", () => {
    const m = calculateLpMetrics(stock(), { now: Date.parse("2026-08-15T14:00:00Z") });
    expect(m.caveats).toContain("session_gap_weekend");
  });

  it("flags a dislocated premium as a reversion drag", () => {
    expect(calculateLpMetrics(stock({ premiumPct: 3.1 })).caveats).toContain("premium_dislocated");
    expect(calculateLpMetrics(stock({ premiumPct: 0.2 })).caveats).not.toContain(
      "premium_dislocated"
    );
  });

  it("flags a missing equity quote", () => {
    expect(calculateLpMetrics(stock({ premiumPct: null })).caveats).toContain("premium_unknown");
  });

  it("leaves plain crypto pools out of session logic entirely", () => {
    expect(calculateLpMetrics(basePool()).session).toBeNull();
  });
});

describe("calculateLpScore", () => {
  it("scores a deep, calm, balanced, fee-covering pool well", () => {
    const { total, breakdown } = calculateLpScore(basePool());
    expect(total).toBeGreaterThan(65);
    expect(breakdown.netEdge.score).toBeGreaterThan(30);
  });

  it("inverts the trader score's view of momentum: a violent pool scores badly", () => {
    // The same pool that a momentum screener loves is the one that runs an LP
    // over. This assertion is the contract between the two scoring models.
    const violent = calculateLpScore(
      basePool({ sparkline: oscillatingCloses(24, 10), volume: { h24: 20_000 } })
    );
    const calm = calculateLpScore(basePool());
    expect(violent.total).toBeLessThan(calm.total);
    expect(violent.breakdown.rangeStability.score).toBe(0);
  });

  it("penalises a shallow pool on depth resilience", () => {
    const shallow = calculateLpScore(basePool({ liquidityUsd: 4_000, volume: { h24: 8_000 } }));
    expect(shallow.breakdown.depthResilience.score).toBe(0);
  });

  it("penalises one-directional flow", () => {
    const toxic = calculateLpScore(basePool({ txns: { h24: { buys: 200, sells: 5 } } }));
    expect(toxic.breakdown.flowQuality.score).toBe(0);
  });

  it("zeroes safety credit for a honeypot label", () => {
    const flagged = calculateLpScore(basePool({ labels: ["honeypot"] }));
    const clean = calculateLpScore(basePool());
    expect(flagged.breakdown.safety.score).toBeLessThan(clean.breakdown.safety.score);
  });

  it("gives an unmeasurable pool a penalised, non-zero edge fraction", () => {
    const unmeasured = calculateLpScore(basePool({ sparkline: [], dataQuality: { hasCandles: false } }));
    const expected = LP_TUNABLES.unmeasuredEdgeFraction * 35;
    expect(unmeasured.breakdown.netEdge.score).toBeCloseTo(expected, 1);
  });

  it("stays within 0..100 for absurd inputs", () => {
    const extreme = calculateLpScore(
      basePool({ liquidityUsd: 1e12, volume: { h24: 1e15 }, txns: { h24: { buys: 1e6, sells: 1e6 } } })
    );
    expect(extreme.total).toBeLessThanOrEqual(100);
    expect(extreme.total).toBeGreaterThanOrEqual(0);
  });

  it("reuses precomputed metrics rather than recomputing them", () => {
    const metrics = calculateLpMetrics(basePool());
    const scored = calculateLpScore(basePool(), metrics);
    expect(scored.metrics).toBe(metrics);
  });
});

describe("evaluateLpPreset", () => {
  it("passes a strong pool through Harvest", () => {
    const gate = evaluateLpPreset(basePool(), LP_PRESETS.harvest);
    expect(gate.passed).toBe(true);
    expect(gate.misses).toEqual([]);
  });

  it("rejects a shallow pool from Carry on TVL", () => {
    const gate = evaluateLpPreset(
      basePool({ liquidityUsd: 20_000, volume: { h24: 40_000 } }),
      LP_PRESETS.carry
    );
    expect(gate.passed).toBe(false);
    expect(gate.misses).toContain("tvl_below_min");
  });

  it("rejects a volatile pool from Vault", () => {
    const gate = evaluateLpPreset(
      basePool({ liquidityUsd: 500_000, volume: { h24: 1_000_000 }, sparkline: oscillatingCloses(24, 5) }),
      LP_PRESETS.vault
    );
    expect(gate.passed).toBe(false);
    expect(gate.misses).toContain("volatility_above_max");
  });

  it("rejects an unmeasured pool from every preset — no benefit of the doubt", () => {
    const pool = basePool({ liquidityUsd: 500_000, volume: { h24: 1_000_000 }, sparkline: [] });
    for (const preset of Object.values(LP_PRESETS)) {
      const gate = evaluateLpPreset(pool, preset);
      expect(gate.passed).toBe(false);
      expect(gate.misses).toContain("volatility_unmeasured");
    }
  });

  it("rejects a shortfall verdict from Carry even if every threshold passes", () => {
    const gate = evaluateLpPreset(
      basePool({
        liquidityUsd: 100_000,
        volume: { h24: 40_000 },
        sparkline: oscillatingCloses(24, 8),
      }),
      LP_PRESETS.carry
    );
    expect(gate.passed).toBe(false);
    expect(gate.misses).toContain("verdict_not_allowed");
  });
});

describe("describeLpVerdict", () => {
  it("refuses to round 'inconclusive' up into a recommendation", () => {
    const m = calculateLpMetrics(basePool({ volume: { h24: 10_000 } }));
    expect(describeLpVerdict(m)).toMatch(/not distinguishable from zero/i);
  });

  it("says plainly when holding beat providing", () => {
    const m = calculateLpMetrics(
      basePool({ volume: { h24: 5_000 }, sparkline: oscillatingCloses(24, 5) })
    );
    expect(describeLpVerdict(m)).toMatch(/holding the pair beat providing/i);
  });

  it("explains the unmeasured case instead of returning an empty string", () => {
    expect(describeLpVerdict(calculateLpMetrics(basePool({ sparkline: [] })))).toMatch(
      /no hourly candles/i
    );
  });
});
