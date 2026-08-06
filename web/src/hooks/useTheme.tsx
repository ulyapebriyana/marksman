import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { STORAGE_KEYS, readStored, writeStored } from "../lib/storage";

export type Theme = "dark" | "light";

const isTheme = (v: unknown): v is Theme => v === "dark" || v === "light";

function getInitialTheme(): Theme {
  const stored = readStored<Theme | null>(STORAGE_KEYS.theme, null, (v): v is Theme | null => v === null || isTheme(v));
  if (stored) return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

interface ThemeValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

/**
 * Theme lives in context, not in per-component state. The top bar's toggle and
 * the `t` shortcut in the console both drive it, and two independent copies
 * would drift apart the moment either one was used.
 */
const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#08070C" : "#F5F3FA");
    writeStored(STORAGE_KEYS.theme, theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
