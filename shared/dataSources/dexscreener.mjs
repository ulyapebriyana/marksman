// DexScreener (no API key). This is the PRIMARY intake source: it's the only
// free-tier call that returns many pairs per request.
//
// IMPORTANT caveat (verified live against the API): DexScreener's free API
// has no "list every pair on chain X" endpoint. `/latest/dex/search?q=...`
// is a keyword search whose results *happen* to include a `chainId` field,
// so we run a small set of seed queries and keep only hits on our chain.
// We additionally sweep `token-pairs/v1/{chain}/{tokenAddress}` for every
// address in the tokenized-stock map, so stock pools are never missed just
// because their symbol didn't match a seed query. Confirmed live: chainId
// slug for Robinhood Chain is "robinhood".

import { fetchJson } from "./httpClient.mjs";
import { mapWithConcurrency } from "../concurrency.mjs";

const BASE_URL = "https://api.dexscreener.com";
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * @param {string} query
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<object[]>} raw DexScreener pair objects
 */
export async function searchPairs(query, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const url = `${BASE_URL}/latest/dex/search?q=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, { timeoutMs });
  return Array.isArray(data?.pairs) ? data.pairs : [];
}

/**
 * All pools for a single token address on a given chain.
 * @param {string} chainId
 * @param {string} tokenAddress
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function getTokenPairs(chainId, tokenAddress, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const url = `${BASE_URL}/token-pairs/v1/${chainId}/${tokenAddress}`;
  const data = await fetchJson(url, { timeoutMs });
  return Array.isArray(data) ? data : [];
}

function dedupeByAddress(pairs) {
  const seen = new Map();
  for (const pair of pairs) {
    const key = String(pair?.pairAddress ?? "").toLowerCase();
    if (key && !seen.has(key)) seen.set(key, pair);
  }
  return [...seen.values()];
}

/**
 * The bulk "scan" call used by the pipeline's INTAKE step. Merges keyword
 * search hits with a direct sweep of known tokenized-stock addresses, filters
 * to the target chain, and dedupes by pair address.
 *
 * @param {object} opts
 * @param {string} [opts.chainId]
 * @param {string[]} [opts.seedQueries]
 * @param {string[]} [opts.tokenAddresses] known token addresses to sweep directly (e.g. tokenized stocks)
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.concurrency]
 * @returns {Promise<object[]>} raw pair objects, filtered to chainId, deduped
 */
export async function fetchBulkPairs(opts = {}) {
  const {
    chainId = "robinhood",
    seedQueries = ["robinhood"],
    tokenAddresses = [],
    timeoutMs = DEFAULT_TIMEOUT_MS,
    concurrency = 6,
  } = opts;

  const searchResults = await mapWithConcurrency(
    seedQueries,
    async (query) => {
      try {
        return await searchPairs(query, { timeoutMs });
      } catch {
        return []; // one bad seed query shouldn't sink the whole scan
      }
    },
    concurrency
  );

  const tokenSweepResults = await mapWithConcurrency(
    tokenAddresses,
    async (address) => {
      try {
        return await getTokenPairs(chainId, address, { timeoutMs });
      } catch {
        return [];
      }
    },
    concurrency
  );

  const allPairs = [...searchResults.flat(), ...tokenSweepResults.flat()];
  const onChain = allPairs.filter((p) => p?.chainId === chainId);
  return dedupeByAddress(onChain);
}
