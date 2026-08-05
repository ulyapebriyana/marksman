import clsx from "clsx";

function scoreColor(fraction: number): string {
  if (fraction >= 0.8) return "var(--color-hot)";
  if (fraction >= 0.65) return "var(--color-watch)";
  return "var(--color-accent)";
}

export function ScoreBar({
  value,
  max = 100,
  label,
  showValue = true,
  size = "md",
}: {
  value: number;
  max?: number;
  label?: string;
  showValue?: boolean;
  size?: "sm" | "md";
}) {
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const color = scoreColor(value / 100);

  return (
    <div className="flex items-center gap-2">
      {label && <span className="w-28 shrink-0 text-xs text-[var(--color-text-dim)]">{label}</span>}
      <div className={clsx("flex-1 rounded-full bg-[var(--color-border)]", size === "sm" ? "h-1.5" : "h-2")}>
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${fraction * 100}%`, background: color }}
        />
      </div>
      {showValue && (
        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--color-text-dim)]">
          {value.toFixed(0)}/{max}
        </span>
      )}
    </div>
  );
}
