// Pure, I/O-free scoring + risk + preset-gate logic. No network, no fs, no clocks
// other than what's passed in on the pool object — this keeps it trivially
// unit-testable and reusable from both the server pipeline and tests.

/** @param {number} n @param {number} min @param {number} max */
function clamp(n, min, max) {
  if (n == null || Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Linear 0..1 scale of `value` between [lo, hi], clamped. */
function scale(value, lo, hi) {
  if (value == null || Number.isNaN(value)) return 0;
  if (hi === lo) return 0;
  return clamp((value - lo) / (hi - lo), 0, 1);
}

// ---------------------------------------------------------------------------
// Tunable weights. Every number below is deliberately exported so presets /
// ops can retune behavior without touching the scoring logic itself.
// ---------------------------------------------------------------------------

export const SCORE_WEIGHTS = Object.freeze({
  momentum: 25,
  feeEfficiency: 25,
  volumeQuality: 20,
  security: 20,
  freshness: 10,
});

export const SCORE_TUNABLES = Object.freeze({
  momentumCapPct: 30, // priceChange1h at/above this maxes out the momentum score
  feeEfficiencyCapRatio: 5, // volume24h / liquidityUsd at/above this maxes fee efficiency
  volumeQualityAbsCapUsd: 500_000, // volume24h at/above this maxes the absolute-volume half
  volumeQualityRatioCapRatio: 3, // volume24h / liquidityUsd cap for the ratio half
  securityMinLiquidityUsd: 5_000, // below this, liquidity is considered "micro" (unsafe)
  securityMinTxns24h: 20, // total buys+sells in 24h to count as "healthy" activity
  freshnessBucketsMs: {
    best: 24 * 60 * 60 * 1000, // <= 24h
    good: 7 * 24 * 60 * 60 * 1000, // <= 7d
    ok: 30 * 24 * 60 * 60 * 1000, // <= 30d
  },
  freshnessScores: { best: 10, good: 7, ok: 4, stale: 1 },
});

export const RISK_TUNABLES = Object.freeze({
  baseRisk: 5,
  liquidityCriticalUsd: 1_000,
  liquidityCriticalPenalty: 20,
  liquidityLowUsd: 10_000,
  liquidityLowPenalty: 10,
  extremeMomentumPct: 100,
  extremeMomentumPenalty: 18,
  newPoolMs: 30 * 60 * 1000,
  newPoolPenalty: 10,
  lowTxns24h: 20,
  lowTxnsPenalty: 15,
  premiumExtremePct: 5,
  premiumExtremePenalty: 20,
  premiumElevatedPct: 2,
  premiumElevatedPenalty: 10,
  missingCandlesPenalty: 8,
  missingUnderlyingPricePenalty: 8,
});

function totalTxns24h(pool) {
  const t = pool?.txns?.h24;
  if (!t) return null;
  const buys = Number(t.buys) || 0;
  const sells = Number(t.sells) || 0;
  return buys + sells;
}

function getPriceChange1h(pool) {
  if (typeof pool?.priceChange1h === "number") return pool.priceChange1h;
  if (typeof pool?.priceChange?.h1 === "number") return pool.priceChange.h1;
  return null;
}

// ---------------------------------------------------------------------------
// calculateScore
// ---------------------------------------------------------------------------

/**
 * @param {object} pool normalized internal pool shape
 * @returns {{ total: number, breakdown: Record<string, {score:number,max:number,value:number|null}> }}
 */
export function calculateScore(pool, weights = SCORE_WEIGHTS, tunables = SCORE_TUNABLES) {
  const breakdown = {};

  // momentum: 0..cap% of priceChange1h scaled to full weight. Only upward
  // moves are rewarded — a crashing pool shouldn't score well on "momentum".
  const pct1h = getPriceChange1h(pool);
  const momentumValue = pct1h == null ? 0 : Math.max(0, pct1h);
  const momentumFrac = scale(momentumValue, 0, tunables.momentumCapPct);
  breakdown.momentum = { score: round2(momentumFrac * weights.momentum), max: weights.momentum, value: pct1h };

  // feeEfficiency: volume24h / liquidity ratio, i.e. how much fee-generating
  // turnover a dollar of liquidity supports.
  const liquidityUsd = Number(pool?.liquidityUsd) || 0;
  const volume24h = Number(pool?.volume?.h24) || 0;
  const feeRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : 0;
  const feeFrac = scale(feeRatio, 0, tunables.feeEfficiencyCapRatio);
  breakdown.feeEfficiency = { score: round2(feeFrac * weights.feeEfficiency), max: weights.feeEfficiency, value: feeRatio };

  // volumeQuality: half from absolute 24h volume (log-scaled, wide dynamic
  // range), half from the same volume/liquidity ratio capped more tightly.
  const half = weights.volumeQuality / 2;
  const absFrac = volume24h > 0
    ? scale(Math.log10(volume24h + 1), 0, Math.log10(tunables.volumeQualityAbsCapUsd + 1))
    : 0;
  const ratioFrac = scale(feeRatio, 0, tunables.volumeQualityRatioCapRatio);
  breakdown.volumeQuality = {
    score: round2(absFrac * half + ratioFrac * half),
    max: weights.volumeQuality,
    value: volume24h,
  };

  // security: composite of liquidity floor, known-token membership, healthy
  // trading activity, and absence of DexScreener danger/honeypot labels.
  const secWeights = { liquidity: 0.3, knownToken: 0.2, txns: 0.3, noDangerLabel: 0.2 };
  const txns24h = totalTxns24h(pool);
  const hasDangerLabel = Array.isArray(pool?.labels)
    ? pool.labels.some((l) => /honeypot|danger|scam/i.test(String(l)))
    : false;
  let secFrac = 0;
  secFrac += liquidityUsd >= tunables.securityMinLiquidityUsd ? secWeights.liquidity : 0;
  secFrac += pool?.isKnownToken ? secWeights.knownToken : 0;
  secFrac += (txns24h ?? 0) >= tunables.securityMinTxns24h ? secWeights.txns : 0;
  secFrac += hasDangerLabel ? 0 : secWeights.noDangerLabel;
  breakdown.security = { score: round2(secFrac * weights.security), max: weights.security, value: txns24h };

  // freshness: newer pools score higher (the arb-hunter preset wants pools
  // before the market has fully arbitraged a mispricing away).
  const ageMs = getAgeMs(pool);
  const buckets = tunables.freshnessBucketsMs;
  const scores = tunables.freshnessScores;
  let freshFrac;
  if (ageMs == null) freshFrac = scores.stale / weights.freshness;
  else if (ageMs <= buckets.best) freshFrac = scores.best / weights.freshness;
  else if (ageMs <= buckets.good) freshFrac = scores.good / weights.freshness;
  else if (ageMs <= buckets.ok) freshFrac = scores.ok / weights.freshness;
  else freshFrac = scores.stale / weights.freshness;
  breakdown.freshness = { score: round2(freshFrac * weights.freshness), max: weights.freshness, value: ageMs };

  const total = round2(Object.values(breakdown).reduce((sum, b) => sum + b.score, 0));
  return { total: clamp(total, 0, 100), breakdown };
}

function getAgeMs(pool) {
  if (typeof pool?.ageMs === "number") return pool.ageMs;
  if (typeof pool?.pairCreatedAt === "number") {
    const now = typeof pool.__now === "number" ? pool.__now : Date.now();
    return now - pool.pairCreatedAt;
  }
  return null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// calculateRisk
// ---------------------------------------------------------------------------

/**
 * @param {object} pool normalized internal pool shape
 * @returns {{ value: number, flags: string[] }}
 */
export function calculateRisk(pool, tunables = RISK_TUNABLES) {
  const flags = [];
  let value = tunables.baseRisk;

  const liquidityUsd = Number(pool?.liquidityUsd) || 0;
  if (liquidityUsd < tunables.liquidityCriticalUsd) {
    value += tunables.liquidityCriticalPenalty;
    flags.push("liquidity_critical");
  } else if (liquidityUsd < tunables.liquidityLowUsd) {
    value += tunables.liquidityLowPenalty;
    flags.push("liquidity_low");
  }

  const pct1h = getPriceChange1h(pool);
  if (pct1h != null && Math.abs(pct1h) > tunables.extremeMomentumPct) {
    value += tunables.extremeMomentumPenalty;
    flags.push("extreme_momentum");
  }

  const ageMs = getAgeMs(pool);
  if (ageMs != null && ageMs < tunables.newPoolMs) {
    value += tunables.newPoolPenalty;
    flags.push("very_new_pool");
  }

  const txns24h = totalTxns24h(pool);
  if (txns24h != null && txns24h < tunables.lowTxns24h) {
    value += tunables.lowTxnsPenalty;
    flags.push("low_trader_count");
  }

  if (pool?.isTokenizedStock) {
    const premiumPct = pool?.premiumPct;
    if (typeof premiumPct === "number") {
      const abs = Math.abs(premiumPct);
      if (abs >= tunables.premiumExtremePct) {
        value += tunables.premiumExtremePenalty;
        flags.push("premium_extreme");
      } else if (abs >= tunables.premiumElevatedPct) {
        value += tunables.premiumElevatedPenalty;
        flags.push("premium_elevated");
      }
    } else {
      value += tunables.missingUnderlyingPricePenalty;
      flags.push("missing_underlying_price");
    }
  }

  if (pool?.dataQuality?.hasCandles === false) {
    value += tunables.missingCandlesPenalty;
    flags.push("missing_candle_data");
  }

  return { value: clamp(round2(value), 0, 100), flags };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const PRESETS = Object.freeze({
  steady: Object.freeze({
    key: "steady",
    label: "Steady",
    description: "Conservative — established pools, tight pricing, low risk.",
    minLiquidityUsd: 50_000,
    maxAbsPremiumPct: 2,
    minVolume24hUsd: 50_000,
    momentumRangePct: [5, 40],
    minAgeMs: 7 * 24 * 60 * 60 * 1000,
    maxRisk: 55,
  }),
  marksman: Object.freeze({
    key: "marksman",
    label: "Marksman",
    description: "Aggressive arb-hunter — chases premium/discount dislocations.",
    minLiquidityUsd: 5_000,
    minAbsPremiumPct: 1,
    minVolume24hUsd: 10_000,
    momentumRangePct: [10, 200],
    minAgeMs: 0,
    maxRisk: 75,
  }),
});

/**
 * @param {object} pool normalized internal pool shape (ideally with .risk precomputed)
 * @param {object} preset one of PRESETS
 * @returns {{ passed: boolean, misses: string[] }}
 */
export function evaluatePreset(pool, preset) {
  const misses = [];

  const liquidityUsd = Number(pool?.liquidityUsd) || 0;
  if (liquidityUsd < preset.minLiquidityUsd) misses.push("liquidity_below_min");

  if (pool?.isTokenizedStock) {
    const premiumPct = pool?.premiumPct;
    if (typeof preset.maxAbsPremiumPct === "number") {
      if (typeof premiumPct !== "number" || Math.abs(premiumPct) > preset.maxAbsPremiumPct) {
        misses.push("premium_out_of_range");
      }
    }
    if (typeof preset.minAbsPremiumPct === "number") {
      if (typeof premiumPct !== "number" || Math.abs(premiumPct) < preset.minAbsPremiumPct) {
        misses.push("premium_too_small");
      }
    }
  }

  const volume24h = Number(pool?.volume?.h24) || 0;
  if (volume24h < preset.minVolume24hUsd) misses.push("volume_below_min");

  const pct1h = getPriceChange1h(pool);
  const [minMomentum, maxMomentum] = preset.momentumRangePct;
  if (pct1h == null) misses.push("momentum_unknown");
  else if (pct1h < minMomentum || pct1h > maxMomentum) misses.push("momentum_out_of_range");

  const ageMs = getAgeMs(pool);
  if (preset.minAgeMs > 0) {
    if (ageMs == null || ageMs < preset.minAgeMs) misses.push("age_below_min");
  }

  const risk = pool?.risk ?? calculateRisk(pool);
  if (risk.value > preset.maxRisk) misses.push("risk_above_max");

  return { passed: misses.length === 0, misses };
}
