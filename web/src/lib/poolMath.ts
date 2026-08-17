import type { Pool, SignalStatus } from "../api/types";

/* -------------------------------------------------------------------------- */
/* Derived reads                                                               */
/* -------------------------------------------------------------------------- */

/** The backend prefers GeckoTerminal candles and falls back to DexScreener. */
export function momentum1h(pool: Pool): number | null {
  return pool.priceChange1h ?? pool.priceChange.h1 ?? null;
}

export function txns24h(pool: Pool): number {
  return pool.txns.h24.buys + pool.txns.h24.sells;
}

/** Share of 24h trades that were buys. `null` when the pool had no trades. */
export function buyPressure(pool: Pool): number | null {
  const total = txns24h(pool);
  if (total === 0) return null;
  return (pool.txns.h24.buys / total) * 100;
}

/** Turnover: how many times the pool's own liquidity traded in 24h. */
export function turnover(pool: Pool): number | null {
  if (!pool.liquidityUsd) return null;
  return pool.volume.h24 / pool.liquidityUsd;
}

export function poolLabel(pool: Pool): string {
  return `${pool.baseToken.symbol ?? "?"} / ${pool.quoteToken.symbol ?? "?"}`;
}

export const SIGNAL_RANK: Record<SignalStatus, number> = { hot: 2, watch: 1, none: 0 };

export function riskTier(value: number): "low" | "medium" | "high" {
  if (value < 30) return "low";
  if (value < 60) return "medium";
  return "high";
}

/* -------------------------------------------------------------------------- */
/* Aggregates                                                                  */
/* -------------------------------------------------------------------------- */

export interface Aggregates {
  count: number;
  hot: number;
  watch: number;
  tokenized: number;
  passing: number;
  liquidityUsd: number;
  volume24h: number;
  txns24h: number;
  avgScore: number;
  avgRisk: number;
  /** Widest absolute premium across tokenized-stock pools with a live quote. */
  widestSpread: Pool | null;
}

export function aggregate(pools: Pool[]): Aggregates {
  const base: Aggregates = {
    count: pools.length,
    hot: 0,
    watch: 0,
    tokenized: 0,
    passing: 0,
    liquidityUsd: 0,
    volume24h: 0,
    txns24h: 0,
    avgScore: 0,
    avgRisk: 0,
    widestSpread: null,
  };
  if (pools.length === 0) return base;

  let scoreSum = 0;
  let riskSum = 0;

  for (const pool of pools) {
    if (pool.signalStatus === "hot") base.hot += 1;
    if (pool.signalStatus === "watch") base.watch += 1;
    if (pool.isTokenizedStock) base.tokenized += 1;
    if (pool.presetGate.passed) base.passing += 1;
    base.liquidityUsd += pool.liquidityUsd;
    base.volume24h += pool.volume.h24;
    base.txns24h += txns24h(pool);
    scoreSum += pool.score.total;
    riskSum += pool.risk.value;

    if (pool.premiumPct != null) {
      const widest = base.widestSpread;
      if (!widest || Math.abs(pool.premiumPct) > Math.abs(widest.premiumPct ?? 0)) {
        base.widestSpread = pool;
      }
    }
  }

  base.avgScore = scoreSum / pools.length;
  base.avgRisk = riskSum / pools.length;
  return base;
}

/* -------------------------------------------------------------------------- */
/* Filtering + sorting                                                         */
/* -------------------------------------------------------------------------- */

export type SortKey =
  | "score"
  | "risk"
  | "momentum"
  | "volume24h"
  | "liquidity"
  | "premium"
  | "age"
  | "txns"
  | "turnover";

export interface Filters {
  search: string;
  signals: SignalStatus[];
  minLiquidity: number;
  minVolume: number;
  maxRisk: number;
  minScore: number;
  tokenizedOnly: boolean;
  passingOnly: boolean;
  watchlistOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  search: "",
  signals: [],
  minLiquidity: 0,
  minVolume: 0,
  maxRisk: 100,
  minScore: 0,
  tokenizedOnly: false,
  passingOnly: false,
  watchlistOnly: false,
};

/** Count of filters differing from default — drives the "N active" chip. */
export function activeFilterCount(filters: Filters): number {
  let n = 0;
  if (filters.signals.length > 0) n += 1;
  if (filters.minLiquidity > 0) n += 1;
  if (filters.minVolume > 0) n += 1;
  if (filters.maxRisk < 100) n += 1;
  if (filters.minScore > 0) n += 1;
  if (filters.tokenizedOnly) n += 1;
  if (filters.passingOnly) n += 1;
  if (filters.watchlistOnly) n += 1;
  return n;
}

export function matchesSearch(pool: Pool, term: string): boolean {
  if (!term) return true;
  const t = term.toLowerCase();
  return (
    (pool.baseToken.symbol?.toLowerCase().includes(t) ?? false) ||
    (pool.baseToken.name?.toLowerCase().includes(t) ?? false) ||
    (pool.quoteToken.symbol?.toLowerCase().includes(t) ?? false) ||
    (pool.stockTicker?.toLowerCase().includes(t) ?? false) ||
    (pool.stockName?.toLowerCase().includes(t) ?? false) ||
    pool.address.toLowerCase().includes(t) ||
    pool.dexId.toLowerCase().includes(t)
  );
}

const SORT_VALUE: Record<SortKey, (p: Pool) => number> = {
  score: (p) => p.score.total,
  risk: (p) => p.risk.value,
  momentum: (p) => momentum1h(p) ?? -Infinity,
  volume24h: (p) => p.volume.h24,
  liquidity: (p) => p.liquidityUsd,
  premium: (p) => (p.premiumPct == null ? -Infinity : Math.abs(p.premiumPct)),
  age: (p) => p.ageMs ?? Infinity,
  txns: (p) => txns24h(p),
  turnover: (p) => turnover(p) ?? -Infinity,
};

export function applyFilters(pools: Pool[], filters: Filters, watchlist: Set<string>): Pool[] {
  const term = filters.search.trim().toLowerCase();
  return pools.filter((pool) => {
    if (!matchesSearch(pool, term)) return false;
    if (filters.signals.length > 0 && !filters.signals.includes(pool.signalStatus)) return false;
    if (pool.liquidityUsd < filters.minLiquidity) return false;
    if (pool.volume.h24 < filters.minVolume) return false;
    if (pool.risk.value > filters.maxRisk) return false;
    if (pool.score.total < filters.minScore) return false;
    if (filters.tokenizedOnly && !pool.isTokenizedStock) return false;
    if (filters.passingOnly && !pool.presetGate.passed) return false;
    if (filters.watchlistOnly && !watchlist.has(pool.address)) return false;
    return true;
  });
}

/**
 * Sorts by the chosen column, but always floats hot/watch pools to the top —
 * a screener that buries a live signal under a sort is not doing its job.
 */
export function sortPools(pools: Pool[], key: SortKey, dir: 1 | -1, groupSignals = true): Pool[] {
  const read = SORT_VALUE[key];
  return [...pools].sort((a, b) => {
    if (groupSignals) {
      const signalDiff = SIGNAL_RANK[b.signalStatus] - SIGNAL_RANK[a.signalStatus];
      if (signalDiff !== 0) return signalDiff;
    }
    const diff = read(b) - read(a);
    if (Number.isNaN(diff)) return 0;
    return diff * dir;
  });
}

/* -------------------------------------------------------------------------- */
/* CSV export                                                                  */
/* -------------------------------------------------------------------------- */

const CSV_COLUMNS: { header: string; read: (p: Pool) => string | number | null }[] = [
  { header: "pair", read: poolLabel },
  { header: "address", read: (p) => p.address },
  { header: "dex", read: (p) => p.dexId },
  { header: "signal", read: (p) => p.signalStatus },
  { header: "score", read: (p) => p.score.total.toFixed(1) },
  { header: "risk", read: (p) => p.risk.value },
  { header: "risk_flags", read: (p) => p.risk.flags.join(" ") },
  { header: "price_usd", read: (p) => p.priceUsd },
  { header: "change_1h_pct", read: (p) => momentum1h(p) },
  { header: "change_24h_pct", read: (p) => p.priceChange.h24 },
  { header: "liquidity_usd", read: (p) => p.liquidityUsd },
  { header: "volume_24h_usd", read: (p) => p.volume.h24 },
  { header: "txns_24h", read: txns24h },
  { header: "age_ms", read: (p) => p.ageMs },
  { header: "tokenized_stock", read: (p) => (p.isTokenizedStock ? "yes" : "no") },
  { header: "ticker", read: (p) => p.stockTicker },
  { header: "underlying_price", read: (p) => p.underlyingPrice },
  { header: "premium_pct", read: (p) => p.premiumPct },
  { header: "preset_passed", read: (p) => (p.presetGate.passed ? "yes" : "no") },
  { header: "preset_misses", read: (p) => p.presetGate.misses.join(" ") },

  // Liquidity-provider view. `fee_apr_pct` is the headline number and
  // `net_edge_apr_pct` is what survives LVR — exported together on purpose, so
  // a spreadsheet can't quote the first without the second sitting next to it.
  { header: "lp_score", read: (p) => p.lp?.total.toFixed(1) ?? null },
  { header: "lp_verdict", read: (p) => p.lp?.metrics.verdict ?? null },
  { header: "fee_tier_bps", read: (p) => p.lp?.metrics.feeTierBps ?? null },
  { header: "fee_tier_known", read: (p) => (p.lp?.metrics.feeTierKnown ? "yes" : "no") },
  { header: "turnover", read: (p) => p.lp?.metrics.turnover ?? null },
  { header: "fee_apr_pct", read: (p) => p.lp?.metrics.feeAprPct ?? null },
  { header: "sigma_daily_pct", read: (p) => p.lp?.metrics.sigmaDailyPct ?? null },
  { header: "lvr_daily_pct", read: (p) => p.lp?.metrics.lvrDailyPct ?? null },
  { header: "net_edge_bp_day", read: (p) => p.lp?.metrics.netEdgeDailyBps ?? null },
  { header: "net_edge_margin_bp", read: (p) => p.lp?.metrics.netEdgeMarginBps ?? null },
  { header: "net_edge_apr_pct", read: (p) => p.lp?.metrics.netEdgeAprPct ?? null },
  { header: "flow_imbalance", read: (p) => p.lp?.metrics.flowImbalance ?? null },
  { header: "apr_after_ticket_pct", read: (p) => p.lp?.metrics.projectedAprPct ?? null },
  { header: "lp_caveats", read: (p) => p.lp?.metrics.caveats.join(" ") ?? null },
  { header: "lp_gate_passed", read: (p) => (p.lpGate?.passed ? "yes" : "no") },
  { header: "lp_gate_misses", read: (p) => p.lpGate?.misses.join(" ") ?? null },
];

function csvCell(value: string | number | null): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function poolsToCsv(pools: Pool[]): string {
  const header = CSV_COLUMNS.map((c) => c.header).join(",");
  const rows = pools.map((pool) => CSV_COLUMNS.map((c) => csvCell(c.read(pool))).join(","));
  return [header, ...rows].join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
