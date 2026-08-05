// Orchestrates the full scan pipeline described in the spec:
// INTAKE -> PRE-FILTER -> ENRICH -> NORMALIZE -> SCORE+RISK -> DECIDE ->
// DETECT TRANSITIONS + side effects. All the actual scoring/decision math
// lives in shared/*.js (pure, unit-tested); this file is pure orchestration
// and I/O wiring.

import { fetchBulkPairs } from "../shared/dataSources/dexscreener.mjs";
import { fetchBulkPools, getPoolOhlcv } from "../shared/dataSources/geckoterminal.mjs";
import { fetchUnderlyingPrice } from "../shared/dataSources/equity.mjs";
import { normalizeDexScreenerPair, normalizeGeckoTerminalPool, mergePoolSources, applyEnrichment } from "../shared/normalize.js";
import { calculateScore, calculateRisk, PRESETS } from "../shared/scoring.js";
import { mapWithConcurrency } from "../shared/concurrency.mjs";
import { createTtlCache } from "../shared/ttlCache.mjs";
import { sendTelegramAlert, formatPoolAlertText } from "./alerts.mjs";

/**
 * @param {import('./config.mjs').Config} config
 * @param {{ signalTracker: ReturnType<typeof import('../shared/signalTransitions.js').createSignalTracker>, historyStore: ReturnType<typeof import('./historyStore.mjs').createHistoryStore> }} deps
 */
export function createPipeline(config, deps) {
  const { signalTracker, historyStore } = deps;

  // Per-item caches: same TTL ballpark as the scan interval for successes,
  // shorter for failures so a flaky source is retried sooner but not hammered.
  const geckoCache = createTtlCache({ successTtlMs: config.scanIntervalMs - 2000, failureTtlMs: 20_000 });
  const equityCache = createTtlCache({ successTtlMs: config.scanIntervalMs - 2000, failureTtlMs: 20_000 });

  async function runScan() {
    const now = Date.now();
    const sourceHealth = {
      dexscreener: { ok: true },
      geckoterminal: { ok: true, successCount: 0, failureCount: 0 },
      equity: { ok: true, successCount: 0, failureCount: 0 },
    };

    // 1. INTAKE — GeckoTerminal's chain-wide pool listing is the primary
    // discovery source (no keyword-search blind spots); DexScreener's
    // keyword search runs alongside it purely to attach honeypot/danger
    // labels where available. Both run in parallel.
    const [geckoBulkPools, rawPairs] = await Promise.all([
      fetchBulkPools(config.geckoNetworkSlug, {
        pages: config.bulkScan.geckoPages,
        includeNewPools: config.bulkScan.includeNewPools,
      }).catch((err) => {
        console.error("[marksman] GeckoTerminal bulk scan failed:", err.message);
        return [];
      }),
      fetchBulkPairs({
        chainId: config.chainId,
        seedQueries: config.seedQueries,
        tokenAddresses: Object.keys(config.tokenMap),
        concurrency: config.enrich.concurrency,
      }),
    ]);
    sourceHealth.geckoterminal.bulkPoolsReturned = geckoBulkPools.length;
    sourceHealth.geckoterminal.bulkOk = geckoBulkPools.length > 0;
    sourceHealth.dexscreener.pairsReturned = rawPairs.length;
    sourceHealth.dexscreener.ok = rawPairs.length > 0;

    // 4. NORMALIZE (raw shape -> internal shape) — done right after intake so
    // every later step works with one consistent object, then union the two
    // sources by address.
    const normalizedFromGecko = geckoBulkPools.map((raw) =>
      normalizeGeckoTerminalPool(raw, { now, tokenMap: config.tokenMap, chainId: config.chainId })
    );
    const normalizedFromDex = rawPairs.map((raw) => normalizeDexScreenerPair(raw, { now, tokenMap: config.tokenMap }));
    const normalized = mergePoolSources(normalizedFromDex, normalizedFromGecko);

    // 2. PRE-FILTER
    const { minLiquidityUsd, minVolume24hUsd, topN } = config.preFilter;
    const filtered = normalized
      .filter((p) => p.liquidityUsd >= minLiquidityUsd && p.volume.h24 >= minVolume24hUsd)
      .sort((a, b) => b.volume.h24 - a.volume.h24)
      .slice(0, topN);

    // 3. ENRICH (parallel, bounded concurrency)
    const shortlist = filtered.slice(0, config.enrich.geckoShortlistN);
    const candlesByAddress = new Map();
    await mapWithConcurrency(
      shortlist,
      async (pool) => {
        try {
          const candles = await geckoCache.getOrFetch(pool.address, () =>
            getPoolOhlcv(config.geckoNetworkSlug, pool.address, { timeframe: "hour", aggregate: 1, limit: 24 })
          );
          candlesByAddress.set(pool.address, candles);
          sourceHealth.geckoterminal.successCount++;
        } catch {
          sourceHealth.geckoterminal.failureCount++;
        }
      },
      config.enrich.concurrency
    );
    sourceHealth.geckoterminal.ok =
      sourceHealth.geckoterminal.bulkOk &&
      (sourceHealth.geckoterminal.failureCount === 0 || sourceHealth.geckoterminal.successCount > 0);

    const stockTickers = [...new Set(filtered.filter((p) => p.isTokenizedStock).map((p) => p.stockTicker))];
    const priceByTicker = new Map();
    await mapWithConcurrency(
      stockTickers,
      async (ticker) => {
        try {
          const price = await equityCache.getOrFetch(ticker, () =>
            fetchUnderlyingPrice(ticker, { provider: config.stockApiProvider, apiKey: config.stockApiKey })
          );
          priceByTicker.set(ticker, price);
          sourceHealth.equity.successCount++;
        } catch {
          sourceHealth.equity.failureCount++;
        }
      },
      config.enrich.concurrency
    );
    sourceHealth.equity.ok = stockTickers.length === 0 || sourceHealth.equity.successCount > 0 || sourceHealth.equity.failureCount === 0;

    const enriched = filtered.map((pool) =>
      applyEnrichment(pool, {
        candles: candlesByAddress.get(pool.address),
        underlyingPrice: priceByTicker.get(pool.stockTicker),
      })
    );

    // 5. SCORE + RISK
    const scored = enriched.map((pool) => {
      const risk = calculateRisk(pool);
      const withRisk = { ...pool, risk };
      const score = calculateScore(withRisk);
      return { ...withRisk, score };
    });

    // 6. DECIDE + 7. DETECT TRANSITIONS (against the fixed, operational preset)
    const activePreset = PRESETS[config.activePresetKey];
    const events = signalTracker.detectTransitions(scored, activePreset, now);

    for (const event of events) {
      const symbol = event.pool?.baseToken?.symbol ?? event.address;
      await historyStore.append({
        address: event.address,
        symbol,
        from: event.from,
        to: event.to,
        at: event.at,
        preset: config.activePresetKey,
        score: event.pool?.score?.total ?? null,
        risk: event.pool?.risk?.value ?? null,
        premiumPct: event.pool?.premiumPct ?? null,
      });

      if (config.autoAlertOnHot && event.to === "hot") {
        await sendTelegramAlert({
          botToken: config.telegramBotToken,
          chatId: config.telegramChatId,
          text: formatPoolAlertText(event.pool, { preset: config.activePresetKey, transition: event }),
        });
      }
    }

    return { pools: scored, scannedAt: now, sourceHealth, activePresetKey: config.activePresetKey };
  }

  return { runScan };
}
