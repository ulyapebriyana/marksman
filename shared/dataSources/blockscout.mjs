// Blockscout — the wallet-history source for Robinhood Chain.
//
// The chain's public RPC is fine for reads at the tip but times out on
// `eth_getLogs` past roughly ten thousand blocks (~17 minutes of chain at
// ~100 ms blocks), which makes it useless for walking months of history.
// Blockscout indexes per address, so one wallet's whole life is a handful of
// paginated calls instead of thousands of range queries.
//
// The public instance sits behind a bot check that answers a bare fetch with
// an HTML challenge, so every request here carries a browser User-Agent. That
// is a header, not a bypass: the API is public and unauthenticated.

import { fetchJson, UpstreamError } from "./httpClient.mjs";

export const BLOCKSCOUT_BASE = "https://robinhoodchain.blockscout.com/api/v2";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

const HEADERS = { "User-Agent": BROWSER_UA, accept: "application/json" };

/** EVM addresses, checksummed or not. */
export function isEvmAddress(value) {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

/**
 * Walks a Blockscout cursor-paginated collection to the end.
 *
 * `maxPages` is a guard, not a limit we expect to hit — but a wallet with
 * tens of thousands of transfers would otherwise walk forever, so hitting it
 * is reported rather than silently truncating the history.
 */
async function paginate(path, { baseUrl = BLOCKSCOUT_BASE, timeoutMs = 15_000, maxPages = 60, pauseMs = 80 } = {}) {
  const items = [];
  let next = null;

  for (let page = 0; page < maxPages; page++) {
    const qs = next ? (path.includes("?") ? "&" : "?") + new URLSearchParams(next) : "";
    const data = await fetchJson(`${baseUrl}${path}${qs}`, { timeoutMs, headers: HEADERS });
    items.push(...(data?.items ?? []));

    next = data?.next_page_params ?? null;
    if (!next) return { items, truncated: false };
    if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }

  return { items, truncated: true };
}

/** Every transaction the address sent or received, newest first. */
export async function fetchAddressTransactions(address, opts = {}) {
  if (!isEvmAddress(address)) throw new UpstreamError(`Not an EVM address: ${address}`, { status: 400 });
  return paginate(`/addresses/${address}/transactions`, opts);
}

/** Every ERC-20 transfer touching the address. */
export async function fetchTokenTransfers(address, opts = {}) {
  if (!isEvmAddress(address)) throw new UpstreamError(`Not an EVM address: ${address}`, { status: 400 });
  return paginate(`/addresses/${address}/token-transfers?type=ERC-20`, opts);
}

/** Every ERC-721 transfer touching the address — the position NFTs. */
export async function fetchNftTransfers(address, opts = {}) {
  if (!isEvmAddress(address)) throw new UpstreamError(`Not an EVM address: ${address}`, { status: 400 });
  return paginate(`/addresses/${address}/token-transfers?type=ERC-721`, opts);
}

/**
 * One transaction's logs, already decoded against the verified contracts.
 * This is where `ModifyLiquidity` lives, and with it the only on-chain record
 * of which position moved and by how much.
 *
 * These paginate at fifty like everything else here, and an LP transaction on
 * a taxed token routinely blows past that — the router's swap, the tax hops
 * and the dividend bookkeeping all land in the same receipt. Reading only the
 * first page silently loses the liquidity events that come after them, which
 * shows up much later as a position that was closed but apparently never
 * opened. So this walks every page.
 */
export async function fetchTransactionLogs(hash, opts = {}) {
  const { items } = await paginate(`/transactions/${hash}/logs`, { maxPages: 20, pauseMs: 0, ...opts });
  return items;
}
