export type SignalStatus = "none" | "watch" | "hot";
export type PresetKey = "steady" | "marksman";

/** LP posture. Independent of `PresetKey` — it gates a different question. */
export type LpPresetKey = "harvest" | "carry" | "vault";

/**
 * Whether fee income covered LVR over the measured window.
 * `inconclusive` means the edge sits inside the error band — it is a real
 * answer, not a missing one, and must not be rendered as a pass.
 */
export type LpVerdict = "covers" | "shortfall" | "inconclusive" | "unmeasured";

export interface LpRangeBand {
  band: "tight" | "balanced" | "wide";
  sigmaMultiple: number;
  halfWidthPct: number | null;
  /** Probability price never leaves the band over the horizon. */
  holdProbability: number | null;
  allocationPct: number | null;
}

export interface LpSessionState {
  open: boolean;
  phase: "regular" | "overnight" | "weekend";
  weekday: string;
  minuteOfDayEt: number;
  sessionKnown: boolean;
}

export interface LpMetrics {
  turnover: number | null;
  feeTierBps: number;
  feeTierKnown: boolean;
  feeYieldDailyPct: number | null;
  feeAprPct: number | null;

  sigmaHourlyPct: number | null;
  sigmaDailyPct: number | null;
  volatilitySamples: number;
  lvrDailyPct: number | null;

  netEdgeDailyBps: number | null;
  netEdgeMarginBps: number | null;
  netEdgeAprPct: number | null;
  verdict: LpVerdict;

  horizonHours: number;
  ranges: LpRangeBand[] | null;

  ticketUsd: number;
  projectedAprPct: number | null;
  aprRetentionPct: number | null;
  aprHalvingDepositUsd: number | null;

  flow: { buys: number; sells: number; total: number } | null;
  flowImbalance: number | null;

  session: LpSessionState | null;
  caveats: string[];
}

export interface LpScore {
  total: number;
  breakdown: {
    netEdge: ScoreBreakdownItem;
    depthResilience: ScoreBreakdownItem;
    flowQuality: ScoreBreakdownItem;
    rangeStability: ScoreBreakdownItem;
    safety: ScoreBreakdownItem;
  };
  metrics: LpMetrics;
}

export interface LpGate {
  passed: boolean;
  misses: string[];
}

export interface TokenInfo {
  address: string;
  symbol: string | null;
  name: string | null;
}

export interface PoolLinks {
  /** Official project site reported by DexScreener. */
  website: string | null;
  /** X/Twitter profile or X Community, with a real Community preferred. */
  community: string | null;
}

/* -------------------------------------------------------------------------- */
/* Funnel — the practitioner security-first gate                              */
/* -------------------------------------------------------------------------- */

export type FunnelVerdict = "candidate" | "watch" | "rejected";
export type FunnelCheckStatus = "pass" | "fail" | "unverifiable" | "reminder";

export interface FunnelCheck {
  key: string;
  label: string;
  status: FunnelCheckStatus;
  detail: string;
}

export interface FunnelSecurity {
  passed: boolean;
  autoFailReasons: string[];
  checks: FunnelCheck[];
  unverifiableCount: number;
}

export interface FunnelVolume {
  passed: boolean;
  continuity: "sustained" | "building" | "spike_only" | "no_data";
  metrics: {
    m5: number;
    h1: number;
    h24: number;
    runRate5m: number | null;
    runRate1h: number | null;
    spikeRatio: number | null;
    txns1h: number;
  };
  reasons: string[];
}

export interface FunnelFeeTvl {
  feeTierBps: number;
  feeTierKnown: boolean;
  dailyFeeUsd: number | null;
  feeToTvlPct: number | null;
  volumeToTvlRatio: number | null;
  bucket: "weak" | "healthy" | "strong" | "suspicious" | "unknown";
}

export interface FunnelPairQuality {
  quoteSymbol: string;
  isStablePair: boolean;
  poolCountForToken: number;
  isLargestTvlForToken: boolean;
  tvlRank: number | null;
}

export interface FunnelRangeGuidance {
  tier: "established" | "strong_but_volatile" | "new" | "unclassified";
  suggestedLowerRangePct: [number, number] | null;
  note: string;
}

export interface Funnel {
  verdict: FunnelVerdict;
  stagesPassed: string[];
  failedAt: string | null;
  caveats: string[];
  security: FunnelSecurity;
  volume: FunnelVolume;
  feeTvl: FunnelFeeTvl;
  pairQuality: FunnelPairQuality;
  range: FunnelRangeGuidance;
  checklist: FunnelCheck[];
}

export interface ScoreBreakdownItem {
  score: number;
  max: number;
  value: number | null;
}

export interface Score {
  total: number;
  breakdown: {
    momentum: ScoreBreakdownItem;
    feeEfficiency: ScoreBreakdownItem;
    volumeQuality: ScoreBreakdownItem;
    security: ScoreBreakdownItem;
    freshness: ScoreBreakdownItem;
  };
}

export interface Risk {
  value: number;
  flags: string[];
}

export interface PresetGate {
  passed: boolean;
  misses: string[];
}

export interface Pool {
  address: string;
  chainId: string;
  dexId: string;
  url: string;
  baseToken: TokenInfo;
  quoteToken: TokenInfo;
  priceUsd: number | null;
  liquidityUsd: number;
  volume: { m5: number; h1: number; h6: number; h24: number };
  priceChange: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  txns: {
    h1: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  fdv: number | null;
  marketCap: number | null;
  pairCreatedAt: number | null;
  ageMs: number | null;
  labels: string[];
  links: PoolLinks;
  isKnownToken: boolean;
  isTokenizedStock: boolean;
  stockTicker: string | null;
  stockName: string | null;
  priceChange1h?: number;
  sparkline: number[];
  underlyingPrice: number | null;
  premiumPct: number | null;
  dataQuality: { hasCandles: boolean; hasUnderlyingPrice: boolean };
  risk: Risk;
  score: Score;
  presetGate: PresetGate;
  signalStatus: SignalStatus;
  /** The liquidity-provider verdict. Deliberately disagrees with `score`. */
  lp: LpScore;
  lpGate: LpGate;
  /** The practitioner security-first funnel: security -> volume -> fee/TVL -> pair quality -> range. */
  funnel: Funnel;
}

export interface SourceHealth {
  dexscreener: { ok: boolean; pairsReturned?: number };
  geckoterminal: { ok: boolean; successCount: number; failureCount: number; bulkPoolsReturned?: number; bulkOk?: boolean };
  equity: { ok: boolean; successCount: number; failureCount: number };
}

export interface PoolsResponse {
  pools: Pool[];
  meta: {
    scannedAt: number;
    sourceHealth: SourceHealth;
    activePreset: PresetKey;
    requestedPreset: PresetKey;
    requestedLpPreset: LpPresetKey;
    poolCount: number;
  };
}

export interface StatusResponse {
  ok: boolean;
  uptimeSeconds: number;
  activePreset: PresetKey;
  presets: PresetKey[];
  defaultLpPreset: LpPresetKey;
  lpPresets: LpPresetKey[];
  scanIntervalSeconds: number;
  lastScan: { scannedAt: number; poolCount: number; sourceHealth: SourceHealth } | null;
  stockApiConfigured: boolean;
  telegramConfigured: boolean;
  tokenMapSize: number;
}

export interface HistoryEntry {
  address: string;
  symbol: string;
  from: SignalStatus;
  to: SignalStatus;
  at: number;
  preset: PresetKey;
  score: number | null;
  risk: number | null;
  premiumPct: number | null;
}

export interface HistoryResponse {
  history: HistoryEntry[];
  total: number;
}

export interface AlertResponse {
  sent: boolean;
  reason?: string;
  note?: string;
  error?: string;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/* -------------------------------------------------------------------------- */
/* Token report — GET /api/token/:address                                      */
/*                                                                             */
/* A different question from the screener: not "which pool is worth a look     */
/* right now" but "what is this token, structurally". Its copy is Indonesian   */
/* because the report is written for an Indonesian reader — the strings below  */
/* come from the server already translated, and the view renders them as-is.   */
/* -------------------------------------------------------------------------- */

/** Worst to least. `info` is context, not a warning, and never moves the verdict. */
export type ReportSeverity = "kritis" | "tinggi" | "sedang" | "rendah" | "info";

/** `unverifiable` is a real result: the check has no data source on this chain. */
export type ReportCheckStatus = "pass" | "fail" | "warn" | "unverifiable";

export interface ReportFlag {
  code: string;
  severity: ReportSeverity;
  label: string;
  detail: string;
  count?: number;
}

export interface ReportCheck {
  code: string;
  status: ReportCheckStatus;
  label: string;
  detail: string;
}

export interface ReportIdentity {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  imageUrl: string | null;
  headerUrl: string | null;
  description: string | null;
  categories: string[];
  websites: { url: string; label?: string }[];
  twitterUrl: string | null;
  telegramUrl: string | null;
  discordUrl: string | null;
  gtScore: number | null;
  gtVerified: boolean;
}

export interface ReportMarket {
  priceUsd: number | null;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  /** Market cap when published, else FDV. `valuationBasis` says which. */
  valuationUsd: number | null;
  valuationBasis: "market_cap" | "fdv" | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  totalSupply: number | null;
  priceChange: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  /** Age of the OLDEST pool — a token is as old as its first market. */
  ageHours: number | null;
  poolCount: number;
  topPoolSharePct: number | null;
  liquidityToValuationPct: number | null;
  turnoverRatio: number | null;
}

export interface ReportFlow {
  buys24h: number | null;
  sells24h: number | null;
  trades24h: number | null;
  /** Unique traders can't be de-duplicated across pools, so these over-count. */
  buyersUpperBound: number | null;
  sellersUpperBound: number | null;
  tradersUpperBound: number | null;
  buyRatioPct: number | null;
  imbalancePct: number | null;
  /** Share of 24h trades in pools that reported unique traders. */
  traderCoveragePct: number | null;
  /**
   * A floor, not an estimate. Derived only from the covered pools above, so
   * it is not distorted by which per-pool calls happened to land.
   */
  tradesPerTraderLowerBound: number | null;
}

export interface ReportDistribution {
  holderCount: number | null;
  top10Pct: number | null;
  rank11to30Pct: number | null;
  rank31to50Pct: number | null;
  restPct: number | null;
  top50Pct: number | null;
  updatedAt: string | null;
  developerAddress: string | null;
  developerHoldingPct: number | null;
}

export interface ReportLaunchpad {
  graduationPct: number | null;
  completed: boolean;
  completedAt: string | null;
  destinationPool: string | null;
}

export interface ReportPool {
  address: string;
  dexId: string | null;
  pairLabel: string | null;
  labels: string[];
  url?: string | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  priceUsd: number | null;
  priceChange24hPct: number | null;
  createdAt: string | number | null;
  ageHours: number | null;
  feePercentage?: number | null;
  lockedLiquidityPct?: number | null;
  buys24h: number | null;
  sells24h: number | null;
  buyers24h: number | null;
  sellers24h: number | null;
}

export interface ReportVerdict {
  level: "kritis" | "tinggi" | "sedang" | "rendah";
  flagCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
}

export interface NarrativeSection {
  key: string;
  title: string;
  body: string;
}

export interface ReportNarrative {
  sections: NarrativeSection[];
  plainText: string;
  verdictLabel: string;
  /** "deterministic" — assembled from the report object, not paraphrased. */
  generatedBy: string;
}

export interface SocialMention {
  id: string | null;
  text: string;
  author: string | null;
  authorName: string | null;
  authorFollowers: number | null;
  createdAt: string | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  views: number | null;
  url: string | null;
}

export interface SocialSynthesis {
  ringkasanProyek?: string;
  tim?: { ringkasan: string; anggota: { handle: string; peran: string; catatan: string; buktiUrl: string }[] };
  katalis?: { ringkasan: string; item: { judul: string; detail: string; sumberHandle: string; buktiUrl: string }[] };
  komunitas?: {
    ringkasan: string;
    sentimen: "positif" | "negatif" | "campuran" | "tidak cukup data";
    jumlahPositif: number;
    jumlahNegatif: number;
    item: { sisi: "positif" | "negatif"; kutipan: string; handle: string; buktiUrl: string }[];
  };
  alpha?: { ringkasan: string; item: { temuan: string; sumberHandle: string; buktiUrl: string }[] };
  generatedBy?: string;
  mentionCount?: number;
  error?: string;
}

export interface ReportSocial {
  /** False when no X/Twitter provider is configured — an empty section is not "nobody is talking". */
  configured: boolean;
  provider?: string;
  query?: string;
  mentions?: SocialMention[];
  stats?: {
    mentionCount: number;
    uniqueAuthors: number;
    totalLikes: number;
    topAuthorFollowers: number;
  } | null;
  error?: string;
  /** Separate from `configured`: a social source with no LLM key yields raw mentions, no synthesis. */
  synthesisConfigured: boolean;
  synthesis: SocialSynthesis | null;
}

export interface ReportSourceHealth {
  geckoterminal: { ok: boolean; reason: string | null };
  dexscreener: { ok: boolean; reason: string | null };
}

export interface TokenReport {
  chain: string;
  identity: ReportIdentity;
  market: ReportMarket;
  flow: ReportFlow;
  distribution: ReportDistribution;
  launchpad: ReportLaunchpad | null;
  pools: ReportPool[];
  checks: ReportCheck[];
  flags: ReportFlag[];
  verdict: ReportVerdict;
  /** Which upstreams answered. Null on reports built without it. */
  sourceHealth: ReportSourceHealth | null;
  narrative: ReportNarrative;
  social: ReportSocial;
  meta: {
    generatedAt: string;
    sources: string[];
    disclaimer: string;
    cacheTtlSeconds?: number;
  };
}

/* -------------------------------------------------------------------------- */
/* Wallet P&L calendar                                                         */
/* -------------------------------------------------------------------------- */

export interface PnlDayPool {
  pair: string;
  pnl: number;
  positions: number;
}

export interface PnlDay {
  /** "YYYY-MM-DD" in the time zone the report was bucketed at. */
  date: string;
  pnl: number;
  positions: number;
  wins: number;
  losses: number;
  fees: number;
  winRatePct: number | null;
  /** What moved the day, biggest absolute contribution first. */
  pools: PnlDayPool[];
}

export interface PnlSummary {
  netPnl: number;
  closedPositions: number;
  wins: number;
  losses: number;
  winRatePct: number | null;
  grossProfit: number;
  grossLoss: number;
  /** Null, never Infinity — a profit factor with no losses has no denominator. */
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  tradingDays: number;
  greenDays: number;
  redDays: number;
  dayWinRatePct: number | null;
  bestDay: { date: string; pnl: number } | null;
  worstDay: { date: string; pnl: number } | null;
  fees: number;
  currentStreak: { direction: "green" | "red" | "flat"; days: number };
  firstDay: string | null;
  lastDay: string | null;
}

/**
 * How much of the wallet the walk could actually account for. This is not
 * diagnostics — a P&L missing three positions looks exactly like a P&L that
 * is simply smaller, so the UI has to be able to say which.
 */
export interface PnlReconciliation {
  complete: boolean;
  positionsCounted: number;
  positionsExcluded: number;
  positionsUnpriced: number;
  positionsPartial: number;
  failedTxs: { hash: string; reason: string }[];
  openPositions: number;
  truncated: boolean;
}

export interface WalletPnl {
  wallet: string;
  chain: string;
  protocol: string;
  denomination: string;
  days: PnlDay[];
  /** "YYYY-MM" buckets holding at least one trading day, oldest first. */
  months: string[];
  summary: PnlSummary;
  timeZoneOffsetMinutes: number;
  reconciliation: PnlReconciliation;
  poolCount: number;
  meta: {
    fetchedAt: string;
    sources: string[];
    cacheTtlSeconds: number;
    lpTransactions: number;
    transactionsScanned: number;
    basis: string;
    disclaimer: string;
  };
}
