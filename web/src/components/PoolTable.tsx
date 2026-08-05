import { useMemo, useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import type { Pool } from "../api/types";
import { formatAge, formatPct, formatUsd, formatPrice } from "../lib/format";
import { SignalBadge } from "./SignalBadge";
import { RiskBadge } from "./RiskBadge";
import { PremiumBadge } from "./PremiumBadge";
import { Sparkline } from "./Sparkline";
import { ScoreBar } from "./ScoreBar";
import { EmptyState } from "./StateViews";

type SortKey = "score" | "risk" | "priceChange1h" | "volume24h" | "liquidity" | "premium" | "age";
const SIGNAL_RANK: Record<Pool["signalStatus"], number> = { hot: 2, watch: 1, none: 0 };

function useSortedFiltered(pools: Pool[], search: string, sortKey: SortKey, sortDir: 1 | -1) {
  return useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? pools.filter(
          (p) =>
            p.baseToken.symbol?.toLowerCase().includes(term) ||
            p.baseToken.name?.toLowerCase().includes(term) ||
            p.quoteToken.symbol?.toLowerCase().includes(term) ||
            p.stockTicker?.toLowerCase().includes(term)
        )
      : pools;

    const keyFn: Record<SortKey, (p: Pool) => number> = {
      score: (p) => p.score.total,
      risk: (p) => p.risk.value,
      priceChange1h: (p) => p.priceChange1h ?? p.priceChange.h1 ?? -Infinity,
      volume24h: (p) => p.volume.h24,
      liquidity: (p) => p.liquidityUsd,
      premium: (p) => (p.premiumPct == null ? -Infinity : Math.abs(p.premiumPct)),
      age: (p) => p.ageMs ?? Infinity,
    };

    return [...filtered].sort((a, b) => {
      const signalDiff = SIGNAL_RANK[b.signalStatus] - SIGNAL_RANK[a.signalStatus];
      if (signalDiff !== 0) return signalDiff;
      return (keyFn[sortKey](b) - keyFn[sortKey](a)) * sortDir;
    });
  }, [pools, search, sortKey, sortDir]);
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: 1 | -1;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === activeKey;
  return (
    <th className={clsx("select-none whitespace-nowrap px-3 py-2 text-left font-medium", className)}>
      <button
        onClick={() => onSort(sortKey)}
        className={clsx(
          "inline-flex items-center gap-1 hover:text-[var(--color-text)]",
          active ? "text-[var(--color-text)]" : "text-[var(--color-text-faint)]"
        )}
      >
        {label}
        {active ? dir === 1 ? <ArrowDown size={11} /> : <ArrowUp size={11} /> : <ArrowUpDown size={11} className="opacity-40" />}
      </button>
    </th>
  );
}

export function PoolTable({ pools, onSelectPool }: { pools: Pool[]; onSelectPool: (pool: Pool) => void }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const rows = useSortedFiltered(pools, search, sortKey, sortDir);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
        <Search size={14} className="text-[var(--color-text-faint)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by symbol or name…"
          className="w-full bg-transparent text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] focus:outline-none"
        />
        <span className="whitespace-nowrap text-xs text-[var(--color-text-faint)]">{rows.length} pools</span>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No pools match this view" description="Try clearing the filter or switching presets." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-faint)]">
                <th className="px-3 py-2 text-left font-medium">Signal</th>
                <th className="px-3 py-2 text-left font-medium">Token</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <SortHeader label="1h" sortKey="priceChange1h" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                <SortHeader label="Premium" sortKey="premium" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                <SortHeader label="Vol 24h" sortKey="volume24h" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="hidden text-right sm:table-cell" />
                <SortHeader label="Liquidity" sortKey="liquidity" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="hidden text-right md:table-cell" />
                <SortHeader label="Score" sortKey="score" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="hidden text-left md:table-cell" />
                <SortHeader label="Risk" sortKey="risk" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Age" sortKey="age" activeKey={sortKey} dir={sortDir} onSort={handleSort} className="hidden text-right sm:table-cell" />
                <th className="hidden px-3 py-2 text-right font-medium lg:table-cell">Chart</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((pool) => (
                <tr
                  key={pool.address}
                  onClick={() => onSelectPool(pool)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectPool(pool);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`View details for ${pool.baseToken.symbol ?? pool.address}`}
                  className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-raised)] focus-visible:bg-[var(--color-surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
                >
                  <td className="px-3 py-2.5">
                    <SignalBadge status={pool.signalStatus} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 font-medium text-[var(--color-text)]">
                          <span>
                            {pool.baseToken.symbol ?? "?"}
                            <span className="text-[var(--color-text-faint)]"> / {pool.quoteToken.symbol ?? "?"}</span>
                          </span>
                          {pool.isTokenizedStock && (
                            <span className="rounded border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-1 text-[10px] font-semibold text-[var(--color-accent)]">
                              {pool.stockTicker}
                            </span>
                          )}
                        </div>
                        <div className="max-w-[200px] truncate text-[11px] text-[var(--color-text-faint)]">
                          {pool.baseToken.name}
                          {pool.dexId ? ` · ${pool.dexId}` : ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatPrice(pool.priceUsd)}</td>
                  <td
                    className={clsx(
                      "px-3 py-2.5 text-right tabular-nums",
                      (pool.priceChange1h ?? pool.priceChange.h1 ?? 0) >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"
                    )}
                  >
                    {formatPct(pool.priceChange1h ?? pool.priceChange.h1, { signed: true })}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <PremiumBadge premiumPct={pool.premiumPct} />
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-[var(--color-text-dim)] sm:table-cell">
                    {formatUsd(pool.volume.h24)}
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-[var(--color-text-dim)] md:table-cell">
                    {formatUsd(pool.liquidityUsd)}
                  </td>
                  <td className="hidden px-3 py-2.5 md:table-cell">
                    <ScoreBar value={pool.score.total} showValue={false} size="sm" />
                  </td>
                  <td className="px-3 py-2.5">
                    <RiskBadge value={pool.risk.value} />
                  </td>
                  <td className="hidden px-3 py-2.5 text-right tabular-nums text-[var(--color-text-dim)] sm:table-cell">
                    {formatAge(pool.ageMs)}
                  </td>
                  <td className="hidden px-3 py-2.5 lg:table-cell">
                    <Sparkline data={pool.sparkline} className="h-7 w-20" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
