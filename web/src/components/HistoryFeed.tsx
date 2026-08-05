import { useState } from "react";
import clsx from "clsx";
import type { HistoryEntry, SignalStatus } from "../api/types";
import { formatPct, formatRelativeTime } from "../lib/format";
import { SignalBadge } from "./SignalBadge";
import { EmptyState } from "./StateViews";

const FILTERS: { key: SignalStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "hot", label: "Hot" },
  { key: "watch", label: "Watch" },
];

export function HistoryFeed({ history }: { history: HistoryEntry[] }) {
  const [filter, setFilter] = useState<SignalStatus | "all">("all");
  const rows = filter === "all" ? history : history.filter((h) => h.to === filter);

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <h3 className="text-sm font-medium text-[var(--color-text)]">Signal History</h3>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={clsx(
                "rounded-md px-2 py-1 text-xs font-medium",
                filter === f.key ? "bg-[var(--color-surface-raised)] text-[var(--color-text)]" : "text-[var(--color-text-faint)]"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No signal transitions yet" description="Hot/watch transitions will appear here as pools cross thresholds." />
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {rows.map((entry, i) => (
            <li key={`${entry.address}-${entry.at}-${i}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <SignalBadge status={entry.to} compact />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    {entry.symbol} <span className="text-[var(--color-text-faint)]">{entry.from} → {entry.to}</span>
                  </p>
                  <p className="text-[11px] text-[var(--color-text-faint)]">
                    {formatRelativeTime(entry.at)} · {entry.preset} preset
                  </p>
                </div>
              </div>
              <div className="text-right text-xs text-[var(--color-text-dim)] tabular-nums">
                {entry.score != null && <div>Score {entry.score.toFixed(0)}</div>}
                {entry.premiumPct != null && <div>{formatPct(entry.premiumPct, { signed: true })} premium</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
