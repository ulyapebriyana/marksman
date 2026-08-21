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
