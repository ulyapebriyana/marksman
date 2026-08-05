import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency.mjs";

describe("mapWithConcurrency", () => {
  it("preserves result order regardless of completion order", async () => {
    const items = [30, 10, 20, 5];
    const results = await mapWithConcurrency(items, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    }, 4);
    expect(results).toEqual([30, 10, 20, 5]);
  });

  it("never exceeds the concurrency limit at any instant", async () => {
    let active = 0;
    let maxActive = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
      3
    );
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("propagates a thrown error from the mapper", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }, 2)
    ).rejects.toThrow("boom");
  });

  it("handles an empty items array", async () => {
    const results = await mapWithConcurrency([], async (n) => n, 5);
    expect(results).toEqual([]);
  });

  it("works when limit exceeds the number of items", async () => {
    const results = await mapWithConcurrency([1, 2], async (n) => n * 2, 10);
    expect(results).toEqual([2, 4]);
  });
});
