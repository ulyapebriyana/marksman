/** localStorage that never throws (private mode, quota, disabled storage). */

export function readStored<T>(key: string, fallback: T, isValid?: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (isValid && !isValid(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — preferences just won't persist */
  }
}

export const STORAGE_KEYS = {
  preset: "marksman:preset",
  theme: "marksman:theme",
  watchlist: "marksman:watchlist",
  filters: "marksman:filters",
  columns: "marksman:columns",
  density: "marksman:density",
  layout: "marksman:layout",
  railCollapsed: "marksman:rail-collapsed",
  seenLanding: "marksman:seen-landing",
} as const;
