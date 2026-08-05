import type { Pool } from "../api/types";

function StatTile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-faint)]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
    </div>
  );
}

export function StatSummary({ pools }: { pools: Pool[] }) {
  const hot = pools.filter((p) => p.signalStatus === "hot").length;
  const watch = pools.filter((p) => p.signalStatus === "watch").length;
  const stockPools = pools.filter((p) => p.isTokenizedStock).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatTile label="Pools Scanned" value={pools.length} />
      <StatTile label="Hot Signals" value={hot} accent={hot > 0 ? "var(--color-hot)" : undefined} />
      <StatTile label="Watch Signals" value={watch} accent={watch > 0 ? "var(--color-watch)" : undefined} />
      <StatTile label="Tokenized Stocks" value={stockPools} accent="var(--color-accent)" />
    </div>
  );
}
