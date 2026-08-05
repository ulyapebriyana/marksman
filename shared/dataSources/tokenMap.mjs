// Loads the configurable token-address -> stock-ticker map used to detect
// tokenized-stock pools and drive premium/discount scoring. Kept as a small
// JSON file (not hardcoded) so it can grow without a code change/deploy.

import { readFile } from "node:fs/promises";

/**
 * @param {string} filePath path to a JSON file of
 *   { "<lowercase address>": { "ticker": "NVDA", "name": "NVIDIA Corp" }, ... }
 * @returns {Promise<Record<string, {ticker:string, name?:string}>>}
 */
export async function loadTokenMap(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }

  const parsed = JSON.parse(raw);
  const map = {};
  for (const [address, info] of Object.entries(parsed)) {
    if (address.startsWith("_")) continue; // allow a "_comment" key
    if (!info?.ticker) continue;
    map[address.toLowerCase()] = { ticker: info.ticker, name: info.name };
  }
  return map;
}
