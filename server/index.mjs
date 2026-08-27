import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

import { loadConfig } from "./config.mjs";
import { createScanCache } from "./scanCache.mjs";
import { createHistoryStore } from "./historyStore.mjs";
import { createPipeline } from "./pipeline.mjs";
import { sendTelegramAlert, formatPoolAlertText } from "./alerts.mjs";
import { PRESETS } from "../shared/scoring.js";
import { LP_PRESETS, evaluateLpPreset } from "../shared/lpScoring.js";
import { createSignalTracker, annotatePoolWithPreset } from "../shared/signalTransitions.js";
import { UpstreamError } from "../shared/dataSources/httpClient.mjs";
import { createTokenReportService, TokenNotFoundError } from "./tokenReports.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const config = await loadConfig();

  const historyStore = createHistoryStore({ filePath: config.historyFilePath, cap: config.historyCap });
  const signalTracker = createSignalTracker({ cooldownMs: config.cooldownMs });
  const pipeline = createPipeline(config, { signalTracker, historyStore });
  const scanCache = createScanCache({ ttlMs: config.scanIntervalMs });
  const tokenReports = createTokenReportService(config);

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  // Public, read-only analytics API with no auth/secrets in the response —
  // CORS is intentionally open so any local dev frontend can hit it.
  app.use("/api", (req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    next();
  });

  function resolvePreset(req) {
    const key = typeof req.query.preset === "string" && req.query.preset in PRESETS ? req.query.preset : config.activePresetKey;
    return { key, preset: PRESETS[key] };
  }

  function resolveLpPreset(req) {
    const key =
      typeof req.query.lp === "string" && req.query.lp in LP_PRESETS ? req.query.lp : config.defaultLpPresetKey;
    return { key, preset: LP_PRESETS[key] };
  }

  app.get("/api/pools", async (req, res) => {
    try {
      const force = req.query.force === "1";
      const result = await scanCache.getOrRun(pipeline.runScan, { force });
      const { key: requestedPresetKey, preset } = resolvePreset(req);
      const { key: requestedLpPresetKey, preset: lpPreset } = resolveLpPreset(req);

      // Both gates are re-evaluated per request against the cached scan, so
      // switching either posture is free — it never triggers a re-scan.
      const pools = result.pools.map((p) => ({
        ...annotatePoolWithPreset(p, preset),
        lpGate: evaluateLpPreset(p, lpPreset),
      }));

      res.set("Cache-Control", "no-store");
      res.json({
        pools,
        meta: {
          scannedAt: result.scannedAt,
          sourceHealth: result.sourceHealth,
          activePreset: config.activePresetKey,
          requestedPreset: requestedPresetKey,
          requestedLpPreset: requestedLpPresetKey,
          poolCount: pools.length,
        },
      });
    } catch (err) {
      respondUpstreamError(res, err, "Failed to scan pools");
    }
  });

  // One token's full analysis report: on-chain fundamentals, holder
  // distribution, order flow, a security checklist that reports what it
  // genuinely cannot verify, an Indonesian narrative, and — when a social
  // provider is configured — the team/catalyst/community/alpha synthesis.
  app.get("/api/token/:address", async (req, res) => {
    try {
      const report = await tokenReports.getReport(req.params.address, { force: req.query.force === "1" });
      res.set("Cache-Control", "no-store");
      res.json(report);
    } catch (err) {
      if (err instanceof TokenNotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      respondUpstreamError(res, err, "Gagal menyusun laporan token");
    }
  });

  app.get("/api/status", async (req, res) => {
    const cached = scanCache.peek();
    res.set("Cache-Control", "no-store");
    res.json({
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      activePreset: config.activePresetKey,
      presets: Object.keys(PRESETS),
      defaultLpPreset: config.defaultLpPresetKey,
      lpPresets: Object.keys(LP_PRESETS),
      scanIntervalSeconds: config.scanIntervalMs / 1000,
      lastScan: cached
        ? { scannedAt: cached.scannedAt, poolCount: cached.pools.length, sourceHealth: cached.sourceHealth }
        : null,
      stockApiConfigured: Boolean(config.stockApiKey),
      telegramConfigured: Boolean(config.telegramBotToken && config.telegramChatId),
      tokenMapSize: Object.keys(config.tokenMap).length,
      socialConfigured: Boolean(config.socialProvider && config.socialApiKey),
      socialProvider: config.socialProvider || null,
      llmConfigured: Boolean(config.anthropicApiKey),
      llmModel: config.anthropicApiKey ? config.llmModel : null,
      tokenReportCacheSize: tokenReports.cacheSize(),
      geckoTokenCacheSize: tokenReports.geckoCacheSize(),
    });
  });

  app.get("/api/history", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 100;
      const all = await historyStore.readAll();
      const recent = all.slice(-limit).reverse(); // newest first
      res.set("Cache-Control", "no-store");
      res.json({ history: recent, total: all.length });
    } catch (err) {
      respondUpstreamError(res, err, "Failed to read signal history");
    }
  });

  app.post("/api/alert", async (req, res) => {
    try {
      const address = req.body?.address;
      if (!address) {
        return res.status(400).json({ error: "Missing required field: address" });
      }

      const cached = scanCache.peek();
      const pool = cached?.pools.find((p) => p.address?.toLowerCase() === String(address).toLowerCase());
      if (!pool) {
        return res.status(404).json({ error: `No cached pool found for address ${address}. Try GET /api/pools first.` });
      }

      const { key: presetKey } = resolvePreset(req);
      const result = await sendTelegramAlert({
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
        text: formatPoolAlertText(pool, { preset: presetKey }),
      });

      res.json({ ...result, note: "Informational only — not financial advice." });
    } catch (err) {
      respondUpstreamError(res, err, "Failed to send alert");
    }
  });

  // Optional: serve a built frontend (web/dist) from the same origin/port so
  // there's a single-process production deploy with zero CORS surface.
  const webDist = join(__dirname, "..", "web", "dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("/{*splat}", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(join(webDist, "index.html"));
    });
  }

  app.use((err, req, res, next) => {
    respondUpstreamError(res, err, "Unexpected server error");
  });

  function respondUpstreamError(res, err, fallbackMessage) {
    const isUpstream = err instanceof UpstreamError;
    console.error(`[marksman] ${fallbackMessage}:`, err.message);
    res.status(502).json({
      error: isUpstream ? err.message : fallbackMessage,
      note: "Screener temporarily degraded — no action needed, this is not a trading signal.",
    });
  }

  app.listen(config.port, config.host, () => {
    console.log(`Marksman backend listening on http://${config.host}:${config.port} (chain ${config.chainId}, preset "${config.activePresetKey}")`);
  });

  // Proactive background refresh so signals/history/alerts keep firing even
  // with no HTTP traffic, independent of the on-demand cache in /api/pools.
  async function backgroundTick() {
    try {
      await scanCache.getOrRun(pipeline.runScan);
    } catch (err) {
      console.error("[marksman] background scan failed:", err.message);
    }
  }
  backgroundTick();
  setInterval(backgroundTick, config.scanIntervalMs);
}

main().catch((err) => {
  console.error("[marksman] fatal startup error:", err);
  process.exit(1);
});
