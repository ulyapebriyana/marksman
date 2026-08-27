// Token-level intake (as opposed to pool-level, which the screener pipeline
// handles). A token report needs things a pool row never carries: total
// supply, holder distribution, who deployed it and how much they still hold,
// launchpad graduation, and the full set of pools the token trades in.
//
// Two sources, both keyless:
//
//   GeckoTerminal /tokens/{addr}/info  — the important one. It publishes
//     holder count + top-10/11-30/31-50 distribution, developer address and
//     holding %, mint/freeze authority, a honeypot flag, and a gt_score.
//     None of that is in the pool listing the screener scans, and it is the
//     data the funnel's security stage otherwise has to mark unverifiable.
//   DexScreener /tokens/{addr}         — every pair for the token, plus the
//     socials/websites/image block GeckoTerminal leaves empty on this chain,
//     plus the honeypot/danger `labels` GeckoTerminal never provides.
//
// Neither is authoritative alone; buildTokenReport() merges them.

import { fetchJson, UpstreamError } from "./httpClient.mjs";

const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex";
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * GeckoTerminal's free tier allows ~30 requests/minute, and this project's
 * background scan already consumes most of that every cycle (see
 * `bulkScan`/`enrich` in server/config.mjs). An on-demand token report
 * therefore lands on a 429 fairly often — but unlike the scan it is a single
 * user waiting on a single page, so a short wait is much better than silently
 * dropping the holder data.
 *
 * Only 429 is retried. A 404 is a real answer and a 5xx won't be fixed by
 * asking again 1.2 seconds later.
 */
async function withRateLimitRetry(fn, { retries = 2, delayMs = 1500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err instanceof UpstreamError && err.status === 429;
      if (!isRateLimit || attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
}

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * GeckoTerminal token metadata + holder/developer/security block.
 *
 * @param {string} network GeckoTerminal network slug, e.g. "robinhood"
 * @param {string} address
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<object|null>} null when the token is unknown to the API
 */
export async function getTokenInfo(network, address, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const url = `${GECKO_BASE}/networks/${network}/tokens/${address}/info`;

  let data;
  try {
    data = await withRateLimitRetry(() => fetchJson(url, { timeoutMs }));
  } catch (err) {
    // A 404 here means "no such token on this chain" — a real answer the
    // caller renders as an empty state, not an upstream outage.
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }

  const a = data?.data?.attributes;
  if (!a) return null;

  const dist = a.holders?.distribution_percentage ?? {};
  return {
    address: a.address?.toLowerCase() ?? address.toLowerCase(),
    name: a.name ?? null,
    symbol: a.symbol ?? null,
    decimals: a.decimals ?? null,
    imageUrl: a.image_url ?? a.image?.large ?? null,
    description: a.description ?? null,
    categories: Array.isArray(a.categories) ? a.categories : [],
    websites: Array.isArray(a.websites) ? a.websites : [],
    twitterHandle: a.twitter_handle ?? null,
    telegramHandle: a.telegram_handle ?? null,
    discordUrl: a.discord_url ?? null,
    gtScore: num(a.gt_score),
    gtScoreDetails: a.gt_score_details ?? null,
    gtVerified: a.gt_verified === true,
    holders: a.holders?.count == null ? null : {
      count: num(a.holders.count),
      top10Pct: num(dist.top_10),
      next20Pct: num(dist["11_30"]),
      next20MorePct: num(dist["31_50"]),
      restPct: num(dist.rest),
      updatedAt: a.holders.last_updated ?? null,
    },
    developerAddress: a.developer_address ?? null,
    developerHoldingPct: num(a.developer_holding_percentage),
    // These three are reported as-is. On an EVM chain `mint_authority` and
    // `freeze_authority` are Solana concepts and come back null — that is
    // "not applicable", NOT "verified absent", so downstream must not read a
    // null here as a clean bill of health.
    mintAuthority: a.mint_authority ?? null,
    freezeAuthority: a.freeze_authority ?? null,
    isHoneypot: a.is_honeypot ?? "unknown",
    launchpad: a.launchpad_details
      ? {
          graduationPct: num(a.launchpad_details.graduation_percentage),
          completed: a.launchpad_details.completed === true,
          completedAt: a.launchpad_details.completed_at ?? null,
          destinationPool: a.launchpad_details.migrated_destination_pool_address ?? null,
        }
      : null,
  };
}

/**
 * GeckoTerminal token market snapshot (supply, FDV, reserve, 24h volume) plus
 * the ids of its top pools.
 *
 * @param {string} network
 * @param {string} address
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<object|null>}
 */
export async function getTokenMarket(network, address, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const url = `${GECKO_BASE}/networks/${network}/tokens/${address}`;

  let data;
  try {
    data = await withRateLimitRetry(() => fetchJson(url, { timeoutMs }));
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }

  const a = data?.data?.attributes;
  if (!a) return null;

  const poolIds = (data?.data?.relationships?.top_pools?.data ?? [])
    .map((p) => String(p.id ?? "").split("_").slice(1).join("_"))
    .filter(Boolean);

  return {
    priceUsd: num(a.price_usd),
    fdvUsd: num(a.fdv_usd),
    marketCapUsd: num(a.market_cap_usd),
    totalReserveUsd: num(a.total_reserve_in_usd),
    volume24hUsd: num(a.volume_usd?.h24),
    normalizedTotalSupply: num(a.normalized_total_supply),
    topPoolAddresses: poolIds,
  };
}

/**
 * One pool's full detail — richer than the listing rows the screener uses:
 * m15/m30 buckets and unique buyer/seller counts, which the flow analysis
 * needs to tell "many traders" from "one bot round-tripping".
 *
 * @param {string} network
 * @param {string} poolAddress
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<object|null>}
 */
export async function getPoolDetail(network, poolAddress, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const url = `${GECKO_BASE}/networks/${network}/pools/${poolAddress}`;

  let data;
  try {
    data = await withRateLimitRetry(() => fetchJson(url, { timeoutMs }));
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }

  const a = data?.data?.attributes;
  if (!a) return null;

  const t = a.transactions ?? {};
  return {
    address: a.address ?? poolAddress,
    name: a.name ?? a.pool_name ?? null,
    dexId: data?.data?.relationships?.dex?.data?.id ?? null,
    priceUsd: num(a.base_token_price_usd),
    liquidityUsd: num(a.reserve_in_usd),
    feePercentage: num(a.pool_fee_percentage),
    lockedLiquidityPct: num(a.locked_liquidity_percentage),
    createdAt: a.pool_created_at ?? null,
    volume: {
      m5: num(a.volume_usd?.m5),
      h1: num(a.volume_usd?.h1),
      h6: num(a.volume_usd?.h6),
      h24: num(a.volume_usd?.h24),
    },
    priceChange: {
      m5: num(a.price_change_percentage?.m5),
      h1: num(a.price_change_percentage?.h1),
      h6: num(a.price_change_percentage?.h6),
      h24: num(a.price_change_percentage?.h24),
    },
    txns: {
      h1: { buys: num(t.h1?.buys), sells: num(t.h1?.sells), buyers: num(t.h1?.buyers), sellers: num(t.h1?.sellers) },
      h6: { buys: num(t.h6?.buys), sells: num(t.h6?.sells), buyers: num(t.h6?.buyers), sellers: num(t.h6?.sellers) },
      h24: { buys: num(t.h24?.buys), sells: num(t.h24?.sells), buyers: num(t.h24?.buyers), sellers: num(t.h24?.sellers) },
    },
  };
}

/**
 * Every DexScreener pair for a token, plus the socials/links block and any
 * honeypot/danger labels. GeckoTerminal leaves `websites`/`twitter_handle`
 * empty on this chain while DexScreener has them, so this is the only place
 * project links come from.
 *
 * @param {string} address
 * @param {{ chainId?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<{pairs: object[], links: object}>}
 */
export async function getDexScreenerToken(address, opts = {}) {
  const { chainId = null, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const data = await fetchJson(`${DEXSCREENER_BASE}/tokens/${address}`, { timeoutMs });

  const all = Array.isArray(data?.pairs) ? data.pairs : [];
  const pairs = chainId ? all.filter((p) => p.chainId === chainId) : all;

  // The links block is duplicated onto every pair; take it from the first
  // pair that actually carries one.
  const info = pairs.find((p) => p.info)?.info ?? {};

  return {
    pairs: pairs.map((p) => ({
      address: p.pairAddress ?? null,
      dexId: p.dexId ?? null,
      labels: Array.isArray(p.labels) ? p.labels : [],
      url: p.url ?? null,
      baseToken: p.baseToken ?? null,
      quoteToken: p.quoteToken ?? null,
      priceUsd: num(p.priceUsd),
      liquidityUsd: num(p.liquidity?.usd),
      fdv: num(p.fdv),
      marketCap: num(p.marketCap),
      volume: { m5: num(p.volume?.m5), h1: num(p.volume?.h1), h6: num(p.volume?.h6), h24: num(p.volume?.h24) },
      priceChange: {
        m5: num(p.priceChange?.m5),
        h1: num(p.priceChange?.h1),
        h6: num(p.priceChange?.h6),
        h24: num(p.priceChange?.h24),
      },
      txns: {
        h1: { buys: num(p.txns?.h1?.buys), sells: num(p.txns?.h1?.sells) },
        h24: { buys: num(p.txns?.h24?.buys), sells: num(p.txns?.h24?.sells) },
      },
      createdAt: p.pairCreatedAt ?? null,
    })),
    links: {
      imageUrl: info.imageUrl ?? null,
      headerUrl: info.header ?? null,
      websites: Array.isArray(info.websites) ? info.websites : [],
      socials: Array.isArray(info.socials) ? info.socials : [],
    },
  };
}
