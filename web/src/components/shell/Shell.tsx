import clsx from "clsx";
import {
  ChevronsLeft,
  Command,
  Moon,
  PanelLeft,
  RefreshCw,
  Search,
  Sun,
  Star,
} from "lucide-react";
import type { PresetKey, SourceHealth } from "../../api/types";
import { NAV_ITEMS, type ViewKey } from "../../lib/nav";
import { Link } from "../../lib/router";
import { formatRelativeTime } from "../../lib/format";
import { IconButton, ProgressRing, Segmented } from "../ui/primitives";
import { ReticleMark, Wordmark } from "../ui/Wordmark";
import { useTheme } from "../../hooks/useTheme";

/* -------------------------------------------------------------------------- */
/* Left rail                                                                   */
/* -------------------------------------------------------------------------- */

export function Rail({
  view,
  collapsed,
  onToggleCollapsed,
  watchlistCount,
}: {
  view: ViewKey;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  watchlistCount: number;
}) {
  return (
    <aside
      className={clsx(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-ink-1 transition-[width] duration-200 lg:flex",
        collapsed ? "w-16" : "w-56"
      )}
    >
      <div className={clsx("flex h-16 shrink-0 items-center border-b border-line", collapsed ? "justify-center px-2" : "px-4")}>
        <Link to="/" className="min-w-0" aria-label="Marksman home">
          {collapsed ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-reticle/30 bg-reticle/10 text-reticle">
              <ReticleMark size={18} />
            </span>
          ) : (
            <Wordmark />
          )}
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2.5" aria-label="Console views">
        {NAV_ITEMS.map((item) => {
          const active = item.key === view;
          return (
            <Link
              key={item.key}
              to={item.path}
              title={collapsed ? `${item.label} — ${item.blurb}` : item.blurb}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors",
                collapsed && "justify-center px-0",
                active ? "bg-ink-3 text-txt-0" : "text-txt-2 hover:bg-ink-2 hover:text-txt-0"
              )}
            >
              {active && (
                <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-reticle" aria-hidden />
              )}
              <item.icon size={16} className={clsx("shrink-0", active && "text-reticle")} aria-hidden />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-line p-2.5">
        {!collapsed && watchlistCount > 0 && (
          <p className="mb-2 flex items-center gap-1.5 px-2.5 text-[11px] text-txt-2">
            <Star size={12} className="text-reticle" aria-hidden />
            {watchlistCount} watched
          </p>
        )}
        <button
          onClick={onToggleCollapsed}
          className={clsx(
            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-medium text-txt-2 transition-colors hover:bg-ink-2 hover:text-txt-0",
            collapsed && "justify-center px-0"
          )}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeft size={16} aria-hidden /> : <ChevronsLeft size={16} aria-hidden />}
          {!collapsed && "Collapse"}
        </button>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Mobile bottom nav                                                           */
/* -------------------------------------------------------------------------- */

export function MobileNav({ view }: { view: ViewKey }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid border-t border-line bg-ink-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
      style={{ gridTemplateColumns: `repeat(${NAV_ITEMS.length}, minmax(0, 1fr))` }}
      aria-label="Console views"
    >
      {NAV_ITEMS.map((item) => {
        const active = item.key === view;
        return (
          <Link
            key={item.key}
            to={item.path}
            aria-current={active ? "page" : undefined}
            className={clsx(
              "flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
              active ? "text-reticle" : "text-txt-2"
            )}
          >
            <item.icon size={17} aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Top bar                                                                     */
/* -------------------------------------------------------------------------- */

function SourceDot({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-txt-2"
      title={`${label}: ${ok ? "responding" : "not responding"}${detail ? ` — ${detail}` : ""}`}
    >
      <span className={clsx("h-1.5 w-1.5 rounded-full", ok ? "bg-bloom" : "bg-flare")} aria-hidden />
      <span className="sr-only">{label} is </span>
      {label}
      <span className="sr-only">{ok ? "responding" : "not responding"}</span>
    </span>
  );
}

export function TopBar({
  title,
  preset,
  onPresetChange,
  scannedAt,
  sourceHealth,
  onRefresh,
  isRefreshing,
  onOpenPalette,
  scanProgress,
  scanRemaining,
}: {
  title: string;
  preset: PresetKey;
  onPresetChange: (preset: PresetKey) => void;
  scannedAt?: number;
  sourceHealth?: SourceHealth;
  onRefresh: () => void;
  isRefreshing: boolean;
  onOpenPalette: () => void;
  scanProgress: number;
  scanRemaining: number;
}) {
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink-0/85 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <Link to="/" className="lg:hidden" aria-label="Marksman home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-reticle/30 bg-reticle/10 text-reticle">
            <ReticleMark size={18} />
          </span>
        </Link>

        <h1 className="font-display truncate text-[17px] font-bold tracking-[-0.02em] text-txt-0">{title}</h1>

        <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
          {/* The preset switcher drops to its own row under 640px — squeezing it
              in here is what crushes the view title down to one letter. */}
          {sourceHealth && (
            <div className="hidden items-center gap-3 rounded-lg border border-line bg-ink-1 px-3 py-1.5 xl:flex">
              <SourceDot
                ok={sourceHealth.dexscreener.ok}
                label="DexScreener"
                detail={sourceHealth.dexscreener.pairsReturned != null ? `${sourceHealth.dexscreener.pairsReturned} pairs` : undefined}
              />
              <SourceDot
                ok={sourceHealth.geckoterminal.ok}
                label="Gecko"
                detail={`${sourceHealth.geckoterminal.successCount} ok / ${sourceHealth.geckoterminal.failureCount} failed`}
              />
              <SourceDot ok={sourceHealth.equity.ok} label="Equity" />
            </div>
          )}

          <button
            onClick={onOpenPalette}
            className="hidden h-9 items-center gap-2 rounded-lg border border-line bg-ink-1 pl-2.5 pr-2 text-[13px] text-txt-2 transition-colors hover:border-line-2 hover:text-txt-1 md:flex"
          >
            <Search size={14} aria-hidden />
            <span className="pr-6">Search pools…</span>
            <span className="inline-flex items-center gap-0.5 rounded border border-line-2 bg-ink-2 px-1.5 py-0.5 font-mono text-[10px]">
              <Command size={9} aria-hidden />K
            </span>
          </button>

          <IconButton label="Search pools" onClick={onOpenPalette} className="md:hidden" size="sm">
            <Search size={15} aria-hidden />
          </IconButton>

          <div className="hidden sm:block">
            <Segmented
              ariaLabel="Signal preset"
              size="sm"
              value={preset}
              onChange={onPresetChange}
              options={[
                { value: "steady", label: "Steady", title: "Conservative gate — established pools, within ±2% of parity" },
                { value: "marksman", label: "Marksman", title: "Dislocation gate — wants the gap at least 1% wide" },
              ]}
            />
          </div>

          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            title={
              scannedAt
                ? `Scanned ${formatRelativeTime(scannedAt)} · next cycle in ${scanRemaining}s. Click to rescan now.`
                : "Rescan now"
            }
            aria-label="Rescan now"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-ink-1 px-2.5 transition-colors hover:border-line-2 disabled:opacity-50"
          >
            <ProgressRing progress={isRefreshing ? 1 : scanProgress} size={18} strokeWidth={2}>
              <RefreshCw size={9} className={clsx("text-txt-2", isRefreshing && "animate-spin")} aria-hidden />
            </ProgressRing>
            <span className="num hidden text-[11px] text-txt-2 sm:inline">{isRefreshing ? "…" : `${scanRemaining}s`}</span>
          </button>

          <IconButton
            label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            onClick={toggle}
            size="sm"
          >
            {theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
          </IconButton>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-line px-4 py-2 sm:hidden">
        <Segmented
          ariaLabel="Signal preset"
          size="sm"
          value={preset}
          onChange={onPresetChange}
          className="flex-1"
          fill
          options={[
            { value: "steady", label: "Steady", title: "Conservative gate — established pools, within ±2% of parity" },
            { value: "marksman", label: "Marksman", title: "Dislocation gate — wants the gap at least 1% wide" },
          ]}
        />
        {sourceHealth && (
          <div className="flex shrink-0 items-center gap-2">
            <SourceDot ok={sourceHealth.dexscreener.ok} label="Dex" />
            <SourceDot ok={sourceHealth.geckoterminal.ok} label="Gecko" />
            <SourceDot ok={sourceHealth.equity.ok} label="Equity" />
          </div>
        )}
      </div>
    </header>
  );
}
