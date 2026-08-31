import type {
  AlertResponse,
  HistoryResponse,
  LpPresetKey,
  PoolsResponse,
  PresetKey,
  StatusResponse,
  TokenReport,
  WalletPnlResponse,
} from "./types";
import { ApiError } from "./types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.error ?? `Request failed: ${res.status}`, res.status);
  }
  return res.json();
}

export function fetchPools(
  opts: { preset?: PresetKey; lpPreset?: LpPresetKey; force?: boolean } = {}
): Promise<PoolsResponse> {
  const params = new URLSearchParams();
  if (opts.preset) params.set("preset", opts.preset);
  if (opts.lpPreset) params.set("lp", opts.lpPreset);
  if (opts.force) params.set("force", "1");
  const qs = params.toString();
  return get<PoolsResponse>(`/api/pools${qs ? `?${qs}` : ""}`);
}

export function fetchStatus(): Promise<StatusResponse> {
  return get<StatusResponse>("/api/status");
}

export function fetchHistory(limit = 100): Promise<HistoryResponse> {
  return get<HistoryResponse>(`/api/history?limit=${limit}`);
}

export async function postAlert(address: string, preset?: PresetKey): Promise<AlertResponse> {
  const params = new URLSearchParams();
  if (preset) params.set("preset", preset);
  const qs = params.toString();
  const res = await fetch(`/api/alert${qs ? `?${qs}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Request failed: ${res.status}`, res.status);
  }
  return body;
}

/** One token's full analysis report. `force` bypasses the server-side cache. */
export function fetchTokenReport(address: string, opts: { force?: boolean } = {}): Promise<TokenReport> {
  return get<TokenReport>(`/api/token/${address}${opts.force ? "?force=1" : ""}`);
}

/**
 * One wallet's realized daily P&L. `tzOffsetMinutes` is minutes east of UTC —
 * which calendar day a position closed on depends entirely on whose midnight
 * you mean, so the client states its own rather than letting the server guess.
 */
export function fetchWalletPnl(
  address: string,
  opts: { tzOffsetMinutes?: number; force?: boolean } = {}
): Promise<WalletPnlResponse> {
  const params = new URLSearchParams();
  if (opts.tzOffsetMinutes != null) params.set("tz", String(opts.tzOffsetMinutes));
  if (opts.force) params.set("force", "1");
  const qs = params.toString();
  return get<WalletPnlResponse>(`/api/wallet/${address}/pnl${qs ? `?${qs}` : ""}`);
}
