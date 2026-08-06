import { useMemo } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { Pool } from "../../api/types";
import { aggregate, momentum1h, poolLabel, txns24h } from "../../lib/poolMath";
import { formatUsd, humanizeFlag } from "../../lib/format";
import { Eyebrow, Panel, Stat } from "../ui/primitives";
import { Histogram } from "../ui/charts";
import { EmptyState } from "../ui/states";

const SCATTER_COLORS = { hot: "var(--c-flare)", watch: "var(--c-reticle)", none: "var(--c-coat)" } as const;

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: { payload: ScatterPoint }[] }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-line-2 bg-ink-2 px-3 py-2 text-[12px] shadow-pop">
      <p className="font-medium text-txt-0">{point.name}</p>
      <p className="num mt-1 text-txt-2">Liquidity {formatUsd(point.liquidity)}</p>
      <p className="num text-txt-2">Volume 24h {formatUsd(point.volume)}</p>
      <p className="num text-txt-2">
        Score {point.score.toFixed(0)} · Risk {point.risk}
      </p>
    </div>
  );
}

interface ScatterPoint {
  name: string;
  liquidity: number;
  volume: number;
  score: number;
  risk: number;
  signal: keyof typeof SCATTER_COLORS;
}

function FrequencyList({
  title,
  entries,
  total,
  tone,
  empty,
}: {
  title: string;
  entries: [string, number][];
  total: number;
  tone: string;
  empty: string;
}) {
  return (
    <Panel title={title} action={<Eyebrow>{entries.length} distinct</Eyebrow>}>
      {entries.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="divide-y divide-line">
          {entries.map(([flag, count]) => (
            <li key={flag} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] text-txt-1">{humanizeFlag(flag)}</span>
                <span className="num shrink-0 text-[12px] text-txt-2">
                  {count} <span className="text-txt-2">· {((count / total) * 100).toFixed(0)}%</span>
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${(count / total) * 100}%`, background: tone }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function AnalyticsView({ pools }: { pools: Pool[] }) {
  const stats = useMemo(() => aggregate(pools), [pools]);

  const scoreBuckets = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}`, count: 0 }));
    for (const pool of pools) {
      const index = Math.min(9, Math.floor(pool.score.total / 10));
      buckets[index].count += 1;
    }
    return buckets;
  }, [pools]);

  const riskBuckets = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({ label: `${i * 10}`, count: 0 }));
    for (const pool of pools) {
      const index = Math.min(9, Math.floor(pool.risk.value / 10));
      buckets[index].count += 1;
    }
    return buckets;
  }, [pools]);

  const scatter = useMemo<ScatterPoint[]>(
    () =>
      pools
        .filter((pool) => pool.liquidityUsd > 0 && pool.volume.h24 > 0)
        .map((pool) => ({
          name: poolLabel(pool),
          liquidity: pool.liquidityUsd,
          volume: pool.volume.h24,
          score: pool.score.total,
          risk: pool.risk.value,
          signal: pool.signalStatus,
        })),
    [pools]
  );

  const riskFlags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pool of pools) {
      for (const flag of pool.risk.flags) counts.set(flag, (counts.get(flag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [pools]);

  const gateMisses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pool of pools) {
      for (const miss of pool.presetGate.misses) counts.set(miss, (counts.get(miss) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [pools]);

  const totalTxns = useMemo(() => pools.reduce((sum, pool) => sum + txns24h(pool), 0), [pools]);
  const movers = useMemo(() => pools.filter((p) => momentum1h(p) != null).length, [pools]);

  if (pools.length === 0) {
    return (
      <div className="panel">
        <EmptyState title="Nothing to analyse yet" description="Analytics fill in once a scan returns pools." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Average score" value={stats.avgScore.toFixed(1)} hint="Across every pool in the scan" />
        <Stat
          label="Average risk"
          value={stats.avgRisk.toFixed(1)}
          tone={stats.avgRisk >= 60 ? "flare" : stats.avgRisk >= 30 ? "reticle" : "bloom"}
          hint="Lower is safer"
        />
        <Stat label="Trades in 24h" value={totalTxns.toLocaleString()} hint="Buys and sells across all pools" />
        <Stat
          label="With 1h candles"
          value={`${movers}/${pools.length}`}
          hint="The rest fall back to DexScreener's 1h number"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Score distribution" action={<Eyebrow>0 → 100</Eyebrow>} bodyClassName="px-4 pb-4 pt-5">
          <Histogram
            buckets={scoreBuckets}
            color="var(--c-coat)"
            labelFor={(bucket) => `Score ${bucket.label}–${Number(bucket.label) + 9}: ${bucket.count} pools`}
          />
        </Panel>

        <Panel title="Risk distribution" action={<Eyebrow>0 → 100</Eyebrow>} bodyClassName="px-4 pb-4 pt-5">
          <Histogram
            buckets={riskBuckets}
            color="var(--c-reticle)"
            labelFor={(bucket) => `Risk ${bucket.label}–${Number(bucket.label) + 9}: ${bucket.count} pools`}
          />
        </Panel>
      </div>

      <Panel
        title="Liquidity against 24h volume"
        action={<Eyebrow>Log scales · bubble size is score</Eyebrow>}
        bodyClassName="p-4"
      >
        {scatter.length === 0 ? (
          <EmptyState title="No pool has both liquidity and volume" />
        ) : (
          <>
            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
                  <CartesianGrid stroke="var(--c-line)" strokeDasharray="2 4" />
                  <XAxis
                    type="number"
                    dataKey="liquidity"
                    scale="log"
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => formatUsd(v)}
                    tick={{ fill: "var(--c-txt-2)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                    stroke="var(--c-line-2)"
                    label={{ value: "Liquidity", position: "insideBottom", offset: -14, fill: "var(--c-txt-2)", fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="volume"
                    scale="log"
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => formatUsd(v)}
                    tick={{ fill: "var(--c-txt-2)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                    stroke="var(--c-line-2)"
                    width={62}
                  />
                  <ZAxis type="number" dataKey="score" range={[24, 320]} />
                  <Tooltip content={<ScatterTooltip />} cursor={{ stroke: "var(--c-line-2)", strokeDasharray: "3 3" }} />
                  {(["none", "watch", "hot"] as const).map((signal) => (
                    <Scatter
                      key={signal}
                      name={signal}
                      data={scatter.filter((point) => point.signal === signal)}
                      fill={SCATTER_COLORS[signal]}
                      fillOpacity={0.55}
                      stroke={SCATTER_COLORS[signal]}
                      isAnimationActive={false}
                    />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-txt-2">
              Pools above the diagonal trade more than their depth suggests — high turnover, which scores well on fee
              efficiency but often comes with thin liquidity. Colour is the signal state; size is the score.
            </p>
          </>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FrequencyList
          title="Most common risk flags"
          entries={riskFlags}
          total={pools.length}
          tone="var(--c-reticle)"
          empty="No risk flags raised across the scan"
        />
        <FrequencyList
          title="Why pools fail the preset gate"
          entries={gateMisses}
          total={pools.length}
          tone="var(--c-flare)"
          empty="Every pool clears the active preset"
        />
      </div>
    </div>
  );
}
