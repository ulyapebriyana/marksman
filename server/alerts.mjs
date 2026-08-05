// Telegram alert sender. Fully optional — if TELEGRAM_BOT_TOKEN/CHAT_ID
// aren't set, sendTelegramAlert() is a documented no-op rather than an error,
// so the rest of the app never depends on alerting being configured.

import { postJson, UpstreamError } from "../shared/dataSources/httpClient.mjs";

const DISCLAIMER = "\n\n_Informational only — not financial advice._";

/**
 * @param {{ botToken?: string, chatId?: string, text: string, timeoutMs?: number }} opts
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export async function sendTelegramAlert(opts) {
  const { botToken, chatId, text, timeoutMs = 8000 } = opts;

  if (!botToken || !chatId) {
    return { sent: false, reason: "telegram_not_configured" };
  }

  try {
    await postJson(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      { chat_id: chatId, text: `${text}${DISCLAIMER}`, parse_mode: "Markdown" },
      { timeoutMs }
    );
    return { sent: true };
  } catch (err) {
    const reason = err instanceof UpstreamError ? err.message : String(err?.message ?? err);
    return { sent: false, reason };
  }
}

/**
 * @param {object} pool enriched, scored pool
 * @param {{ preset?: string, transition?: {from:string, to:string} }} [ctx]
 */
export function formatPoolAlertText(pool, ctx = {}) {
  const symbol = pool?.baseToken?.symbol ?? pool?.address ?? "unknown pool";
  const lines = [`*Marksman signal:* ${symbol}`];

  if (ctx.transition) lines.push(`Status: ${ctx.transition.from} → *${ctx.transition.to}*`);
  if (ctx.preset) lines.push(`Preset: ${ctx.preset}`);
  if (typeof pool?.score?.total === "number") lines.push(`Score: ${pool.score.total}/100`);
  if (typeof pool?.risk?.value === "number") lines.push(`Risk: ${pool.risk.value}/100`);
  if (pool?.isTokenizedStock && typeof pool?.premiumPct === "number") {
    const sign = pool.premiumPct >= 0 ? "+" : "";
    lines.push(`Premium vs ${pool.stockTicker}: ${sign}${pool.premiumPct.toFixed(2)}%`);
  }
  if (pool?.address) lines.push(`Pool: \`${pool.address}\``);

  return lines.join("\n");
}
