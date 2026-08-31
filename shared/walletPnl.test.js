import { describe, it, expect } from "vitest";
import {
  aggregateDays,
  buildWalletPnl,
  countExcluded,
  currentStreak,
  dayKeyFor,
  monthsCovered,
  summarizePnl,
} from "./walletPnl.js";

// 2026-08-25T16:45:45Z — deliberately late in the UTC day, so a +7 offset
// pushes it onto the next calendar day and a 0 offset does not.
const LATE_UTC = 1787683545;

const position = (over = {}) => ({
  closedAt: LATE_UTC,
  pnl: 1,
  fees: 0.05,
  pair: "FOO-SOL",
  ...over,
});

describe("dayKeyFor", () => {
  it("buckets by the offset's midnight, not UTC's", () => {
    expect(dayKeyFor(LATE_UTC, 0)).toBe("2026-08-25");
    expect(dayKeyFor(LATE_UTC, 420)).toBe("2026-08-26"); // Jakarta
    expect(dayKeyFor(LATE_UTC, -300)).toBe("2026-08-25"); // New York
  });

  it("defaults to UTC", () => {
    expect(dayKeyFor(LATE_UTC)).toBe("2026-08-25");
  });
});

describe("aggregateDays", () => {
  it("sums P&L, counts wins and losses, and rates the day", () => {
    const days = aggregateDays([
      position({ pnl: 2 }),
      position({ pnl: -0.5 }),
      position({ pnl: -0.5 }),
    ]);

    expect(days).toHaveLength(1);
    expect(days[0].pnl).toBe(1);
    expect(days[0].positions).toBe(3);
    expect(days[0].wins).toBe(1);
    expect(days[0].losses).toBe(2);
    expect(days[0].winRatePct).toBeCloseTo(33.33, 2);
  });

  it("emits nothing for days with no closed position", () => {
    const days = aggregateDays([
      position({ closedAt: LATE_UTC }),
      position({ closedAt: LATE_UTC + 3 * 86_400 }),
    ]);

    // Two trading days, three days apart: the gap is absent, not zero.
    expect(days.map((d) => d.date)).toEqual(["2026-08-25", "2026-08-28"]);
  });

  it("returns days oldest first regardless of input order", () => {
    const days = aggregateDays([
      position({ closedAt: LATE_UTC + 86_400 }),
      position({ closedAt: LATE_UTC }),
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-08-25", "2026-08-26"]);
  });

  it("drops positions it cannot place on a day rather than bucketing them", () => {
    const days = aggregateDays([position(), position({ closedAt: null }), position({ pnl: null })]);

    expect(days).toHaveLength(1);
    expect(days[0].positions).toBe(1);
    expect(countExcluded([position(), position({ closedAt: null }), position({ pnl: null })])).toBe(2);
  });

  it("attributes the day to the pools that moved it, biggest first", () => {
    const days = aggregateDays([
      position({ pair: "SMALL-SOL", pnl: 0.1 }),
      position({ pair: "BIG-SOL", pnl: -3 }),
      position({ pair: "BIG-SOL", pnl: 1 }),
    ]);

    expect(days[0].pools[0]).toMatchObject({ pair: "BIG-SOL", pnl: -2, positions: 2 });
    expect(days[0].pools[1]).toMatchObject({ pair: "SMALL-SOL", positions: 1 });
  });

  it("respects the time zone offset when splitting days", () => {
    // 18:45Z and 16:45Z — the same UTC day, but +420 puts them either side
    // of Jakarta midnight.
    const positions = [position({ closedAt: LATE_UTC }), position({ closedAt: LATE_UTC - 7200 })];

    expect(aggregateDays(positions, { offsetMinutes: 0 })).toHaveLength(1);
    expect(aggregateDays(positions, { offsetMinutes: 420 })).toHaveLength(2);
  });
});

describe("summarizePnl", () => {
  const positions = [
    position({ pnl: 3 }),
    position({ pnl: 1 }),
    position({ pnl: -2, closedAt: LATE_UTC + 86_400 }),
  ];
  const days = aggregateDays(positions);
  const summary = summarizePnl(days, positions);

  it("separates position win rate from day win rate", () => {
    expect(summary.winRatePct).toBeCloseTo(66.67, 2); // 2 of 3 positions
    expect(summary.dayWinRatePct).toBe(50); // 1 of 2 days
  });

  it("computes profit factor and average win against average loss", () => {
    expect(summary.grossProfit).toBe(4);
    expect(summary.grossLoss).toBe(2);
    expect(summary.profitFactor).toBe(2);
    expect(summary.avgWin).toBe(2);
    expect(summary.avgLoss).toBe(-2);
  });

  it("reports profit factor as null, never Infinity, when nothing lost", () => {
    const wins = [position({ pnl: 1 }), position({ pnl: 2 })];
    expect(summarizePnl(aggregateDays(wins), wins).profitFactor).toBeNull();
  });

  it("names the best and worst day", () => {
    expect(summary.bestDay).toEqual({ date: "2026-08-25", pnl: 4 });
    expect(summary.worstDay).toEqual({ date: "2026-08-26", pnl: -2 });
  });

  it("counts only positions that made it onto the calendar", () => {
    const withOrphan = [...positions, position({ closedAt: null, pnl: 99 })];
    const s = summarizePnl(aggregateDays(withOrphan), withOrphan);
    expect(s.closedPositions).toBe(3);
    expect(s.netPnl).toBe(2);
  });

  it("survives an empty wallet without inventing a day", () => {
    const s = summarizePnl([], []);
    expect(s).toMatchObject({ netPnl: 0, closedPositions: 0, tradingDays: 0, winRatePct: null, bestDay: null });
  });
});

describe("currentStreak", () => {
  const day = (date, pnl) => ({ date, pnl });

  it("counts consecutive green trading days ending at the last one", () => {
    expect(currentStreak([day("2026-08-01", -1), day("2026-08-02", 1), day("2026-08-05", 2)])).toEqual({
      direction: "green",
      days: 2,
    });
  });

  it("does not let an untraded gap break the streak", () => {
    // 08-03 and 08-04 are absent — a weekend off is not a losing day.
    expect(currentStreak([day("2026-08-02", -1), day("2026-08-05", -2)])).toEqual({ direction: "red", days: 2 });
  });

  it("is flat for an empty history", () => {
    expect(currentStreak([])).toEqual({ direction: "flat", days: 0 });
  });
});

describe("monthsCovered", () => {
  it("lists each month once, oldest first", () => {
    expect(
      monthsCovered([{ date: "2026-07-30" }, { date: "2026-08-01" }, { date: "2026-08-26" }])
    ).toEqual(["2026-07", "2026-08"]);
  });
});

describe("buildWalletPnl", () => {
  const fetched = (over = {}) => ({
    positions: [position({ pnl: 1 }), position({ pnl: -0.5 })],
    pools: [{ poolId: "pool1" }],
    unpriced: 0,
    partial: 0,
    failedTxs: [],
    openPositions: 0,
    ...over,
  });

  it("is complete when every position priced and every transaction read", () => {
    const report = buildWalletPnl(fetched());
    expect(report.reconciliation.complete).toBe(true);
    expect(report.summary.netPnl).toBe(0.5);
  });

  it("is incomplete when a transaction could not be read, though the days still render", () => {
    const report = buildWalletPnl(fetched({ failedTxs: [{ hash: "0xabc", reason: "HTTP 429" }] }));
    expect(report.reconciliation.complete).toBe(false);
    expect(report.days).toHaveLength(1);
  });

  it("is incomplete when a position could not be priced", () => {
    expect(buildWalletPnl(fetched({ unpriced: 2 })).reconciliation.complete).toBe(false);
  });

  it("is incomplete when a position was joined partway through its life", () => {
    expect(buildWalletPnl(fetched({ partial: 1 })).reconciliation.complete).toBe(false);
  });

  it("carries the offset it bucketed at into the payload", () => {
    expect(buildWalletPnl(fetched(), { offsetMinutes: 420 }).timeZoneOffsetMinutes).toBe(420);
  });
});
