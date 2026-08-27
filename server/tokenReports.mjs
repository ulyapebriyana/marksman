// Orchestration for GET /api/token/:address — the I/O half of the token
// report. All the judgement lives in shared/tokenReport.js and
// shared/narrative.js; this file only fetches, caches, and assembles.

import { createTtlCache } from "../shared/ttlCache.mjs";
import { mapWithConcurrency } from "../shared/concurrency.mjs";
import {
  getTokenInfo,
  getTokenMarket,
  getPoolDetail,
  getDexScreenerToken,
} from "../shared/dataSources/tokenIntel.mjs";
import { fetchSocialMentions, buildSocialQuery } from "../shared/dataSources/socialIntel.mjs";
import { buildTokenReport } from "../shared/tokenReport.js";
import { buildNarrative } from "../shared/narrative.js";
import { synthesizeSocialSections } from "./llmNarrative.mjs";

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** Human-readable failure reason from a rejected Promise.allSettled entry. */
function reasonOf(settled) {
  if (settled.status !== "rejected") return null;
  const err = settled.reason;
  if (err?.status === 429) return "rate_limited";
  return err?.message ? String(err.message).slice(0, 120) : "unknown";
}

export class TokenNotFoundError extends Error {
  constructor(address) {
    super(`Token ${address} tidak ditemukan di chain ini.`);
    this.name = "TokenNotFoundError";
  }
}

export function isValidAddress(address) {
  return EVM_ADDRESS.test(String(address ?? ""));
}

/**
 * @param {object} config loadConfig() result
 */
export function createTokenReportService(config) {
  // Reports are much more expensive than a pool row (up to 6 upstream calls
  // plus an LLM round-trip), and a token's fundamentals don't move on a
  // 60-second cadence, so this cache is deliberately longer-lived than the
  // scan cache.
  const cache = createTtlCache({
    successTtlMs: config.tokenReportTtlMs,
    failureTtlMs: Math.min(30_000, config.tokenReportTtlMs),
  });

  // Two requests for the same cold token would otherwise both do the full
  // fetch, including paying for two LLM calls.
  const inFlight = new Map();

  async function fetchReport(address) {
    const network = config.geckoNetworkSlug;

    // Independent upstreams — one being down must not stop the others, so
    // each settles on its own and the builder handles the nulls.
    const [infoRes, marketRes, dexRes] = await Promise.allSettled([
      getTokenInfo(network, address),
      getTokenMarket(network, address),
      getDexScreenerToken(address, { chainId: config.chainId }),
    ]);

    const info = infoRes.status === "fulfilled" ? infoRes.value : null;
    const market = marketRes.status === "fulfilled" ? marketRes.value : null;
    const dexToken = dexRes.status === "fulfilled" ? dexRes.value : null;

    // Which sources actually answered. This is NOT cosmetic: without it the
    // report cannot tell "this token publishes no holder data" apart from
    // "GeckoTerminal rate-limited us just now", and it would report the
    // second as the first — exactly the kind of confident-but-wrong gap this
    // codebase refuses to ship.
    const sourceHealth = {
      geckoterminal:
        infoRes.status === "fulfilled" || marketRes.status === "fulfilled"
          ? { ok: true, reason: null }
          : { ok: false, reason: reasonOf(infoRes) ?? reasonOf(marketRes) },
      dexscreener:
        dexRes.status === "fulfilled" ? { ok: true, reason: null } : { ok: false, reason: reasonOf(dexRes) },
    };

    // Nothing anywhere knows this address: a real 404, not a degraded report.
    if (!info && !market && !dexToken?.pairs?.length) {
      throw new TokenNotFoundError(address);
    }

    // Pool detail is only worth fetching for the pools that carry the
    // liquidity — it costs one rate-limited call each and the tail pools
    // contribute rounding error.
    const poolAddresses = (
      market?.topPoolAddresses?.length
        ? market.topPoolAddresses
        : (dexToken?.pairs ?? [])
            .slice()
            .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
            .map((p) => p.address)
            .filter(Boolean)
    ).slice(0, config.tokenReport.poolDetailLimit);

    const poolDetails = (
      await mapWithConcurrency(
        poolAddresses,
        (addr) => getPoolDetail(network, addr).catch(() => null),
        config.tokenReport.concurrency
      )
    ).filter(Boolean);

    const identityForQuery = {
      symbol: info?.symbol ?? dexToken?.pairs?.[0]?.baseToken?.symbol ?? null,
      address,
      twitterUrl: dexToken?.links?.socials?.find((s) => s.type === "twitter")?.url ?? null,
    };

    const social = await fetchSocialMentions({
      provider: config.socialProvider,
      apiKey: config.socialApiKey,
      query: buildSocialQuery(identityForQuery),
      limit: config.tokenReport.socialLimit,
    });

    const report = buildTokenReport(
      { info, market, dexToken, poolDetails, address, social, sourceHealth },
      { chain: config.chainId }
    );

    const narrative = buildNarrative(report);

    const synthesis = await synthesizeSocialSections({
      report,
      social,
      apiKey: config.anthropicApiKey,
      model: config.llmModel,
    });

    return {
      ...report,
      narrative,
      social: {
        ...report.social,
        // Says which half is missing, so the UI can distinguish "no social
        // source" from "social source but no synthesis key" — different
        // problems with different fixes.
        synthesisConfigured: Boolean(config.anthropicApiKey),
        synthesis: synthesis ?? null,
      },
      meta: {
        ...report.meta,
        cacheTtlSeconds: Math.round(config.tokenReportTtlMs / 1000),
      },
    };
  }

  /**
   * @param {string} rawAddress
   * @param {{ force?: boolean }} [opts]
   */
  async function getReport(rawAddress, opts = {}) {
    const address = String(rawAddress).toLowerCase();
    if (!isValidAddress(address)) {
      throw new TokenNotFoundError(rawAddress);
    }

    if (opts.force) cache.clear();
    if (inFlight.has(address)) return inFlight.get(address);

    const promise = cache
      .getOrFetch(address, () => fetchReport(address))
      .finally(() => inFlight.delete(address));

    inFlight.set(address, promise);
    return promise;
  }

  return { getReport, cacheSize: () => cache.size() };
}
