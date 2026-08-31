// Turning Robinhood Chain LP transactions into positions with a P&L.
//
// Uniswap v4 keeps no per-position accounting on chain. A `ModifyLiquidity`
// event says only which pool moved, over which tick range, by how much
// LIQUIDITY, and — crucially — carries the position's NFT id in `salt`. That
// last field is what makes exact attribution possible: every liquidity change
// is unambiguously one position's, even in a transaction that closes one
// position and opens another in the same breath.
//
// Everything here is pure. Prices arrive as a lookup the caller has already
// filled in, so the fold is deterministic and testable without a network.

/** v4's PositionManager stores the NFT id in the position's salt. */
export function tokenIdFromSalt(salt) {
  try {
    const id = BigInt(salt);
    return id > 0n ? id.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Pulls the liquidity changes out of one transaction's decoded logs.
 * Anything that is not a `ModifyLiquidity` is not this module's business.
 */
export function extractLiquidityEvents(logs) {
  const events = [];

  for (const log of logs ?? []) {
    const decoded = log?.decoded;
    if (!decoded || !decoded.method_call?.startsWith("ModifyLiquidity(")) continue;

    const params = Object.fromEntries((decoded.parameters ?? []).map((p) => [p.name, p.value]));
    const tokenId = tokenIdFromSalt(params.salt);
    if (!tokenId) continue; // a position with no id is not one we can track

    events.push({
      poolId: String(params.id ?? "").toLowerCase(),
      tokenId,
      tickLower: Number(params.tickLower),
      tickUpper: Number(params.tickUpper),
      liquidityDelta: Number(params.liquidityDelta),
    });
  }

  return events;
}

/**
 * The wallet's own signed token movements in a transaction: positive is what
 * arrived, negative is what left. Transfers between other parties in the same
 * transaction (router to pool, tax hops, internal swaps) are not the wallet's
 * money and are ignored.
 */
export function walletFlows(transfers, wallet) {
  const me = wallet.toLowerCase();
  const byToken = new Map();

  for (const t of transfers ?? []) {
    const from = (t.from?.hash ?? "").toLowerCase();
    const to = (t.to?.hash ?? "").toLowerCase();
    const sign = to === me ? 1 : from === me ? -1 : 0;
    if (!sign) continue;

    const decimals = Number(t.total?.decimals ?? 18);
    const amount = Number(t.total?.value ?? 0) / 10 ** decimals;
    if (!Number.isFinite(amount)) continue;

    const address = (t.token?.address_hash ?? "").toLowerCase();
    const row = byToken.get(address) ?? { address, symbol: t.token?.symbol ?? "?", decimals, amount: 0 };
    row.amount += sign * amount;
    byToken.set(address, row);
  }

  return [...byToken.values()];
}

/**
 * Folds transactions into positions.
 *
 * Deposits and withdrawals are valued from the liquidity that moved, priced at
 * the moment it moved — `valueLiquidity` is injected so this stays pure. Fees
 * are the part liquidity math cannot see (they are paid out on top of
 * principal), so they are read from what actually reached the wallet beyond
 * the principal it got back.
 *
 * @param {Array<{hash:string, timestamp:number, events:Array, flows:Array}>} txs oldest first
 * @param {{ valueLiquidity: (e: object, ts: number) => ({usd:number}|null), priceToken: (address: string, ts: number) => number|null }} deps
 */
export function foldPositions(txs, { valueLiquidity, priceToken }) {
  const positions = new Map();
  const failedTxs = [];

  for (const tx of [...txs].sort((a, b) => a.timestamp - b.timestamp)) {
    // What the wallet received in this transaction, in dollars. Used to
    // separate fees from principal below.
    let walletInUsd = 0;
    let walletFlowPriced = true;
    for (const flow of tx.flows ?? []) {
      if (flow.amount <= 0) continue;
      const price = priceToken(flow.address, tx.timestamp);
      if (price == null) { walletFlowPriced = false; continue; }
      walletInUsd += flow.amount * price;
    }

    let principalOutUsd = 0;

    for (const event of tx.events) {
      const position = positions.get(event.tokenId) ?? {
        tokenId: event.tokenId,
        poolId: event.poolId,
        pair: null,
        openedAt: tx.timestamp,
        closedAt: null,
        liquidity: 0,
        depositUsd: 0,
        withdrawUsd: 0,
        feeUsd: 0,
        tickLower: event.tickLower,
        tickUpper: event.tickUpper,
        priced: true,
        // True when the first liquidity change we ever saw for this position
        // was not an increase. Then we joined its life partway through and
        // never saw what it cost — so its P&L is unknowable, however
        // confident the withdrawal figure looks. Without this guard a
        // position whose opening transaction went missing reports its entire
        // exit value as profit.
        partial: event.liquidityDelta <= 0,
        eventCount: 0,
      };
      position.eventCount++;
      position.liquidity += event.liquidityDelta;

      if (event.liquidityDelta !== 0) {
        const valued = valueLiquidity(event, tx.timestamp);
        if (valued == null) {
          // The position stays in the ledger but is flagged: a position whose
          // deposits could not be priced has an unknown P&L, not a zero one.
          position.priced = false;
        } else if (event.liquidityDelta > 0) {
          position.depositUsd += valued.usd;
        } else {
          position.withdrawUsd += valued.usd;
          principalOutUsd += valued.usd;
        }
      }

      // Liquidity back to zero is a close, whether or not the NFT is burned —
      // in v4 it usually is not, so waiting for a burn would find none.
      position.closedAt = position.liquidity <= 0 ? tx.timestamp : null;
      if (position.liquidity < 0) position.liquidity = 0;

      positions.set(event.tokenId, position);
    }

    // Anything the wallet received beyond the principal it withdrew is fee
    // income. Split across the positions that paid out in this transaction,
    // in proportion to how much principal each returned.
    const feeUsd = walletInUsd - principalOutUsd;
    if (walletFlowPriced && feeUsd > 0 && principalOutUsd > 0) {
      for (const event of tx.events) {
        if (event.liquidityDelta >= 0) continue;
        const position = positions.get(event.tokenId);
        const valued = valueLiquidity(event, tx.timestamp);
        if (!position || valued == null) continue;
        position.feeUsd += feeUsd * (valued.usd / principalOutUsd);
      }
    }
  }

  const all = [...positions.values()];
  return {
    positions: all,
    // Counted per position, not per event — one pool with no price series
    // must not read as a dozen separate failures.
    unpriced: all.filter((p) => !p.priced).length,
    partial: all.filter((p) => p.partial).length,
    failedTxs,
  };
}

/**
 * The shape `walletPnl.js` consumes: one row per CLOSED position, with the P&L
 * that was realized and the day it was realized on. Open positions are left
 * out on purpose — an unrealized number does not belong on a day that has
 * already happened.
 */
export function realizedPositions(positions, { pairFor } = {}) {
  return positions
    .filter((p) => p.closedAt != null)
    .map((p) => ({
      address: p.tokenId,
      pool: p.poolId,
      pair: pairFor?.(p.poolId) ?? p.pair ?? p.poolId,
      openedAt: p.openedAt,
      closedAt: p.closedAt,
      // Unpriced positions carry a null P&L so the day they closed on reads as
      // incomplete rather than quietly break-even.
      pnl: p.priced && !p.partial ? p.withdrawUsd + p.feeUsd - p.depositUsd : null,
      fees: p.priced && !p.partial ? p.feeUsd : null,
      depositUsd: p.priced && !p.partial ? p.depositUsd : null,
    }));
}
