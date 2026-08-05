import { describe, it, expect, vi } from "vitest";
import { createTtlCache } from "./ttlCache.mjs";

describe("createTtlCache", () => {
  it("caches a successful value and doesn't call fetchFn again before expiry", async () => {
    const cache = createTtlCache({ successTtlMs: 1000 });
    const fetchFn = vi.fn().mockResolvedValue("value-1");
    const a = await cache.getOrFetch("k", fetchFn, 0);
    const b = await cache.getOrFetch("k", fetchFn, 500);
    expect(a).toBe("value-1");
    expect(b).toBe("value-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("refetches after the success TTL expires", async () => {
    const cache = createTtlCache({ successTtlMs: 1000 });
    const fetchFn = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");
    await cache.getOrFetch("k", fetchFn, 0);
    const second = await cache.getOrFetch("k", fetchFn, 1001);
    expect(second).toBe("v2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("negative-caches a failure using failureTtlMs, shorter than success", async () => {
    const cache = createTtlCache({ successTtlMs: 10_000, failureTtlMs: 100 });
    const err = new Error("upstream down");
    const fetchFn = vi.fn().mockRejectedValue(err);

    await expect(cache.getOrFetch("k", fetchFn, 0)).rejects.toThrow("upstream down");
    await expect(cache.getOrFetch("k", fetchFn, 50)).rejects.toThrow("upstream down");
    expect(fetchFn).toHaveBeenCalledTimes(1); // still within failure TTL, cached

    fetchFn.mockResolvedValueOnce("recovered");
    const recovered = await cache.getOrFetch("k", fetchFn, 101); // failure TTL expired
    expect(recovered).toBe("recovered");
  });

  it("keys are independent", async () => {
    const cache = createTtlCache();
    await cache.getOrFetch("a", async () => "A", 0);
    await cache.getOrFetch("b", async () => "B", 0);
    expect(cache.size()).toBe(2);
  });

  it("clear() empties the store", async () => {
    const cache = createTtlCache();
    await cache.getOrFetch("a", async () => "A", 0);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});
