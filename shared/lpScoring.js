// Pure, I/O-free liquidity-provider scoring. Sibling of scoring.js, and
// deliberately NOT an extension of it — the two answer different questions and
// disagree on purpose:
//
//   scoring.js  asks "should I TRADE this pool?"  -> rewards momentum, rewards
//               freshness, rewards a wide premium dislocation.
//   lpScoring.js asks "should I PROVIDE LIQUIDITY here?" -> momentum is a COST
//               (it is the mechanism by which an LP is adversely selected),
//               freshness is a RISK (APR collapses as capital arrives), and a
//               premium is a drag the LP eats on reversion.
//
// A pool can legitimately score 85 as a trade and 20 as an LP position. That
// inversion is the whole point; do not "reconcile" the two scores.
//
// The economics implemented here:
//
//   fee income   = turnover x feeTier                    (what the pool pays)
//   LVR          = sigma^2 / 8  per unit time            (what being passive costs)
//   net edge     = fee income - LVR                      (the only number that matters)
//
// LVR ("loss versus rebalancing", Milionis-Moallemi-Roughgarden-Zhang 2022) is
// the continuous-time cost of quoting a stale price to informed flow. For a
// constant-product pool tracking a reference price under geometric Brownian
// motion, it accrues at sigma^2/8 of pool value per unit time. It is not the
// same thing as impermanent loss: IL is path-dependent and can be recovered if
// price returns; LVR is realised continuously and never comes back.
//
// Everything below is an ESTIMATE built on public aggregate data (24h volume,
// hourly closes, txn counts). It is not swap-level accounting. `caveats` on the
// result says so explicitly, per pool, and the verdict goes to "inconclusive"
// rather than guessing when the numbers cannot support a call.

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

function round(n, places = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * Standard normal CDF — Zelen & Severo / Abramowitz-Stegun 26.2.17, |error| <
 * 7.5e-8. Used for the in-range probability, which needs a tail probability
 * and nothing more exotic.
 */
function normalCdf(x) {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

// ---------------------------------------------------------------------------
// Tunables. Same discipline as scoring.js: every number is named and exported
// so it can be retuned without touching logic.
// ---------------------------------------------------------------------------

export const LP_TUNABLES = Object.freeze({
  /**
   * Fee tier assumed when the pool doesn't report one. 30 bp is the Uniswap v3
   * mid tier and the most common setting for a volatile pair. Pools carrying a
   * real `feeTierBps` use that instead and drop the `fee_tier_assumed` caveat.
   */
  defaultFeeTierBps: 30,
  /**
   * Relative uncertainty applied to fee income when the tier is assumed rather
   * than known. Live tiers span 1-100 bp, so a half-order-of-magnitude band is
   * honest — it is what pushes thin edges to "inconclusive" instead of a call
   * the data cannot support.
   */
  assumedFeeTierRelError: 0.5,

  /** Hourly closes needed before realised volatility is computed at all. */
  minClosesForVolatility: 5,
  /** Below this many usable log returns, the estimate is flagged `few_return_samples`. */
  lowSampleReturns: 12,

  /** Planning horizon for range width + in-range probability, in hours. */
  defaultHorizonHours: 24,
  /** Reference deposit used for the dilution projection, in USD. */
  defaultTicketUsd: 1_000,

  /** Net-edge scale for scoring: this many bp/day of shortfall scores zero... */
  netEdgeFloorBps: 25,
  /** ...and this many bp/day of surplus maxes the bucket. */
  netEdgeCapBps: 40,
  /** Score fraction awarded when volatility is unmeasurable (neutral, penalised). */
  unmeasuredEdgeFraction: 0.25,

  /** Two-way flow: at/below this imbalance the flow bucket is full marks. */
  flowBalancedImbalance: 0.1,
  /** At/above this imbalance, flow is one-directional and scores zero. */
  flowToxicImbalance: 0.6,
  /** Fewer 24h txns than this and flow quality can't be judged. */
  minTxnsForFlow: 20,

  /** Depth: TVL at/below this is "micro" and scores zero on resilience... */
  depthFloorUsd: 5_000,
  /** ...and at/above this it is deep enough to absorb ordinary tickets. */
  depthCapUsd: 500_000,
  /** Below this TVL the pool earns the `thin_tvl_dilution` caveat. */
  thinTvlUsd: 25_000,

  /** Daily sigma at/below this is "calm" — full marks on range stability. */
  calmDailySigmaPct: 2,
  /** Daily sigma at/above this is violent — zero marks. */
  violentDailySigmaPct: 25,

  /** Fee APR above this, combined with a negative net edge, trips `apr_mirage`. */
  aprMirageThresholdPct: 100,
  /** Absolute premium at/above this is a live reversion drag on an LP. */
  premiumDislocatedPct: 1.5,

  /** Range presets as multiples of sigma over the horizon. */
  rangeSigmaMultiples: Object.freeze({ tight: 1, balanced: 1.5, wide: 2 }),
  /**
   * Suggested split across the three bands. Narrow captures the most fee per
   * dollar, wide keeps capital in-range while the narrow band is out.
   */
  rangeAllocationPct: Object.freeze({ tight: 50, balanced: 30, wide: 20 }),
});

export const LP_SCORE_WEIGHTS = Object.freeze({
  netEdge: 35, // does fee income actually cover LVR
  depthResilience: 20, // can the pool absorb capital without collapsing your APR
  flowQuality: 15, // two-way flow vs being run over in one direction
  rangeStability: 15, // how often you'd be knocked out of range
  safety: 15, // labels, known token, activity, data completeness
});

/** US equity regular session, in America/New_York wall-clock minutes. */
const EQUITY_SESSION = Object.freeze({
  openMinute: 9 * 60 + 30, // 09:30 ET
  closeMinute: 16 * 60, // 16:00 ET
});

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function totalTxns24h(pool) {
  const t = pool?.txns?.h24;
  if (!t) return null;
  const buys = Number(t.buys) || 0;
  const sells = Number(t.sells) || 0;
  const total = buys + sells;
  return total > 0 ? { buys, sells, total } : null;
}

/**
 * Realised volatility from the hourly close series, as a per-hour standard
 * deviation of log returns. Returns null when there isn't enough clean data —
 * callers must handle that rather than substituting a guess.
 *
 * @param {number[]} closes oldest first
 */
export function realizedVolatility(closes, tunables = LP_TUNABLES) {
  if (!Array.isArray(closes) || closes.length < tunables.minClosesForVolatility) return null;

  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = Number(closes[i - 1]);
    const curr = Number(closes[i]);
    if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev <= 0 || curr <= 0) continue;
    returns.push(Math.log(curr / prev));
  }
  if (returns.length < 2) return null;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const sigmaHourly = Math.sqrt(variance);
  if (!Number.isFinite(sigmaHourly) || sigmaHourly <= 0) return null;

  return { sigmaHourly, samples: returns.length };
}

/**
 * Probability that price never leaves a +/- band over `hours`, under driftless
 * GBM. Uses the reflection principle on each barrier and unions them — an
 * upper bound on the exit probability, so the answer is deliberately the
 * pessimistic one.
 *
 * Worth internalising: a +/-1 sigma band holds only ~36% of the time, not the
 * ~68% the terminal distribution suggests. Ranges are broken by the path, not
 * by where price finishes.
 */
export function probabilityInRange(halfWidthPct, sigmaHourly, hours) {
  if (!Number.isFinite(halfWidthPct) || halfWidthPct <= 0) return null;
  if (!Number.isFinite(sigmaHourly) || sigmaHourly <= 0) return null;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const barrier = Math.log(1 + halfWidthPct / 100);
  const sigmaHorizon = sigmaHourly * Math.sqrt(hours);
  const z = barrier / sigmaHorizon;
  return clamp(1 - 4 * normalCdf(-z), 0, 1);
}

/**
 * Where the US equity session stands right now. Tokenized stocks quote 24/7
 * while the market they track is shut most of the week, so an LP in a stock
 * pool is exposed to a scheduled jump that crypto pools simply don't have.
 *
 * Intl handles DST correctly and needs no dependency. Market holidays are NOT
 * modelled — a holiday reads as a normal open day, which is the one direction
 * this can be wrong, so `sessionKnown` stays false on weekdays to say so.
 */
export function equitySessionState(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));

  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday");
  // Intl renders midnight as "24" in some ICU versions; normalise it.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const minuteOfDay = hour * 60 + minute;

  const isWeekend = weekday === "Sat" || weekday === "Sun";
  const isFridayAfterClose = weekday === "Fri" && minuteOfDay >= EQUITY_SESSION.closeMinute;
  const open =
    !isWeekend && minuteOfDay >= EQUITY_SESSION.openMinute && minuteOfDay < EQUITY_SESSION.closeMinute;

  let phase;
  if (open) phase = "regular";
  else if (isWeekend || isFridayAfterClose) phase = "weekend";
  else phase = "overnight";

  return {
    open,
    phase, // "regular" | "overnight" | "weekend"
    weekday,
    minuteOfDayEt: minuteOfDay,
    /** Holidays aren't modelled, so an "open" verdict on a weekday is provisional. */
    sessionKnown: isWeekend || isFridayAfterClose,
  };
}

// ---------------------------------------------------------------------------
// calculateLpMetrics
// ---------------------------------------------------------------------------

/**
 * The measured layer: turnover, fee income, LVR, net edge, range guidance,
 * dilution, flow. No opinions, no 0-100 — just the numbers and what they rest
 * on. `calculateLpScore` turns these into a ranking.
 *
 * @param {object} pool normalized internal pool shape
 * @param {{ now?: number, horizonHours?: number, ticketUsd?: number, tunables?: object }} [opts]
 */
export function calculateLpMetrics(pool, opts = {}) {
  const tunables = opts.tunables ?? LP_TUNABLES;
  const now = opts.now ?? pool?.__now ?? Date.now();
  const horizonHours = opts.horizonHours ?? tunables.defaultHorizonHours;
  const ticketUsd = opts.ticketUsd ?? tunables.defaultTicketUsd;

  const caveats = [];

  // --- Fee engine ---------------------------------------------------------
  const liquidityUsd = Number(pool?.liquidityUsd) || 0;
  const volume24h = Number(pool?.volume?.h24) || 0;
  const turnover = liquidityUsd > 0 ? volume24h / liquidityUsd : null;

  const reportedTier = Number(pool?.feeTierBps);
  const feeTierKnown = Number.isFinite(reportedTier) && reportedTier > 0;
  const feeTierBps = feeTierKnown ? reportedTier : tunables.defaultFeeTierBps;
  if (!feeTierKnown) caveats.push("fee_tier_assumed");

  // Daily fee income as a fraction of position value.
  const feeYieldDaily = turnover == null ? null : turnover * (feeTierBps / 10_000);
  const feeAprPct = feeYieldDaily == null ? null : feeYieldDaily * 365 * 100;

  // --- Cost of being the passive side ------------------------------------
  const vol = realizedVolatility(pool?.sparkline, tunables);
  let sigmaHourly = null;
  let sigmaDailyPct = null;
  let lvrDaily = null;
  let volSamples = 0;

  if (vol) {
    sigmaHourly = vol.sigmaHourly;
    volSamples = vol.samples;
    const sigmaDaily = sigmaHourly * Math.sqrt(24);
    sigmaDailyPct = sigmaDaily * 100;
    // LVR accrual for a constant-product pool: sigma^2 / 8 per unit time.
    lvrDaily = (sigmaDaily * sigmaDaily) / 8;
    if (volSamples < tunables.lowSampleReturns) caveats.push("few_return_samples");
  } else {
    caveats.push("volatility_unmeasured");
  }

  // --- Net edge, with an honest uncertainty band --------------------------
  // Two independent sources of error, combined in quadrature:
  //
  //   statistical — the variance estimate. SE(s^2) = s^2*sqrt(2/(n-1)) for a
  //     normal sample; doubled here for a ~95% interval.
  //   systematic  — the fee tier, when it's a guess rather than reported.
  //     `assumedFeeTierRelError` is the FULL band, not a sigma, so it is not
  //     doubled. Doubling it would make "covers" unreachable by construction
  //     (the margin would always exceed fee income, and net edge never can).
  let netEdgeDailyBps = null;
  let netEdgeMarginBps = null;
  let verdict = "unmeasured";

  if (feeYieldDaily != null && lvrDaily != null) {
    const netEdgeDaily = feeYieldDaily - lvrDaily;
    netEdgeDailyBps = netEdgeDaily * 10_000;

    const lvrInterval = 2 * lvrDaily * Math.sqrt(2 / Math.max(1, volSamples - 1));
    const feeInterval = feeTierKnown ? 0 : feeYieldDaily * tunables.assumedFeeTierRelError;
    netEdgeMarginBps = Math.sqrt(lvrInterval ** 2 + feeInterval ** 2) * 10_000;

    if (netEdgeDailyBps > netEdgeMarginBps) verdict = "covers";
    else if (netEdgeDailyBps < -netEdgeMarginBps) verdict = "shortfall";
    else verdict = "inconclusive";
  }

  // --- Range guidance, derived from measured volatility -------------------
  // Rule-of-thumb range widths ("5-15% for a volatile pair") are guesses about
  // volatility. Measure it instead and the width falls out.
  let ranges = null;
  if (sigmaHourly != null) {
    const sigmaHorizon = sigmaHourly * Math.sqrt(horizonHours);
    ranges = Object.entries(tunables.rangeSigmaMultiples).map(([band, multiple]) => {
      const halfWidthPct = (Math.exp(multiple * sigmaHorizon) - 1) * 100;
      return {
        band,
        sigmaMultiple: multiple,
        halfWidthPct: round(halfWidthPct, 2),
        holdProbability: round(probabilityInRange(halfWidthPct, sigmaHourly, horizonHours), 3),
        allocationPct: tunables.rangeAllocationPct[band] ?? null,
      };
    });
  }

  // --- Dilution -----------------------------------------------------------
  // Fee yield per dollar is volume x tier / TVL, so your own deposit dilutes
  // the very APR that attracted you. A headline APR on a shallow pool is a
  // number you cannot actually buy at size.
  const projectedAprPct =
    feeAprPct == null || liquidityUsd <= 0
      ? null
      : feeAprPct * (liquidityUsd / (liquidityUsd + ticketUsd));
  const aprRetentionPct =
    projectedAprPct == null || !feeAprPct ? null : (projectedAprPct / feeAprPct) * 100;
  if (liquidityUsd > 0 && liquidityUsd < tunables.thinTvlUsd) caveats.push("thin_tvl_dilution");

  // --- Flow ---------------------------------------------------------------
  const txns = totalTxns24h(pool);
  let flowImbalance = null;
  if (txns && txns.total >= tunables.minTxnsForFlow) {
    flowImbalance = Math.abs(txns.buys - txns.sells) / txns.total;
    if (flowImbalance >= tunables.flowToxicImbalance) caveats.push("directional_flow");
  } else {
    caveats.push("flow_unmeasured");
  }

  // --- Tokenized-stock hazards -------------------------------------------
  let session = null;
  if (pool?.isTokenizedStock) {
    session = equitySessionState(now);
    if (session.phase === "weekend") caveats.push("session_gap_weekend");
    else if (session.phase === "overnight") caveats.push("session_gap_overnight");

    const premiumPct = pool?.premiumPct;
    if (typeof premiumPct === "number") {
      if (Math.abs(premiumPct) >= tunables.premiumDislocatedPct) caveats.push("premium_dislocated");
    } else {
      caveats.push("premium_unknown");
    }
  }

  // --- The flag that matters most ----------------------------------------
  // A large advertised APR that does not survive its own LVR. This is the
  // single most common way an LP loses money while watching a number go up.
  if (feeAprPct != null && feeAprPct >= tunables.aprMirageThresholdPct && verdict === "shortfall") {
    caveats.push("apr_mirage");
  }

  return {
    turnover: round(turnover, 4),
    feeTierBps,
    feeTierKnown,
    feeYieldDailyPct: round(feeYieldDaily == null ? null : feeYieldDaily * 100, 4),
    feeAprPct: round(feeAprPct, 2),

    sigmaHourlyPct: round(sigmaHourly == null ? null : sigmaHourly * 100, 3),
    sigmaDailyPct: round(sigmaDailyPct, 2),
    volatilitySamples: volSamples,
    lvrDailyPct: round(lvrDaily == null ? null : lvrDaily * 100, 4),

    netEdgeDailyBps: round(netEdgeDailyBps, 2),
    netEdgeMarginBps: round(netEdgeMarginBps, 2),
    netEdgeAprPct:
      netEdgeDailyBps == null ? null : round((netEdgeDailyBps / 10_000) * 365 * 100, 2),
    verdict, // "covers" | "shortfall" | "inconclusive" | "unmeasured"

    horizonHours,
    ranges,

    ticketUsd,
    projectedAprPct: round(projectedAprPct, 2),
    aprRetentionPct: round(aprRetentionPct, 1),
    aprHalvingDepositUsd: liquidityUsd > 0 ? liquidityUsd : null,

    flow: txns ? { buys: txns.buys, sells: txns.sells, total: txns.total } : null,
    flowImbalance: round(flowImbalance, 3),

    session,
    caveats,
  };
}

// ---------------------------------------------------------------------------
// calculateLpScore
// ---------------------------------------------------------------------------

/**
 * @param {object} pool normalized internal pool shape
 * @param {object} [metrics] output of calculateLpMetrics; computed if omitted
 * @returns {{ total: number, breakdown: Record<string,{score:number,max:number,value:number|null}>, metrics: object }}
 */
export function calculateLpScore(pool, metrics = null, weights = LP_SCORE_WEIGHTS, tunables = LP_TUNABLES) {
  const m = metrics ?? calculateLpMetrics(pool, { tunables });
  const breakdown = {};

  // netEdge — the core question. An unmeasurable pool gets a fixed, penalised
  // fraction rather than a zero (absence of evidence) or a pass (wishful).
  let edgeFrac;
  if (m.netEdgeDailyBps == null) {
    edgeFrac = tunables.unmeasuredEdgeFraction;
  } else {
    edgeFrac = scale(m.netEdgeDailyBps, -tunables.netEdgeFloorBps, tunables.netEdgeCapBps);
  }
  breakdown.netEdge = {
    score: round(edgeFrac * weights.netEdge, 2),
    max: weights.netEdge,
    value: m.netEdgeDailyBps,
  };

  // depthResilience — log-scaled TVL. This is dilution resistance: the deeper
  // the pool, the less your own ticket (and the next person's) moves the APR.
  const liquidityUsd = Number(pool?.liquidityUsd) || 0;
  const depthFrac =
    liquidityUsd <= 0
      ? 0
      : scale(
          Math.log10(liquidityUsd),
          Math.log10(tunables.depthFloorUsd),
          Math.log10(tunables.depthCapUsd)
        );
  breakdown.depthResilience = {
    score: round(depthFrac * weights.depthResilience, 2),
    max: weights.depthResilience,
    value: liquidityUsd,
  };

  // flowQuality — balanced two-way flow means you're earning the spread from
  // both sides. One-directional flow means you're the exit liquidity.
  let flowFrac;
  if (m.flowImbalance == null) {
    flowFrac = 0.3; // unmeasurable: penalised, not zeroed
  } else {
    flowFrac = 1 - scale(m.flowImbalance, tunables.flowBalancedImbalance, tunables.flowToxicImbalance);
  }
  breakdown.flowQuality = {
    score: round(flowFrac * weights.flowQuality, 2),
    max: weights.flowQuality,
    value: m.flowImbalance,
  };

  // rangeStability — calm pools keep you in range and rebalancing less often.
  let stabilityFrac;
  if (m.sigmaDailyPct == null) {
    stabilityFrac = 0.3;
  } else {
    stabilityFrac =
      1 - scale(m.sigmaDailyPct, tunables.calmDailySigmaPct, tunables.violentDailySigmaPct);
  }
  breakdown.rangeStability = {
    score: round(stabilityFrac * weights.rangeStability, 2),
    max: weights.rangeStability,
    value: m.sigmaDailyPct,
  };

  // safety — same spirit as the trader score's security bucket, retargeted:
  // an LP is locked in for a while, so data completeness counts for more.
  const secWeights = { noDangerLabel: 0.3, knownToken: 0.2, activity: 0.25, dataComplete: 0.25 };
  const hasDangerLabel = Array.isArray(pool?.labels)
    ? pool.labels.some((l) => /honeypot|danger|scam/i.test(String(l)))
    : false;
  const txnTotal = m.flow?.total ?? 0;
  let safetyFrac = 0;
  safetyFrac += hasDangerLabel ? 0 : secWeights.noDangerLabel;
  safetyFrac += pool?.isKnownToken ? secWeights.knownToken : 0;
  safetyFrac += txnTotal >= tunables.minTxnsForFlow ? secWeights.activity : 0;
  safetyFrac += pool?.dataQuality?.hasCandles ? secWeights.dataComplete : 0;
  breakdown.safety = {
    score: round(safetyFrac * weights.safety, 2),
    max: weights.safety,
    value: txnTotal || null,
  };

  const total = round(
    Object.values(breakdown).reduce((sum, b) => sum + (b.score ?? 0), 0),
    2
  );

  return { total: clamp(total, 0, 100), breakdown, metrics: m };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Three postures, gated on measured numbers rather than vibes. `harvest` will
 * happily take a violent pool if the fee engine is genuinely paying for it;
 * `vault` refuses anything it cannot prove.
 */
export const LP_PRESETS = Object.freeze({
  harvest: Object.freeze({
    key: "harvest",
    label: "Harvest",
    description: "Aggressive — high turnover, narrow bands, accepts volatility if fees pay for it.",
    minTurnover: 0.75,
    minTvlUsd: 10_000,
    maxDailySigmaPct: 45,
    minNetEdgeBps: -5,
    maxFlowImbalance: 0.75,
    allowedVerdicts: ["covers", "inconclusive"],
    requireMeasuredVolatility: true,
  }),
  carry: Object.freeze({
    key: "carry",
    label: "Carry",
    description: "Balanced — a real edge over LVR, on a pool deep enough to hold a position.",
    minTurnover: 0.3,
    minTvlUsd: 50_000,
    maxDailySigmaPct: 20,
    minNetEdgeBps: 3,
    maxFlowImbalance: 0.5,
    allowedVerdicts: ["covers"],
    requireMeasuredVolatility: true,
  }),
  vault: Object.freeze({
    key: "vault",
    label: "Vault",
    description: "Defensive — calm pairs, deep books, proven edge. Refuses anything unmeasured.",
    minTurnover: 0.1,
    minTvlUsd: 250_000,
    maxDailySigmaPct: 8,
    minNetEdgeBps: 2,
    maxFlowImbalance: 0.35,
    allowedVerdicts: ["covers"],
    requireMeasuredVolatility: true,
  }),
});

/**
 * @param {object} pool normalized internal pool shape (ideally with .lp precomputed)
 * @param {object} preset one of LP_PRESETS
 * @returns {{ passed: boolean, misses: string[] }}
 */
export function evaluateLpPreset(pool, preset) {
  const m = pool?.lp?.metrics ?? calculateLpMetrics(pool);
  const misses = [];

  const liquidityUsd = Number(pool?.liquidityUsd) || 0;
  if (liquidityUsd < preset.minTvlUsd) misses.push("tvl_below_min");

  if (m.turnover == null || m.turnover < preset.minTurnover) misses.push("turnover_below_min");

  if (preset.requireMeasuredVolatility && m.sigmaDailyPct == null) {
    misses.push("volatility_unmeasured");
  } else if (m.sigmaDailyPct != null && m.sigmaDailyPct > preset.maxDailySigmaPct) {
    misses.push("volatility_above_max");
  }

  if (m.netEdgeDailyBps == null) misses.push("net_edge_unknown");
  else if (m.netEdgeDailyBps < preset.minNetEdgeBps) misses.push("net_edge_below_min");

  if (m.flowImbalance != null && m.flowImbalance > preset.maxFlowImbalance) {
    misses.push("flow_too_directional");
  }

  if (!preset.allowedVerdicts.includes(m.verdict)) misses.push("verdict_not_allowed");

  return { passed: misses.length === 0, misses };
}

/**
 * One-line plain-English reading of the verdict, for the UI and alerts.
 * Deliberately refuses to round "inconclusive" up into a recommendation.
 */
export function describeLpVerdict(metrics) {
  const m = metrics ?? {};
  switch (m.verdict) {
    case "covers":
      return `Fees clear LVR by ~${m.netEdgeDailyBps?.toFixed(1)} bp/day (±${m.netEdgeMarginBps?.toFixed(1)}). Providing beat holding over the measured window.`;
    case "shortfall":
      return `Fees fall short of LVR by ~${Math.abs(m.netEdgeDailyBps ?? 0).toFixed(1)} bp/day (±${m.netEdgeMarginBps?.toFixed(1)}). Holding the pair beat providing.`;
    case "inconclusive":
      return `Edge of ${m.netEdgeDailyBps?.toFixed(1)} bp/day sits inside the ±${m.netEdgeMarginBps?.toFixed(1)} error band. Not distinguishable from zero.`;
    default:
      return "No hourly candles for this pool, so LVR can't be estimated and fee income can't be judged against it.";
  }
}
