// Append-only JSON history file with atomic writes (write .tmp, then
// rename) and a promise-queue so concurrent appends never interleave and
// corrupt the file. Capped at `cap` entries (oldest dropped first).

import { readFile, writeFile, rename } from "node:fs/promises";

/**
 * @param {{ filePath: string, cap?: number }} opts
 */
export function createHistoryStore(opts) {
  const { filePath, cap = 250 } = opts;
  const tmpPath = `${filePath}.tmp`;
  let writeQueue = Promise.resolve();

  async function readAll() {
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
  }

  /**
   * @param {object} entry a JSON-serializable history record
   * @returns {Promise<object[]>} the full (capped) history after appending
   */
  function append(entry) {
    const task = writeQueue.then(async () => {
      const current = await readAll();
      current.push(entry);
      const capped = current.length > cap ? current.slice(current.length - cap) : current;
      await writeFile(tmpPath, JSON.stringify(capped, null, 2), "utf8");
      await rename(tmpPath, filePath);
      return capped;
    });
    // Keep the queue alive even if this particular append fails, so later
    // appends aren't permanently blocked by one bad write.
    writeQueue = task.catch(() => {});
    return task;
  }

  return { readAll, append };
}
