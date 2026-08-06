import { useMemo } from "react";
import { ArrowRight, Droplets, Flame, Radar, Scale, TrendingDown, TrendingUp } from "lucide-react";
import type { HistoryEntry, Pool } from "../../api/types";
import { aggregate, momentum1h, poolLabel } from "../../lib/poolMath";
import { formatPct, formatRelativeTime, formatUsd } from "../../lib/format";
import { Eyebrow, Panel, Stat } from "../ui/primitives";
import { Delta, PremiumBadge, RiskBadge, SignalBadge, StockTag } from "../ui/badges";
import { Sparkline, SpreadBar } from "../ui/charts";
import { EmptyState } from "../ui/states";
import { SpreadField, buildField } from "../SpreadField";
import { Link } from "../../lib/router";

function MoverRow({ pool, onSelect }: { pool: Pool; onSelect: (pool: Pool) => void }) {
  return (
    <button
      onClick={() => onSelect(pool)}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink-2"
    >
      <SignalBadge status={pool.signalStatus} compact />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-txt-0">{poolLabel(pool)}</span>
          {pool.isTokenizedStock && <StockTag ticker={pool.stockTicker} name={pool.stockName} />}
        </span>
        <span className="num block text-[11px] text-txt-2">{formatUsd(pool.liquidityUsd)} liquidity</span>
      </span>
      <Sparkline data={pool.sparkline} className="hidden h-7 w-16 shrink-0 sm:block" />
      <Delta value={momentum1h(pool)} className="w-16 shrink-0 justify-end text-right text-[13px]" />
    </button>
  );
}

export function OverviewView({
  pools,
  history,
  onSelectPool,
}: {
  pools: Pool[];
  history: HistoryEntry[];
  onSelectPool: (pool: Pool) => void;
}) {
  const stats = useMemo(() => aggregate(pools), [pools]);
  const field = useMemo(() => buildField(pools), [pools]);

  const { gainers, losers, spreads } = useMemo(() => {
    const withMove = pools.filter((p) => momentum1h(p) != null);
    const sorted = [...withMove].sort((a, b) => (momentum1h(b) ?? 0) - (momentum1h(a) ?? 0));
    return {
      gainers: sorted.slice(0, 5),
      losers: sorted.slice(-5).reverse(),
      spreads: pools
        .filter((p) => p.isTokenizedStock && p.premiumPct != null)
        .sort((a, b) => Math.abs(b.premiumPct ?? 0) - Math.abs(a.premiumPct ?? 0))
        .slice(0, 6),
    };
  }, [pools]);

  const maxAbsSpread = Math.max(...spreads.map((p) => Math.abs(p.premiumPct ?? 0)), 1);
  const recentSignals = history.filter((entry) => entry.to !== "none").slice(0, 6);

  return (
    <div className="space-y-4">
      {/* readouts */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Pools in scan"
          value={stats.count}
          hint={`${stats.passing} clear the active preset`}
          icon={<Radar size={14} aria-hidden />}
        />
        <Stat
          label="Hot signals"
          value={stats.hot}
          tone={stats.hot > 0 ? "flare" : undefined}
          hint={stats.watch > 0 ? `${stats.watch} more on watch` : "Nothing on watch"}
          icon={<Flame size={14} aria-hidden />}
        />
        <Stat
          label="Total liquidity"
          value={formatUsd(stats.liquidityUsd)}
          hint={`${formatUsd(stats.volume24h)} traded in 24h`}
          icon={<Droplets size={14} aria-hidden />}
        />
        <Stat
          label="Widest gap"
          value={
            stats.widestSpread?.premiumPct != null ? formatPct(stats.widestSpread.premiumPct, { signed: true }) : "—"
          }
          tone={stats.widestSpread ? ((stats.widestSpread.premiumPct ?? 0) >= 0 ? "bloom" : "flare") : undefined}
          hint={stats.widestSpread ? `${stats.widestSpread.stockTicker} vs its equity` : "No equity quotes this scan"}
          icon={<Scale size={14} aria-hidden />}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* field */}
        <Panel
          title="Spread field"
          action={<Eyebrow>Liquidity × 1h move × volume</Eyebrow>}
          bodyClassName="relative h-[300px] sm:h-[380px]"
          className="barrel"
        >
          <SpreadField nodes={field} className="absolute inset-0 h-full w-full" density={0.95} />
          <p className="pointer-events-none absolute bottom-3 right-4 max-w-[15rem] text-right text-[10px] leading-snug text-txt-2">
            Struts mark tokenized stocks. Strut length is the gap to the equity.
          </p>
        </Panel>

        {/* spreads */}
        <Panel
          title="Widest gaps"
          action={
            <Link to="/app/spreads" className="inline-flex items-center gap-1 text-[11px] text-coat hover:underline">
              All spreads <ArrowRight size={11} aria-hidden />
            </Link>
          }
        >
          {spreads.length === 0 ? (
            <EmptyState
              title="No priced tokenized stocks"
              description="Either the scan found none, or the equity feed isn't configured. Check System for source health."
              icon={<Scale size={18} aria-hidden />}
            />
          ) : (
            <ul className="divide-y divide-line">
              {spreads.map((pool) => (
                <li key={pool.address}>
                  <button
                    onClick={() => onSelectPool(pool)}
                    className="grid w-full grid-cols-[3.25rem_1fr_4.5rem] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-2"
                  >
                    <span className="font-display text-[13px] font-bold tracking-tight text-txt-0">
                      {pool.stockTicker}
                    </span>
                    <SpreadBar premiumPct={pool.premiumPct ?? 0} maxAbs={maxAbsSpread} />
                    <span className="text-right">
                      <PremiumBadge premiumPct={pool.premiumPct} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Top gainers" action={<TrendingUp size={14} className="text-bloom" aria-hidden />}>
          {gainers.length === 0 ? (
            <EmptyState title="No 1h price data yet" description="Candles arrive with the next scan." />
          ) : (
            <ul className="divide-y divide-line">
              {gainers.map((pool) => (
                <li key={pool.address}>
                  <MoverRow pool={pool} onSelect={onSelectPool} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Top decliners" action={<TrendingDown size={14} className="text-flare" aria-hidden />}>
          {losers.length === 0 ? (
            <EmptyState title="No 1h price data yet" description="Candles arrive with the next scan." />
          ) : (
            <ul className="divide-y divide-line">
              {losers.map((pool) => (
                <li key={pool.address}>
                  <MoverRow pool={pool} onSelect={onSelectPool} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Recent signals"
          action={
            <Link to="/app/signals" className="inline-flex items-center gap-1 text-[11px] text-coat hover:underline">
              All signals <ArrowRight size={11} aria-hidden />
            </Link>
          }
        >
          {recentSignals.length === 0 ? (
            <EmptyState
              title="No transitions yet"
              description="A pool crossing into watch or hot gets logged here the moment it happens."
            />
          ) : (
            <ul className="divide-y divide-line">
              {recentSignals.map((entry, i) => (
                <li key={`${entry.address}-${entry.at}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
                  <SignalBadge status={entry.to} compact />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-txt-0">{entry.symbol}</span>
                    <span className="block text-[11px] text-txt-2">
                      {entry.from} → {entry.to} · {formatRelativeTime(entry.at)}
                    </span>
                  </span>
                  {entry.risk != null && <RiskBadge value={entry.risk} showLabel={false} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
