// Daily realized P&L for one wallet — pure, I/O-free aggregation.
//
// The input is a flat list of CLOSED positions (see dataSources/meteora.mjs).
// The output is one row per calendar day plus the summary statistics a trader
// actually reads: win rate by position, win rate by day, profit factor, and
// the average win against the average loss.
//
// Two rules run through all of it:
//
//   1. A day with no closed position is ABSENT, not zero. A flat day and a day
//      you did not trade are different facts, and the calendar has to be able
//      to render them differently.
//   2. A position the upstream could not price (no closedAt, no pnl) is
//      counted and reported, never bucketed into "today" or treated as break-
//      even. See `excluded` in the meta.

/** Minutes east of UTC. Jakarta is +420, UTC is 0, New York is -240/-300. */
export const DEFAULT_TZ_OFFSET_MINUTES = 0;

/**
 * The calendar day a unix timestamp falls on, at a fixed UTC offset.
 * @param {number} unixSeconds
 * @param {number} offsetMinutes minutes east of UTC
 * @returns {string} "YYYY-MM-DD"
 */
export function dayKeyFor(unixSeconds, offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES) {
  return new Date((unixSeconds + offsetMinutes * 60) * 1000).toISOString().slice(0, 10);
}

const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const pct = (part, whole) => (whole > 0 ? round((100 * part) / whole, 2) : null);

/**
 * One row per day that has at least one closed position, oldest first.
 * @param {Array<{closedAt: number|null, pnl: number|null, fees: number|null, pair?: string, pool?: string}>} positions
 * @param {{ offsetMinutes?: number, poolsPerDay?: number }} [opts]
 */
export function aggregateDays(positions, opts = {}) {
  const { offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES, poolsPerDay = 5 } = opts;
  const buckets = new Map();
  let excluded = 0;

  for (const p of positions) {
    if (!p || p.closedAt == null || p.pnl == null) {
      excluded++;
      continue;
    }

    const key = dayKeyFor(p.closedAt, offsetMinutes);
    let day = buckets.get(key);
    if (!day) {
      day = { date: key, pnl: 0, positions: 0, wins: 0, losses: 0, fees: 0, _pools: new Map() };
      buckets.set(key, day);
    }

    day.pnl += p.pnl;
    day.fees += p.fees ?? 0;
    day.positions++;
    if (p.pnl > 0) day.wins++;
    else if (p.pnl < 0) day.losses++;

    const pairKey = p.pair ?? p.pool ?? "unknown";
    const pool = day._pools.get(pairKey) ?? { pair: pairKey, pnl: 0, positions: 0 };
    pool.pnl += p.pnl;
    pool.positions++;
    day._pools.set(pairKey, pool);
  }

  return [...buckets.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map(({ _pools, ...day }) => ({
      ...day,
      pnl: round(day.pnl),
      fees: round(day.fees),
      winRatePct: pct(day.wins, day.positions),
      // What actually moved the day, biggest absolute contribution first —
      // so a red day can be traced to the pool that made it red.
      pools: [..._pools.values()]
        .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
        .slice(0, poolsPerDay)
        .map((pool) => ({ ...pool, pnl: round(pool.pnl) })),
    }));
}

/** Counts of positions the aggregation could not place on a day. */
export function countExcluded(positions) {
  return positions.filter((p) => !p || p.closedAt == null || p.pnl == null).length;
}

/**
 * The headline statistics, derived from the day rows and the positions behind
 * them. Position-level rates come from `positions`; day-level rates come from
 * `days` — they answer different questions and must not be conflated.
 */
export function summarizePnl(days, positions) {
  // Only positions that made it onto the calendar count here, so the summary
  // can never describe a larger population than the day rows do.
  const priced = positions.filter((p) => p && p.pnl != null && p.closedAt != null);

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let fees = 0;

  for (const p of priced) {
    fees += p.fees ?? 0;
    if (p.pnl > 0) {
      grossProfit += p.pnl;
      wins++;
    } else if (p.pnl < 0) {
      grossLoss += -p.pnl;
      losses++;
    }
  }

  const greenDays = days.filter((d) => d.pnl > 0).length;
  const redDays = days.filter((d) => d.pnl < 0).length;
  const netPnl = days.reduce((acc, d) => acc + d.pnl, 0);

  const best = days.reduce((a, d) => (a == null || d.pnl > a.pnl ? d : a), null);
  const worst = days.reduce((a, d) => (a == null || d.pnl < a.pnl ? d : a), null);

  return {
    netPnl: round(netPnl, 2),
    closedPositions: priced.length,
    wins,
    losses,
    winRatePct: pct(wins, wins + losses),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    // Undefined rather than Infinity when nothing ever lost: a profit factor
    // with no denominator is not a very large number, it is not a number.
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : null,
    avgWin: wins > 0 ? round(grossProfit / wins) : null,
    avgLoss: losses > 0 ? round(-grossLoss / losses) : null,
    tradingDays: days.length,
    greenDays,
    redDays,
    dayWinRatePct: pct(greenDays, greenDays + redDays),
    bestDay: best ? { date: best.date, pnl: best.pnl } : null,
    worstDay: worst ? { date: worst.date, pnl: worst.pnl } : null,
    fees: round(fees),
    currentStreak: currentStreak(days),
    firstDay: days[0]?.date ?? null,
    lastDay: days[days.length - 1]?.date ?? null,
  };
}

/**
 * Consecutive same-direction TRADING days ending at the most recent one. Days
 * with no positions are not in `days` at all, so they neither extend nor break
 * a streak — a weekend off is not a losing day.
 */
export function currentStreak(days) {
  if (days.length === 0) return { direction: "flat", days: 0 };
  const last = days[days.length - 1];
  const direction = last.pnl > 0 ? "green" : last.pnl < 0 ? "red" : "flat";
  if (direction === "flat") return { direction, days: 1 };

  let count = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const sign = days[i].pnl > 0 ? "green" : days[i].pnl < 0 ? "red" : "flat";
    if (sign !== direction) break;
    count++;
  }
  return { direction, days: count };
}

/** The "YYYY-MM" buckets that hold at least one trading day, oldest first. */
export function monthsCovered(days) {
  return [...new Set(days.map((d) => d.date.slice(0, 7)))];
}

/**
 * Assembles the full wallet report from a fetch result.
 * @param {{positions: any[], pools?: any[], unpriced?: number, failedTxs?: any[], openPositions?: number}} fetched
 * @param {{ offsetMinutes?: number }} [opts]
 */
export function buildWalletPnl(fetched, opts = {}) {
  const { offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES } = opts;
  const { positions, pools = [], unpriced = 0, partial = 0, failedTxs = [], openPositions = 0 } = fetched;

  const days = aggregateDays(positions, { offsetMinutes });
  const summary = summarizePnl(days, positions);
  const excluded = countExcluded(positions);

  // There is no upstream that computes this wallet's P&L independently — the
  // whole figure is reconstructed here. So completeness is not "do we agree
  // with someone else", it is "how much did we fail to price", and that count
  // travels with the numbers instead of being rounded into them.
  const complete = failedTxs.length === 0 && unpriced === 0 && partial === 0 && excluded === 0;

  return {
    days,
    months: monthsCovered(days),
    summary,
    timeZoneOffsetMinutes: offsetMinutes,
    reconciliation: {
      complete,
      positionsCounted: summary.closedPositions,
      positionsExcluded: excluded,
      positionsUnpriced: unpriced,
      positionsPartial: partial,
      failedTxs,
      openPositions,
    },
    poolCount: pools.length,
  };
}
