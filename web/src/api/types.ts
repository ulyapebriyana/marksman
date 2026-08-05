export type SignalStatus = "none" | "watch" | "hot";
export type PresetKey = "steady" | "marksman";

export interface TokenInfo {
  address: string;
  symbol: string | null;
  name: string | null;
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
    poolCount: number;
  };
}

export interface StatusResponse {
  ok: boolean;
  uptimeSeconds: number;
  activePreset: PresetKey;
  presets: PresetKey[];
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
