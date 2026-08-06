import { useMemo } from "react";
import {
  ArrowRight,
  Ban,
  Gauge,
  KeyRound,
  Layers,
  Radar,
  ShieldCheck,
  Timer,
  Wallet,
} from "lucide-react";
import { SpreadField, buildField, idleField } from "../components/SpreadField";
import { Wordmark } from "../components/ui/Wordmark";
import { Button, Eyebrow } from "../components/ui/primitives";
import { SpreadBar } from "../components/ui/charts";
import { Link } from "../lib/router";
import { usePools, useStatus } from "../hooks/usePools";
import { aggregate } from "../lib/poolMath";
import { formatPct, formatUsd } from "../lib/format";
import type { Pool } from "../api/types";

/* -------------------------------------------------------------------------- */

const SCORE_DIMENSIONS = [
  {
    name: "Momentum",
    weight: 25,
    body: "How hard the price moved in the last hour, read from GeckoTerminal candles and capped at 30%.",
  },
  {
    name: "Fee efficiency",
    weight: 25,
    body: "24h volume divided by the liquidity sitting in the pool. A pool turning over 5× maxes this out.",
  },
  {
    name: "Volume quality",
    weight: 20,
    body: "Half absolute volume, half volume-to-liquidity — so a big pool and a busy pool both register.",
  },
  {
    name: "Security",
    weight: 20,
    body: "Liquidity above $5k, at least 20 trades in 24h, and no danger label from DexScreener.",
  },
  {
    name: "Freshness",
    weight: 10,
    body: "Under a day scores full marks; past a month it scores one. New pools are where dislocations start.",
  },
];

const PIPELINE = [
  { step: "Intake", body: "Union GeckoTerminal's chain-wide listing with a DexScreener keyword sweep." },
  { step: "Filter", body: "Drop pools that can't be priced or scored at all." },
  { step: "Enrich", body: "Pull 1h candles for the top pools by volume, and live equity quotes for tokenized stocks." },
  { step: "Normalize", body: "Fold both source shapes into one pool record; DexScreener wins on conflicts for its labels." },
  { step: "Score", body: "Five weighted dimensions to a 0–100 score, plus a separate risk number." },
  { step: "Decide", body: "Apply the active preset's gate, then log every pool that crossed into watch or hot." },
];

const PRESETS = [
  {
    key: "steady",
    label: "Steady",
    summary: "Established pools, tight to parity, low risk.",
    gates: [
      ["Liquidity", "≥ $50,000"],
      ["24h volume", "≥ $50,000"],
      ["Premium", "within ±2%"],
      ["1h move", "5% to 40%"],
      ["Pool age", "≥ 7 days"],
      ["Risk", "≤ 55"],
    ],
  },
  {
    key: "marksman",
    label: "Marksman",
    summary: "Hunts dislocations — wants the gap wide, not narrow.",
    gates: [
      ["Liquidity", "≥ $5,000"],
      ["24h volume", "≥ $10,000"],
      ["Premium", "at least 1% off parity"],
      ["1h move", "10% to 200%"],
      ["Pool age", "any"],
      ["Risk", "≤ 75"],
    ],
  },
];

const LIMITS = [
  {
    icon: Wallet,
    title: "It never holds funds",
    body: "Marksman has no wallet, signs nothing, and places no orders. It reads two public APIs and serves the result.",
  },
  {
    icon: KeyRound,
    title: "It never sees a key",
    body: "There is no connect-wallet button because there is nothing to connect to. Private keys and seed phrases are outside the design.",
  },
  {
    icon: Ban,
    title: "It is not advice",
    body: "A score ranks what the scan found against its own tunables. It does not know your position, your horizon, or your risk.",
  },
  {
    icon: ShieldCheck,
    title: "It tells you when it's blind",
    body: "Without an equity API key, premium reads as unavailable rather than zero. Degraded sources are labelled, never silently filled in.",
  },
];

/* -------------------------------------------------------------------------- */

function LiveReadout({ label, value, tone }: { label: string; value: string; tone?: "reticle" | "bloom" | "flare" }) {
  const toneClass = tone ? { reticle: "text-reticle", bloom: "text-bloom", flare: "text-flare" }[tone] : "text-txt-0";
  return (
    <div className="sm:border-l sm:border-line sm:px-4 sm:py-1 sm:first:border-l-0 sm:first:pl-0">
      <p className="engraved text-txt-2">{label}</p>
      <p className={`num mt-1.5 text-lg font-semibold leading-none ${toneClass}`}>{value}</p>
    </div>
  );
}

function GapDemo({ pools }: { pools: Pool[] }) {
  const stocks = useMemo(
    () =>
      pools
        .filter((p) => p.isTokenizedStock && p.premiumPct != null)
        .sort((a, b) => Math.abs(b.premiumPct ?? 0) - Math.abs(a.premiumPct ?? 0))
        .slice(0, 4),
    [pools]
  );

  // A worked example when the scan has no priced tokenized stocks to show.
  const sample = [
    { ticker: "NVDA", onChain: 187.42, real: 183.06 },
    { ticker: "AAPL", onChain: 226.15, real: 227.9 },
    { ticker: "TSLA", onChain: 341.8, real: 335.12 },
  ].map((row) => ({ ...row, premium: ((row.onChain - row.real) / row.real) * 100 }));

  const rows =
    stocks.length > 0
      ? stocks.map((p) => ({
          ticker: p.stockTicker ?? "?",
          onChain: p.priceUsd ?? 0,
          real: p.underlyingPrice ?? 0,
          premium: p.premiumPct ?? 0,
        }))
      : sample;

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.premium)), 1);

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="engraved text-txt-2">{stocks.length > 0 ? "Live · this scan" : "Worked example"}</p>
        <p className="engraved text-txt-2">On-chain vs equity</p>
      </div>
      <div className="divide-y divide-line">
        {rows.map((row) => (
          <div key={row.ticker} className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-3.5">
            <div className="w-16">
              <p className="font-display text-sm font-bold tracking-tight text-txt-0">{row.ticker}</p>
              <p className="num text-[10px] text-txt-2">{formatUsd(row.real)}</p>
            </div>
            <SpreadBar premiumPct={row.premium} maxAbs={maxAbs} />
            <div className="w-20 text-right">
              <p className={`num text-sm font-semibold ${row.premium >= 0 ? "text-bloom" : "text-flare"}`}>
                {formatPct(row.premium, { signed: true })}
              </p>
              <p className="num text-[10px] text-txt-2">{formatUsd(row.onChain)}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-txt-2">
        Bars run from parity at centre. Right of centre the token costs more than the equity it tracks; left of centre it
        costs less.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export default function Landing() {
  const poolsQuery = usePools("marksman");
  const statusQuery = useStatus();

  // Memoised so the `?? []` fallback doesn't hand a new array to every
  // downstream useMemo on each render — the field would rebuild constantly.
  const pools = useMemo(() => poolsQuery.data?.pools ?? [], [poolsQuery.data]);
  const stats = useMemo(() => aggregate(pools), [pools]);
  const field = useMemo(() => (pools.length > 0 ? buildField(pools) : idleField()), [pools]);
  const cadence = statusQuery.data?.scanIntervalSeconds ?? 60;

  return (
    <div className="min-h-screen bg-ink-0">
      {/* ---------- nav ---------- */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-line/60 bg-ink-0/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between gap-4 px-5 sm:px-8">
          <Wordmark />
          <nav className="flex items-center gap-1.5">
            <a
              href="#gap"
              className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-txt-1 transition-colors hover:text-txt-0 sm:block"
            >
              The gap
            </a>
            <a
              href="#method"
              className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-txt-1 transition-colors hover:text-txt-0 sm:block"
            >
              Method
            </a>
            <a
              href="#limits"
              className="hidden rounded-lg px-3 py-2 text-[13px] font-medium text-txt-1 transition-colors hover:text-txt-0 sm:block"
            >
              Limits
            </a>
            <Link to="/app">
              <Button variant="primary" size="sm">
                Open console <ArrowRight size={14} aria-hidden />
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* ---------- hero ---------- */}
      <section className="barrel relative overflow-hidden pt-16">
        <SpreadField
          nodes={field}
          className="pointer-events-auto absolute inset-0 h-full w-full"
          density={1.15}
        />
        {/* Scrims so type stays legible over whatever the field is doing.
            Wide screens put the copy on the left and the field on the right, so
            a horizontal wipe is enough. Below lg the copy spans the full width,
            so the veil has to run top-to-bottom instead — clearing near the
            floor, where the measurement grid is the only thing left to see. */}
        <div
          className="pointer-events-none absolute inset-0 hidden lg:block"
          style={{
            background:
              "linear-gradient(100deg, var(--c-ink-0) 0%, color-mix(in srgb, var(--c-ink-0) 82%, transparent) 38%, transparent 66%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-0 lg:hidden"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--c-ink-0) 94%, transparent) 0%, color-mix(in srgb, var(--c-ink-0) 90%, transparent) 55%, color-mix(in srgb, var(--c-ink-0) 45%, transparent) 100%)",
          }}
        />

        <div className="pointer-events-none relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-[1240px] grid-cols-1 items-center px-5 py-20 sm:px-8">
          <div className="pointer-events-auto max-w-[38rem]">
            <div className="rise flex flex-wrap items-center gap-2.5" style={{ animationDelay: "40ms" }}>
              <span className="engraved rounded-full border border-line-2 bg-ink-1/80 px-2.5 py-1 text-txt-1">
                Robinhood Chain · 4663
              </span>
              <span className="engraved inline-flex items-center gap-1.5 rounded-full border border-bloom/30 bg-bloom/10 px-2.5 py-1 text-bloom">
                <span className="h-1.5 w-1.5 rounded-full bg-bloom signal-pulse" aria-hidden />
                Scanning every {cadence}s
              </span>
            </div>

            <h1
              className="display-xl rise mt-6 text-[clamp(2.9rem,8.5vw,5.6rem)] text-txt-0"
              style={{ animationDelay: "120ms" }}
            >
              Two prices.
              <br />
              <span className="text-reticle">One asset.</span>
            </h1>

            <p
              className="rise mt-6 max-w-[34rem] text-[16px] leading-relaxed text-txt-1 sm:text-[17px]"
              style={{ animationDelay: "200ms" }}
            >
              Tokenized NVDA trades in a liquidity pool. Real NVDA trades on an exchange. They drift apart, and the gap
              closes again. Marksman scans every pool on the chain, scores what it finds, and shows you exactly how far
              apart the two have moved.
            </p>

            <div className="rise mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "280ms" }}>
              <Link to="/app">
                <Button variant="primary" size="lg">
                  Open the console <ArrowRight size={16} aria-hidden />
                </Button>
              </Link>
              <a href="#method">
                <Button variant="secondary" size="lg">
                  How it reads a pool
                </Button>
              </a>
            </div>

            <div
              className="rise mt-12 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-6 sm:flex sm:flex-wrap sm:items-center sm:gap-x-0 sm:gap-y-4"
              style={{ animationDelay: "360ms" }}
            >
              <LiveReadout label="Pools in scan" value={pools.length > 0 ? String(stats.count) : "—"} />
              <LiveReadout
                label="Hot signals"
                value={pools.length > 0 ? String(stats.hot) : "—"}
                tone={stats.hot > 0 ? "flare" : undefined}
              />
              <LiveReadout label="Tokenized" value={pools.length > 0 ? String(stats.tokenized) : "—"} tone="reticle" />
              <LiveReadout
                label="Widest gap"
                value={stats.widestSpread?.premiumPct != null ? formatPct(stats.widestSpread.premiumPct, { signed: true }) : "—"}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ---------- the gap ---------- */}
      <section id="gap" className="scroll-mt-16 border-t border-line bg-ink-0 py-24">
        <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
            <div>
              <Eyebrow>What Marksman looks at</Eyebrow>
              <h2 className="font-display mt-4 text-[clamp(2rem,4vw,2.9rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-txt-0">
                A tokenized stock is a promise about a price somewhere else.
              </h2>
              <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-txt-1">
                <p>
                  An ERC-20 tokenized stock is supposed to track its equity one-for-one. On-chain it is just another token
                  in a pool, priced by whoever last traded it. Nothing forces the two prices together in the moment.
                </p>
                <p>
                  So they separate. A thin pool, a fast move, a market that's closed — and the token sits at a{" "}
                  <span className="font-medium text-bloom">premium</span> above the equity, or a{" "}
                  <span className="font-medium text-flare">discount</span> below it.
                </p>
                <p className="text-txt-2">
                  Marksman quotes the equity through a stock API, quotes the token through the pool, and reports the
                  difference on every scan. Without an equity API key it reports the gap as unavailable — never as zero.
                </p>
              </div>
            </div>

            <div className="lg:pt-10">
              <GapDemo pools={pools} />
            </div>
          </div>
        </div>
      </section>

      {/* ---------- method ---------- */}
      <section id="method" className="scroll-mt-16 border-t border-line py-24">
        <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
          <Eyebrow>Every scan, in order</Eyebrow>
          <h2 className="font-display mt-4 max-w-[24ch] text-[clamp(2rem,4vw,2.9rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-txt-0">
            Six stages from raw chain data to a ranked list.
          </h2>

          {/* Ordered because the pipeline genuinely is ordered — each stage
              consumes the previous one's output. */}
          <ol className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2 lg:grid-cols-3">
            {PIPELINE.map((stage, i) => (
              <li key={stage.step} className="group relative bg-ink-1 p-6 transition-colors hover:bg-ink-2">
                <span className="num text-[11px] font-semibold text-reticle">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="font-display mt-2 text-[17px] font-bold tracking-tight text-txt-0">{stage.step}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-txt-2">{stage.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-20 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-16">
            <div>
              <Eyebrow>The score</Eyebrow>
              <h3 className="font-display mt-4 text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold leading-[1.05] tracking-[-0.03em] text-txt-0">
                Five dimensions, weighted to 100.
              </h3>
              <p className="mt-4 text-[15px] leading-relaxed text-txt-1">
                These are read in parallel, not in sequence — a pool can max momentum and fail security in the same scan.
                Risk is scored separately, so a high score never hides a dangerous pool.
              </p>
              <div className="mt-6 rounded-xl border border-line bg-ink-1 p-4">
                <p className="text-[13px] leading-relaxed text-txt-2">
                  Every weight and threshold here is a named constant in{" "}
                  <code className="rounded bg-ink-3 px-1.5 py-0.5 font-mono text-[12px] text-txt-1">shared/scoring.js</code>
                  . Change one, re-run the tests, and the suite fails loudly if a boundary moved.
                </p>
              </div>
            </div>

            <ul className="space-y-px overflow-hidden rounded-2xl border border-line bg-line">
              {SCORE_DIMENSIONS.map((dimension) => (
                <li key={dimension.name} className="bg-ink-1 p-5">
                  <div className="flex items-baseline justify-between gap-4">
                    <h4 className="font-display text-[15px] font-bold tracking-tight text-txt-0">{dimension.name}</h4>
                    <span className="num shrink-0 text-[13px] font-semibold text-reticle">{dimension.weight}</span>
                  </div>
                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-reticle transition-[width] duration-700"
                      style={{ width: `${(dimension.weight / 25) * 100}%` }}
                    />
                  </div>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-txt-2">{dimension.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ---------- presets ---------- */}
      <section className="border-t border-line bg-ink-0 py-24">
        <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
          <Eyebrow>Two ways to read the same scan</Eyebrow>
          <h2 className="font-display mt-4 max-w-[22ch] text-[clamp(2rem,4vw,2.9rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-txt-0">
            Presets disagree on purpose.
          </h2>
          <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-txt-1">
            A preset is a gate, not a filter on the data. Switching one re-evaluates the scan you already have, so the
            swap is instant and costs no upstream calls.
          </p>

          <div className="mt-12 grid grid-cols-1 gap-5 md:grid-cols-2">
            {PRESETS.map((preset) => (
              <div
                key={preset.key}
                className="panel flex flex-col p-6 transition-colors hover:border-line-2"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                      preset.key === "marksman" ? "bg-reticle/12 text-reticle" : "bg-coat/12 text-coat"
                    }`}
                  >
                    {preset.key === "marksman" ? <Radar size={17} aria-hidden /> : <Gauge size={17} aria-hidden />}
                  </span>
                  <h3 className="font-display text-lg font-bold tracking-tight text-txt-0">{preset.label}</h3>
                </div>
                <p className="mt-3 text-[14px] leading-relaxed text-txt-1">{preset.summary}</p>

                <dl className="mt-5 space-y-px overflow-hidden rounded-lg border border-line bg-line">
                  {preset.gates.map(([term, value]) => (
                    <div key={term} className="flex items-center justify-between gap-4 bg-ink-1 px-3.5 py-2.5">
                      <dt className="text-[12px] text-txt-2">{term}</dt>
                      <dd className="num text-[12px] font-medium text-txt-0">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- limits ---------- */}
      <section id="limits" className="scroll-mt-16 border-t border-line py-24">
        <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
          <Eyebrow>Where the instrument stops</Eyebrow>
          <h2 className="font-display mt-4 max-w-[20ch] text-[clamp(2rem,4vw,2.9rem)] font-extrabold leading-[1.02] tracking-[-0.035em] text-txt-0">
            What Marksman will not do.
          </h2>

          <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2">
            {LIMITS.map((limit) => (
              <div key={limit.title} className="bg-ink-1 p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-2 bg-ink-2 text-txt-1">
                  <limit.icon size={16} aria-hidden />
                </span>
                <h3 className="font-display mt-4 text-[16px] font-bold tracking-tight text-txt-0">{limit.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-txt-2">{limit.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- close ---------- */}
      <section className="barrel relative overflow-hidden border-t border-line py-24">
        <div className="reticle-grid pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden />
        <div className="relative mx-auto max-w-[1240px] px-5 text-center sm:px-8">
          <h2 className="font-display mx-auto max-w-[16ch] text-[clamp(2.2rem,5vw,3.6rem)] font-extrabold leading-[1] tracking-[-0.04em] text-txt-0">
            The scan is already running.
          </h2>
          <p className="mx-auto mt-5 max-w-[46ch] text-[15px] leading-relaxed text-txt-1">
            No account, no wallet, no setup. The console opens on the current scan.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/app">
              <Button variant="primary" size="lg">
                Open the console <ArrowRight size={16} aria-hidden />
              </Button>
            </Link>
          </div>

          <div className="mx-auto mt-14 flex max-w-3xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[12px] text-txt-2">
            <span className="inline-flex items-center gap-1.5">
              <Layers size={13} aria-hidden /> DexScreener + GeckoTerminal
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Timer size={13} aria-hidden /> {cadence}s scan cadence
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={13} aria-hidden /> Read-only by construction
            </span>
          </div>
        </div>
      </section>

      {/* ---------- footer ---------- */}
      <footer className="border-t border-line bg-ink-0 py-10">
        <div className="mx-auto flex max-w-[1240px] flex-col items-center justify-between gap-5 px-5 sm:flex-row sm:px-8">
          <Wordmark showTagline />
          <p className="max-w-[46ch] text-center text-[11px] leading-relaxed text-txt-2 sm:text-right">
            Informational screener. Not financial advice, not a broker, not a trading venue. Premium figures depend on a
            third-party equity feed and can be stale.
          </p>
        </div>
      </footer>
    </div>
  );
}
