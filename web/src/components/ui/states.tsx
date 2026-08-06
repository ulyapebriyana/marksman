import { AlertTriangle, RadioTower, RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import type { SourceHealth } from "../../api/types";
import { Button } from "./primitives";

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-16 text-center">
      <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-full border border-line bg-ink-2 text-txt-2">
        {icon ?? <RadioTower size={18} aria-hidden />}
      </span>
      <p className="text-sm font-medium text-txt-0">{title}</p>
      {description && <p className="max-w-sm text-[12px] leading-relaxed text-txt-2">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-flare/35 bg-flare/10 text-flare">
        <AlertTriangle size={18} aria-hidden />
      </span>
      <p className="max-w-md text-sm font-medium text-txt-0">{message}</p>
      <p className="max-w-md text-[12px] leading-relaxed text-txt-2">
        The screener kept the last good scan. Retry, or wait for the next cycle.
      </p>
      {onRetry && (
        <Button size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw size={13} aria-hidden /> Retry
        </Button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 9 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-1.5 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="sweep relative h-11 overflow-hidden rounded-lg bg-ink-2" style={{ opacity: 1 - i * 0.07 }} />
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sweep relative h-40 overflow-hidden rounded-xl border border-line bg-ink-1" />
      ))}
    </div>
  );
}

const SOURCE_LABELS: Record<keyof SourceHealth, string> = {
  dexscreener: "DexScreener",
  geckoterminal: "GeckoTerminal 1h charts",
  equity: "Equity price feed",
};

export function DegradedSourceBanner({ sourceHealth }: { sourceHealth?: SourceHealth }) {
  if (!sourceHealth) return null;
  const degraded = (Object.keys(sourceHealth) as (keyof SourceHealth)[]).filter((key) => !sourceHealth[key].ok);
  if (degraded.length === 0) return null;

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-reticle/30 bg-reticle/8 px-3.5 py-2.5 text-[12px] leading-relaxed text-reticle">
      <WifiOff size={15} className="mt-0.5 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">{degraded.map((k) => SOURCE_LABELS[k]).join(" and ")}</span>{" "}
        {degraded.length === 1 ? "is" : "are"} not responding. Rows sourced from {degraded.length === 1 ? "it" : "them"} are
        missing data until it recovers — read them as incomplete, not as a signal.
      </p>
    </div>
  );
}

export function DisclaimerBanner() {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-line bg-ink-1 px-3.5 py-2.5 text-[12px] leading-relaxed text-txt-2">
      <ShieldAlert size={15} className="mt-0.5 shrink-0 text-reticle" aria-hidden />
      <p>
        Marksman reads the chain and nothing else — no wallet, no keys, no orders. Scores and signals rank what the scan
        found; they are not advice. Premium figures depend on a third-party equity feed that can lag or be wrong.
      </p>
    </div>
  );
}
