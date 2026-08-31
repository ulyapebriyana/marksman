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
  walletPnl.mjs         wallet walk -> priced ledger -> daily P&L
  alerts.mjs            Telegram sender

shared/             Pure, I/O-free logic + data-source adapters
  scoring.js            calculateScore, calculateRisk, evaluatePreset, PRESETS (+ .test.js)
  lpScoring.js          calculateLpMetrics, calculateLpScore, evaluateLpPreset,
                        LP_PRESETS — the liquidity-provider model (+ .test.js)
  funnelScoring.js      runFunnel and friends — the practitioner security-first
                        funnel (+ .test.js), see "The practitioner funnel" below
  normalize.js          raw DexScreener/GeckoTerminal shapes -> one internal pool shape, mergePoolSources (+ .test.js)
  signalTransitions.js  getPoolSignalStatus, createSignalTracker (+ .test.js)
  concurrency.mjs       bounded-concurrency async mapper (+ .test.js)
  uniswapMath.js        concentrated-liquidity identities: ticks, sqrt prices,
                        and what a liquidity delta was worth (+ .test.js)
  lpLedger.js           on-chain LP events -> positions with a P&L (+ .test.js)
  walletPnl.js          closed positions -> daily calendar + summary (+ .test.js)
  ttlCache.mjs          per-key cache, separate success/failure TTL (+ .test.js)
  dataSources/          dexscreener.mjs, geckoterminal.mjs, equity.mjs, tokenMap.mjs,
                        httpClient.mjs, blockscout.mjs (wallet history),
                        poolPrices.mjs (historical prices, on a call budget)

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
the console (`/app`, `/app/screener`, `/app/funnel`, `/app/spreads`, `/app/liquidity`,
`/app/pnl`, `/app/signals`, `/app/analytics`, `/app/system`). Unknown paths fall back to the
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
| `SOCIAL_PROVIDER` / `SOCIAL_API_KEY` | _(empty)_ | `twitterapi` (twitterapi.io) or `x` (official X API v2). Powers the team/catalysts/community/alpha sections of the token report. Unset means those sections say "not connected" — they never render as "nobody is talking about this" |
| `ANTHROPIC_API_KEY` / `LLM_MODEL` | _(empty)_ / `claude-opus-5` | Synthesises the raw posts above into structured Indonesian sections. Unset means the report still ships its deterministic narrative plus the raw mentions |
| `TOKEN_REPORT_TTL_SECONDS` | `300` | How long one token's report is cached. Deliberately longer than the scan cadence — a report costs up to six upstream calls plus an LLM round-trip |
| `WALLET_PNL_TTL_SECONDS` | `300` | How long one wallet's P&L walk is cached. A cold walk costs one explorer call per LP transaction plus a price series per pool, and realized P&L for days that have already ended does not move |
| `WALLET_PNL_CONCURRENCY` | `6` | Explorer calls in flight while walking a wallet |
| `WALLET_PNL_MAX_TX` | `600` | Guard on how many transactions one walk will read. A busier wallet reports itself `truncated` rather than quietly showing a partial calendar |
| `PRICE_CACHE_PATH` | `data/price-cache.json` | Where historical candles are persisted. A closed candle never changes, so re-fetching it would spend GeckoTerminal quota for nothing |
| `DEFAULT_WALLET` | _(empty)_ | Optional. Pre-fills the P&L screen's wallet field |
| `GECKO_TOKEN_TTL_SECONDS` | `1800` | How long the GeckoTerminal half of a report (holder distribution, deployer holding, launchpad state) is cached — see "Living with the rate limit" below |

## The wallet P&L calendar

`GET /api/wallet/:address/pnl` answers one question — **how much did this
wallet make or lose, on each day** — for an address providing liquidity on
Uniswap v4 on Robinhood Chain. `/app/pnl` renders it as a month calendar.

Robinhood Chain has no P&L API, so the whole figure is reconstructed:

| Step | Source | What it gives |
|---|---|---|
| Wallet history | Blockscout | transactions, token flows, decoded logs |
| Liquidity changes | `ModifyLiquidity` logs | pool, tick range, liquidity delta, **and the position's NFT id** |
| Prices | GeckoTerminal hourly candles | what each token was worth *at the hour it moved* |
| Amounts | `uniswapMath.js` | how many tokens that liquidity was |
| Positions | `lpLedger.js` | deposits, withdrawals, fees, per position |
| Days | `walletPnl.js` | closed positions bucketed into calendar days |

### The walk is a background job, not a long request

A cold wallet takes a minute or two — the price throttle below dominates it —
so the endpoint does not hold the connection open. The first call starts the
walk and answers `202` with `{ pending: true, elapsedSeconds }`; the client
polls every few seconds and gets `200` with the report once it lands. This is
not a nicety: nginx cuts a proxied request at sixty seconds, so the synchronous
version returned a 504 in production for every wallet not already cached, and a
phone on mobile data would have given up sooner still. A result that has aged
out is served as-is while its refresh runs behind it (`meta.refreshing`) — a
slightly old calendar beats a spinner.

### Why the salt is the whole trick

Uniswap v4 keeps no per-position accounting on chain, and `ModifyLiquidity`
reports only liquidity — never token amounts. What makes exact attribution
possible anyway is that v4's PositionManager stores the position's NFT id in
the event's `salt`. A transaction that closes one position and opens another
in the same breath — a rebalance, which is most of them — is therefore still
unambiguous. Without the salt, the wallet's net token flow would be all you
had, and it nets the two positions together.

### Why hourly candles are precise enough

Valuing a liquidity delta needs the pool's price at that instant, which is not
available historically on a public RPC. An hourly candle close is used
instead. That is fine, and not by luck: moving the price along the curve
trades one token for the other *at that same price*, so the token split shifts
but the dollar total barely does. Checked against a real withdrawal, the
candle-priced value came to $399.61 against an actual $399.61, while the token
split was off by 1.4%. There is a test pinning exactly this.

### Time zone is not cosmetic

Which calendar day a position closed on depends on whose midnight you mean, so
the client sends its own UTC offset (`?tz=`, minutes east of UTC) and the
server buckets to it. This is worth being fussy about: comparing against a
third-party tracker on the same wallet, every daily figure disagreed until the
offset matched — and then the position counts matched exactly, day for day.
The expensive half of the walk is cached per wallet and the bucketing is redone
per request, so changing zone costs nothing.

### Only closed positions, and only what could be priced

A position is closed when its liquidity returns to zero — **not** when its NFT
is burned, which in v4 usually never happens. Open positions are left off the
calendar entirely: an unrealized number does not belong on a day that has
already ended.

Every response carries a `reconciliation` block, and the UI shows a banner
whenever `complete` is false. This is not diagnostics. A P&L missing three
positions looks exactly like a P&L that is simply smaller, so the screen has to
be able to say which:

- `positionsUnpriced` — pools with no usable price history
- `positionsPartial` — positions whose *opening* was never seen, so their cost
  basis is unknowable. During development one such position reported its entire
  $533 exit as profit, which was most of the wallet's apparent net. The guard
  that catches it has a test named after the bug
- `failedTxs` / `truncated` — explorer calls that did not land

None of these are counted as zero.

### Living with two rate limits

The walk is bounded by Blockscout on one side and GeckoTerminal on the other.
Both are handled by spending less rather than retrying harder:

- **Blockscout** is scanned in two passes. Pass one reads only transactions
  that moved a position NFT — pure signal by definition — and *learns which
  contracts this wallet LPs through*. Pass two then reads only transactions
  sent to those contracts. Nothing is hardcoded, so a new router ships and this
  still works. It also cut a real wallet's walk from 182 lookups to 92.
- **Blockscout paginates transaction logs at fifty**, and an LP transaction on
  a taxed token routinely exceeds that once the router's swap, the tax hops and
  the dividend bookkeeping land in the same receipt. Reading only the first
  page silently loses the liquidity events after them — which is precisely how
  that $533 phantom profit appeared. Every page is walked.
- **GeckoTerminal** is the same ~30 calls/minute the background scan already
  half-consumes (see "Living with the rate limit" below). Price calls are
  serialised through one throttle with a minimum gap, backed off on 429, and
  persisted to `data/price-cache.json` — a candle that has closed will never
  change, so a restart must not cost the quota twice.

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

## The practitioner funnel

`shared/funnelScoring.js` (`runFunnel`, shipped on every pool as `.funnel`) is
a third, independent lens — encoding a pattern observed across several X
accounts publishing LP P&L (self-reported, not independently audited
on-chain): screen for **safety before yield**, in a fixed order:

```
1. token security       -> auto-fail on what's actually checkable
2. volume sustainability -> a 5m spike with nothing behind it is not real flow
3. fee/TVL efficiency    -> volume x feeTier / TVL, bucketed
4. pair quality          -> stablecoin pair, largest-TVL pool for the token
5. range guidance        -> a maturity-tier sanity check, not the primary range
```

It is a **sequential gate, not a weighted score** — a pool that fails stage 1
or 2 is `rejected` outright regardless of how good stages 3–4 look. That
ordering is the entire point of the methodology: a 5,000%-APR pool that rugs
80% is still a large loss no matter how good the fee number looked on the way
in. `verdict` is `candidate` / `watch` / `rejected`; `failedAt` names the
first stage that didn't clear.

### The data-availability gap, stated plainly

The methodology's security stage assumes access to on-chain contract
introspection and holder analytics (GoPlus, Honeypot.is, TokenSniffer,
bundle/holder-concentration checkers). **Robinhood Chain (chainId 4663) isn't
indexed by any of those as of this writing**, and neither DexScreener nor
GeckoTerminal expose contract verification, mint/blacklist/pause functions,
holder concentration, or bundled supply. Rather than fabricate a pass/fail for
checks the pipeline cannot actually run, `evaluateTokenSecurity()` marks every
one of them `unverifiable` with a pointer to check by hand — never a silent
pass. Only what's genuinely checkable (a DexScreener danger/honeypot label, a
hard liquidity floor) can fail a pool automatically. The UI surfaces this
directly rather than implying a security audit that didn't happen.

The same honesty applies to the checklist's cumulative-fees check (the
methodology's "≥1 ETH total fees" reference) — there's no cumulative-fee
history or ETH price feed here, so it reports the closest available proxy
(today's estimated daily fee income) rather than a fabricated ETH figure.

### Why fee/TVL buckets the way it does

```
fee pool per day = volume24h x feeTier
fee/TVL           = fee pool per day / TVL
```

| `volumeToTvlRatio` | bucket | reading |
|---|---|---|
| < 0.25x | `weak` | usually not worth it |
| 0.25x – 1x | `healthy` | sustainable if it holds for a few days |
| 1x – 5x | `strong` | high fee potential |
| > 5x | `suspicious` | very attractive on paper, but treat as a wash-trading/thin-TVL suspect — **never auto-promoted to `candidate`** |

### Range guidance is contextual, not primary

`getMaturityRangeGuidance()` reproduces the methodology's fixed percentage
tiers by token maturity (market cap + age) as a rule-of-thumb sanity check.
The number to actually size a position on is the **realized-volatility**
range in the Liquidity view (`pool.lp.metrics.ranges`) — it's measured from
real hourly closes rather than a fixed percentage, which the funnel's range
stage says explicitly in its `note`.

### Pair quality needs siblings

Stage 4 checks whether a pool is the largest-TVL pool among every other pool
sharing the same base token (different fee tiers/DEXes) — the "check every
fee tier, pick the deepest one with real volume" step. `server/pipeline.mjs`
groups the scanned pools by `baseToken.address` before calling `runFunnel()`
so each pool can see its siblings; calling `runFunnel()` directly (as the
tests do) needs `siblingPools` passed in explicitly.

## The token report

`GET /api/token/:address` answers a different question from the screener. The
screener asks "which pool is worth a look right now"; the report asks "what is
this token, structurally" — and it answers **in Indonesian**, because that is
who it is written for. The console renders it at `/app/token/0x…`; paste a
contract address into the command palette to get there.

### Why the copy is Indonesian and the rest of the app is not

This is a deliberate split, not a half-finished translation. The screener is an
instrument panel read by its operator; the report is a document written for a
reader. Only the report was asked for in Indonesian, so only the report is —
including its number formatting, which uses comma decimals and `rb`/`jt`
scale throughout. `shared/narrative.js` and `TokenReportView.tsx` each have
their own formatters rather than reusing the en-US ones in `web/src/lib/format.ts`;
mixing `$1.5M` into a paragraph that reads `15,28%` looks like a bug.

### The layers, and which of them cost money

| Layer | Source | Needs a key |
|---|---|---|
| Fundamentals, pools, flow, distribution | GeckoTerminal + DexScreener | no |
| Security checklist | same, plus what it honestly cannot check | no |
| Narrative (six sections of Indonesian prose) | generated from the numbers above | no |
| Team / catalysts / community / alpha | X/Twitter search | **yes** — `SOCIAL_API_KEY` |
| Synthesis of those posts into sections | Claude | **yes** — `ANTHROPIC_API_KEY` |

The first three work with no credentials at all. The last two degrade the way
everything else in this codebase degrades: the section states that its source
is not connected, which is a different claim from "nobody is talking about
this token" and must never be collapsed into it.

### The narrative is assembled, not paraphrased

`shared/narrative.js` builds its sentences from the same report object the UI
renders, so **every figure in the prose is the figure in the data by
construction**. A model rewriting those paragraphs is a model that can get one
wrong, and a wrong number inside fluent prose is worse than no prose. The LLM
in `server/llmNarrative.mjs` therefore never touches the arithmetic — its only
job is the social sections, which are genuinely unstructured text that nothing
else can summarise.

The editorial rule is enforced by a test: the narrative describes what the data
shows and what it cannot show, and never tells anyone what to do about it. The
words "beli" and "jual" appear freely as *nouns* naming the two sides of order
flow; what the test bans is advisory phrasing.

### GeckoTerminal `/tokens/{addr}/info` closes most of the data gap

The funnel section below documents that Robinhood Chain has no
contract-introspection or holder-analytics provider. That is still true of the
providers it names, but GeckoTerminal's token *info* endpoint does publish
holder count, top-10/11-30/31-50 distribution, the deployer address and its
remaining holding percentage, a honeypot flag, and a `gt_score`. The report
uses all of it.

What it still cannot establish is reported as `unverifiable`, never as a pass:

- **Contract source verification** — no API for this chain.
- **Mint / freeze / blacklist functions** — the `mint_authority` and
  `freeze_authority` fields are Solana concepts and come back `null` on an EVM
  chain. **`null` here means "not applicable", not "checked and clean"**, and
  rendering it as a pass would be inventing a result the API never gave.
- **Honeypot simulation** — no simulator indexes this chain. The absence of a
  DexScreener danger label is not a honeypot test.
- **Liquidity locks** — not published by either source.

### Numbers that are bounds, not estimates

Unique trader counts are published per pool and cannot be de-duplicated across
pools without wallet-level data — the same wallet trading two pools is counted
twice. So the trader count is an **upper bound**, which makes trades-per-trader
a **lower bound**. The bot-concentration flag can therefore only under-report,
never over-report, and both the API field name (`tradesPerTraderLowerBound`)
and the rendered copy say so.

Token age is taken from the **oldest** pool, not the newest: a token is as old
as its first market, and a fresh pool on an established token must not read as
a fresh token.

Valuation prefers market cap and falls back to FDV, and `valuationBasis` says
which one it used — FDV on a token with unpublished circulating supply is the
value of the entire supply, which the narrative states outright rather than
letting the reader assume otherwise.

### Living with the rate limit

GeckoTerminal's free tier allows roughly 30 requests a minute, and this
project's own background scan spends most of that in a burst every cycle
(`bulkScan.geckoPages` + `enrich.geckoShortlistN` in `server/config.mjs`).
Measured from the production box, that leaves **about half of every minute
returning 429** to anything else — which is where an on-demand token report
lands.

Retrying inside the page load does not fix this: the outage lasts tens of
seconds, far longer than a reader will wait for a page. What fixes it is not
needing the call. The GeckoTerminal half of a report gets **its own cache with
a much longer TTL** (`GECKO_TOKEN_TTL_SECONDS`, 30 minutes) than the report
itself, because holder distribution and deployer holding change on the order
of a day — the API publishes its own `last_updated` and it moves daily. One
success serves every request for that token for the next half hour, so only
the first request after expiry can be unlucky. Failures are negative-cached for
15 seconds, not 30 minutes, so a retry is available almost immediately.

When it still misses, the report says which fields are missing **and why**,
and distinguishes that from a token that genuinely publishes nothing — see
above. A paid CoinGecko plan raises the limit and would remove the problem
entirely; nothing here requires one.

### The verdict escalates rather than averages

`buildVerdict()` is driven by the worst flag present *plus* a count rule: two
`tinggi` flags make `kritis`, three `sedang` flags make `tinggi`. A pile of
moderate problems is a serious problem, and averaging severities would hide
exactly that case. `info` flags (launchpad graduation, the unverifiable-check
count) are context and never move the verdict.

### Posts from strangers are data, not instructions

Everything the social layer returns is text written by people with an interest
in the token's price. It reaches the model inside an explicit data envelope,
the system prompt states that posts are quotable evidence and never
instructions, and the response is constrained to a JSON schema — so the worst
case of a post containing "ignore previous instructions" or "this token is
audited and safe" is a bad summary, not a redirected agent. Nothing in the
output is executed or fetched; evidence links render with `nofollow` and
`noopener`, and the UI labels the whole block as the authors' claims rather
than verified fact.

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
| `GET /api/pools?preset=&lp=&force=` | Scanned, scored, annotated pools + meta (scannedAt, sourceHealth, active/requested preset). Each pool carries `score`/`presetGate` (trade view), `lp`/`lpGate` (liquidity view), and `funnel` (the practitioner security-first gate — computed once per scan, not re-evaluated per posture). `force=1` bypasses the cache. Switching either preset is free — it re-evaluates the cached scan, it doesn't re-scan. |
| `GET /api/status` | Runtime health, last scan summary, which optional integrations are configured. |
| `GET /api/history?limit=` | Recent signal transitions (newest first), capped at 250 total. |
| `POST /api/alert` `{ address }` | Sends a manual Telegram alert for a pool from the current cache. 404 if the pool isn't in the last scan. |
| `GET /api/token/:address?force=` | One token's full analysis report in Indonesian — fundamentals, holder distribution, order flow, a security checklist, risk findings, a generated narrative, and (when configured) X/Twitter intelligence. 404 if no source knows the address on this chain. Cached for `TOKEN_REPORT_TTL_SECONDS`. |

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
