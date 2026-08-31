import "dotenv/config";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadTokenMap } from "../shared/dataSources/tokenMap.mjs";
import { PRESETS } from "../shared/scoring.js";
import { LP_PRESETS } from "../shared/lpScoring.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function envInt(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  return raw != null && Number.isFinite(n) ? n : fallback;
}

/** Loads env + the token map once at startup and freezes it into one config object. */
export async function loadConfig() {
  const tokenMapPath = process.env.TOKEN_MAP_PATH ?? join(ROOT, "data", "token-map.json");
  const tokenMap = await loadTokenMap(tokenMapPath);

  const activePresetKey = process.env.ACTIVE_PRESET in PRESETS ? process.env.ACTIVE_PRESET : "marksman";
  // The LP posture is browse-only — it gates a view, not signals/history/alerts
  // — so this is just the default a client gets when it doesn't ask for one.
  const defaultLpPresetKey = process.env.LP_PRESET in LP_PRESETS ? process.env.LP_PRESET : "carry";

  return Object.freeze({
    port: envInt("PORT", 8787),
    host: process.env.HOST ?? "127.0.0.1", // bind to loopback by default; put nginx/a reverse proxy in front for public exposure
    scanIntervalMs: envInt("SCAN_INTERVAL_SECONDS", 60) * 1000,
    activePresetKey,
    defaultLpPresetKey,

    chainId: process.env.DEXSCREENER_CHAIN_ID ?? "robinhood",
    geckoNetworkSlug: process.env.GECKOTERMINAL_NETWORK ?? "robinhood",
    seedQueries: [
      "robinhood",
      ...new Set(Object.values(tokenMap).map((t) => t.ticker).filter(Boolean)),
    ],

    stockApiProvider: process.env.STOCK_API_PROVIDER ?? "finnhub",
    stockApiKey: process.env.STOCK_API_KEY ?? "",

    // --- Token report (GET /api/token/:address) ---
    // The social layer is the only part of the report that needs a paid key.
    // Everything else works without one, so an unset provider degrades that
    // one section rather than the endpoint.
    socialProvider: process.env.SOCIAL_PROVIDER ?? "",
    socialApiKey: process.env.SOCIAL_API_KEY ?? "",
    // Synthesising team/catalysts/community/alpha out of raw posts is the
    // only job the model has here; it never touches the on-chain numbers.
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
    llmModel: process.env.LLM_MODEL ?? "claude-opus-5",
    tokenReportTtlMs: envInt("TOKEN_REPORT_TTL_SECONDS", 300) * 1000,
    tokenReport: {
      poolDetailLimit: 4,
      concurrency: 3,
      socialLimit: 40,
      // Holder distribution and deployer holding change on the order of a
      // day, so caching them well past the report's own TTL costs nothing in
      // freshness and buys a lot of resilience against the rate limit the
      // background scan keeps saturated.
      geckoTtlMs: envInt("GECKO_TOKEN_TTL_SECONDS", 1800) * 1000,
      // Flow does move minute to minute, so this is much shorter — long
      // enough to stop the contributing-pool set flickering between
      // refreshes, short enough that the numbers stay current.
      poolDetailTtlMs: envInt("POOL_DETAIL_TTL_SECONDS", 120) * 1000,
    },

    // --- Wallet P&L calendar (GET /api/wallet/:address/pnl) ---
    // The one endpoint that reads a wallet rather than the chain at large:
    // Uniswap v4 LP positions on Robinhood Chain, reconstructed from logs.
    walletPnl: {
      // Much longer than a scan, because the two things are not comparable: a
      // pool's price moves every block, while a closed position's P&L is
      // settled history that will never change again. Only the current day can
      // still move. A short TTL would re-walk the whole wallet every few
      // minutes — roughly a hundred explorer calls — to re-derive numbers that
      // were already final.
      ttlMs: envInt("WALLET_PNL_TTL_SECONDS", 900) * 1000,
      // Blockscout is the bottleneck: one call per candidate transaction.
      concurrency: envInt("WALLET_PNL_CONCURRENCY", 6),
      // A guard, not an expected limit — a wallet busier than this reports
      // itself as truncated rather than quietly showing a partial calendar.
      maxLogFetches: envInt("WALLET_PNL_MAX_TX", 600),
      // Candles that have already closed never change, so the price cache is
      // worth keeping across restarts — re-fetching it would spend the
      // GeckoTerminal quota the background scan is already competing for.
      priceCachePath: process.env.PRICE_CACHE_PATH ?? join(ROOT, "data", "price-cache.json"),
    },
    // Optional convenience only — the UI asks for a wallet when it is unset.
    defaultWallet: process.env.DEFAULT_WALLET ?? "",

    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? "",
    autoAlertOnHot: process.env.AUTO_ALERT_ON_HOT === "true",

    tokenMap,
    historyFilePath: process.env.HISTORY_FILE_PATH ?? join(ROOT, "data", "signal-history.json"),

    preFilter: {
      minLiquidityUsd: 2_000,
      minVolume24hUsd: 1_000,
      topN: 48,
    },
    // GeckoTerminal bulk listing is the primary intake/discovery source (it
    // has no keyword-search blind spots, unlike DexScreener). Budget: 3 pages
    // of /pools + 1 page of /new_pools = 4 calls, leaving 20 of the ~30/min
    // rate limit for the candle shortlist below (4 + 20 = 24, headroom for
    // retries).
    bulkScan: {
      geckoPages: 3,
      includeNewPools: true,
    },
    enrich: {
      geckoShortlistN: 20,
      concurrency: 6,
    },
    cooldownMs: 15 * 60 * 1000,
    historyCap: 250,
  });
}
