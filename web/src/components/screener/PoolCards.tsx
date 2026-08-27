import clsx from "clsx";
import { Check, Star } from "lucide-react";
import type { Pool } from "../../api/types";
import { momentum1h, poolLabel, turnover } from "../../lib/poolMath";
import { formatAge, formatPrice, formatUsd } from "../../lib/format";
import { Delta, PremiumBadge, RiskBadge, ScoreBar, SignalBadge, StockTag } from "../ui/badges";
import { Sparkline } from "../ui/charts";
import { EmptyState } from "../ui/states";
import { PoolLinks } from "../ui/PoolLinks";

export function PoolCards({
  pools,
  onSelectPool,
  isWatched,
  onToggleWatch,
  compareIds,
  onToggleCompare,
  emptyAction,
}: {
  pools: Pool[];
  onSelectPool: (pool: Pool) => void;
  isWatched: (address: string) => boolean;
  onToggleWatch: (address: string) => void;
  compareIds: string[];
  onToggleCompare: (address: string) => void;
  emptyAction?: React.ReactNode;
}) {
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

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {pools.map((pool) => {
        const watched = isWatched(pool.address);
        const comparing = compareIds.includes(pool.address);
        const rate = turnover(pool);

        return (
          <article
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
              "group panel cursor-pointer p-4 transition-all duration-150",
              "hover:border-line-2 hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-reticle",
              comparing && "border-coat/60"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="truncate text-[14px] font-semibold text-txt-0">
                    {pool.baseToken.symbol ?? "?"}
                    <span className="text-txt-2"> / {pool.quoteToken.symbol ?? "?"}</span>
                  </h3>
                  {pool.isTokenizedStock && <StockTag ticker={pool.stockTicker} name={pool.stockName} />}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                  <p className="min-w-0 truncate text-[11px] text-txt-2">
                    {pool.baseToken.name}
                    {pool.dexId ? ` · ${pool.dexId}` : ""}
                  </p>
                  <PoolLinks pool={pool} />
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCompare(pool.address);
                  }}
                  aria-label={comparing ? "Remove from comparison" : "Add to comparison"}
                  aria-pressed={comparing}
                  className={clsx(
                    "flex h-5 w-5 items-center justify-center rounded border transition-colors",
                    comparing
                      ? "border-coat bg-coat text-white"
                      : "border-line-2 text-transparent opacity-0 hover:border-coat focus-visible:opacity-100 group-hover:opacity-100"
                  )}
                >
                  <Check size={12} strokeWidth={3} aria-hidden />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleWatch(pool.address);
                  }}
                  aria-label={watched ? "Unstar pool" : "Star pool"}
                  aria-pressed={watched}
                  className={clsx(
                    "rounded p-0.5 transition-all",
                    watched
                      ? "text-reticle"
                      : "text-txt-2 opacity-0 hover:text-reticle focus-visible:opacity-100 group-hover:opacity-100"
                  )}
                >
                  <Star size={14} fill={watched ? "currentColor" : "none"} aria-hidden />
                </button>
              </div>
            </div>

            <div className="mt-3.5 flex items-end justify-between gap-3">
              <div>
                <SignalBadge status={pool.signalStatus} />
                {/* formatPrice, not formatUsd — most of these tokens trade well
                    below a cent and would round to a meaningless $0.00. */}
                <p className="num mt-1 truncate text-xl font-semibold leading-none text-txt-0">
                  {formatPrice(pool.priceUsd)}
                </p>
                <Delta value={momentum1h(pool)} className="mt-1.5 text-[12px]" />
              </div>
              <Sparkline data={pool.sparkline} className="h-10 w-28 shrink-0" />
            </div>

            <div className="mt-3.5 space-y-2 border-t border-line pt-3">
              <ScoreBar value={pool.score.total} label="Score" size="sm" />
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <p className="engraved text-txt-2">Liquidity</p>
                  <p className="num mt-1 text-[12px] text-txt-1">{formatUsd(pool.liquidityUsd)}</p>
                </div>
                <div>
                  <p className="engraved text-txt-2">Vol 24h</p>
                  <p className="num mt-1 text-[12px] text-txt-1">
                    {formatUsd(pool.volume.h24)}
                    {rate != null && rate >= 0.1 && <span className="text-txt-2"> · {rate.toFixed(1)}×</span>}
                  </p>
                </div>
                <div>
                  <p className="engraved text-txt-2">{pool.isTokenizedStock ? "Premium" : "Age"}</p>
                  <p className="num mt-1 text-[12px] text-txt-1">
                    {pool.isTokenizedStock ? <PremiumBadge premiumPct={pool.premiumPct} /> : formatAge(pool.ageMs)}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
              <RiskBadge value={pool.risk.value} />
              <span className="text-[11px] text-txt-2">
                {pool.presetGate.passed ? (
                  <span className="text-bloom">Passes gate</span>
                ) : (
                  `Fails ${pool.presetGate.misses.length} gate${pool.presetGate.misses.length === 1 ? "" : "s"}`
                )}
              </span>
            </div>
          </article>
        );
      })}
    </div>
  );
}
