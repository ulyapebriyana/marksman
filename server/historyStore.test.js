import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHistoryStore } from "./historyStore.mjs";

let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "marksman-history-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createHistoryStore", () => {
  it("readAll returns [] when the file doesn't exist yet", async () => {
    const store = createHistoryStore({ filePath: join(dir, "history.json") });
    expect(await store.readAll()).toEqual([]);
  });

  it("append persists an entry and readAll reflects it", async () => {
    const store = createHistoryStore({ filePath: join(dir, "history.json") });
    await store.append({ address: "0x1", to: "watch" });
    const all = await store.readAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ address: "0x1", to: "watch" });
  });

  it("caps history at the configured max, dropping the oldest first", async () => {
    const store = createHistoryStore({ filePath: join(dir, "history.json"), cap: 3 });
    for (let i = 0; i < 5; i++) {
      await store.append({ i });
    }
    const all = await store.readAll();
    expect(all).toHaveLength(3);
    expect(all.map((e) => e.i)).toEqual([2, 3, 4]);
  });

  it("serializes concurrent appends without losing or corrupting entries", async () => {
    const store = createHistoryStore({ filePath: join(dir, "history.json"), cap: 100 });
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.append({ i })));
    const all = await store.readAll();
    expect(all).toHaveLength(20);
    expect(new Set(all.map((e) => e.i)).size).toBe(20); // no duplicates/overwrites
  });

  it("does not leave a .tmp file behind after a successful append", async () => {
    const filePath = join(dir, "history.json");
    const store = createHistoryStore({ filePath });
    await store.append({ a: 1 });
    await expect(readFileSafe(`${filePath}.tmp`)).resolves.toBe(false);
  });
});

async function readFileSafe(path) {
  const { access } = await import("node:fs/promises");
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
