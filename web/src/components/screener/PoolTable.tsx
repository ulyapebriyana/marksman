import clsx from "clsx";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, Star } from "lucide-react";
import type { Pool } from "../../api/types";
import type { SortKey } from "../../lib/poolMath";
import { momentum1h, poolLabel, txns24h } from "../../lib/poolMath";
import { formatAge, formatCount, formatPrice, formatUsd } from "../../lib/format";
import { Delta, PremiumBadge, RiskBadge, ScoreBar, SignalBadge, StockTag } from "../ui/badges";
import { Sparkline } from "../ui/charts";
import { EmptyState } from "../ui/states";

export type ColumnKey =
  | "price"
  | "momentum"
  | "premium"
  | "volume24h"
  | "liquidity"
  | "txns"
  | "score"
  | "risk"
  | "age"
  | "chart";

export const ALL_COLUMNS: { key: ColumnKey; label: string; sortKey?: SortKey; align: "left" | "right" }[] = [
  { key: "price", label: "Price", align: "right" },
  { key: "momentum", label: "1h", sortKey: "momentum", align: "right" },
  { key: "premium", label: "Premium", sortKey: "premium", align: "right" },
  { key: "volume24h", label: "Vol 24h", sortKey: "volume24h", align: "right" },
  { key: "liquidity", label: "Liquidity", sortKey: "liquidity", align: "right" },
  { key: "txns", label: "Txns 24h", sortKey: "txns", align: "right" },
  { key: "score", label: "Score", sortKey: "score", align: "left" },
  { key: "risk", label: "Risk", sortKey: "risk", align: "left" },
  { key: "age", label: "Age", sortKey: "age", align: "right" },
  { key: "chart", label: "1h chart", align: "right" },
];

/** Age and txns are available in the column menu; nine columns already fill a laptop. */
export const DEFAULT_COLUMNS: ColumnKey[] = [
  "price",
  "momentum",
  "premium",
  "volume24h",
  "liquidity",
  "score",
  "risk",
  "chart",
];

function SortButton({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: 1 | -1;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === activeKey;
  return (
    <button
      onClick={() => onSort(sortKey)}
      aria-label={`Sort by ${label}`}
      className={clsx(
        "inline-flex items-center gap-1 transition-colors hover:text-txt-0",
        active ? "text-txt-0" : "text-txt-2"
      )}
    >
      {label}
      {active ? (
        dir === 1 ? (
          <ArrowDown size={11} aria-hidden />
        ) : (
          <ArrowUp size={11} aria-hidden />
        )
      ) : (
        <ArrowUpDown size={11} className="opacity-35" aria-hidden />
      )}
    </button>
  );
}

export function PoolTable({
  pools,
  columns,
  density,
  sortKey,
  sortDir,
  onSort,
  onSelectPool,
  isWatched,
  onToggleWatch,
  compareIds,
  onToggleCompare,
  emptyAction,
}: {
  pools: Pool[];
  columns: ColumnKey[];
  density: "comfortable" | "compact";
  sortKey: SortKey;
  sortDir: 1 | -1;
  onSort: (key: SortKey) => void;
  onSelectPool: (pool: Pool) => void;
  isWatched: (address: string) => boolean;
  onToggleWatch: (address: string) => void;
  compareIds: string[];
  onToggleCompare: (address: string) => void;
  emptyAction?: React.ReactNode;
}) {
  const visible = ALL_COLUMNS.filter((column) => columns.includes(column.key));
  const cellY = density === "compact" ? "py-1.5" : "py-2.5";

  if (pools.length === 0) {
    return (
      <div className="panel">
        <EmptyState
          title="No pools match this view"
          description="Every pool in the scan was filtered out. Loosen a threshold, clear the search, or switch preset."
          action={emptyAction}
        />
      </div>
    );
  }

  function renderCell(pool: Pool, key: ColumnKey) {
    switch (key) {
      case "price":
        return <span className="num text-txt-0">{formatPrice(pool.priceUsd)}</span>;
      case "momentum":
        return <Delta value={momentum1h(pool)} />;
      case "premium":
        return <PremiumBadge premiumPct={pool.premiumPct} />;
      case "volume24h":
        return <span className="num text-txt-1">{formatUsd(pool.volume.h24)}</span>;
      case "liquidity":
        return <span className="num text-txt-1">{formatUsd(pool.liquidityUsd)}</span>;
      case "txns":
        return <span className="num text-txt-1">{formatCount(txns24h(pool))}</span>;
      case "score":
        return (
          <span className="flex items-center gap-1.5" title={`Score ${pool.score.total.toFixed(1)} of 100`}>
            <ScoreBar value={pool.score.total} showValue={false} size="sm" className="w-11" />
            <span className="num w-6 text-right text-[12px] text-txt-1">{pool.score.total.toFixed(0)}</span>
          </span>
        );
      case "risk":
        return <RiskBadge value={pool.risk.value} showLabel={false} />;
      case "age":
        return <span className="num text-txt-1">{formatAge(pool.ageMs)}</span>;
      case "chart":
        return <Sparkline data={pool.sparkline} className="ml-auto h-7 w-20" />;
    }
  }

  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[840px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-[11px]">
              <th scope="col" className="w-9 px-2 py-2.5">
                <span className="sr-only">Compare</span>
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-medium text-txt-2">
                Signal
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-medium text-txt-2">
                Pair
              </th>
              {visible.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={clsx(
                    "whitespace-nowrap px-2.5 py-2.5 font-medium text-txt-2",
                    column.align === "right" ? "text-right" : "text-left"
                  )}
                >
                  {column.sortKey ? (
                    <SortButton
                      label={column.label}
                      sortKey={column.sortKey}
                      activeKey={sortKey}
                      dir={sortDir}
                      onSort={onSort}
                    />
                  ) : (
                    column.label
                  )}
                </th>
              ))}
              <th scope="col" className="w-10 px-2 py-2.5">
                <span className="sr-only">Watch</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {pools.map((pool) => {
              const watched = isWatched(pool.address);
              const comparing = compareIds.includes(pool.address);
              return (
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
                  aria-label={`${poolLabel(pool)} — open details`}
                  className={clsx(
                    "group cursor-pointer border-b border-line transition-colors last:border-0",
                    "hover:bg-ink-2 focus-visible:bg-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-reticle",
                    comparing && "bg-coat/6"
                  )}
                >
                  <td className={clsx("px-2", cellY)}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleCompare(pool.address);
                      }}
                      aria-label={comparing ? `Remove ${poolLabel(pool)} from comparison` : `Add ${poolLabel(pool)} to comparison`}
                      aria-pressed={comparing}
                      className={clsx(
                        "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                        comparing ? "border-coat bg-coat text-white" : "border-line-2 text-transparent hover:border-coat"
                      )}
                    >
                      <Check size={11} strokeWidth={3} aria-hidden />
                    </button>
                  </td>

                  <td className={clsx("px-3", cellY)}>
                    <SignalBadge status={pool.signalStatus} />
                  </td>

                  <td className={clsx("px-3", cellY)}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-txt-0">
                        {pool.baseToken.symbol ?? "?"}
                        <span className="text-txt-2"> / {pool.quoteToken.symbol ?? "?"}</span>
                      </span>
                      {pool.isTokenizedStock && <StockTag ticker={pool.stockTicker} name={pool.stockName} />}
                      {!pool.presetGate.passed && (
                        <span
                          className="h-1 w-1 shrink-0 rounded-full bg-txt-2"
                          title={`Fails the preset gate: ${pool.presetGate.misses.join(", ")}`}
                          aria-hidden
                        />
                      )}
                    </div>
                    {density === "comfortable" && (
                      <p className="mt-0.5 max-w-[150px] truncate text-[11px] text-txt-2">
                        {pool.baseToken.name}
                        {pool.dexId ? ` · ${pool.dexId}` : ""}
                      </p>
                    )}
                  </td>

                  {visible.map((column) => (
                    <td
                      key={column.key}
                      className={clsx("px-2.5", cellY, column.align === "right" ? "text-right" : "text-left")}
                    >
                      {renderCell(pool, column.key)}
                    </td>
                  ))}

                  <td className={clsx("px-2", cellY)}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleWatch(pool.address);
                      }}
                      aria-label={watched ? `Unstar ${poolLabel(pool)}` : `Star ${poolLabel(pool)}`}
                      aria-pressed={watched}
                      className={clsx(
                        "rounded p-1 transition-all",
                        watched
                          ? "text-reticle opacity-100"
                          : "text-txt-2 opacity-0 hover:text-reticle focus-visible:opacity-100 group-hover:opacity-100"
                      )}
                    >
                      <Star size={14} fill={watched ? "currentColor" : "none"} aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
