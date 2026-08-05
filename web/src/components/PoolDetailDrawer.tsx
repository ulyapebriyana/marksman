import { useEffect, useState } from "react";
import { Bell, Check, Copy, ExternalLink, X } from "lucide-react";
import type { Pool, PresetKey } from "../api/types";
import { formatAge, formatPct, formatPrice, formatUsd, humanizeFlag, shortenAddress } from "../lib/format";
import { SignalBadge } from "./SignalBadge";
import { RiskBadge } from "./RiskBadge";
import { ScoreBar } from "./ScoreBar";
import { Sparkline } from "./Sparkline";
import { useSendAlert } from "../hooks/usePools";
import { useToast } from "../hooks/useToast";

const SCORE_LABELS: Record<string, string> = {
  momentum: "Momentum",
  feeEfficiency: "Fee Efficiency",
  volumeQuality: "Volume Quality",
  security: "Security",
  freshness: "Freshness",
};

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(address).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2 py-1 font-mono text-xs text-[var(--color-text-dim)] hover:bg-[var(--color-surface-raised)]"
    >
      {shortenAddress(address)}
      {copied ? <Check size={12} className="text-[var(--color-up)]" /> : <Copy size={12} />}
    </button>
  );
}

export function PoolDetailDrawer({
  pool,
  preset,
  onClose,
}: {
  pool: Pool | null;
  preset: PresetKey;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const sendAlert = useSendAlert();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!pool) return null;

  function handleAlert() {
    if (!pool) return;
    sendAlert.mutate(
      { address: pool.address, preset },
      {
        onSuccess: (res) => {
          if (res.sent) showToast("Alert sent.", "success");
          else showToast(res.reason === "telegram_not_configured" ? "Telegram isn't configured yet." : `Alert not sent: ${res.reason}`, "error");
        },
        onError: (err) => showToast(err instanceof Error ? err.message : "Failed to send alert", "error"),
      }
    );
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
        <div className="sticky top-0 flex items-start justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--color-text)]">{pool.baseToken.symbol}</h2>
              {pool.isTokenizedStock && (
                <span className="rounded border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]">
                  Tokenized {pool.stockTicker}
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-faint)]">{pool.baseToken.name}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-[var(--color-text-dim)] hover:bg-[var(--color-surface-raised)]">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-4">
          <div className="flex items-center justify-between">
            <SignalBadge status={pool.signalStatus} />
            <RiskBadge value={pool.risk.value} />
          </div>

          <div className="rounded-lg border border-[var(--color-border)] p-3">
            <p className="mb-2 text-xs font-medium text-[var(--color-text-dim)]">
              Preset gate — <span className="capitalize">{preset}</span>{" "}
              {pool.presetGate.passed ? (
                <span className="text-[var(--color-up)]">passed</span>
              ) : (
                <span className="text-[var(--color-hot)]">failed</span>
              )}
            </p>
            {!pool.presetGate.passed && (
              <ul className="flex flex-wrap gap-1.5">
                {pool.presetGate.misses.map((m) => (
                  <li key={m} className="rounded border border-[var(--color-hot)]/30 bg-[var(--color-hot)]/10 px-1.5 py-0.5 text-[11px] text-[var(--color-hot)]">
                    {humanizeFlag(m)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-[var(--color-text-dim)]">Score breakdown</p>
              <p className="text-sm font-semibold tabular-nums">{pool.score.total.toFixed(1)}/100</p>
            </div>
            <div className="flex flex-col gap-2">
              {Object.entries(pool.score.breakdown).map(([key, item]) => (
                <ScoreBar key={key} label={SCORE_LABELS[key] ?? key} value={item.score} max={item.max} size="sm" />
              ))}
            </div>
          </div>

          {pool.risk.flags.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-[var(--color-text-dim)]">Risk flags</p>
              <ul className="flex flex-wrap gap-1.5">
                {pool.risk.flags.map((f) => (
                  <li key={f} className="rounded border border-[var(--color-watch)]/30 bg-[var(--color-watch)]/10 px-1.5 py-0.5 text-[11px] text-[var(--color-watch)]">
                    {humanizeFlag(f)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pool.isTokenizedStock && (
            <div className="rounded-lg border border-[var(--color-border)] p-3">
              <p className="mb-2 text-xs font-medium text-[var(--color-text-dim)]">Premium vs {pool.stockTicker}</p>
              {pool.dataQuality.hasUnderlyingPrice ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[11px] text-[var(--color-text-faint)]">On-chain</p>
                    <p className="text-sm font-semibold tabular-nums">{formatPrice(pool.priceUsd)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[var(--color-text-faint)]">Real ({pool.stockTicker})</p>
                    <p className="text-sm font-semibold tabular-nums">{formatPrice(pool.underlyingPrice)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[var(--color-text-faint)]">Premium</p>
                    <p className={`text-sm font-semibold tabular-nums ${(pool.premiumPct ?? 0) >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
                      {formatPct(pool.premiumPct, { signed: true })}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--color-text-faint)]">
                  Underlying price unavailable — set STOCK_API_KEY in the backend .env to enable this.
                </p>
              )}
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-medium text-[var(--color-text-dim)]">1h price action</p>
            <Sparkline data={pool.sparkline} className="h-20 w-full" />
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Liquidity" value={formatUsd(pool.liquidityUsd)} />
            <Stat label="Volume 24h" value={formatUsd(pool.volume.h24)} />
            <Stat label="Txns 24h" value={`${pool.txns.h24.buys + pool.txns.h24.sells}`} />
            <Stat label="Age" value={formatAge(pool.ageMs)} />
            <Stat label="FDV" value={formatUsd(pool.fdv)} />
            <Stat label="Market Cap" value={formatUsd(pool.marketCap)} />
          </div>

          <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4">
            <CopyAddress address={pool.address} />
            <a
              href={pool.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-[var(--color-accent)] hover:underline"
            >
              DexScreener <ExternalLink size={12} />
            </a>
          </div>

          <button
            onClick={handleAlert}
            disabled={sendAlert.isPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-medium text-[#06120d] hover:opacity-90 disabled:opacity-50"
          >
            <Bell size={14} />
            {sendAlert.isPending ? "Sending…" : "Send manual alert"}
          </button>
          <p className="text-center text-[11px] text-[var(--color-text-faint)]">Informational only — not financial advice.</p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-[var(--color-text-faint)]">{label}</p>
      <p className="font-medium tabular-nums text-[var(--color-text)]">{value}</p>
    </div>
  );
}
