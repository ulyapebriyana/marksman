// Pure decision + transition-detection logic. No I/O: callers own history
// persistence and alert side effects; this module only decides *when* those
// side effects should fire.

import { calculateScore, evaluatePreset } from "./scoring.js";

export const STATUS_RANK = Object.freeze({ none: 0, watch: 1, hot: 2 });

export const SIGNAL_SCORE_THRESHOLDS = Object.freeze({ watch: 65, hot: 80 });

/**
 * @param {object} pool normalized pool (ideally with .risk and .score precomputed)
 * @param {object} preset one of PRESETS
 * @returns {'none'|'watch'|'hot'}
 */
export function getPoolSignalStatus(pool, preset, thresholds = SIGNAL_SCORE_THRESHOLDS) {
  const { passed } = evaluatePreset(pool, preset);
  if (!passed) return "none";

  const total = pool?.score?.total ?? calculateScore(pool).total;
  if (total >= thresholds.hot) return "hot";
  if (total >= thresholds.watch) return "watch";
  return "none";
}

/**
 * Request-time (preset-dependent) annotation of an already-scored pool. Pure
 * and cheap, so it's fine to recompute per HTTP request for whichever preset
 * the viewer currently has selected — no need to re-run the scan.
 *
 * @param {object} pool normalized pool with .score and .risk already attached
 * @param {object} preset one of PRESETS
 */
export function annotatePoolWithPreset(pool, preset) {
  const gate = evaluatePreset(pool, preset);
  const signalStatus = getPoolSignalStatus(pool, preset);
  return { ...pool, presetGate: gate, signalStatus };
}

/**
 * Tracks previous per-pool signal status and applies a per-(address,status)
 * cooldown so a flickering pool can't spam repeated events for the same
 * target status within the cooldown window.
 */
export function createSignalTracker({ cooldownMs = 15 * 60 * 1000 } = {}) {
  const previousStatus = new Map(); // address -> status
  const cooldownUntil = new Map(); // "address:status" -> epoch ms

  /**
   * @param {object[]} pools normalized pools (with .risk/.score attached) for this scan
   * @param {object} preset active preset
   * @param {number} now epoch ms (injectable for tests)
   * @returns {{address:string, from:string, to:string, at:number, pool:object}[]}
   */
  function detectTransitions(pools, preset, now = Date.now()) {
    const events = [];

    for (const pool of pools) {
      const address = pool.address;
      const status = getPoolSignalStatus(pool, preset);
      const prev = previousStatus.get(address) ?? "none";

      if (STATUS_RANK[status] > STATUS_RANK[prev]) {
        const cooldownKey = `${address}:${status}`;
        const cooledUntil = cooldownUntil.get(cooldownKey) ?? 0;
        if (now >= cooledUntil) {
          events.push({ address, from: prev, to: status, at: now, pool });
          cooldownUntil.set(cooldownKey, now + cooldownMs);
        }
      }

      previousStatus.set(address, status);
    }

    return events;
  }

  function getStatus(address) {
    return previousStatus.get(address) ?? "none";
  }

  function reset() {
    previousStatus.clear();
    cooldownUntil.clear();
  }

  return { detectTransitions, getStatus, reset };
}
