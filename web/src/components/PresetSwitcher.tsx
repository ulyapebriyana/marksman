import clsx from "clsx";
import type { PresetKey } from "../api/types";

const PRESETS: { key: PresetKey; label: string; description: string }[] = [
  { key: "steady", label: "Steady", description: "Conservative — established pools, tight pricing, low risk." },
  { key: "marksman", label: "Marksman", description: "Aggressive arb-hunter — chases premium/discount dislocations." },
];

export function PresetSwitcher({ value, onChange }: { value: PresetKey; onChange: (preset: PresetKey) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          onClick={() => onChange(p.key)}
          title={p.description}
          className={clsx(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === p.key
              ? "bg-[var(--color-accent)] text-[#06120d]"
              : "text-[var(--color-text-dim)] hover:text-[var(--color-text)]"
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
