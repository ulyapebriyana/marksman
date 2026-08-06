import { useCallback, useMemo, useState } from "react";
import { STORAGE_KEYS, readStored, writeStored } from "../lib/storage";

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Pool addresses the viewer pinned. Local to the browser — nothing is sent upstream. */
export function useWatchlist() {
  const [addresses, setAddresses] = useState<string[]>(() =>
    readStored<string[]>(STORAGE_KEYS.watchlist, [], isStringArray)
  );

  const set = useMemo(() => new Set(addresses), [addresses]);

  const toggle = useCallback((address: string) => {
    setAddresses((prev) => {
      const next = prev.includes(address) ? prev.filter((a) => a !== address) : [...prev, address];
      writeStored(STORAGE_KEYS.watchlist, next);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setAddresses([]);
    writeStored(STORAGE_KEYS.watchlist, []);
  }, []);

  const has = useCallback((address: string) => set.has(address), [set]);

  return { addresses, set, has, toggle, clear, count: addresses.length };
}
