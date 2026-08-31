import { describe, it, expect } from "vitest";
import {
  amountsForLiquidity,
  rawPriceFromUsd,
  sqrtRatioAtTick,
  tickAtRawPrice,
  valueOfLiquidity,
} from "./uniswapMath.js";

describe("sqrtRatioAtTick", () => {
  it("is 1 at tick zero", () => {
    expect(sqrtRatioAtTick(0)).toBe(1);
  });

  it("round-trips against tickAtRawPrice", () => {
    for (const tick of [-346724, -120000, 0, 55555, 200000]) {
      const raw = sqrtRatioAtTick(tick) ** 2;
      expect(tickAtRawPrice(raw)).toBeCloseTo(tick, 3);
    }
  });

  it("refuses ticks outside Uniswap's range", () => {
    expect(() => sqrtRatioAtTick(900000)).toThrow(RangeError);
    expect(() => sqrtRatioAtTick(NaN)).toThrow(RangeError);
  });
});

describe("rawPriceFromUsd", () => {
  it("folds the decimal difference into the price", () => {
    // An 18-decimal token at $1 against a 6-decimal token at $1 sits 10^-12
    // away from the human-readable ratio of 1.
    expect(rawPriceFromUsd({ usd0: 1, usd1: 1, decimals0: 18, decimals1: 6 })).toBeCloseTo(1e-12, 24);
  });

  it("has no answer when either price is missing", () => {
    expect(rawPriceFromUsd({ usd0: 0, usd1: 1, decimals0: 18, decimals1: 18 })).toBeNull();
    expect(rawPriceFromUsd({ usd0: 1, usd1: null, decimals0: 18, decimals1: 18 })).toBeNull();
  });
});

describe("amountsForLiquidity", () => {
  const range = { sqrtPriceLower: sqrtRatioAtTick(-1000), sqrtPriceUpper: sqrtRatioAtTick(1000) };

  it("is all token0 below the range", () => {
    const { amount0, amount1 } = amountsForLiquidity({ liquidity: 1e18, sqrtPrice: sqrtRatioAtTick(-5000), ...range });
    expect(amount1).toBe(0);
    expect(amount0).toBeGreaterThan(0);
  });

  it("is all token1 above the range", () => {
    const { amount0, amount1 } = amountsForLiquidity({ liquidity: 1e18, sqrtPrice: sqrtRatioAtTick(5000), ...range });
    expect(amount0).toBe(0);
    expect(amount1).toBeGreaterThan(0);
  });

  it("holds both inside the range", () => {
    const { amount0, amount1 } = amountsForLiquidity({ liquidity: 1e18, sqrtPrice: sqrtRatioAtTick(0), ...range });
    expect(amount0).toBeGreaterThan(0);
    expect(amount1).toBeGreaterThan(0);
  });

  it("treats a withdrawal's negative liquidity as the same size as a deposit's", () => {
    const args = { sqrtPrice: sqrtRatioAtTick(0), ...range };
    expect(amountsForLiquidity({ liquidity: -1e18, ...args })).toEqual(
      amountsForLiquidity({ liquidity: 1e18, ...args })
    );
  });

  it("does not care which way round the range is given", () => {
    const flipped = { sqrtPriceLower: range.sqrtPriceUpper, sqrtPriceUpper: range.sqrtPriceLower };
    expect(amountsForLiquidity({ liquidity: 1e18, sqrtPrice: sqrtRatioAtTick(0), ...flipped })).toEqual(
      amountsForLiquidity({ liquidity: 1e18, sqrtPrice: sqrtRatioAtTick(0), ...range })
    );
  });
});

describe("valueOfLiquidity", () => {
  // A real withdrawal: position 1197885 in PRISM/USDG, 2026-08-31T14:55Z.
  // The chain moved 10988.58 PRISM and 343.747828 USDG for this liquidity.
  const real = {
    liquidity: 8208970086642662,
    tickLower: -346724,
    tickUpper: -327082,
    usd0: 0.0051175608029194,
    usd1: 0.998931361724416,
    decimals0: 18,
    decimals1: 6,
  };

  it("reproduces the dollar value of a real on-chain withdrawal", () => {
    const actualUsd = 10988.58 * real.usd0 + 343.747828 * real.usd1;
    expect(valueOfLiquidity(real).usd).toBeCloseTo(actualUsd, 1);
  });

  it("is barely moved by an imprecise price, which is why hourly candles suffice", () => {
    // The split between the two tokens shifts, but the total does not: moving
    // along the curve trades one for the other at that same price.
    const nudged = valueOfLiquidity({ ...real, usd0: real.usd0 * 1.02 });
    expect(nudged.usd / valueOfLiquidity(real).usd).toBeCloseTo(1, 1);
  });

  it("returns null rather than zero when a price is unknown", () => {
    expect(valueOfLiquidity({ ...real, usd0: null })).toBeNull();
  });
});
