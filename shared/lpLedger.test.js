import { describe, it, expect } from "vitest";
import { extractLiquidityEvents, foldPositions, realizedPositions, tokenIdFromSalt, walletFlows } from "./lpLedger.js";

const WALLET = "0xE689b1ea3cFdE47f8C45396b9d96e325F44F64fe";
const POOL = "0xc2d1a212123a83e19991cde3df91a3407cd7a12bdbaef3666ad4cad54b73d538";

const modifyLog = ({ delta, salt = "0x12473d", tickLower = -346724, tickUpper = -327082 }) => ({
  decoded: {
    method_call: "ModifyLiquidity(bytes32 id, address sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)",
    parameters: [
      { name: "id", value: POOL },
      { name: "tickLower", value: String(tickLower) },
      { name: "tickUpper", value: String(tickUpper) },
      { name: "liquidityDelta", value: String(delta) },
      { name: "salt", value: salt },
    ],
  },
});

const transfer = ({ from, to, value, decimals = 6, symbol = "USDG", address = "0xusdg" }) => ({
  from: { hash: from },
  to: { hash: to },
  token: { symbol, address_hash: address },
  total: { value: String(value), decimals: String(decimals) },
});

describe("tokenIdFromSalt", () => {
  it("reads the position id v4 hides in the salt", () => {
    expect(tokenIdFromSalt("0x12473d")).toBe("1197885");
  });

  it("has no id for the zero salt or for nonsense", () => {
    expect(tokenIdFromSalt("0x0")).toBeNull();
    expect(tokenIdFromSalt("not a number")).toBeNull();
  });
});

describe("extractLiquidityEvents", () => {
  it("keeps ModifyLiquidity and ignores everything else in the receipt", () => {
    const events = extractLiquidityEvents([
      { decoded: { method_call: "Transfer(address,address,uint256)", parameters: [] } },
      modifyLog({ delta: 1000 }),
      { decoded: null, topics: ["0xdead"] },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ poolId: POOL, tokenId: "1197885", liquidityDelta: 1000 });
  });

  it("skips a position with no id rather than inventing one", () => {
    expect(extractLiquidityEvents([modifyLog({ delta: 1000, salt: "0x0" })])).toHaveLength(0);
  });

  it("survives a transaction with no logs at all", () => {
    expect(extractLiquidityEvents(null)).toEqual([]);
  });
});

describe("walletFlows", () => {
  it("signs the wallet's own movements and ignores everyone else's", () => {
    const flows = walletFlows(
      [
        transfer({ from: "0xrouter", to: WALLET, value: 500_000_000 }),
        transfer({ from: WALLET, to: "0xrouter", value: 200_000_000 }),
        transfer({ from: "0xrouter", to: "0xpool", value: 999_000_000 }), // not ours
      ],
      WALLET
    );
    expect(flows).toHaveLength(1);
    expect(flows[0].amount).toBeCloseTo(300, 6);
  });

  it("is case-insensitive about addresses", () => {
    const flows = walletFlows([transfer({ from: "0xrouter", to: WALLET.toLowerCase(), value: 1_000_000 })], WALLET.toUpperCase());
    expect(flows[0].amount).toBe(1);
  });
});

describe("foldPositions", () => {
  // Every unit of liquidity is worth a dollar, so the arithmetic is readable.
  const valueLiquidity = (event) => ({ usd: Math.abs(event.liquidityDelta) });
  const priceToken = () => 1;
  const deps = { valueLiquidity, priceToken };

  const tx = (timestamp, events, flows = []) => ({ hash: `0x${timestamp}`, timestamp, events, flows });
  const ev = (delta, tokenId = "1197885") => ({
    poolId: POOL,
    tokenId,
    tickLower: -1000,
    tickUpper: 1000,
    liquidityDelta: delta,
  });

  it("closes a position when its liquidity returns to zero, NFT burned or not", () => {
    const { positions } = foldPositions([tx(100, [ev(500)]), tx(200, [ev(-500)])], deps);
    expect(positions[0].closedAt).toBe(200);
    expect(positions[0].depositUsd).toBe(500);
    expect(positions[0].withdrawUsd).toBe(500);
  });

  it("leaves a position open while liquidity remains", () => {
    const { positions } = foldPositions([tx(100, [ev(500)]), tx(200, [ev(-200)])], deps);
    expect(positions[0].closedAt).toBeNull();
  });

  it("reopens a position that was closed and topped up again", () => {
    const { positions } = foldPositions([tx(100, [ev(500)]), tx(200, [ev(-500)]), tx(300, [ev(300)])], deps);
    expect(positions[0].closedAt).toBeNull();
  });

  it("attributes two positions in one transaction separately, via the salt", () => {
    const { positions } = foldPositions([tx(100, [ev(500, "111"), ev(700, "222")])], deps);
    expect(positions.map((p) => [p.tokenId, p.depositUsd])).toEqual([
      ["111", 500],
      ["222", 700],
    ]);
  });

  it("counts what the wallet received beyond principal as fee income", () => {
    // Withdrew 500 of principal, 560 came back: 60 of it was fees.
    const flows = [{ address: "0xusdg", symbol: "USDG", decimals: 6, amount: 560 }];
    const { positions } = foldPositions([tx(100, [ev(500)]), tx(200, [ev(-500)], flows)], deps);
    expect(positions[0].feeUsd).toBeCloseTo(60, 6);
  });

  it("splits fees across the positions that paid out, in proportion to principal", () => {
    const flows = [{ address: "0xusdg", symbol: "USDG", decimals: 6, amount: 330 }];
    const { positions } = foldPositions(
      [tx(100, [ev(100, "111"), ev(200, "222")]), tx(200, [ev(-100, "111"), ev(-200, "222")], flows)],
      deps
    );
    expect(positions.find((p) => p.tokenId === "111").feeUsd).toBeCloseTo(10, 6);
    expect(positions.find((p) => p.tokenId === "222").feeUsd).toBeCloseTo(20, 6);
  });

  it("never books negative fees when a transaction also opened a position", () => {
    // A rebalance nets the new deposit out of the wallet's inflow.
    const flows = [{ address: "0xusdg", symbol: "USDG", decimals: 6, amount: 20 }];
    const { positions } = foldPositions([tx(100, [ev(500)]), tx(200, [ev(-500)], flows)], deps);
    expect(positions[0].feeUsd).toBe(0);
  });

  it("flags a position whose opening it never saw instead of calling the exit pure profit", () => {
    // This is the failure that inflated a real wallet's P&L by $533: the
    // opening transaction was missed, so the whole withdrawal looked like gain.
    const { positions, partial } = foldPositions([tx(200, [ev(-500)])], deps);
    expect(partial).toBe(1);
    expect(positions[0].partial).toBe(true);
    expect(realizedPositions(positions)[0].pnl).toBeNull();
  });

  it("flags a position it could not price rather than valuing it at zero", () => {
    const { positions, unpriced } = foldPositions([tx(100, [ev(500)]), tx(200, [ev(-500)])], {
      ...deps,
      valueLiquidity: () => null,
    });
    expect(unpriced).toBe(1);
    expect(realizedPositions(positions)[0].pnl).toBeNull();
  });

  it("processes transactions oldest first however they arrive", () => {
    const { positions } = foldPositions([tx(200, [ev(-500)]), tx(100, [ev(500)])], deps);
    expect(positions[0].partial).toBe(false);
    expect(positions[0].openedAt).toBe(100);
  });
});

describe("realizedPositions", () => {
  const base = {
    tokenId: "1",
    poolId: POOL,
    openedAt: 100,
    closedAt: 200,
    depositUsd: 100,
    withdrawUsd: 130,
    feeUsd: 5,
    priced: true,
    partial: false,
  };

  it("realizes P&L as withdrawals plus fees minus deposits", () => {
    expect(realizedPositions([base])[0].pnl).toBeCloseTo(35, 6);
  });

  it("leaves open positions off the calendar entirely", () => {
    expect(realizedPositions([{ ...base, closedAt: null }])).toHaveLength(0);
  });

  it("names the pair when a lookup is supplied", () => {
    expect(realizedPositions([base], { pairFor: () => "PRISM / USDG" })[0].pair).toBe("PRISM / USDG");
  });
});
