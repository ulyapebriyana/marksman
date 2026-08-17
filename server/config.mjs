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
