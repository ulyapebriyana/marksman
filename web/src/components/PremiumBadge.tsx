import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatPct } from "../lib/format";

export function PremiumBadge({ premiumPct }: { premiumPct: number | null }) {
  if (premiumPct == null) {
    return <span className="text-xs text-[var(--color-text-faint)]">—</span>;
  }

  const isPremium = premiumPct >= 0;
  const description = isPremium ? "Premium: on-chain trades above the real equity price" : "Discount: on-chain trades below the real equity price";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
        isPremium ? "text-[var(--color-up)]" : "text-[var(--color-down)]"
      )}
      title={description}
      aria-label={`${description}, ${formatPct(Math.abs(premiumPct))}`}
    >
      {isPremium ? <ArrowUpRight size={12} aria-hidden /> : <ArrowDownRight size={12} aria-hidden />}
      {formatPct(Math.abs(premiumPct))}
    </span>
  );
}
