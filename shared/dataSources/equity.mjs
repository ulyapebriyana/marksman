// Real underlying equity price for tokenized-stock pools, used to compute
// premiumPct (on-chain price vs real-world price). Provider-agnostic:
// pick ONE of Finnhub / Polygon / Alpha Vantage via STOCK_API_PROVIDER.

import { fetchJson, UpstreamError } from "./httpClient.mjs";

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchFinnhub(ticker, apiKey, timeoutMs) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`;
  const data = await fetchJson(url, { timeoutMs });
  const price = Number(data?.c);
  if (!Number.isFinite(price) || price <= 0) {
    throw new UpstreamError(`Finnhub returned no usable price for ${ticker}`);
  }
  return price;
}

async function fetchPolygon(ticker, apiKey, timeoutMs) {
  const url = `https://api.polygon.io/v2/last/trade/${encodeURIComponent(ticker)}?apiKey=${apiKey}`;
  const data = await fetchJson(url, { timeoutMs });
  const price = Number(data?.results?.p ?? data?.last?.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new UpstreamError(`Polygon returned no usable price for ${ticker}`);
  }
  return price;
}

async function fetchAlphaVantage(ticker, apiKey, timeoutMs) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`;
  const data = await fetchJson(url, { timeoutMs });
  const price = Number(data?.["Global Quote"]?.["05. price"]);
  if (!Number.isFinite(price) || price <= 0) {
    throw new UpstreamError(`Alpha Vantage returned no usable price for ${ticker}`);
  }
  return price;
}

const PROVIDERS = Object.freeze({
  finnhub: fetchFinnhub,
  polygon: fetchPolygon,
  alphavantage: fetchAlphaVantage,
});

/**
 * @param {string} ticker e.g. "NVDA"
 * @param {{ provider?: string, apiKey?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<number>} last/current price in USD
 */
export async function fetchUnderlyingPrice(ticker, opts = {}) {
  const { provider = "finnhub", apiKey, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

  if (!apiKey) {
    throw new UpstreamError("Missing STOCK_API_KEY — set it in .env to enable premium/discount scoring.");
  }

  const impl = PROVIDERS[provider];
  if (!impl) {
    throw new UpstreamError(`Unknown STOCK_API_PROVIDER "${provider}". Expected one of: ${Object.keys(PROVIDERS).join(", ")}`);
  }

  return impl(ticker, apiKey, timeoutMs);
}
