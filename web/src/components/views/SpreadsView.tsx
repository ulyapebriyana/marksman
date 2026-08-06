import { useMemo } from "react";
import { Scale } from "lucide-react";
import type { Pool } from "../../api/types";
import { formatPct, formatPrice, formatUsd } from "../../lib/format";
import { poolLabel } from "../../lib/poolMath";
import { Eyebrow, Panel, Stat } from "../ui/primitives";
import { PremiumBadge, RiskBadge, SignalBadge } from "../ui/badges";
import { Sparkline, SpreadBar } from "../ui/charts";
import { EmptyState } from "../ui/states";

export function SpreadsView({ pools, onSelectPool }: { pools: Pool[]; onSelectPool: (pool: Pool) => void }) {
  const { priced, unpriced, stats } = useMemo(() => {
    const tokenized = pools.filter((p) => p.isTokenizedStock);
    const priced = tokenized
      .filter((p) => p.premiumPct != null)
      .sort((a, b) => Math.abs(b.premiumPct ?? 0) - Math.abs(a.premiumPct ?? 0));
    const unpriced = tokenized.filter((p) => p.premiumPct == null);

    const premiums = priced.map((p) => p.premiumPct ?? 0);
    const above = premiums.filter((v) => v > 0).length;
    const below = premiums.filter((v) => v < 0).length;
    const avgAbs = premiums.length > 0 ? premiums.reduce((sum, v) => sum + Math.abs(v), 0) / premiums.length : 0;

    return { priced, unpriced, stats: { above, below, avgAbs, total: tokenized.length } };
  }, [pools]);

  const maxAbs = Math.max(...priced.map((p) => Math.abs(p.premiumPct ?? 0)), 1);

  if (stats.total === 0) {
    return (
      <div className="panel">
        <EmptyState
          title="No tokenized stocks in this scan"
          description="Marksman recognises a tokenized stock by address, from data/token-map.json on the server. Add an address there and it appears here on the next scan."
          icon={<Scale size={18} aria-hidden />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tokenized pools" value={stats.total} hint={`${priced.length} with a live equity quote`} />
        <Stat
          label="Above parity"
          value={stats.above}
          tone={stats.above > 0 ? "bloom" : undefined}
          hint="Token costs more than the equity"
        />
        <Stat
          label="Below parity"
          value={stats.below}
          tone={stats.below > 0 ? "flare" : undefined}
          hint="Token costs less than the equity"
        />
        <Stat label="Average gap" value={`${stats.avgAbs.toFixed(2)}%`} hint="Mean absolute distance from parity" />
      </div>

      <Panel
        title="Gap to the tracked equity"
        action={<Eyebrow>Centre line is parity</Eyebrow>}
      >
        {priced.length === 0 ? (
          <EmptyState
            title="No equity quotes this scan"
            description="Every tokenized pool is missing its underlying price. Set STOCK_API_KEY on the server, then check System for the feed's health."
          />
        ) : (
          <ul className="divide-y divide-line">
            {priced.map((pool) => (
              <li key={pool.address}>
                <button
                  onClick={() => onSelectPool(pool)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-ink-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-[15px] font-bold tracking-tight text-txt-0">
                        {pool.stockTicker}
                      </span>
                      <SignalBadge status={pool.signalStatus} compact />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-txt-2">{pool.stockName ?? poolLabel(pool)}</p>
                  </div>

                  <div>
                    <SpreadBar premiumPct={pool.premiumPct ?? 0} maxAbs={maxAbs} />
                    <div className="num mt-1.5 flex items-center justify-between text-[10px] text-txt-2">
                      <span>on-chain {formatPrice(pool.priceUsd)}</span>
                      <span>equity {formatPrice(pool.underlyingPrice)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <Sparkline data={pool.sparkline} className="hidden h-8 w-20 shrink-0 md:block" />
                    <div className="w-20 shrink-0 text-right">
                      <p
                        className={`num text-[15px] font-semibold ${
                          (pool.premiumPct ?? 0) >= 0 ? "text-bloom" : "text-flare"
                        }`}
                      >
                        {formatPct(pool.premiumPct, { signed: true })}
                      </p>
                      <p className="num mt-0.5 text-[10px] text-txt-2">{formatUsd(pool.liquidityUsd)}</p>
                    </div>
                    <RiskBadge value={pool.risk.value} showLabel={false} />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {unpriced.length > 0 && (
        <Panel title="Missing an equity quote" action={<Eyebrow>{unpriced.length} pools</Eyebrow>}>
          <p className="border-b border-line px-4 py-2.5 text-[12px] leading-relaxed text-txt-2">
            These are recognised tokenized stocks, but no underlying price came back this scan — so the gap is reported as
            unknown rather than guessed at.
          </p>
          <ul className="divide-y divide-line">
            {unpriced.map((pool) => (
              <li key={pool.address}>
                <button
                  onClick={() => onSelectPool(pool)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-2"
                >
                  <span className="font-display w-14 shrink-0 text-[13px] font-bold tracking-tight text-txt-0">
                    {pool.stockTicker}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-txt-2">{poolLabel(pool)}</span>
                  <span className="num shrink-0 text-[12px] text-txt-1">{formatPrice(pool.priceUsd)}</span>
                  <PremiumBadge premiumPct={null} />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
