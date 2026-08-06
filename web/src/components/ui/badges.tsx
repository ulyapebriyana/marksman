import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { SignalStatus } from "../../api/types";
import { formatPct } from "../../lib/format";
import { riskTier } from "../../lib/poolMath";

/* -------------------------------------------------------------------------- */
/* Signal                                                                      */
/* -------------------------------------------------------------------------- */

const SIGNAL_STYLE: Record<SignalStatus, { label: string; dot: string; text: string; pulse: boolean }> = {
  none: { label: "Quiet", dot: "bg-txt-2", text: "text-txt-2", pulse: false },
  watch: { label: "Watch", dot: "bg-reticle", text: "text-reticle", pulse: false },
  hot: { label: "Hot", dot: "bg-flare", text: "text-flare", pulse: true },
};

export function SignalBadge({ status, compact = false }: { status: SignalStatus; compact?: boolean }) {
  const style = SIGNAL_STYLE[status];
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 font-medium", style.text, compact ? "text-[11px]" : "text-[13px]")}
      title={`Signal: ${style.label}`}
    >
      <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", style.dot, style.pulse && "signal-pulse")} aria-hidden />
      {compact ? <span className="sr-only">{style.label}</span> : style.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Risk                                                                        */
/* -------------------------------------------------------------------------- */

const RISK_STYLE = {
  low: { label: "Low", className: "text-bloom border-bloom/35 bg-bloom/10" },
  medium: { label: "Med", className: "text-reticle border-reticle/35 bg-reticle/10" },
  high: { label: "High", className: "text-flare border-flare/35 bg-flare/10" },
} as const;

export function RiskBadge({ value, showLabel = true }: { value: number; showLabel?: boolean }) {
  const tier = RISK_STYLE[riskTier(value)];
  return (
    <span
      className={clsx(
        "num inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        tier.className
      )}
      title={`Risk ${value} of 100 — ${tier.label.toLowerCase()}`}
    >
      {value.toFixed(0)}
      {showLabel && <span className="font-sans">· {tier.label}</span>}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Premium / discount                                                          */
/* -------------------------------------------------------------------------- */

export function PremiumBadge({ premiumPct, size = "sm" }: { premiumPct: number | null; size?: "sm" | "md" }) {
  if (premiumPct == null) {
    return (
      <span className="text-[11px] text-txt-2" title="No underlying equity quote available">
        —
      </span>
    );
  }

  const isPremium = premiumPct >= 0;
  const description = isPremium
    ? "Premium — the token trades above the equity it tracks"
    : "Discount — the token trades below the equity it tracks";

  return (
    <span
      className={clsx(
        "num inline-flex items-center gap-0.5 font-medium",
        size === "sm" ? "text-[12px]" : "text-sm",
        isPremium ? "text-bloom" : "text-flare"
      )}
      title={description}
      aria-label={`${description}, ${formatPct(Math.abs(premiumPct))}`}
    >
      {isPremium ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
      {formatPct(Math.abs(premiumPct))}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Delta (any signed percentage)                                               */
/* -------------------------------------------------------------------------- */

export function Delta({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null || Number.isNaN(value)) {
    return <span className={clsx("num text-txt-2", className)}>—</span>;
  }
  const flat = Math.abs(value) < 0.005;
  return (
    <span
      className={clsx("num inline-flex items-center gap-0.5", flat ? "text-txt-2" : value > 0 ? "text-bloom" : "text-flare", className)}
    >
      {flat ? <Minus size={11} aria-hidden /> : null}
      {formatPct(value, { signed: true })}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Tokenized-stock tag                                                         */
/* -------------------------------------------------------------------------- */

export function StockTag({ ticker, name }: { ticker: string | null; name?: string | null }) {
  if (!ticker) return null;
  return (
    <span
      className="engraved shrink-0 rounded border border-coat/45 bg-coat/12 px-1 py-px text-coat"
      title={name ? `Tokenized ${ticker} — tracks ${name}` : `Tokenized ${ticker}`}
    >
      {ticker}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Score bar                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Score runs on the cool brand ramp, deliberately sharing no colour with risk.
 * Red here would read as "dangerous" when it actually means "scores well".
 */
function scoreColor(fraction: number): string {
  if (fraction >= 0.75) return "var(--c-bloom)";
  if (fraction >= 0.45) return "var(--c-coat)";
  return "color-mix(in srgb, var(--c-coat) 50%, var(--c-line-2))";
}

export function ScoreBar({
  value,
  max = 100,
  label,
  showValue = true,
  size = "md",
  className,
}: {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;

  return (
    <div className={clsx("flex items-center gap-2.5", className)}>
      {label && <span className="w-[104px] shrink-0 text-[12px] text-txt-1">{label}</span>}
      <div
        className={clsx("min-w-8 flex-1 overflow-hidden rounded-full bg-line", size === "sm" ? "h-1.5" : "h-2")}
        role="meter"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? "Score"}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${fraction * 100}%`, background: scoreColor(value / max) }}
        />
      </div>
      {showValue && (
        <span className="num w-11 shrink-0 text-right text-[12px] text-txt-1">
          {value.toFixed(0)}
          <span className="text-txt-2">/{max}</span>
        </span>
      )}
    </div>
  );
}
