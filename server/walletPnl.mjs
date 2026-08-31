// GET /api/wallet/:address/pnl — the service behind the P&L calendar.
//
// Robinhood Chain has no P&L API. This reconstructs one:
//
//   Blockscout      the wallet's transactions, its token flows, and the
//                   decoded `ModifyLiquidity` logs inside them
//   GeckoTerminal   what each token was worth at the hour it moved
//   uniswapMath     how much liquidity that was, in tokens
//   lpLedger        folding it all into positions
//   walletPnl       bucketing closed positions into calendar days
//
// The walk costs one Blockscout call per candidate transaction plus a
// throttled price series per pool, so a cold wallet takes a minute or two.
// That is far too long to hold an HTTP request open — nginx gives up at sixty
// seconds, and a phone on mobile data gives up sooner — so the walk runs as a
// background job and the endpoint answers immediately: 202 with `pending`
// while it runs, the report once it lands. The client polls.
//
// The finished walk is cached per wallet; re-bucketing it for a different time
// zone is done per request and costs nothing.

import { mapWithConcurrency } from "../shared/concurrency.mjs";
import {
  fetchAddressTransactions,
  fetchNftTransfers,
  fetchTokenTransfers,
  fetchTransactionLogs,
  isEvmAddress,
} from "../shared/dataSources/blockscout.mjs";
import { createPriceBook } from "../shared/dataSources/poolPrices.mjs";
import { extractLiquidityEvents, foldPositions, realizedPositions, walletFlows } from "../shared/lpLedger.js";
import { valueOfLiquidity } from "../shared/uniswapMath.js";
import { buildWalletPnl } from "../shared/walletPnl.js";

export class InvalidWalletError extends Error {
  constructor(address) {
    super(`Bukan alamat wallet EVM yang valid: ${address}`);
    this.name = "InvalidWalletError";
  }
}

const seconds = (iso) => Math.floor(new Date(iso).getTime() / 1000);

export function createWalletPnlService(config) {
  const { ttlMs, concurrency, maxLogFetches } = config.walletPnl;
  const prices = createPriceBook({ network: config.geckoNetworkSlug, cachePath: config.walletPnl.priceCachePath });

  /** wallet -> { walked, expiresAt } */
  const results = new Map();
  /** wallet -> { startedAt } for a walk currently running */
  const jobs = new Map();
  /** wallet -> { error, expiresAt }, so a failure surfaces on the next poll */
  const failures = new Map();

  async function walk(address) {
    const [txs, erc20, nfts] = await Promise.all([
      fetchAddressTransactions(address),
      fetchTokenTransfers(address),
      fetchNftTransfers(address),
    ]);

    const timestampOf = new Map();
    const toAddressOf = new Map();
    for (const tx of txs.items) {
      timestampOf.set(tx.hash, seconds(tx.timestamp));
      toAddressOf.set(tx.hash, (tx.to?.hash ?? "").toLowerCase());
    }

    const transfersByTx = new Map();
    for (const t of erc20.items) {
      if (!transfersByTx.has(t.transaction_hash)) transfersByTx.set(t.transaction_hash, []);
      transfersByTx.get(t.transaction_hash).push(t);
      if (!timestampOf.has(t.transaction_hash)) timestampOf.set(t.transaction_hash, seconds(t.timestamp));
    }

    const nftTxs = new Set();
    for (const t of nfts.items) {
      nftTxs.add(t.transaction_hash);
      if (!timestampOf.has(t.transaction_hash)) timestampOf.set(t.transaction_hash, seconds(t.timestamp));
    }

    const failedTxs = [];
    const lpTxs = [];
    const lpContracts = new Set();

    async function scan(hashes) {
      await mapWithConcurrency(
        hashes,
        async (hash) => {
          let logs;
          try {
            logs = await fetchTransactionLogs(hash);
          } catch (err) {
            failedTxs.push({ hash, reason: err.message });
            return;
          }
          const events = extractLiquidityEvents(logs);
          if (events.length === 0) return;
          const to = toAddressOf.get(hash);
          if (to) lpContracts.add(to);
          lpTxs.push({
            hash,
            timestamp: timestampOf.get(hash) ?? 0,
            events,
            flows: walletFlows(transfersByTx.get(hash) ?? [], address),
          });
        },
        concurrency
      );
    }

    // Two passes rather than one, to keep the cost proportional to LP activity
    // instead of to wallet size. Every position NFT movement is LP activity by
    // definition, so pass one is pure signal — and it also reveals which
    // contracts this wallet LPs through. Pass two then looks only at
    // transactions sent to those contracts, which catches liquidity changes
    // that moved no NFT (topping up a position in place). Discovering the
    // routers instead of hardcoding them means a new one ships and this
    // still works.
    const firstPass = [...nftTxs].slice(0, maxLogFetches);
    await scan(firstPass);

    const scanned = new Set(firstPass);
    const secondPass = [...transfersByTx.keys()]
      .filter((hash) => !scanned.has(hash) && lpContracts.has(toAddressOf.get(hash)))
      .slice(0, Math.max(0, maxLogFetches - scanned.size));
    await scan(secondPass);

    const truncated =
      txs.truncated ||
      erc20.truncated ||
      nfts.truncated ||
      nftTxs.size > firstPass.length;

    // One warm-up for every pool the walk touched: identity plus both price
    // series, on the throttle, cached to disk.
    const poolIds = [...new Set(lpTxs.flatMap((tx) => tx.events.map((e) => e.poolId)))];
    const metaById = await prices.warmPools(poolIds);

    const valueLiquidity = (event, ts) => {
      const meta = metaById.get(event.poolId);
      if (!meta) return null;
      const usd0 = prices.priceAt(meta.token0.address, ts);
      const usd1 = prices.priceAt(meta.token1.address, ts);
      if (usd0 == null || usd1 == null) return null;
      return valueOfLiquidity({
        liquidity: event.liquidityDelta,
        tickLower: event.tickLower,
        tickUpper: event.tickUpper,
        usd0,
        usd1,
        decimals0: meta.token0.decimals,
        decimals1: meta.token1.decimals,
      });
    };

    const folded = foldPositions(lpTxs, { valueLiquidity, priceToken: prices.priceAt });
    const pairFor = (poolId) => metaById.get(poolId)?.name ?? poolId;

    return {
      positions: realizedPositions(folded.positions, { pairFor }),
      openPositions: folded.positions.filter((p) => p.closedAt == null).length,
      pools: poolIds.map((id) => ({ poolId: id, name: pairFor(id) })),
      unpriced: folded.unpriced,
      partial: folded.partial,
      failedTxs: [...failedTxs, ...folded.failedTxs],
      truncated,
      lpTxCount: lpTxs.length,
      scannedTxCount: scanned.size + secondPass.length,
      fetchedAt: new Date().toISOString(),
    };
  }

  /** Kicks off a walk and files the outcome. Never rejects to the caller. */
  function startJob(address) {
    const key = address.toLowerCase();
    const startedAt = Date.now();
    jobs.set(key, { startedAt });

    walk(address).then(
      (walked) => {
        results.set(key, { walked, expiresAt: Date.now() + ttlMs });
        failures.delete(key);
        jobs.delete(key);
      },
      (error) => {
        // Short-lived, so a transient upstream failure does not lock the
        // wallet out for the full result TTL.
        failures.set(key, { error, expiresAt: Date.now() + 20_000 });
        jobs.delete(key);
      }
    );

    return { startedAt };
  }

  /**
   * Returns the report if the walk has finished, or a `pending` marker if it
   * has not. Starting the walk is a side effect of asking for it.
   *
   * @param {string} address
   * @param {{ offsetMinutes?: number, force?: boolean }} [opts]
   */
  async function getPnl(address, opts = {}) {
    if (!isEvmAddress(address)) throw new InvalidWalletError(address);
    const { offsetMinutes = 0, force = false } = opts;

    const key = address.toLowerCase();
    const now = Date.now();

    if (force) {
      results.delete(key);
      failures.delete(key);
    }

    const failure = failures.get(key);
    if (failure) {
      if (failure.expiresAt > now) {
        failures.delete(key);
        throw failure.error;
      }
      failures.delete(key);
    }

    const cached = results.get(key);
    const fresh = cached && cached.expiresAt > now;

    // A stale result is still served while the refresh runs behind it — a
    // slightly old calendar beats a spinner, and the walk is idempotent.
    if (!fresh && !jobs.has(key)) startJob(address);

    if (!cached) {
      const job = jobs.get(key);
      return {
        wallet: address,
        pending: true,
        startedAt: new Date(job?.startedAt ?? now).toISOString(),
        elapsedSeconds: Math.round((now - (job?.startedAt ?? now)) / 1000),
        note: "Menyusun ulang riwayat LP dari log on-chain. Ini butuh satu sampai dua menit untuk wallet yang belum pernah dibaca.",
      };
    }

    const walked = cached.walked;
    const report = buildWalletPnl(walked, { offsetMinutes });

    return {
      wallet: address,
      pending: false,
      chain: config.chainId,
      protocol: "uniswap-v4",
      denomination: "USD",
      ...report,
      reconciliation: { ...report.reconciliation, truncated: walked.truncated },
      meta: {
        fetchedAt: walked.fetchedAt,
        // True while a refresh runs behind a result that has aged out.
        refreshing: jobs.has(key),
        sources: ["Blockscout (robinhoodchain)", "GeckoTerminal"],
        cacheTtlSeconds: ttlMs / 1000,
        lpTransactions: walked.lpTxCount,
        transactionsScanned: walked.scannedTxCount,
        // Only positions whose liquidity has gone back to zero are realized.
        // Open ones are still moving and have no place on a day that is over.
        basis: "closed Uniswap v4 positions, valued at the price when each liquidity change happened",
        disclaimer: "Informational only — not financial advice.",
      },
    };
  }

  return { getPnl, cacheSize: () => results.size, jobsRunning: () => jobs.size };
}
