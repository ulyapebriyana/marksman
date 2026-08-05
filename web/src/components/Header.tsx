import clsx from "clsx";
import { Crosshair, Moon, RefreshCw, Sun } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { formatRelativeTime } from "../lib/format";
import type { PresetKey, SourceHealth } from "../api/types";
import { PresetSwitcher } from "./PresetSwitcher";

function SourceDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-text-faint)]" title={`${label}: ${ok ? "healthy" : "degraded"}`}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", ok ? "bg-[var(--color-up)]" : "bg-[var(--color-hot)]")} />
      {label}
    </span>
  );
}

export function Header({
  preset,
  onPresetChange,
  scannedAt,
  sourceHealth,
  onRefresh,
  isRefreshing,
}: {
  preset: PresetKey;
  onPresetChange: (p: PresetKey) => void;
  scannedAt?: number;
  sourceHealth?: SourceHealth;
  onRefresh: () => void;
  isRefreshing: boolean;
}) {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
            <Crosshair size={18} />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight text-[var(--color-text)]">Marksman</h1>
            <p className="text-[11px] leading-tight text-[var(--color-text-faint)]">Robinhood Chain pool screener</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {sourceHealth && (
            <div className="hidden items-center gap-2.5 rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 md:flex">
              <SourceDot ok={sourceHealth.dexscreener.ok} label="DexScreener" />
              <SourceDot ok={sourceHealth.geckoterminal.ok} label="Gecko" />
              <SourceDot ok={sourceHealth.equity.ok} label="Equity" />
            </div>
          )}

          <span className="text-xs text-[var(--color-text-faint)]" title={scannedAt ? new Date(scannedAt).toLocaleString() : undefined}>
            Scanned {formatRelativeTime(scannedAt)}
          </span>

          <PresetSwitcher value={preset} onChange={onPresetChange} />

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-raised)] disabled:opacity-50"
            title="Force a fresh scan"
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
          </button>

          <button
            onClick={toggle}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-dim)] hover:bg-[var(--color-surface-raised)]"
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </div>
    </header>
  );
}
