import clsx from "clsx";

function riskTier(value: number): { label: string; className: string } {
  if (value < 30) return { label: "Low", className: "text-[var(--color-up)] border-[var(--color-up)]/30 bg-[var(--color-up)]/10" };
  if (value < 60) return { label: "Med", className: "text-[var(--color-watch)] border-[var(--color-watch)]/30 bg-[var(--color-watch)]/10" };
  return { label: "High", className: "text-[var(--color-hot)] border-[var(--color-hot)]/30 bg-[var(--color-hot)]/10" };
}

export function RiskBadge({ value }: { value: number }) {
  const tier = riskTier(value);
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium tabular-nums",
        tier.className
      )}
      title={`Risk score ${value}/100`}
    >
      {value.toFixed(0)} · {tier.label}
    </span>
  );
}
