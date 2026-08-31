// Concentrated-liquidity math — the Uniswap v3/v4 identities, and nothing else.
//
// A v4 `ModifyLiquidity` event says how much LIQUIDITY moved, never how many
// tokens. Converting one to the other is the whole reason this file exists:
// without it a position's deposits and withdrawals are unmeasurable, and so
// is its P&L.
//
// Everything here is float math on values that on-chain are 128/160-bit
// integers. That is a deliberate trade: the output is a dollar figure shown to
// two decimals, not a settlement amount, and the dominant error by far is the
// price the caller passes in (see `valueOfLiquidity`), not the arithmetic.

/** Uniswap's tick bounds. Outside these a tick is not a tick. */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

/**
 * sqrt(price) at a tick, where price is the RAW token1/token0 ratio — that is,
 * with both tokens' decimals still baked in, exactly as the pool stores it.
 */
export function sqrtRatioAtTick(tick) {
  if (!Number.isFinite(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new RangeError(`Tick out of range: ${tick}`);
  }
  return Math.pow(1.0001, tick / 2);
}

/** The inverse: the tick a raw price sits at. Not rounded to a tick spacing. */
export function tickAtRawPrice(rawPrice) {
  if (!(rawPrice > 0)) throw new RangeError(`Price must be positive: ${rawPrice}`);
  return Math.log(rawPrice) / Math.log(1.0001);
}

/**
 * The raw token1/token0 price implied by two USD prices.
 *
 * "Raw" means decimals included, because that is the space ticks live in: a
 * pool of an 18-decimal token against a 6-decimal one is off by 10^12 from the
 * human-readable ratio, and using the human ratio puts every position in the
 * wrong tick range by ~276k ticks.
 */
export function rawPriceFromUsd({ usd0, usd1, decimals0, decimals1 }) {
  if (!(usd0 > 0) || !(usd1 > 0)) return null;
  return (usd0 / usd1) * 10 ** (decimals1 - decimals0);
}

/**
 * The token0/token1 amounts that `liquidity` represents in [tickLower,
 * tickUpper] at the given sqrt price. Returns RAW amounts (still scaled by the
 * tokens' decimals).
 *
 * The three branches are the three regimes of a concentrated position: fully
 * in token0 below its range, fully in token1 above it, and a mix inside.
 */
export function amountsForLiquidity({ liquidity, sqrtPrice, sqrtPriceLower, sqrtPriceUpper }) {
  if (sqrtPriceLower > sqrtPriceUpper) {
    [sqrtPriceLower, sqrtPriceUpper] = [sqrtPriceUpper, sqrtPriceLower];
  }
  const L = Math.abs(liquidity);

  if (sqrtPrice <= sqrtPriceLower) {
    // Price is below the range: the position is entirely token0.
    return { amount0: (L * (sqrtPriceUpper - sqrtPriceLower)) / (sqrtPriceLower * sqrtPriceUpper), amount1: 0 };
  }
  if (sqrtPrice >= sqrtPriceUpper) {
    // Above the range: entirely token1.
    return { amount0: 0, amount1: L * (sqrtPriceUpper - sqrtPriceLower) };
  }
  return {
    amount0: (L * (sqrtPriceUpper - sqrtPrice)) / (sqrtPrice * sqrtPriceUpper),
    amount1: L * (sqrtPrice - sqrtPriceLower),
  };
}

/**
 * What a liquidity delta was worth, in USD, at the moment it moved.
 *
 * The token split this produces is only as good as the price passed in, but
 * the TOTAL is not: moving the price along the curve trades one token for the
 * other at that same price, so the dollar value barely shifts. That is what
 * makes a P&L built on hourly candles trustworthy even though the exact
 * sqrtPrice at the block is not available.
 *
 * Returns null — never 0 — when a price is missing, so a day with an unpriced
 * pool reads as unknown rather than as break-even.
 */
export function valueOfLiquidity({
  liquidity,
  tickLower,
  tickUpper,
  usd0,
  usd1,
  decimals0,
  decimals1,
}) {
  const rawPrice = rawPriceFromUsd({ usd0, usd1, decimals0, decimals1 });
  if (rawPrice == null) return null;

  const { amount0, amount1 } = amountsForLiquidity({
    liquidity,
    sqrtPrice: Math.sqrt(rawPrice),
    sqrtPriceLower: sqrtRatioAtTick(tickLower),
    sqrtPriceUpper: sqrtRatioAtTick(tickUpper),
  });

  const token0 = amount0 / 10 ** decimals0;
  const token1 = amount1 / 10 ** decimals1;
  const usd = token0 * usd0 + token1 * usd1;

  return Number.isFinite(usd) ? { usd, token0, token1 } : null;
}
