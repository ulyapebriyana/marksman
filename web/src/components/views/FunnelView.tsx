import { useMemo, useState } from "react";
import { ChevronDown, Filter, ShieldCheck } from "lucide-react";
import clsx from "clsx";
import type { FunnelCheck, FunnelCheckStatus, FunnelVerdict, Pool } from "../../api/types";
import { formatUsd, humanizeFlag } from "../../lib/format";
import { poolLabel } from "../../lib/poolMath";
import { Eyebrow, Panel, Segmented } from "../ui/primitives";
import { EmptyState } from "../ui/states";

/* -------------------------------------------------------------------------- */
/* Verdict + check presentation                                               */
/* -------------------------------------------------------------------------- */

const VERDICT: Record<FunnelVerdict, { label: string; className: string; blurb: string }> = {
  candidate: {
    label: "Candidate",
    className: "text-bloom border-bloom/35 bg-bloom/10",
    blurb: "Clears every gate: safe on what's checkable, sustained volume, healthy fee/TVL, best pool for its token.",
  },
  watch: {
    label: "Watch",
    className: "text-txt-1 border-line-2 bg-ink-2",
    blurb: "Passes the safety gates but falls short on fee/TVL efficiency or pair quality today.",
  },
  rejected: {
    label: "Rejected",
    className: "text-flare border-flare/35 bg-flare/10",
    blurb: "Fails token security or volume sustainability — the two hard gates.",
  },
};

const CHECK_STATUS: Record<FunnelCheckStatus, { label: string; className: string }> = {
  pass: { label: "Pass", className: "text-bloom" },
  fail: { label: "Fail", className: "text-flare" },
  unverifiable: { label: "Unverifiable", className: "text-txt-2" },
  reminder: { label: "Your call", className: "text-coat" },
};

function VerdictPill({ verdict }: { verdict: FunnelVerdict }) {
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

function CheckRow({ check }: { check: FunnelCheck }) {
  const s = CHECK_STATUS[check.status];
  return (
    <div className="flex items-start justify-between gap-3 border-t border-line py-1.5 first:border-t-0">
      <span className="max-w-[60%] text-[11px] leading-snug text-txt-1">{check.label}</span>
      <span className="flex flex-col items-end text-right">
        <span className={clsx("text-[11px] font-medium", s.className)}>{s.label}</span>
        <span className="max-w-[220px] text-[10px] leading-snug text-txt-2">{check.detail}</span>
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Funnel pipeline — cumulative counts through each stage                     */
/* -------------------------------------------------------------------------- */

const STAGE_DEFS = [
  { key: "security", label: "Token security" },
  { key: "volume", label: "Volume sustainability" },
  { key: "feeTvl", label: "Fee/TVL efficiency" },
  { key: "pairQuality", label: "Pair quality" },
] as const;

function FunnelPipeline({ counts, total }: { counts: number[]; total: number }) {
  return (
    <div className="space-y-2.5 px-4 py-3.5">
      {STAGE_DEFS.map((stage, i) => {
        const count = counts[i];
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={stage.key}>
            <div className="mb-1 flex items-baseline justify-between text-[11px]">
              <span className="text-txt-1">
                {i + 1}. {stage.label}
              </span>
              <span className="num text-txt-2">
                {count} / {total}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-ink-2">
              <div
                className={clsx("h-full rounded", count === 0 ? "bg-txt-2/35" : "bg-reticle")}
                style={{ width: `${Math.max(count > 0 ? 1.5 : 0, pct)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Expanded detail                                                            */
/* -------------------------------------------------------------------------- */

function FunnelDetail({ pool }: { pool: Pool }) {
  const f = pool.funnel;

  return (
    <div className="grid gap-5 border-t border-line bg-ink-1/60 px-4 py-4 lg:grid-cols-3">
      <div>
        <Eyebrow>Decision checklist</Eyebrow>
        <div className="mt-2">
          {f.checklist.map((item) => (
            <CheckRow key={item.key} check={item} />
          ))}
        </div>
      </div>

      <div>
        <Eyebrow>Volume continuity</Eyebrow>
        <p className="mt-1.5 text-[11px] leading-relaxed text-txt-1">
          Read: <span className="font-medium text-txt-0">{f.volume.continuity.replace(/_/g, " ")}</span>.{" "}
          {f.volume.continuity === "spike_only"
            ? "5-minute volume dramatically outruns the trailing hour — likely hype or wash volume, not sustained flow."
            : f.volume.continuity === "sustained"
              ? "5m, 1h, and 24h all corroborate each other."
              : "Not enough recent activity to call it either way yet."}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border border-line bg-ink-2 px-2 py-1.5">
            <p className="engraved text-txt-2">5m run-rate</p>
            <p className="num mt-1 text-[12px] text-txt-0">{formatUsd(f.volume.metrics.runRate5m)}</p>
          </div>
          <div className="rounded-md border border-line bg-ink-2 px-2 py-1.5">
            <p className="engraved text-txt-2">1h run-rate</p>
            <p className="num mt-1 text-[12px] text-txt-0">{formatUsd(f.volume.metrics.runRate1h)}</p>
          </div>
          <div className="rounded-md border border-line bg-ink-2 px-2 py-1.5">
            <p className="engraved text-txt-2">24h actual</p>
            <p className="num mt-1 text-[12px] text-txt-0">{formatUsd(f.volume.metrics.h24)}</p>
          </div>
        </div>

        <Eyebrow className="mt-4">Fee / TVL efficiency</Eyebrow>
        <p className="mt-1.5 text-[11px] leading-relaxed text-txt-1">
          {formatUsd(f.feeTvl.dailyFeeUsd)}/day at a {f.feeTvl.feeTierBps}bp tier
          {!f.feeTvl.feeTierKnown && " (assumed — not published)"}, {f.feeTvl.volumeToTvlRatio?.toFixed(2) ?? "—"}
          x volume/TVL —{" "}
          <span
            className={clsx(
              "font-medium",
              f.feeTvl.bucket === "suspicious"
                ? "text-flare"
                : f.feeTvl.bucket === "strong" || f.feeTvl.bucket === "healthy"
                  ? "text-bloom"
                  : "text-txt-1"
            )}
          >
            {f.feeTvl.bucket}
          </span>
          .
        </p>
        {f.caveats.includes("fee_tvl_ratio_suspicious") && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-flare">
            Above 5x is "very attractive" on paper but the methodology treats it as a wash-trading/thin-TVL
            suspect, not a green light — never promoted to Candidate on that basis alone.
          </p>
        )}
      </div>

      <div>
        <Eyebrow>Pair quality</Eyebrow>
        <p className="mt-1.5 text-[11px] leading-relaxed text-txt-1">
          Quoted in <span className="font-medium text-txt-0">{f.pairQuality.quoteSymbol || "?"}</span>
          {f.pairQuality.isStablePair ? " (a stablecoin — single-sided exposure)" : " (not a stablecoin — dual-asset exposure)"}.{" "}
          {f.pairQuality.isLargestTvlForToken
            ? "Largest-TVL pool for this token."
            : `Ranked #${f.pairQuality.tvlRank ?? "?"} of ${f.pairQuality.poolCountForToken} pools for this token by TVL.`}
        </p>

        <Eyebrow className="mt-4">Range guidance (context, not the primary number)</Eyebrow>
        <p className="mt-1.5 text-[11px] leading-relaxed text-txt-1">
          Maturity tier: <span className="font-medium text-txt-0">{f.range.tier.replace(/_/g, " ")}</span>
          {f.range.suggestedLowerRangePct && (
            <>
              {" "}
              — practitioner reference: {f.range.suggestedLowerRangePct[0]}-{f.range.suggestedLowerRangePct[1]}%
              below spot.
            </>
          )}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-txt-2">{f.range.note}</p>
        <p className="mt-2 text-[11px] leading-relaxed text-txt-2">
          The measured, sigma-based range in the Liquidity view is the number to actually size a position on —
          this is a sanity-check tier, not a replacement for it.
        </p>

        {f.security.autoFailReasons.length > 0 && (
          <p className="mt-3 rounded-md border border-flare/35 bg-flare/10 px-2.5 py-2 text-[11px] leading-relaxed text-flare">
            Auto-failed on: {f.security.autoFailReasons.map(humanizeFlag).join(", ").toLowerCase()}.
          </p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* View                                                                       */
/* -------------------------------------------------------------------------- */

type VerdictFilter = "all" | FunnelVerdict;

export function FunnelView({ pools, onSelectPool }: { pools: Pool[]; onSelectPool: (pool: Pool) => void }) {
  const [filter, setFilter] = useState<VerdictFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (address: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });

  const { rows, counts, verdictCounts, total } = useMemo(() => {
    const withFunnel = pools.filter((p) => p.funnel);
    // Cumulative, like a real funnel chart: a pool counts at stage i only if
    // it also cleared every stage before it (the underlying `stagesPassed`
    // list is per-stage, not gated on prior stages, since a pool can fail
    // security yet still show a healthy fee/TVL ratio in isolation).
    const stageCounts = STAGE_DEFS.map((_, i) => {
      const required = STAGE_DEFS.slice(0, i + 1).map((s) => s.key);
      return withFunnel.filter((p) => required.every((key) => p.funnel.stagesPassed.includes(key))).length;
    });
    const vCounts = { candidate: 0, watch: 0, rejected: 0 };
    for (const p of withFunnel) vCounts[p.funnel.verdict]++;

    const visible = filter === "all" ? withFunnel : withFunnel.filter((p) => p.funnel.verdict === filter);
    const sorted = [...visible].sort((a, b) => {
      const rank: Record<FunnelVerdict, number> = { candidate: 2, watch: 1, rejected: 0 };
      const diff = rank[b.funnel.verdict] - rank[a.funnel.verdict];
      if (diff !== 0) return diff;
      return (b.funnel.feeTvl.volumeToTvlRatio ?? 0) - (a.funnel.feeTvl.volumeToTvlRatio ?? 0);
    });

    return { rows: sorted, counts: stageCounts, verdictCounts: vCounts, total: withFunnel.length };
  }, [pools, filter]);

  if (total === 0) {
    return (
      <div className="panel">
        <EmptyState
          title="No pools run through the funnel yet"
          description="The funnel needs a completed scan. Once pools arrive, each one is gated through security, volume sustainability, fee/TVL efficiency, and pair quality — in that order."
          icon={<Filter size={18} aria-hidden />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Panel title="Security first, then yield">
        <p className="border-b border-line px-4 py-2.5 text-[12px] leading-relaxed text-txt-2">
          A sequential gate, not a weighted score — a pool that fails token security or volume sustainability is
          rejected outright, however good its fee/TVL ratio looks. Many security checks (contract verification,
          holder concentration, bundled supply) aren't exposed by DexScreener/GeckoTerminal and Robinhood Chain
          isn't yet indexed by third-party security scanners, so those read "Unverifiable" rather than a fabricated
          pass — check them by hand before sizing a position.
        </p>
        <FunnelPipeline counts={counts} total={total} />
      </Panel>

      <Panel
        title="Funnel results"
        action={
          <Segmented<VerdictFilter>
            value={filter}
            onChange={setFilter}
            size="sm"
            ariaLabel="Filter by verdict"
            options={[
              { value: "all", label: `All (${total})` },
              { value: "candidate", label: `Candidate (${verdictCounts.candidate})` },
              { value: "watch", label: `Watch (${verdictCounts.watch})` },
              { value: "rejected", label: `Rejected (${verdictCounts.rejected})` },
            ]}
          />
        }
      >
        {rows.length === 0 ? (
          <EmptyState title="No pools match this filter" description="Try a different verdict, or clear the filter." />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((pool) => {
              const f = pool.funnel;
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
                        aria-label={`${isOpen ? "Collapse" : "Expand"} funnel detail for ${poolLabel(pool)}`}
                        className="shrink-0 rounded p-0.5 text-txt-2 transition-colors hover:bg-ink-3 hover:text-txt-0"
                      >
                        <ChevronDown size={14} className={clsx("transition-transform", isOpen && "rotate-180")} aria-hidden />
                      </button>
                      <div className="min-w-0">
                        <button
                          onClick={() => onSelectPool(pool)}
                          className="truncate text-left text-[13px] font-medium text-txt-0 hover:text-reticle"
                        >
                          {poolLabel(pool)}
                        </button>
                        <p className="num mt-0.5 text-[10px] text-txt-2">
                          {formatUsd(pool.liquidityUsd)} TVL · {f.pairQuality.quoteSymbol || "?"}
                          {!f.pairQuality.isStablePair && " · non-stable"}
                        </p>
                      </div>
                    </div>

                    <div className="hidden min-w-0 sm:block">
                      <p className="truncate text-[11px] text-txt-1">
                        {f.failedAt ? (
                          <>Failed at: {STAGE_DEFS.find((s) => s.key === f.failedAt)?.label ?? f.failedAt}</>
                        ) : (
                          <>Clears every stage</>
                        )}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-txt-2">
                        Fee/TVL: {f.feeTvl.bucket} · {f.pairQuality.isLargestTvlForToken ? "top pool" : `#${f.pairQuality.tvlRank} for token`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {f.security.unverifiableCount > 0 && f.security.passed && (
                        <span title="Some security checks are unverifiable from available data" className="text-txt-2">
                          <ShieldCheck size={13} aria-hidden />
                        </span>
                      )}
                      <VerdictPill verdict={f.verdict} />
                    </div>
                  </div>
                  {isOpen && <FunnelDetail pool={pool} />}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
