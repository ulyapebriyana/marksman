import { WifiOff } from "lucide-react";
import type { SourceHealth } from "../api/types";

const LABELS: Record<keyof SourceHealth, string> = {
  dexscreener: "DexScreener",
  geckoterminal: "GeckoTerminal (1h charts)",
  equity: "Equity price feed",
};

export function DegradedSourceBanner({ sourceHealth }: { sourceHealth?: SourceHealth }) {
  if (!sourceHealth) return null;
  const degraded = (Object.keys(sourceHealth) as (keyof SourceHealth)[]).filter((k) => !sourceHealth[k].ok);
  if (degraded.length === 0) return null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--color-watch)]/30 bg-[var(--color-watch)]/10 px-3 py-2 text-xs text-[var(--color-watch)]">
      <WifiOff size={14} className="mt-0.5 shrink-0" />
      <p>
        {degraded.map((k) => LABELS[k]).join(", ")} {degraded.length === 1 ? "is" : "are"} temporarily unavailable — some
        data may be partial or missing until it recovers. This is not a trading signal.
      </p>
    </div>
  );
}
