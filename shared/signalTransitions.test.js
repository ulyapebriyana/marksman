import { describe, it, expect } from "vitest";
import { getPoolSignalStatus, createSignalTracker, STATUS_RANK, annotatePoolWithPreset } from "./signalTransitions.js";
import { PRESETS } from "./scoring.js";

const NOW = Date.parse("2026-08-06T12:00:00Z");

function poolWith({ passed = true, total = 70, address = "0xabc" } = {}) {
  // A pool that trivially passes/fails evaluatePreset by forcing risk + gate
  // fields, and carries a precomputed .score so getPoolSignalStatus doesn't
  // need to recompute from raw fields.
  return {
    address,
    liquidityUsd: passed ? 100_000 : 0,
    volume: { h24: passed ? 80_000 : 0 },
    priceChange1h: passed ? 10 : null,
    pairCreatedAt: NOW - 10 * 24 * 60 * 60 * 1000,
    __now: NOW,
    risk: { value: passed ? 10 : 90, flags: [] },
    score: { total, breakdown: {} },
  };
}

describe("getPoolSignalStatus", () => {
  it("returns none when the preset gate fails regardless of score", () => {
    const pool = poolWith({ passed: false, total: 99 });
    expect(getPoolSignalStatus(pool, PRESETS.steady)).toBe("none");
  });

  it("returns watch when gate passes and score is in [65,80)", () => {
    const pool = poolWith({ total: 70 });
    expect(getPoolSignalStatus(pool, PRESETS.steady)).toBe("watch");
  });

  it("returns hot when gate passes and score >= 80", () => {
    const pool = poolWith({ total: 85 });
    expect(getPoolSignalStatus(pool, PRESETS.steady)).toBe("hot");
  });

  it("returns none when gate passes but score is below 65", () => {
    const pool = poolWith({ total: 40 });
    expect(getPoolSignalStatus(pool, PRESETS.steady)).toBe("none");
  });

  it("treats the boundary score values as documented (65 -> watch, 80 -> hot)", () => {
    expect(getPoolSignalStatus(poolWith({ total: 65 }), PRESETS.steady)).toBe("watch");
    expect(getPoolSignalStatus(poolWith({ total: 80 }), PRESETS.steady)).toBe("hot");
    expect(getPoolSignalStatus(poolWith({ total: 64.99 }), PRESETS.steady)).toBe("none");
  });
});

describe("annotatePoolWithPreset", () => {
  it("attaches presetGate and signalStatus without mutating the input", () => {
    const pool = poolWith({ total: 90 });
    const snapshot = JSON.stringify(pool);
    const annotated = annotatePoolWithPreset(pool, PRESETS.steady);
    expect(annotated.signalStatus).toBe("hot");
    expect(annotated.presetGate.passed).toBe(true);
    expect(JSON.stringify(pool)).toBe(snapshot);
  });

  it("reports gate misses for a failing pool alongside signalStatus 'none'", () => {
    const pool = poolWith({ passed: false, total: 90 });
    const annotated = annotatePoolWithPreset(pool, PRESETS.steady);
    expect(annotated.signalStatus).toBe("none");
    expect(annotated.presetGate.passed).toBe(false);
    expect(annotated.presetGate.misses.length).toBeGreaterThan(0);
  });
});

describe("STATUS_RANK", () => {
  it("orders none < watch < hot", () => {
    expect(STATUS_RANK.none).toBeLessThan(STATUS_RANK.watch);
    expect(STATUS_RANK.watch).toBeLessThan(STATUS_RANK.hot);
  });
});

describe("createSignalTracker", () => {
  it("emits an event on none -> watch", () => {
    const tracker = createSignalTracker();
    const events = tracker.detectTransitions([poolWith({ total: 70 })], PRESETS.steady, NOW);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ address: "0xabc", from: "none", to: "watch" });
  });

  it("emits an event on watch -> hot but not again on the same scan", () => {
    const tracker = createSignalTracker();
    tracker.detectTransitions([poolWith({ total: 70 })], PRESETS.steady, NOW);
    const events = tracker.detectTransitions([poolWith({ total: 90 })], PRESETS.steady, NOW + 1000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ from: "watch", to: "hot" });
  });

  it("emits directly on none -> hot, skipping watch", () => {
    const tracker = createSignalTracker();
    const events = tracker.detectTransitions([poolWith({ total: 95 })], PRESETS.steady, NOW);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ from: "none", to: "hot" });
  });

  it("does NOT emit when rank decreases (watch -> none)", () => {
    const tracker = createSignalTracker();
    tracker.detectTransitions([poolWith({ total: 70 })], PRESETS.steady, NOW);
    const events = tracker.detectTransitions([poolWith({ passed: false, total: 70 })], PRESETS.steady, NOW + 1000);
    expect(events).toHaveLength(0);
    expect(tracker.getStatus("0xabc")).toBe("none");
  });

  it("does NOT emit when rank decreases (hot -> watch)", () => {
    const tracker = createSignalTracker();
    tracker.detectTransitions([poolWith({ total: 90 })], PRESETS.steady, NOW);
    const events = tracker.detectTransitions([poolWith({ total: 70 })], PRESETS.steady, NOW + 1000);
    expect(events).toHaveLength(0);
  });

  it("suppresses a repeat none->watch->none->watch flap within the cooldown window", () => {
    const tracker = createSignalTracker({ cooldownMs: 15 * 60 * 1000 });
    tracker.detectTransitions([poolWith({ total: 70 })], PRESETS.steady, NOW); // none->watch, emits
    tracker.detectTransitions([poolWith({ passed: false, total: 70 })], PRESETS.steady, NOW + 1000); // watch->none
    const events = tracker.detectTransitions([poolWith({ total: 70 })], PRESETS.steady, NOW + 2000); // none->watch again, within cooldown
    expect(events).toHaveLength(0);
  });

  it("allows a re-emit for the same status once the cooldown has expired", () => {
    const cooldownMs = 15 * 60 * 1000;
    const tracker = createSignalTracker({ cooldownMs });
    tracker.detectTransitions([poolWith({ total: 70 })], PRESETS.steady, NOW);
    tracker.detectTransitions([poolWith({ passed: false, total: 70 })], PRESETS.steady, NOW + 1000);
    const events = tracker.detectTransitions(
      [poolWith({ total: 70 })],
      PRESETS.steady,
      NOW + cooldownMs + 1
    );
    expect(events).toHaveLength(1);
  });

  it("tracks multiple addresses independently", () => {
    const tracker = createSignalTracker();
    const events = tracker.detectTransitions(
      [poolWith({ total: 70, address: "0xaaa" }), poolWith({ passed: false, total: 70, address: "0xbbb" })],
      PRESETS.steady,
      NOW
    );
    expect(events).toHaveLength(1);
    expect(events[0].address).toBe("0xaaa");
    expect(tracker.getStatus("0xbbb")).toBe("none");
  });

  it("cooldown keys are per-status, so a hot cooldown doesn't block a later watch emit for the same address", () => {
    const tracker = createSignalTracker({ cooldownMs: 15 * 60 * 1000 });
    // none -> hot (skips watch, so watch's cooldown key was never set)
    tracker.detectTransitions([poolWith({ total: 95 })], PRESETS.steady, NOW);
    // hot -> none
    tracker.detectTransitions([poolWith({ passed: false, total: 95 })], PRESETS.steady, NOW + 1000);
    // none -> watch should still be free to emit since "address:watch" cooldown was never set
    const events = tracker.detectTransitions([poolWith({ total: 70 })], PRESETS.steady, NOW + 2000);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ from: "none", to: "watch" });
  });
});
