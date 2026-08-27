import { useEffect, useState } from "react";
import clsx from "clsx";
import { Bell, Check, Copy, ExternalLink, FileSearch, Star, X } from "lucide-react";
import type { Pool, PresetKey } from "../api/types";
import {
  formatAge,
  formatCount,
  formatPct,
  formatPrice,
  formatUsd,
  humanizeFlag,
  shortenAddress,
} from "../lib/format";
import { buyPressure, momentum1h, poolLabel, turnover, txns24h } from "../lib/poolMath";
import { RiskBadge, ScoreBar, SignalBadge, StockTag } from "./ui/badges";
import { Sparkline, SplitBar } from "./ui/charts";
import { Button, Eyebrow, IconButton } from "./ui/primitives";
import { useSendAlert } from "../hooks/usePools";
import { useToast } from "../hooks/useToast";
import { useFocusTrap, useScrollLock } from "../hooks/useMisc";
import { PoolLinks } from "./ui/PoolLinks";
import { tokenReportPath } from "../lib/nav";
import { useRouter } from "../lib/router";

const SCORE_LABELS: Record<string, string> = {
  momentum: "Momentum",
  feeEfficiency: "Fee efficiency",
  volumeQuality: "Volume quality",
  security: "Security",
  freshness: "Freshness",
};

const FLAG_EXPLANATIONS: Record<string, string> = {
  liquidity_critical: "Under $1,000 of liquidity — a single trade moves the price hard.",
  liquidity_low: "Under $10,000 of liquidity. Slippage will be significant.",
  extreme_momentum: "Moved more than 100% in an hour. Often a launch or a squeeze, not a trend.",
  new_pool: "Created within the last 30 minutes. Almost no history to read.",
  low_txns: "Fewer than 20 trades in 24h. The price may be stale.",
  premium_extreme: "More than 5% away from the equity it tracks.",
  premium_elevated: "More than 2% away from the equity it tracks.",
  missing_candles: "No 1h candles this scan, so momentum fell back to DexScreener's number.",
  missing_underlying_price: "No equity quote available, so the premium can't be computed.",
  danger_label: "DexScreener flagged this pool.",
};

const GATE_EXPLANATIONS: Record<string, string> = {
  liquidity_below_min: "Liquidity is below the preset's floor.",
  volume_below_min: "24h volume is below the preset's floor.",
  premium_out_of_range: "Sits further from parity than the preset allows.",
  premium_too_small: "Sits too close to parity — this preset wants a dislocation.",
  momentum_unknown: "No 1h price change was available this scan.",
  momentum_out_of_range: "The 1h move is outside the preset's band.",
  age_below_min: "The pool is younger than the preset allows.",
  risk_above_max: "Risk is above the preset's ceiling.",
};

type Tab = "overview" | "score" | "risk" | "raw";

function Field({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div title={hint}>
      <p className="engraved text-txt-2">{label}</p>
      <p className="num mt-1 text-[13px] font-medium text-txt-0">{value}</p>
    </div>
  );
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(address).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-2 px-2 py-1 font-mono text-[11px] text-txt-1 transition-colors hover:border-line-2 hover:text-txt-0"
      aria-label={copied ? "Address copied" : `Copy pool address ${address}`}
    >
      {shortenAddress(address)}
      {copied ? <Check size={11} className="text-bloom" aria-hidden /> : <Copy size={11} aria-hidden />}
    </button>
  );
}

export function PoolDrawer({
  pool,
  preset,
  onClose,
  isWatched,
  onToggleWatch,
}: {
  pool: Pool | null;
  preset: PresetKey;
  onClose: () => void;
  isWatched: boolean;
  onToggleWatch: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const { showToast } = useToast();
  const { navigate } = useRouter();
  const sendAlert = useSendAlert();
  const containerRef = useFocusTrap(pool != null);

  useScrollLock(pool != null);

  useEffect(() => {
    setTab("overview");
  }, [pool?.address]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
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
          if (res.sent) {
            showToast(`Alert sent for ${poolLabel(pool)}.`, "success");
          } else if (res.reason === "telegram_not_configured") {
            showToast("Telegram isn't configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the server.", "error");
          } else {
            showToast(`Alert not sent — ${res.reason ?? "unknown reason"}.`, "error");
          }
        },
        onError: (err) => showToast(err instanceof Error ? err.message : "Could not reach the alert endpoint.", "error"),
      }
    );
  }

  const move = momentum1h(pool);
  const rate = turnover(pool);
  const pressure = buyPressure(pool);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${poolLabel(pool)} details`}>
      <button
        className="absolute inset-0 cursor-default bg-[var(--c-scrim)] backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close details"
        tabIndex={-1}
      />

      <div
        ref={containerRef}
        className="slide-in relative flex h-full w-full max-w-lg flex-col border-l border-line-2 bg-ink-1 shadow-pop"
      >
        {/* header */}
        <div className="shrink-0 border-b border-line px-5 pb-0 pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display truncate text-xl font-bold tracking-[-0.02em] text-txt-0">
                  {pool.baseToken.symbol ?? "?"}
                  <span className="text-txt-2"> / {pool.quoteToken.symbol ?? "?"}</span>
                </h2>
                {pool.isTokenizedStock && <StockTag ticker={pool.stockTicker} name={pool.stockName} />}
              </div>
              <div className="mt-1 flex min-w-0 items-center gap-1.5">
                <p className="min-w-0 truncate text-[12px] text-txt-2">
                  {pool.baseToken.name}
                  {pool.dexId ? ` · ${pool.dexId}` : ""}
                </p>
                <PoolLinks pool={pool} />
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                label={`Token report for ${pool.baseToken.symbol ?? "this token"}`}
                variant="ghost"
                size="sm"
                onClick={() => {
                  onClose();
                  navigate(tokenReportPath(pool.baseToken.address));
                }}
              >
                <FileSearch size={16} aria-hidden />
              </IconButton>
              <IconButton
                label={isWatched ? "Remove from watchlist" : "Add to watchlist"}
                variant="ghost"
                size="sm"
                onClick={onToggleWatch}
                className={isWatched ? "text-reticle" : undefined}
              >
                <Star size={16} fill={isWatched ? "currentColor" : "none"} aria-hidden />
              </IconButton>
              <IconButton label="Close details" variant="ghost" size="sm" onClick={onClose}>
                <X size={17} aria-hidden />
              </IconButton>
            </div>
          </div>

          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <p className="num text-3xl font-semibold leading-none tracking-tight text-txt-0">
                {formatPrice(pool.priceUsd)}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <SignalBadge status={pool.signalStatus} />
                <span
                  className={clsx("num text-[13px]", move == null ? "text-txt-2" : move >= 0 ? "text-bloom" : "text-flare")}
                >
                  {formatPct(move, { signed: true })} <span className="text-txt-2">1h</span>
                </span>
              </div>
            </div>
            <Sparkline data={pool.sparkline} className="h-12 w-32 shrink-0" />
          </div>

          <div className="mt-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Pool detail sections">
            {(["overview", "score", "risk", "raw"] as Tab[]).map((key) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={clsx(
                  "-mb-px border-b-2 px-3 py-2.5 text-[13px] font-medium capitalize transition-colors",
                  tab === key
                    ? "border-reticle text-txt-0"
                    : "border-transparent text-txt-2 hover:text-txt-1"
                )}
              >
                {key === "raw" ? "Details" : key}
              </button>
            ))}
          </div>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {tab === "overview" && (
            <div className="space-y-6">
              {pool.isTokenizedStock && (
                <section>
                  <Eyebrow className="mb-2.5">Against {pool.stockTicker}</Eyebrow>
                  {pool.dataQuality.hasUnderlyingPrice ? (
                    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
                      <div className="bg-ink-2 px-3 py-3 text-center">
                        <p className="engraved text-txt-2">On-chain</p>
                        <p className="num mt-1.5 text-[15px] font-semibold text-txt-0">{formatPrice(pool.priceUsd)}</p>
                      </div>
                      <div className="bg-ink-2 px-3 py-3 text-center">
                        <p className="engraved text-txt-2">Equity</p>
                        <p className="num mt-1.5 text-[15px] font-semibold text-txt-0">
                          {formatPrice(pool.underlyingPrice)}
                        </p>
                      </div>
                      <div className="bg-ink-2 px-3 py-3 text-center">
                        <p className="engraved text-txt-2">Gap</p>
                        <p
                          className={clsx(
                            "num mt-1.5 text-[15px] font-semibold",
                            (pool.premiumPct ?? 0) >= 0 ? "text-bloom" : "text-flare"
                          )}
                        >
                          {formatPct(pool.premiumPct, { signed: true })}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-xl border border-line bg-ink-2 px-3.5 py-3 text-[12px] leading-relaxed text-txt-2">
                      No equity quote this scan, so the gap is unknown rather than zero. Set{" "}
                      <code className="font-mono text-txt-1">STOCK_API_KEY</code> on the server to enable it.
                    </p>
                  )}
                </section>
              )}

              <section>
                <Eyebrow className="mb-2.5">
                  Preset gate · <span className="capitalize">{preset}</span>
                </Eyebrow>
                {pool.presetGate.passed ? (
                  <p className="flex items-center gap-2 rounded-xl border border-bloom/30 bg-bloom/8 px-3.5 py-2.5 text-[12px] text-bloom">
                    <Check size={14} aria-hidden /> Clears every threshold in this preset.
                  </p>
                ) : (
                  <ul className="space-y-px overflow-hidden rounded-xl border border-line bg-line">
                    {pool.presetGate.misses.map((miss) => (
                      <li key={miss} className="bg-ink-2 px-3.5 py-2.5">
                        <p className="text-[12px] font-medium text-flare">{humanizeFlag(miss)}</p>
                        {GATE_EXPLANATIONS[miss] && (
                          <p className="mt-0.5 text-[11px] leading-snug text-txt-2">{GATE_EXPLANATIONS[miss]}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <Eyebrow className="mb-3">Pool</Eyebrow>
                <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
                  <Field label="Liquidity" value={formatUsd(pool.liquidityUsd)} />
                  <Field label="Volume 24h" value={formatUsd(pool.volume.h24)} />
                  <Field
                    label="Turnover"
                    value={rate == null ? "—" : `${rate.toFixed(2)}×`}
                    hint="24h volume divided by liquidity"
                  />
                  <Field label="Volume 1h" value={formatUsd(pool.volume.h1)} />
                  <Field label="Txns 24h" value={formatCount(txns24h(pool))} />
                  <Field label="Age" value={formatAge(pool.ageMs)} />
                  {/* Both sources report 0 when they simply don't know, so a
                      literal $0.00 here would be a fabricated fact. */}
                  <Field label="FDV" value={pool.fdv ? formatUsd(pool.fdv) : "—"} hint="Not reported when unavailable" />
                  <Field
                    label="Market cap"
                    value={pool.marketCap ? formatUsd(pool.marketCap) : "—"}
                    hint="Not reported when unavailable"
                  />
                  <Field label="24h move" value={formatPct(pool.priceChange.h24, { signed: true })} />
                </div>
              </section>

              {txns24h(pool) > 0 && (
                <section>
                  <Eyebrow className="mb-2.5">Buy / sell split · 24h</Eyebrow>
                  <SplitBar
                    left={pool.txns.h24.buys}
                    right={pool.txns.h24.sells}
                    leftLabel="buys"
                    rightLabel="sells"
                  />
                  {pressure != null && (
                    <p className="mt-2 text-[11px] text-txt-2">
                      {pressure.toFixed(0)}% of trades were buys.
                    </p>
                  )}
                </section>
              )}
            </div>
          )}

          {tab === "score" && (
            <div className="space-y-5">
              <div className="flex items-baseline justify-between">
                <Eyebrow>Weighted to 100</Eyebrow>
                <p className="num text-2xl font-semibold text-txt-0">
                  {pool.score.total.toFixed(1)}
                  <span className="text-[14px] text-txt-2">/100</span>
                </p>
              </div>

              <div className="space-y-3.5">
                {Object.entries(pool.score.breakdown).map(([key, item]) => (
                  <div key={key}>
                    <ScoreBar label={SCORE_LABELS[key] ?? key} value={item.score} max={item.max} size="sm" />
                    {item.value != null && (
                      <p className="num mt-1 pl-[104px] text-[11px] text-txt-2">
                        measured {typeof item.value === "number" ? item.value.toFixed(2) : item.value}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <p className="rounded-xl border border-line bg-ink-2 px-3.5 py-3 text-[11px] leading-relaxed text-txt-2">
                Score ranks opportunity; risk is scored separately so a strong score can never hide a dangerous pool.
                Check both.
              </p>
            </div>
          )}

          {tab === "risk" && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <Eyebrow>Risk score</Eyebrow>
                <RiskBadge value={pool.risk.value} />
              </div>

              {pool.risk.flags.length === 0 ? (
                <p className="rounded-xl border border-bloom/30 bg-bloom/8 px-3.5 py-3 text-[12px] text-bloom">
                  No risk flags raised this scan.
                </p>
              ) : (
                <ul className="space-y-px overflow-hidden rounded-xl border border-line bg-line">
                  {pool.risk.flags.map((flag) => (
                    <li key={flag} className="bg-ink-2 px-3.5 py-3">
                      <p className="text-[12px] font-medium text-reticle">{humanizeFlag(flag)}</p>
                      {FLAG_EXPLANATIONS[flag] && (
                        <p className="mt-1 text-[11px] leading-relaxed text-txt-2">{FLAG_EXPLANATIONS[flag]}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Field label="1h candles" value={pool.dataQuality.hasCandles ? "Available" : "Missing"} />
                <Field
                  label="Equity quote"
                  value={pool.dataQuality.hasUnderlyingPrice ? "Available" : "Missing"}
                />
              </div>
            </div>
          )}

          {tab === "raw" && (
            <div className="space-y-5">
              <section>
                <Eyebrow className="mb-3">Identity</Eyebrow>
                <dl className="space-y-px overflow-hidden rounded-xl border border-line bg-line text-[12px]">
                  {[
                    ["Pool address", <CopyAddress key="pool" address={pool.address} />],
                    ["Base token", <CopyAddress key="base" address={pool.baseToken.address} />],
                    ["Quote token", <CopyAddress key="quote" address={pool.quoteToken.address} />],
                    ["Chain", pool.chainId],
                    ["DEX", pool.dexId],
                    ["Labels", pool.labels.length > 0 ? pool.labels.join(", ") : "none"],
                    ["Known token", pool.isKnownToken ? "yes" : "no"],
                  ].map(([term, value]) => (
                    <div key={String(term)} className="flex items-center justify-between gap-3 bg-ink-2 px-3.5 py-2.5">
                      <dt className="text-txt-2">{term}</dt>
                      <dd className="text-right text-txt-1">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section>
                <Eyebrow className="mb-3">Volume by window</Eyebrow>
                <div className="grid grid-cols-4 gap-3">
                  <Field label="5m" value={formatUsd(pool.volume.m5)} />
                  <Field label="1h" value={formatUsd(pool.volume.h1)} />
                  <Field label="6h" value={formatUsd(pool.volume.h6)} />
                  <Field label="24h" value={formatUsd(pool.volume.h24)} />
                </div>
              </section>

              <section>
                <Eyebrow className="mb-3">Price change by window</Eyebrow>
                <div className="grid grid-cols-4 gap-3">
                  <Field label="5m" value={formatPct(pool.priceChange.m5, { signed: true })} />
                  <Field label="1h" value={formatPct(pool.priceChange.h1, { signed: true })} />
                  <Field label="6h" value={formatPct(pool.priceChange.h6, { signed: true })} />
                  <Field label="24h" value={formatPct(pool.priceChange.h24, { signed: true })} />
                </div>
              </section>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="shrink-0 space-y-3 border-t border-line px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <CopyAddress address={pool.address} />
            <a
              href={pool.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-[12px] text-coat transition-colors hover:underline"
            >
              Open on DexScreener <ExternalLink size={12} aria-hidden />
            </a>
          </div>

          <Button variant="primary" className="w-full" onClick={handleAlert} disabled={sendAlert.isPending}>
            <Bell size={14} aria-hidden />
            {sendAlert.isPending ? "Sending…" : "Send Telegram alert"}
          </Button>
          <p className="text-center text-[11px] text-txt-2">Informational only. Marksman places no trades.</p>
        </div>
      </div>
    </div>
  );
}
