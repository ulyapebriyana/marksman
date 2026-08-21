// The practitioner "security-first" funnel: token security -> volume
// sustainability -> fee/TVL efficiency -> pair quality -> range guidance.
//
// This is a SEQUENTIAL gate, not a weighted score, because that is the whole
// point of the methodology it encodes: screen for safety before yield. A
// 5000% APR pool that rugs 80% is still a large loss no matter how good the
// fee number looks, so a pool that fails stage 1 or 2 is "rejected" outright
// — it never gets to look attractive on fee/TVL.
//
// It sits ALONGSIDE scoring.js (trade) and lpScoring.js (LP net-edge
// economics), not in place of either. See README "The practitioner funnel".
//
// Hard data-availability constraint, stated once here rather than buried in
// every function: DexScreener/GeckoTerminal expose pool and trading data,
// not on-chain contract introspection. Whether ownership is renounced,
// whether a mint/blacklist/pause function exists, what fraction of supply is
// bundled to a deployer wallet, whether a team is real — none of that is in
// either response, and Robinhood Chain (chainId 4663) isn't yet indexed by
// GoPlus / Honeypot.is / TokenSniffer. Rather than fabricate a verdict for
// checks we cannot actually run, every one of them reports status
// "unverifiable" with a pointer to check by hand. `passed` never treats
// "unverifiable" as a pass — only checks the pipeline can actually see gate
// anything.

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(n, places = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function hasDangerLabel(pool) {
  return Array.isArray(pool?.labels)
    ? pool.labels.some((l) => /honeypot|danger|scam/i.test(String(l)))
    : false;
}

const STABLE_QUOTE_SYMBOLS = new Set(["USDG", "USDC", "USDT", "DAI"]);

// ---------------------------------------------------------------------------
// Tunables — same discipline as scoring.js/lpScoring.js: every threshold is a
// named, exported constant.
// ---------------------------------------------------------------------------

export const FUNNEL_TUNABLES = Object.freeze({
  // stage 1: security
  minLiquidityForSecurityUsd: 5_000, // below this a single withdrawal can gut the pair — hard fail

  // stage 2: volume sustainability
  minVolume24hUsd: 20_000,
  spikeRatioThreshold: 6, // 5m run-rate this many x the trailing-hour run-rate reads as a spike, not sustained flow
  minTxns1h: 3,

  // stage 3: fee/TVL efficiency. Bucket edges match the practitioner
  // consensus: <0.25x weak, 0.25-1x healthy, 1-5x strong, >5x suspicious
  // (likely wash trading or TVL too thin to trust).
  defaultFeeTierBps: 100, // 1% is the common Robinhood-launchpad baseline tier
  feeTvlWeakRatio: 0.25,
  feeTvlHealthyRatio: 1,
  feeTvlSuspiciousRatio: 5,

  // stage 5: range guidance (contextual maturity tiers, not the primary
  // range — the sigma-based bands in lpScoring.js are)
  maturity: Object.freeze({
    establishedMinMarketCapUsd: 1_000_000,
    establishedMinAgeMs: 5 * 24 * 60 * 60 * 1000,
    strongMinMarketCapUsd: 500_000,
    strongMinAgeMs: 3 * 24 * 60 * 60 * 1000,
  }),
  rangeGuidancePct: Object.freeze({
    established: [30, 50],
    strong_but_volatile: [60, 70],
  }),

  maxPositionPctOfLpCapital: 25,
});

// ---------------------------------------------------------------------------
// Stage 1: token security
// ---------------------------------------------------------------------------

/**
 * @param {object} pool normalized internal pool shape
 * @returns {{ passed: boolean, autoFailReasons: string[], checks: object[], unverifiableCount: number }}
 */
export function evaluateTokenSecurity(pool, tunables = FUNNEL_TUNABLES) {
  const checks = [];
  const autoFailReasons = [];

  const danger = hasDangerLabel(pool);
  checks.push({
    key: "no_danger_label",
    label: "No honeypot/danger label from DexScreener",
    status: danger ? "fail" : "pass",
    detail: danger
      ? `Flagged: ${pool.labels.join(", ")}`
      : "Clean on the labels DexScreener publishes.",
  });
  if (danger) autoFailReasons.push("danger_label");

  const liquidityUsd = num(pool?.liquidityUsd);
  const thin = liquidityUsd < tunables.minLiquidityForSecurityUsd;
  checks.push({
    key: "liquidity_floor",
    label: `Liquidity at/above $${tunables.minLiquidityForSecurityUsd.toLocaleString("en-US")}`,
    status: thin ? "fail" : "pass",
    detail: thin
      ? `Only $${liquidityUsd.toLocaleString("en-US")} pooled — a single withdrawal can gut this pair.`
      : `$${liquidityUsd.toLocaleString("en-US")} pooled.`,
  });
  if (thin) autoFailReasons.push("liquidity_below_security_floor");

  const unverifiable = [
    { key: "contract_verified", label: "Contract source verified" },
    { key: "no_mint_or_pause", label: "No live mint/blacklist/pause function on an unlocked wallet" },
    { key: "holder_concentration", label: "Holder concentration checked (no dominant wallet/bundle)" },
    { key: "liquidity_locked", label: "Liquidity locked or otherwise not unilaterally withdrawable" },
    { key: "team_or_community", label: "Team/community traceable, not an anonymous drive-by" },
  ];
  for (const u of unverifiable) {
    checks.push({
      ...u,
      status: "unverifiable",
      detail: "Not exposed by DexScreener/GeckoTerminal — verify manually before sizing a position.",
    });
  }

  return {
    passed: autoFailReasons.length === 0,
    autoFailReasons,
    checks,
    unverifiableCount: unverifiable.length,
  };
}

// ---------------------------------------------------------------------------
// Stage 2: volume sustainability
// ---------------------------------------------------------------------------

/**
 * A 5-minute spike with nothing behind it is the #1 false positive the
 * methodology warns about. This checks whether volume is corroborated across
 * 5m/1h/24h, not just whether the headline number is big.
 *
 * @param {object} pool normalized internal pool shape
 */
export function evaluateVolumeSustainability(pool, tunables = FUNNEL_TUNABLES) {
  const v = pool?.volume ?? {};
  const m5 = num(v.m5);
  const h1 = num(v.h1);
  const h24 = num(v.h24);
  const txns1h = num(pool?.txns?.h1?.buys) + num(pool?.txns?.h1?.sells);

  const belowFloor = h24 < tunables.minVolume24hUsd;

  // Run-rates: what 24h volume would be if the last 5m / 1h kept up exactly.
  const runRate5m = m5 * 288;
  const runRate1h = h1 * 24;

  // Compare the 5-minute run-rate against the trailing HOUR's run-rate, not
  // against the daily average — a rising market pushes the daily average up
  // too, but a genuine spike dramatically outruns even its own last hour.
  let spikeRatio = null;
  let isSpike = false;
  if (runRate1h > 0) {
    spikeRatio = runRate5m / runRate1h;
    isSpike = spikeRatio >= tunables.spikeRatioThreshold;
  } else if (m5 > 0) {
    isSpike = true; // a 5m print with zero preceding hourly activity
  }

  const thinTxns = txns1h < tunables.minTxns1h;

  let continuity;
  if (h24 === 0) continuity = "no_data";
  else if (isSpike || thinTxns) continuity = "spike_only";
  else if (h1 > 0 && m5 > 0) continuity = "sustained";
  else continuity = "building";

  const passed = !belowFloor && continuity !== "spike_only" && continuity !== "no_data";

  const reasons = [];
  if (belowFloor) reasons.push("volume_24h_below_floor");
  if (isSpike) reasons.push("five_minute_spike_not_corroborated");
  if (thinTxns) reasons.push("too_few_recent_trades");
  if (continuity === "no_data") reasons.push("no_volume_data");

  return {
    passed,
    continuity, // "sustained" | "building" | "spike_only" | "no_data"
    metrics: {
      m5,
      h1,
      h24,
      runRate5m: round(runRate5m),
      runRate1h: round(runRate1h),
      spikeRatio: round(spikeRatio, 2),
      txns1h,
    },
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Stage 3: fee/TVL efficiency
// ---------------------------------------------------------------------------

/**
 * fee pool per day  = volume24h x feeTier
 * fee/TVL           = fee pool per day / TVL
 *
 * @param {object} pool normalized internal pool shape
 */
export function calculateFeeTvlEfficiency(pool, tunables = FUNNEL_TUNABLES) {
  const liquidityUsd = num(pool?.liquidityUsd);
  const volume24h = num(pool?.volume?.h24);

  const reportedTier = Number(pool?.feeTierBps);
  const feeTierKnown = Number.isFinite(reportedTier) && reportedTier > 0;
  const feeTierBps = feeTierKnown ? reportedTier : tunables.defaultFeeTierBps;

  const dailyFeeUsd = volume24h * (feeTierBps / 10_000);
  const feeToTvlPct = liquidityUsd > 0 ? (dailyFeeUsd / liquidityUsd) * 100 : null;
  const volumeToTvlRatio = liquidityUsd > 0 ? volume24h / liquidityUsd : null;

  let bucket;
  if (volumeToTvlRatio == null) bucket = "unknown";
  else if (volumeToTvlRatio < tunables.feeTvlWeakRatio) bucket = "weak";
  else if (volumeToTvlRatio < tunables.feeTvlHealthyRatio) bucket = "healthy";
  else if (volumeToTvlRatio < tunables.feeTvlSuspiciousRatio) bucket = "strong";
  else bucket = "suspicious";

  return {
    feeTierBps,
    feeTierKnown,
    dailyFeeUsd: round(dailyFeeUsd),
    feeToTvlPct: round(feeToTvlPct, 3),
    volumeToTvlRatio: round(volumeToTvlRatio, 3),
    bucket, // "weak" | "healthy" | "strong" | "suspicious" | "unknown"
  };
}

// ---------------------------------------------------------------------------
// Stage 4: pair quality
// ---------------------------------------------------------------------------

/**
 * @param {object} pool normalized internal pool shape
 * @param {object[]} siblingPools other pools sharing the same baseToken.address (different fee tiers/DEXes)
 */
export function evaluatePairQuality(pool, siblingPools = []) {
  const quoteSymbol = String(pool?.quoteToken?.symbol ?? "").toUpperCase();
  const isStablePair = STABLE_QUOTE_SYMBOLS.has(quoteSymbol);

  const family = [pool, ...siblingPools.filter((p) => p?.address !== pool?.address)];
  const ranked = [...family].sort((a, b) => num(b?.liquidityUsd) - num(a?.liquidityUsd));
  const tvlRank = ranked.findIndex((p) => p?.address === pool?.address) + 1;
  const liquidityUsd = num(pool?.liquidityUsd);
  const isLargestTvlForToken = liquidityUsd > 0 && tvlRank === 1;

  return {
    quoteSymbol,
    isStablePair,
    poolCountForToken: family.length,
    isLargestTvlForToken,
    tvlRank: tvlRank || null,
  };
}

// ---------------------------------------------------------------------------
// Stage 5: range guidance — contextual maturity tier, not the primary range.
// lpScoring.js's realized-volatility bands (pool.lp.metrics.ranges) are the
// measured number; this is the fixed-percentage rule of thumb practitioners
// reach for when volatility can't be measured yet.
// ---------------------------------------------------------------------------

/**
 * @param {object} pool normalized internal pool shape
 */
export function getMaturityRangeGuidance(pool, tunables = FUNNEL_TUNABLES) {
  const m = tunables.maturity;
  const marketCapRaw = pool?.marketCap ?? pool?.fdv;
  const marketCap = typeof marketCapRaw === "number" && Number.isFinite(marketCapRaw) ? marketCapRaw : null;
  const ageMs = typeof pool?.ageMs === "number" ? pool.ageMs : null;

  let tier;
  if (marketCap != null && marketCap >= m.establishedMinMarketCapUsd && ageMs != null && ageMs >= m.establishedMinAgeMs) {
    tier = "established";
  } else if (marketCap != null && marketCap >= m.strongMinMarketCapUsd && ageMs != null && ageMs >= m.strongMinAgeMs) {
    tier = "strong_but_volatile";
  } else if (ageMs == null || ageMs < m.strongMinAgeMs) {
    tier = "new";
  } else {
    tier = "unclassified";
  }

  const suggestedLowerRangePct = tunables.rangeGuidancePct[tier] ?? null;

  const note =
    tier === "established"
      ? "Established token — practitioner norm is a lower bound roughly 30-50% below spot."
      : tier === "strong_but_volatile"
        ? "Younger but liquid — tighten position size and go no shallower than 60-70% below spot."
        : tier === "new"
          ? "Under the maturity bar on age/market cap. Practitioner consensus: skip, or accept that a near-total range is really a bet on the token surviving, not liquidity protection."
          : "Not enough data (market cap and/or age) to place a maturity tier.";

  return { tier, suggestedLowerRangePct, note };
}

// ---------------------------------------------------------------------------
// The checklist — mirrors the methodology's "Checklist keputusan final"
// almost line for line, so the UI can render exactly what a practitioner
// would tick through by hand.
// ---------------------------------------------------------------------------

function buildChecklist({ pool, security, volume, feeTvl, pairQuality, tunables, lpRanges }) {
  const liquidityUsd = num(pool?.liquidityUsd);

  return [
    {
      key: "contract_and_holders",
      label: "Token passes contract + holder checks",
      status: security.passed ? "unverifiable" : "fail",
      detail: security.passed
        ? "Contract verification and holder/bundle concentration aren't exposed by DexScreener/GeckoTerminal — check the explorer by hand before sizing a position."
        : "Auto-failed on a check the pipeline can actually see (danger label or a thin-liquidity floor).",
    },
    {
      key: "survived_a_dump",
      label: "Token has already survived at least one dump",
      status: "unverifiable",
      detail: "Needs price history deeper than this scan keeps — check the chart directly.",
    },
    {
      key: "volume_not_a_spike",
      label: "Volume shows up on 5m, 1h, and 24h — not one spike",
      status:
        volume.continuity === "sustained"
          ? "pass"
          : volume.continuity === "spike_only" || volume.continuity === "no_data"
            ? "fail"
            : "unverifiable",
      detail: `Continuity read: ${volume.continuity.replace(/_/g, " ")}.`,
    },
    {
      key: "total_fees_floor",
      label: "Cumulative fees clear a meaningful floor (reference: >=1 ETH on GMGN-style tooling)",
      status: "unverifiable",
      detail: `No cumulative-fee history or ETH price feed here. Closest proxy: an estimated $${feeTvl.dailyFeeUsd ?? "—"}/day at today's volume and a ${feeTvl.feeTierBps}bp tier.`,
    },
    {
      key: "stable_pair_tvl",
      label: "TOKEN/stablecoin pair has adequate TVL",
      status: pairQuality.isStablePair
        ? liquidityUsd >= tunables.minLiquidityForSecurityUsd
          ? "pass"
          : "fail"
        : "fail",
      detail: pairQuality.isStablePair
        ? `Paired with ${pairQuality.quoteSymbol}, $${liquidityUsd.toLocaleString("en-US")} TVL.`
        : `Paired with ${pairQuality.quoteSymbol || "an unknown quote token"}, not a stablecoin — dual-asset exposure the methodology steers away from for defensive LP.`,
    },
    {
      key: "best_fee_tvl_among_candidates",
      label: "Fee/TVL ranks among the best candidates for this token",
      status:
        pairQuality.isLargestTvlForToken && (feeTvl.bucket === "healthy" || feeTvl.bucket === "strong")
          ? "pass"
          : "fail",
      detail: `${pairQuality.isLargestTvlForToken ? "Largest-TVL pool" : `Ranked #${pairQuality.tvlRank ?? "?"} of ${pairQuality.poolCountForToken}`} for this token; fee/TVL bucket: ${feeTvl.bucket}.`,
    },
    {
      key: "community_or_team",
      label: "Community, team, or product can be found",
      status: "unverifiable",
      detail: "Not derivable from pool data — search the ticker on X and check whether the community held together after a dump.",
    },
    {
      key: "sensible_lower_range",
      label: "Lower range bound sits at a sensible support level",
      status: "unverifiable",
      detail: lpRanges
        ? "A measured-volatility range is available (see the Liquidity view) — use that over a blind percentage."
        : "No realized-volatility range yet (needs hourly candles) — fall back to visible chart support.",
    },
    {
      key: "position_sizing",
      label: `Position sized at <=${tunables.maxPositionPctOfLpCapital}% of LP capital`,
      status: "reminder",
      detail: "A sizing decision the methodology makes explicitly — no pool data can confirm it for you.",
    },
  ];
}

// ---------------------------------------------------------------------------
// runFunnel — the orchestrator. Sequential, not additive: a pool that fails
// stage 1 or 2 is "rejected" outright regardless of how good stages 3-4 look.
// ---------------------------------------------------------------------------

/**
 * @param {object} pool normalized internal pool shape
 * @param {{ siblingPools?: object[], lpRanges?: object[]|null, tunables?: object }} [opts]
 */
export function runFunnel(pool, opts = {}) {
  const tunables = opts.tunables ?? FUNNEL_TUNABLES;
  const siblingPools = opts.siblingPools ?? [];
  const lpRanges = opts.lpRanges ?? null;

  const security = evaluateTokenSecurity(pool, tunables);
  const volume = evaluateVolumeSustainability(pool, tunables);
  const feeTvl = calculateFeeTvlEfficiency(pool, tunables);
  const pairQuality = evaluatePairQuality(pool, siblingPools);
  const range = getMaturityRangeGuidance(pool, tunables);

  const feeTvlOk = feeTvl.bucket === "healthy" || feeTvl.bucket === "strong";
  const pairOk = pairQuality.isStablePair && pairQuality.isLargestTvlForToken;

  const stages = [
    { key: "security", label: "Token security", passed: security.passed },
    { key: "volume", label: "Volume sustainability", passed: volume.passed },
    { key: "feeTvl", label: "Fee/TVL efficiency", passed: feeTvlOk },
    { key: "pairQuality", label: "Pair quality", passed: pairOk },
  ];
  const failedAt = stages.find((s) => !s.passed)?.key ?? null;

  const caveats = [];
  // A >5x ratio reads as "very attractive" on the surface but the methodology
  // is explicit that it must be treated as a wash-trading/thin-TVL suspect,
  // not a green light — so it is deliberately never promoted to "candidate".
  if (feeTvl.bucket === "suspicious") caveats.push("fee_tvl_ratio_suspicious");
  if (feeTvl.bucket === "unknown") caveats.push("fee_tvl_unmeasured");

  let verdict;
  if (!security.passed || !volume.passed) verdict = "rejected";
  else if (feeTvlOk && pairOk) verdict = "candidate";
  else verdict = "watch";

  const checklist = buildChecklist({ pool, security, volume, feeTvl, pairQuality, tunables, lpRanges });

  return {
    verdict, // "candidate" | "watch" | "rejected"
    stagesPassed: stages.filter((s) => s.passed).map((s) => s.key),
    failedAt, // first failing stage key, or null
    caveats,
    security,
    volume,
    feeTvl,
    pairQuality,
    range,
    checklist,
  };
}
