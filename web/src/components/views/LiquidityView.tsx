import { useMemo, useState } from "react";
import { ChevronDown, Droplets, TriangleAlert } from "lucide-react";
import clsx from "clsx";
import type { Pool, LpMetrics, LpPresetKey, LpVerdict, LpRangeBand } from "../../api/types";
import { formatPct, formatUsd, humanizeFlag } from "../../lib/format";
import { poolLabel } from "../../lib/poolMath";
import { Chip, Eyebrow, Panel, Segmented, Stat } from "../ui/primitives";
import { EmptyState } from "../ui/states";

/* -------------------------------------------------------------------------- */
/* Verdict presentation                                                        */
/* -------------------------------------------------------------------------- */

const VERDICT: Record<LpVerdict, { label: string; className: string; blurb: string }> = {
  covers: {
    label: "Covers",
    className: "text-bloom border-bloom/35 bg-bloom/10",
    blurb: "Fee income cleared LVR by more than the error band.",
  },
  shortfall: {
    label: "Shortfall",
    className: "text-flare border-flare/35 bg-flare/10",
    blurb: "LVR outran fee income. Holding the pair beat providing it.",
  },
  inconclusive: {
    label: "Inconclusive",
    className: "text-txt-1 border-line-2 bg-ink-2",
    blurb: "The edge sits inside the error band — not distinguishable from zero.",
  },
  unmeasured: {
    label: "Unmeasured",
    className: "text-txt-2 border-line bg-ink-1",
    blurb: "No hourly candles, so LVR can't be estimated at all.",
  },
};

/**
 * Annualising a daily edge is a convenience projection, not a forecast — and
 * past a certain magnitude it stops meaning anything (a position losing 600 bp
 * a day does not survive to compound for a year). Beyond the cap this shows a
 * bound rather than a spurious six-figure percentage. The bp/day figure next
 * to it is the actual measurement.
 */
const EDGE_APR_DISPLAY_CAP = 1000;

function formatEdgeApr(value: number | null): string {
  if (value == null) return "—";
  if (value > EDGE_APR_DISPLAY_CAP) return `>+${EDGE_APR_DISPLAY_CAP}%`;
  if (value < -EDGE_APR_DISPLAY_CAP) return `<−${EDGE_APR_DISPLAY_CAP}%`;
  return formatPct(value, { signed: true });
}

function VerdictPill({ verdict }: { verdict: LpVerdict }) {
  const v = VERDICT[verdict];
  return (
    <span
      title={v.blurb}
      className={clsx(
        "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        v.className
      )}
    >
      {v.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Edge bar — net edge with its error whisker, centred on zero                 */
/* -------------------------------------------------------------------------- */

/**
 * Signed log position on the track. Net edges across a scan span three orders
 * of magnitude — a healthy pool sits near +10 bp/day while a doomed one runs
 * to −60,000 — so a linear scale collapses every ordinary bar to a hairline
 * against the worst outlier. Symlog keeps small edges legible without cropping
 * the extremes, and preserves sign, so "the whisker crosses zero" still reads
 * exactly as it should.
 */
function symlogPct(value: number, scale: number): number {
  if (value === 0) return 0;
  const norm = Math.log10(1 + Math.abs(value)) / Math.log10(1 + scale);
  return Math.sign(value) * Math.min(1, norm) * 50; // 50% == half the track
}

/**
 * The one chart that answers the question. A bar from zero to the net edge,
 * with a whisker spanning +/- the margin. When the whisker crosses zero the
 * result is not significant, and the bar renders muted to say so — the same
 * convention every error bar in science uses, applied to a yield number that
 * is usually quoted with no error bar at all.
 */
function EdgeBar({ metrics, scale }: { metrics: LpMetrics; scale: number }) {
  const edge = metrics.netEdgeDailyBps;
  const margin = metrics.netEdgeMarginBps ?? 0;

  if (edge == null) {
    return <div className="h-6 rounded bg-ink-2" title="Not measurable" aria-hidden />;
  }

  const edgePct = symlogPct(edge, scale);
  const loPct = symlogPct(edge - margin, scale);
  const hiPct = symlogPct(edge + margin, scale);

  const significant = metrics.verdict === "covers" || metrics.verdict === "shortfall";
  const positive = edge >= 0;
  const barColor = !significant ? "bg-txt-2/35" : positive ? "bg-bloom" : "bg-flare";

  const barLeft = positive ? 50 : 50 + edgePct;
  const barWidth = Math.abs(edgePct);

  return (
    <div
      className="relative h-6 w-full overflow-hidden rounded bg-ink-2"
      title={`Net edge ${edge.toFixed(1)} bp/day, 95% band ±${margin.toFixed(1)} (log scale)`}
    >
      {/* error whisker */}
      <div
        className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-txt-2/45"
        style={{ left: `${50 + loPct}%`, width: `${Math.max(0.5, hiPct - loPct)}%` }}
      />
      {/* net edge bar */}
      <div
        className={clsx("absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm", barColor)}
        style={{ left: `${barLeft}%`, width: `${Math.max(0.6, barWidth)}%` }}
      />
      {/* zero line, drawn last so it always reads */}
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line-2" />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Range ladder                                                                */
/* -------------------------------------------------------------------------- */

function RangeLadder({ ranges, horizonHours }: { ranges: LpRangeBand[]; horizonHours: number }) {
  return (
    <div>
      <Eyebrow>Range bands over {horizonHours}h, from measured volatility</Eyebrow>
      <table className="mt-2 w-full text-[11px]">
        <thead>
          <tr className="text-txt-2">
            <th className="pb-1 text-left font-medium">Band</th>
            <th className="pb-1 text-right font-medium">Width</th>
            <th className="pb-1 text-right font-medium">Holds</th>
            <th className="pb-1 text-right font-medium">Split</th>
          </tr>
        </thead>
        <tbody className="num">
          {ranges.map((r) => (
            <tr key={r.band} className="border-t border-line">
              <td className="py-1 text-left capitalize text-txt-1">
                {r.band} <span className="text-txt-2">({r.sigmaMultiple}σ)</span>
              </td>
              <td className="py-1 text-right text-txt-0">±{r.halfWidthPct?.toFixed(1)}%</td>
              <td className="py-1 text-right text-txt-1">
                {r.holdProbability == null ? "—" : `${(r.holdProbability * 100).toFixed(0)}%`}
              </td>
              <td className="py-1 text-right text-txt-2">{r.allocationPct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-relaxed text-txt-2">
        "Holds" is the chance price never leaves the band over the horizon — a path probability, not an
        endpoint one, which is why a ±1σ band holds ~36% of the time rather than the ~68% the bell curve
        suggests.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Expanded detail                                                             */
/* -------------------------------------------------------------------------- */

function DetailRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 first:border-t-0">
      <span className="text-[11px] text-txt-2" title={hint}>
        {label}
      </span>
      <span className="num text-[12px] font-medium text-txt-0">{value}</span>
    </div>
  );
}

function PoolDetail({ pool }: { pool: Pool }) {
  const m = pool.lp.metrics;

  return (
    <div className="grid gap-5 border-t border-line bg-ink-1/60 px-4 py-4 lg:grid-cols-3">
      <div>
        <Eyebrow>Fee engine vs. the cost of being passive</Eyebrow>
        <div className="mt-2">
          <DetailRow
            label="Turnover (24h vol / TVL)"
            value={m.turnover == null ? "—" : `${m.turnover.toFixed(2)}×`}
            hint="How much fee-generating flow each dollar of liquidity supports"
          />
          <DetailRow
            label={`Fee tier${m.feeTierKnown ? "" : " (assumed)"}`}
            value={`${m.feeTierBps} bp`}
          />
          <DetailRow label="Fee income" value={`${m.feeYieldDailyPct?.toFixed(3) ?? "—"} %/day`} />
          <DetailRow
            label="LVR cost"
            value={m.lvrDailyPct == null ? "—" : `−${m.lvrDailyPct.toFixed(3)} %/day`}
            hint="Loss versus rebalancing: σ²/8 per day. Realised continuously and never recovered."
          />
          <DetailRow
            label="Net edge"
            value={
              m.netEdgeDailyBps == null
                ? "—"
                : `${m.netEdgeDailyBps > 0 ? "+" : ""}${m.netEdgeDailyBps.toFixed(1)} ± ${m.netEdgeMarginBps?.toFixed(1)} bp/day`
            }
          />
          <DetailRow
            label="Daily volatility"
            value={
              m.sigmaDailyPct == null ? "—" : `${m.sigmaDailyPct.toFixed(2)}% (n=${m.volatilitySamples})`
            }
          />
        </div>
      </div>

      <div>
        <Eyebrow>What your ticket actually earns</Eyebrow>
        <div className="mt-2">
          <DetailRow label="Headline fee APR" value={formatPct(m.feeAprPct)} />
          <DetailRow
            label={`APR after a ${formatUsd(m.ticketUsd)} deposit`}
            value={formatPct(m.projectedAprPct)}
            hint="Your own capital dilutes the yield per dollar that attracted you"
          />
          <DetailRow
            label="Retained"
            value={m.aprRetentionPct == null ? "—" : `${m.aprRetentionPct.toFixed(0)}%`}
          />
          <DetailRow
            label="Deposit that halves APR"
            value={formatUsd(m.aprHalvingDepositUsd)}
            hint="Equal to current TVL — that much new capital cuts the rate in two"
          />
          <DetailRow
            label="Flow (buys / sells)"
            value={m.flow ? `${m.flow.buys} / ${m.flow.sells}` : "—"}
          />
          <DetailRow
            label="Directional imbalance"
            value={m.flowImbalance == null ? "—" : `${(m.flowImbalance * 100).toFixed(0)}%`}
            hint="0% is balanced two-way flow. High means you are the counterparty in one direction."
          />
        </div>

        {m.session && (
          <p className="mt-3 rounded-md border border-line bg-ink-2 px-2.5 py-2 text-[11px] leading-relaxed text-txt-1">
            <span className="font-medium text-txt-0">Equity session: {m.session.phase}.</span>{" "}
            {m.session.open
              ? "The tracked market is open, so the token price has a live anchor."
              : "The token keeps trading while the exchange is shut. News accumulates and arrives as a jump at the open — an LP quotes through that gap without being able to reprice."}
          </p>
        )}
      </div>

      <div>
        {m.ranges ? (
          <RangeLadder ranges={m.ranges} horizonHours={m.horizonHours} />
        ) : (
          <p className="text-[11px] leading-relaxed text-txt-2">
            No range guidance — volatility couldn't be measured for this pool, and a band width is only
            meaningful relative to measured volatility.
          </p>
        )}

        {m.caveats.length > 0 && (
          <div className="mt-4">
            <Eyebrow>What this rests on</Eyebrow>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {m.caveats.map((c) => (
                <span
                  key={c}
                  className={clsx(
                    "rounded border px-1.5 py-0.5 text-[10px]",
                    c === "apr_mirage"
                      ? "border-flare/40 bg-flare/10 text-flare"
                      : "border-line-2 bg-ink-2 text-txt-2"
                  )}
                >
                  {humanizeFlag(c)}
                </span>
              ))}
            </div>
          </div>
        )}

        {pool.lpGate.misses.length > 0 && (
          <p className="mt-3 text-[11px] leading-relaxed text-txt-2">
            Fails the current posture on: {pool.lpGate.misses.map(humanizeFlag).join(", ").toLowerCase()}.
          </p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* View                                                                        */
/* -------------------------------------------------------------------------- */

type SortKey = "netEdge" | "lpScore" | "feeApr";

const POSTURE_BLURB: Record<LpPresetKey, string> = {
  harvest: "Aggressive — high turnover and narrow bands, accepting volatility when fees genuinely pay for it.",
  carry: "Balanced — demands a proven edge over LVR on a pool deep enough to hold a real position.",
  vault: "Defensive — calm pairs, deep books, proven edge. Refuses anything it cannot measure.",
};

export function LiquidityView({
  pools,
  lpPreset,
  onLpPresetChange,
  onSelectPool,
}: {
  pools: Pool[];
  lpPreset: LpPresetKey;
  onLpPresetChange: (key: LpPresetKey) => void;
  onSelectPool: (pool: Pool) => void;
}) {
  const [sort, setSort] = useState<SortKey>("netEdge");
  const [onlyPassing, setOnlyPassing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (address: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });

  const { rows, stats, scale } = useMemo(() => {
    const withLp = pools.filter((p) => p.lp);

    const counts = { covers: 0, shortfall: 0, inconclusive: 0, unmeasured: 0 };
    let mirages = 0;
    for (const p of withLp) {
      counts[p.lp.metrics.verdict]++;
      if (p.lp.metrics.caveats.includes("apr_mirage")) mirages++;
    }

    const visible = onlyPassing ? withLp.filter((p) => p.lpGate?.passed) : withLp;

    const sorted = [...visible].sort((a, b) => {
      const pick = (p: Pool) =>
        sort === "netEdge"
          ? p.lp.metrics.netEdgeDailyBps
          : sort === "feeApr"
            ? p.lp.metrics.feeAprPct
            : p.lp.total;
      const av = pick(a);
      const bv = pick(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // unmeasured sinks, never floats
      if (bv == null) return -1;
      return bv - av;
    });

    // Shared bar scale so every row is comparable at a glance.
    const widest = Math.max(
      ...withLp.map((p) => {
        const m = p.lp.metrics;
        if (m.netEdgeDailyBps == null) return 0;
        return Math.abs(m.netEdgeDailyBps) + (m.netEdgeMarginBps ?? 0);
      }),
      10
    );

    return {
      rows: sorted,
      stats: { ...counts, mirages, measured: withLp.length - counts.unmeasured, total: withLp.length },
      scale: widest,
    };
  }, [pools, sort, onlyPassing]);

  if (stats.total === 0) {
    return (
      <div className="panel">
        <EmptyState
          title="No pools scored for liquidity provision yet"
          description="The LP model needs a completed scan. Once pools arrive, each one is measured for fee income against LVR."
          icon={<Droplets size={18} aria-hidden />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Fees cover LVR"
          value={stats.covers}
          tone={stats.covers > 0 ? "bloom" : undefined}
          hint={`of ${stats.measured} measurable pools`}
        />
        <Stat
          label="Fees fall short"
          value={stats.shortfall}
          tone={stats.shortfall > 0 ? "flare" : undefined}
          hint="Holding the pair beat providing it"
        />
        <Stat
          label="Inconclusive"
          value={stats.inconclusive}
          hint="Edge inside the error band — no call either way"
        />
        <Stat
          label="APR mirages"
          value={stats.mirages}
          tone={stats.mirages > 0 ? "flare" : undefined}
          icon={stats.mirages > 0 ? <TriangleAlert size={14} aria-hidden /> : undefined}
          hint="Triple-digit APR that its own LVR eats"
        />
      </div>

      <Panel
        title="Providing posture"
        action={
          <Segmented<LpPresetKey>
            value={lpPreset}
            onChange={onLpPresetChange}
            size="sm"
            ariaLabel="LP posture"
            options={[
              { value: "harvest", label: "Harvest" },
              { value: "carry", label: "Carry" },
              { value: "vault", label: "Vault" },
            ]}
          />
        }
      >
        <p className="px-4 py-2.5 text-[12px] leading-relaxed text-txt-2">{POSTURE_BLURB[lpPreset]}</p>
      </Panel>

      <Panel
        title="Fee income against LVR"
        action={
          <div className="flex items-center gap-2">
            <Chip active={onlyPassing} onClick={() => setOnlyPassing((v) => !v)}>
              Passing only
            </Chip>
            <Segmented<SortKey>
              value={sort}
              onChange={setSort}
              size="sm"
              ariaLabel="Sort by"
              options={[
                { value: "netEdge", label: "Net edge" },
                { value: "lpScore", label: "LP score" },
                { value: "feeApr", label: "Fee APR" },
              ]}
            />
          </div>
        }
      >
        <p className="border-b border-line px-4 py-2.5 text-[12px] leading-relaxed text-txt-2">
          Each bar is the daily net edge — fee income minus LVR — with a 95% error whisker, on a signed log
          scale so a +10 bp pool stays visible next to a −60,000 bp one. A whisker crossing the zero line
          means the pool's edge is not distinguishable from nothing, however large its advertised APR.
          Estimates from public aggregate data, not swap-level accounting.
        </p>

        {rows.length === 0 ? (
          <EmptyState
            title="No pool passes this posture"
            description="Nothing in the current scan clears every threshold. Loosen the posture or clear the filter to see what came close."
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((pool) => {
              const m = pool.lp.metrics;
              const isOpen = expanded.has(pool.address);
              return (
                <li key={pool.address}>
                  <div
                    className={clsx(
                      "grid w-full grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] items-center gap-4 px-4 py-3",
                      isOpen && "bg-ink-2/50"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        onClick={() => toggle(pool.address)}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Collapse" : "Expand"} liquidity detail for ${poolLabel(pool)}`}
                        className="shrink-0 rounded p-0.5 text-txt-2 transition-colors hover:bg-ink-3 hover:text-txt-0"
                      >
                        <ChevronDown
                          size={14}
                          className={clsx("transition-transform", isOpen && "rotate-180")}
                          aria-hidden
                        />
                      </button>
                      <div className="min-w-0">
                        <button
                          onClick={() => onSelectPool(pool)}
                          className="truncate text-left text-[13px] font-medium text-txt-0 hover:text-reticle"
                        >
                          {poolLabel(pool)}
                        </button>
                        <p className="num mt-0.5 text-[10px] text-txt-2">
                          {formatUsd(pool.liquidityUsd)} TVL
                          {m.sigmaDailyPct != null && <> · σ {m.sigmaDailyPct.toFixed(1)}%/d</>}
                          {!pool.lpGate?.passed && <span className="text-txt-2"> · off-posture</span>}
                        </p>
                      </div>
                    </div>

                    <div>
                      <EdgeBar metrics={m} scale={scale} />
                      <div className="num mt-1 flex items-center justify-between text-[10px] text-txt-2">
                        <span>fee {m.feeYieldDailyPct?.toFixed(2) ?? "—"}%/d</span>
                        <span>
                          {m.netEdgeDailyBps == null
                            ? "not measurable"
                            : `${m.netEdgeDailyBps > 0 ? "+" : ""}${m.netEdgeDailyBps.toFixed(1)} ± ${m.netEdgeMarginBps?.toFixed(1)} bp/d`}
                        </span>
                        <span>LVR {m.lvrDailyPct?.toFixed(2) ?? "—"}%/d</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="hidden w-28 shrink-0 text-right md:block">
                        <p className="num text-[13px] font-semibold text-txt-1">
                          {m.feeAprPct != null && m.feeAprPct > EDGE_APR_DISPLAY_CAP
                            ? `>${EDGE_APR_DISPLAY_CAP}%`
                            : formatPct(m.feeAprPct)}
                        </p>
                        <p className="num text-[10px] text-txt-2">
                          headline APR{!m.feeTierKnown && <span title="Fee tier assumed at 30 bp — the feed doesn't publish it for this pool"> · est</span>}
                        </p>
                      </div>
                      <div className="w-24 shrink-0 text-right">
                        <p
                          className={clsx(
                            "num text-[15px] font-semibold",
                            m.netEdgeAprPct == null
                              ? "text-txt-2"
                              : m.netEdgeAprPct >= 0
                                ? "text-bloom"
                                : "text-flare"
                          )}
                        >
                          {formatEdgeApr(m.netEdgeAprPct)}
                        </p>
                        <p className="num text-[10px] text-txt-2">net of LVR</p>
                      </div>
                      <VerdictPill verdict={m.verdict} />
                    </div>
                  </div>

                  {isOpen && <PoolDetail pool={pool} />}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="How to read this">
        <div className="grid gap-4 px-4 py-3.5 text-[12px] leading-relaxed text-txt-2 lg:grid-cols-3">
          <div>
            <p className="mb-1 font-medium text-txt-1">Why this disagrees with the score</p>
            <p>
              The Screener's score answers "should I trade this?" and rewards momentum. This page answers
              "should I provide liquidity here?" — where momentum is the mechanism that costs you money. A
              pool can rank high on one and low on the other, on purpose.
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-txt-1">What LVR is</p>
            <p>
              Loss versus rebalancing: what it costs to quote a stale price to traders who know more than
              your pool does. It accrues at σ²/8 per day and, unlike impermanent loss, is never recovered
              when price comes back. Fee income has to clear it or holding would have been better.
            </p>
          </div>
          <div>
            <p className="mb-1 font-medium text-txt-1">Why so many read "inconclusive"</p>
            <p>
              Because the honest answer often is. Fee tiers aren't published in the feed, and volatility from
              24 hourly closes carries real error. Where the edge is smaller than that uncertainty, this says
              so rather than dressing a coin flip up as a signal.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
