# Marksman

A real-time screener for Uniswap liquidity pools on **Robinhood Chain** (EVM L2,
chainId 4663). It scans pools, scores them, detects when a pool becomes a
signal, and serves ranked results over HTTP + a React dashboard. It
specializes in tokenized-stock pools (ERC-20 "Stock Tokens" tracking equities
like NVDA/AAPL/TSLA) alongside general crypto pools.

**This is a screener/analytics tool, not a trading bot.** It never touches
private keys, seed phrases, or executes trades. Every score and alert is
informational only.

## Stack

- **Backend**: Node.js 20+, Express 5, pure ESM. No database — in-memory
  cache + a single JSON history file. Vitest for tests.
- **Frontend**: React 19 + TypeScript + Vite, Tailwind CSS v4, TanStack Query
  (polling/caching), Recharts (the analytics scatter only), lucide-react (icons).
  Routing and the 3D hero are hand-rolled rather than pulled in as dependencies —
  see below.

## Project structure

```
server/            Express app + scan pipeline orchestration (I/O)
  index.mjs           HTTP API
  pipeline.mjs         runScan(): intake -> filter -> enrich -> normalize -> score -> decide -> transitions
  config.mjs           env + token map loading
  scanCache.mjs         time-based cache with stampede guard
  historyStore.mjs      atomic, queued JSON history writes
  alerts.mjs            Telegram sender

shared/             Pure, I/O-free logic + data-source adapters
  scoring.js            calculateScore, calculateRisk, evaluatePreset, PRESETS (+ .test.js)
  lpScoring.js          calculateLpMetrics, calculateLpScore, evaluateLpPreset,
                        LP_PRESETS — the liquidity-provider model (+ .test.js)
  normalize.js          raw DexScreener/GeckoTerminal shapes -> one internal pool shape, mergePoolSources (+ .test.js)
  signalTransitions.js  getPoolSignalStatus, createSignalTracker (+ .test.js)
  concurrency.mjs       bounded-concurrency async mapper (+ .test.js)
  ttlCache.mjs          per-key cache, separate success/failure TTL (+ .test.js)
  dataSources/          dexscreener.mjs, geckoterminal.mjs, equity.mjs, tokenMap.mjs, httpClient.mjs

data/
  signal-history.json   append-only signal transition log (capped at 250)
  token-map.json         tokenized-stock address -> ticker map (edit this!)

web/                Frontend (Vite + React)
  src/api/              typed fetch client + response types
  src/lib/              router.tsx (~60-line history router), poolMath.ts
                        (filter/sort/aggregate/CSV), format.ts, nav.ts, storage.ts
  src/hooks/            TanStack Query hooks, theme + toast providers,
                        watchlist, hotkeys, misc (focus trap, scan countdown)
  src/pages/            Landing.tsx (marketing) and Console.tsx (the app shell)
  src/components/
    SpreadField.tsx     the 3D field — see "The Spread Field" below
    ui/                 primitives, badges, charts, states, wordmark
    shell/              left rail, top bar, mobile nav, command palette
    screener/           filter panel, table, cards, compare tray
    views/              one file per console view
    PoolDrawer.tsx      pool detail sheet (overview / score / risk / details)
```

### Routes

Two surfaces, one bundle. `/` is the landing page; everything under `/app` is
the console (`/app`, `/app/screener`, `/app/spreads`, `/app/liquidity`,
`/app/signals`, `/app/analytics`, `/app/system`). Unknown paths fall back to the
landing page, and unknown `/app/*` paths fall back to the overview.

`server/index.mjs` already serves `web/dist/index.html` for any non-`/api` path,
so deep links work in production without extra configuration.

### The Spread Field

`web/src/components/SpreadField.tsx` renders every scanned pool as a node in a
3D measurement volume — x is liquidity, y is the 1h move, z is 24h volume, all
log-scaled and normalised. Tokenized stocks are drawn as a *pair*: the on-chain
node and a hollow parity tick, joined by a strut whose length is the premium.
A rangefinder reticle cycles through them and reads out the gap.

It is a hand-rolled perspective projection on a 2D canvas, not WebGL — the scene
is a few hundred points and a wireframe floor, which is not worth ~600 kB of
Three.js. It pauses when offscreen or backgrounded, reads its colours from the
CSS custom properties so it follows the theme, and honours
`prefers-reduced-motion` by holding a fixed camera angle.

**Degraded mode matters here.** Without `STOCK_API_KEY` no pool has a premium,
so there are no struts to draw. Rather than going blank, the reticle falls back
to sighting hot pools (and then the highest-scoring ones) and reads out the 1h
move instead of the gap.

## Running it

### 1. Backend

```bash
npm install
cp .env.example .env   # then fill in STOCK_API_KEY etc. (see below)
npm run dev             # http://localhost:8787, restarts on file change
```

### 2. Frontend (separate terminal, for development)

```bash
cd web
npm install
npm run dev             # http://localhost:5173, proxies /api -> :8787
```

Open `http://localhost:5173`.

### 3. Production (single process, single port)

```bash
cd web && npm run build && cd ..
npm start                # serves the API AND the built frontend on :8787
```

`server/index.mjs` serves `web/dist` as static files whenever that directory
exists, so there's nothing extra to configure — build the frontend once and
the backend takes over serving it.

### Tests

```bash
npm test                 # Vitest — 94 tests over shared/ and server/
```

## Environment variables (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `SCAN_INTERVAL_SECONDS` | `60` | Background scan cadence + cache TTL |
| `ACTIVE_PRESET` | `marksman` | Operational preset driving signal transitions/history/alerts (`steady` or `marksman`) — independent of what a viewer browses in the UI |
| `LP_PRESET` | `carry` | Default liquidity-provider posture (`harvest`, `carry`, or `vault`) when a client doesn't pass `?lp=`. Browse-only — it never drives signals or alerts |
| `STOCK_API_PROVIDER` | `finnhub` | `finnhub`, `polygon`, or `alphavantage` |
| `STOCK_API_KEY` | _(empty)_ | Required to compute tokenized-stock premium/discount. Without it, `premiumPct` stays `null` and the UI shows a "degraded" banner for the equity source — everything else still works |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | _(empty)_ | Optional. Without these, `/api/alert` responds `{ sent: false, reason: "telegram_not_configured" }` rather than erroring |
| `AUTO_ALERT_ON_HOT` | `false` | If `true`, automatically sends a Telegram alert whenever a pool transitions to `hot` (in addition to the manual `POST /api/alert`) |
| `DEXSCREENER_CHAIN_ID` / `GECKOTERMINAL_NETWORK` | `robinhood` | Chain slugs, confirmed live against both APIs |
| `TOKEN_MAP_PATH` / `HISTORY_FILE_PATH` | `data/token-map.json` / `data/signal-history.json` | Override file locations |

## The liquidity-provider model

`shared/lpScoring.js` is a second, independent scoring axis that answers a
different question from `scoring.js` — and disagrees with it on purpose.

| | `scoring.js` (`score`) | `lpScoring.js` (`lp`) |
|---|---|---|
| Question | Should I **trade** this pool? | Should I **provide liquidity** here? |
| Momentum | Rewarded — it's the move you're catching | **Penalised** — it's the mechanism that picks you off |
| Freshness | Rewarded — get in before the arb closes | **Penalised** — APR collapses as capital arrives |
| Premium gap | The opportunity | A drag you eat on reversion |

A pool can legitimately score 85 as a trade and 20 as an LP position. Both
verdicts ship on every pool from `/api/pools`; neither is derived from the
other. **Don't try to reconcile them.**

### The economics

```
fee income  = turnover x feeTier          what the pool pays you
LVR         = sigma^2 / 8 per day         what being the passive side costs
net edge    = fee income - LVR            the only number that decides it
```

LVR ("loss versus rebalancing", Milionis et al. 2022) is the cost of quoting a
stale price to informed flow. It is **not** impermanent loss: IL is path-
dependent and reverses if price returns, while LVR is realised continuously and
never comes back. If fee income doesn't clear it, holding the pair would have
beaten providing it.

### Why so much reads "inconclusive"

Every net edge ships with a 95% error band combining two sources:

- **statistical** — the volatility estimate from ~24 hourly closes,
  `SE(s²) = s²·sqrt(2/(n−1))`, doubled.
- **systematic** — the fee tier, when it isn't published. That band is
  `assumedFeeTierRelError` (±50%) and is deliberately *not* doubled; doubling it
  would make a "covers" verdict unreachable by construction.

When the edge is smaller than that band the verdict is `inconclusive` — a real
answer, not a missing one. It must never be rendered as a pass.

### Fee tiers matter more than anything else here

Fee income scales linearly with the tier, so assuming 30 bp for a 1 bp pool
overstates yield **30x**. Neither DexScreener nor GeckoTerminal exposes a fee
field, but GeckoTerminal suffixes it onto the pool name (`"USDG / WETH 0.01%"`),
and `parseFeeTierBps()` in `normalize.js` reads it from there — typically
resolving ~75% of a scan. `mergePoolSources()` backfills the tier onto the
DexScreener copy of a pool, which would otherwise win the merge and drop it.
Pools with no tier in the name fall back to 30 bp, carry a `fee_tier_assumed`
caveat, and get the wider error band above.

### What else it measures

- **Range bands** — tight/balanced/wide at 1σ/1.5σ/2σ over the horizon, each with
  a hold probability. These are *path* probabilities via the reflection
  principle, so a ±1σ band holds ~36% of the time, not the ~68% the bell curve
  suggests. Suggested split is 50/30/20.
- **Dilution** — the APR a reference ticket actually receives after its own
  deposit dilutes the pool, plus the deposit size that would halve the rate
  (which is just current TVL).
- **Flow imbalance** — `|buys − sells| / total`. Balanced two-way flow means
  you earn the spread from both sides; one-directional flow means you're the
  exit liquidity.
- **Equity session hazard** (tokenized stocks only) — the token trades 24/7
  while the market it tracks is shut most of the week, so news accumulates and
  arrives as a jump at the open. `equitySessionState()` flags overnight and
  weekend exposure. Market holidays are **not** modelled.
- **`apr_mirage`** — a triple-digit APR whose own LVR eats it. The single most
  common way an LP loses money while watching a number go up.

### Postures

`LP_PRESETS.harvest` / `.carry` / `.vault` gate on measured numbers (turnover,
TVL, σ, net edge, flow imbalance, allowed verdicts). All three reject a pool
whose volatility couldn't be measured — no benefit of the doubt. The posture is
browse-only: it gates the Liquidity view and never drives signals, history, or
alerts. `LP_PRESET` sets the server default; `?lp=` overrides per request and
re-gates the cached scan without re-scanning.

**Everything here is an estimate from public aggregate data — 24h volume,
hourly closes, txn counts — not swap-level accounting.** `metrics.caveats` says
per pool what each number rests on.

## Tuning scores, risk, and presets

Everything is a named constant in `shared/scoring.js` — no magic numbers
buried in logic:

- `SCORE_WEIGHTS` / `SCORE_TUNABLES` — the five scoring buckets (momentum,
  fee efficiency, volume quality, security, freshness) and the caps/floors
  each is scaled against.
- `RISK_TUNABLES` — every penalty (thin liquidity, extreme momentum, new
  pool, low trader count, large premium, missing data) and its point value.
- `PRESETS.steady` / `PRESETS.marksman` — the gate each preset applies
  (min liquidity, premium band, volume floor, momentum range, min age, max
  risk). `evaluatePreset()` picks up a new entry here automatically, but the
  frontend is hardcoded to these two. Adding a third means updating:
  `PresetKey` in `web/src/api/types.ts`, the two `Segmented` switchers in
  `web/src/components/shell/Shell.tsx` (desktop and mobile rows), the toggle
  command in `web/src/pages/Console.tsx`, and the `PRESETS` copy block in
  `web/src/pages/Landing.tsx`.

Change a number, re-run `npm test` — the test suite pins behavior at the
boundaries (e.g. exact score at 0%/30%+ momentum, risk at each liquidity
tier), so a tuning change that breaks an assumption will fail loudly.

## API

| Endpoint | Notes |
|---|---|
| `GET /api/pools?preset=&lp=&force=` | Scanned, scored, annotated pools + meta (scannedAt, sourceHealth, active/requested preset). Each pool carries both `score`/`presetGate` (trade view) and `lp`/`lpGate` (liquidity view). `force=1` bypasses the cache. Switching either preset is free — it re-evaluates the cached scan, it doesn't re-scan. |
| `GET /api/status` | Runtime health, last scan summary, which optional integrations are configured. |
| `GET /api/history?limit=` | Recent signal transitions (newest first), capped at 250 total. |
| `POST /api/alert` `{ address }` | Sends a manual Telegram alert for a pool from the current cache. 404 if the pool isn't in the last scan. |

All responses are `Cache-Control: no-store`. Upstream failures return `502`
with a message — the process never crashes on a bad external response.

## How pool discovery (intake) works

DexScreener's free API has **no "list every pool on chain X" endpoint** —
only keyword search and per-token lookups. Relying on that alone means a pool
whose name/symbol matches none of your seed queries (e.g. a token with no
"robinhood" or stock-ticker branding at all — verified live with a real
"CASHCAT/WETH" pool that a "robinhood"-only search never surfaces) silently
never appears.

So intake unions **two** sources every scan (`server/pipeline.mjs` step 1):

1. **GeckoTerminal chain-wide listing** (primary) — `shared/dataSources/geckoterminal.mjs`'s
   `fetchBulkPools()` pages `/networks/{network}/pools` (top ~60 by liquidity,
   `bulkScan.geckoPages` pages) unioned with `/networks/{network}/new_pools`
   (freshest pools, which may not yet be liquid enough to rank into the top
   pages). No keyword matching involved — this is what catches CASHCAT-style
   pools.
2. **DexScreener keyword search** (secondary) — seeded with "robinhood" +
   every ticker in `token-map.json`, plus a direct sweep of known
   tokenized-stock addresses. Kept alongside GeckoTerminal purely because it
   carries honeypot/danger `labels` GeckoTerminal doesn't provide.

`shared/normalize.js`'s `mergePoolSources()` unions both by pool address; when
a pool is found in both, the DexScreener version wins (for its `labels`).

**Rate-limit budget**: GeckoTerminal is ~30 calls/min. Bulk discovery costs
`geckoPages + 1` calls (default 4); the remaining budget goes to
`enrich.geckoShortlistN` (default 20) per-pool candle fetches for 1h
momentum/sparklines — 4 + 20 = 24, leaving headroom. If you raise
`geckoShortlistN` or `bulkScan.geckoPages` in `server/config.mjs`, keep the
sum comfortably under 30 or you'll see `geckoterminal.ok: false` in
`/api/status` from throttled requests.

## Known limitations (read before trusting premium/discount signals)

- **`data/token-map.json` needs to stay accurate.** It ships with three
  addresses (NVDA/AAPL/TSLA) confirmed live on 2026-08-06 by matching
  DexScreener pools labeled "\* • Robinhood Token". Watch out for copycat
  tokens sharing the same symbol at a *different* address (e.g. a plain
  "NVIDIA" or "AAPL Cat" token also exists on-chain) — only addresses in this
  file are treated as the real tokenized stock.
- **1h candles/sparklines are only fetched for the top `geckoShortlistN`
  pools** by volume each scan (see rate-limit budget above), not every pool
  in the result. The rest fall back to DexScreener's own `priceChange.h1` for
  momentum scoring (no sparkline) when available, or `null` for pools sourced
  only from GeckoTerminal's bulk listing.
- **Without `STOCK_API_KEY`**, `premiumPct` is always `null` and tokenized
  stocks carry a `missing_underlying_price` risk flag — this is the intended
  degraded-mode behavior, not a bug.
- **GeckoTerminal doesn't provide honeypot/danger labels.** A pool discovered
  only through the bulk listing (not also matched by the DexScreener keyword
  search) won't get that particular security signal until DexScreener also
  picks it up.
