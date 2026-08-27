import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { Download, Droplets, Moon, RefreshCw, Star, Sun, Trash2 } from "lucide-react";
import type { LpPresetKey, Pool, PresetKey } from "../api/types";
import { useForceRescan, useHistory, usePools, useStatus } from "../hooks/usePools";
import { useRefreshTokenReport, useTokenReport } from "../hooks/useTokenReport";
import { useWatchlist } from "../hooks/useWatchlist";
import { useHotkeys, useLeaderKey } from "../hooks/useHotkeys";
import { useScanProgress } from "../hooks/useMisc";
import { useTheme } from "../hooks/useTheme";
import { useToast } from "../hooks/useToast";
import { STORAGE_KEYS, readStored, writeStored } from "../lib/storage";
import { DEFAULT_FILTERS, applyFilters, downloadCsv, poolsToCsv, type Filters } from "../lib/poolMath";
import { NAV_ITEMS, tokenAddressFromPath, viewFromPath, type ViewKey } from "../lib/nav";
import { useRouter } from "../lib/router";

import { MobileNav, Rail, TopBar } from "../components/shell/Shell";
import { CommandPalette, type Command } from "../components/shell/CommandPalette";
import { PoolDrawer } from "../components/PoolDrawer";
import { DegradedSourceBanner, DisclaimerBanner, ErrorState, TableSkeleton } from "../components/ui/states";
import { OverviewView } from "../components/views/OverviewView";
import { ScreenerView } from "../components/views/ScreenerView";
import { FunnelView } from "../components/views/FunnelView";
import { SpreadsView } from "../components/views/SpreadsView";
import { LiquidityView } from "../components/views/LiquidityView";
import { SignalsView } from "../components/views/SignalsView";
import { SystemView } from "../components/views/SystemView";
import { TokenReportView } from "../components/views/TokenReportView";

// Analytics is the only view that pulls in Recharts — roughly half the bundle.
// Splitting it keeps the first paint of every other view lean.
const AnalyticsView = lazy(() =>
  import("../components/views/AnalyticsView").then((m) => ({ default: m.AnalyticsView }))
);

const isPreset = (v: unknown): v is PresetKey => v === "steady" || v === "marksman";
const isLpPreset = (v: unknown): v is LpPresetKey => v === "harvest" || v === "carry" || v === "vault";

const LP_PRESET_CYCLE: LpPresetKey[] = ["harvest", "carry", "vault"];

export default function Console() {
  const { path, navigate } = useRouter();
  const view: ViewKey = viewFromPath(path);
  const { showToast } = useToast();
  const { toggle: toggleTheme, theme } = useTheme();

  const [preset, setPreset] = useState<PresetKey>(() =>
    readStored<PresetKey>(STORAGE_KEYS.preset, "marksman", isPreset)
  );
  const [lpPreset, setLpPreset] = useState<LpPresetKey>(() =>
    readStored<LpPresetKey>(STORAGE_KEYS.lpPreset, "carry", isLpPreset)
  );
  const [filters, setFilters] = useState<Filters>(() =>
    readStored<Filters>(STORAGE_KEYS.filters, DEFAULT_FILTERS, (v): v is Filters => typeof v === "object" && v !== null)
  );
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() =>
    readStored<boolean>(STORAGE_KEYS.railCollapsed, false, (v): v is boolean => typeof v === "boolean")
  );

  // A token report is a detail route layered over the console shell rather
  // than a nav view — the rail keeps whatever view the user came from.
  const tokenAddress = tokenAddressFromPath(path);
  const tokenQuery = useTokenReport(tokenAddress);
  const refreshToken = useRefreshTokenReport(tokenAddress);

  const poolsQuery = usePools(preset, lpPreset);
  const historyQuery = useHistory();
  const statusQuery = useStatus();
  const rescan = useForceRescan(preset, lpPreset);
  const watchlist = useWatchlist();

  const pools = useMemo(() => poolsQuery.data?.pools ?? [], [poolsQuery.data]);
  const history = historyQuery.data?.history ?? [];
  const meta = poolsQuery.data?.meta;

  const { progress, remaining } = useScanProgress(meta?.scannedAt, statusQuery.data?.scanIntervalSeconds ?? 60);

  useEffect(() => writeStored(STORAGE_KEYS.preset, preset), [preset]);
  useEffect(() => writeStored(STORAGE_KEYS.lpPreset, lpPreset), [lpPreset]);
  useEffect(() => writeStored(STORAGE_KEYS.filters, filters), [filters]);
  useEffect(() => writeStored(STORAGE_KEYS.railCollapsed, railCollapsed), [railCollapsed]);

  // Keep the open drawer pointed at the freshest copy of its pool, so numbers
  // update in place instead of freezing at whatever the row held when clicked.
  useEffect(() => {
    if (!selectedPool) return;
    const fresh = pools.find((pool) => pool.address === selectedPool.address);
    if (fresh && fresh !== selectedPool) setSelectedPool(fresh);
  }, [pools, selectedPool]);

  const handleRescan = useCallback(() => {
    rescan.mutate(undefined, {
      onSuccess: (data) => showToast(`Rescanned — ${data.meta.poolCount} pools.`, "success"),
      onError: (err) => showToast(err instanceof Error ? err.message : "Rescan failed.", "error"),
    });
  }, [rescan, showToast]);

  const handleExport = useCallback(() => {
    const rows = applyFilters(pools, filters, watchlist.set);
    if (rows.length === 0) {
      showToast("Nothing to export — no pools match the current filters.", "info");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadCsv(`marksman-scan-${stamp}.csv`, poolsToCsv(rows));
    showToast(`Exported ${rows.length} pool${rows.length === 1 ? "" : "s"} to CSV.`, "success");
  }, [pools, filters, watchlist.set, showToast]);

  /* --- keyboard ---------------------------------------------------------- */

  useHotkeys({
    "mod+k": (e) => {
      e.preventDefault();
      setPaletteOpen(true);
    },
    "/": (e) => {
      e.preventDefault();
      setPaletteOpen(true);
    },
    r: () => handleRescan(),
    t: () => toggleTheme(),
    "?": () => navigate("/app/system"),
    escape: () => {
      setPaletteOpen(false);
      setSelectedPool(null);
    },
  });

  useLeaderKey(
    "g",
    Object.fromEntries(NAV_ITEMS.map((item) => [item.hotkey, () => navigate(item.path)]))
  );

  /* --- palette commands -------------------------------------------------- */

  const commands = useMemo<Command[]>(
    () => [
      {
        id: "rescan",
        label: "Rescan now",
        hint: "Bypass the cache and hit both sources",
        group: "Action",
        icon: <RefreshCw size={15} aria-hidden />,
        run: handleRescan,
      },
      {
        id: "preset",
        label: `Switch to the ${preset === "marksman" ? "Steady" : "Marksman"} preset`,
        hint: "Re-evaluates the current scan — no upstream calls",
        group: "Action",
        icon: <Star size={15} aria-hidden />,
        run: () => setPreset(preset === "marksman" ? "steady" : "marksman"),
      },
      {
        id: "lp-preset",
        label: `Cycle the LP posture (now ${lpPreset})`,
        hint: "Harvest → Carry → Vault. Re-gates the cached scan.",
        group: "Action",
        icon: <Droplets size={15} aria-hidden />,
        run: () => {
          const next = LP_PRESET_CYCLE[(LP_PRESET_CYCLE.indexOf(lpPreset) + 1) % LP_PRESET_CYCLE.length];
          setLpPreset(next);
          navigate("/app/liquidity");
        },
      },
      {
        id: "export",
        label: "Export the current view to CSV",
        hint: "Respects the filters you have applied",
        group: "Action",
        icon: <Download size={15} aria-hidden />,
        run: handleExport,
      },
      {
        id: "theme",
        label: theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme",
        group: "Action",
        icon: theme === "dark" ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />,
        run: toggleTheme,
      },
      ...(watchlist.count > 0
        ? [
            {
              id: "clear-watchlist",
              label: `Clear the watchlist (${watchlist.count})`,
              group: "Action",
              icon: <Trash2 size={15} aria-hidden />,
              run: () => {
                watchlist.clear();
                showToast("Watchlist cleared.", "success");
              },
            },
          ]
        : []),
    ],
    [preset, lpPreset, theme, handleRescan, handleExport, toggleTheme, watchlist, showToast, navigate]
  );

  /* --- render ------------------------------------------------------------ */

  const title = tokenAddress
    ? (tokenQuery.data?.identity.symbol ? `$${tokenQuery.data.identity.symbol}` : "Laporan Token")
    : (NAV_ITEMS.find((item) => item.key === view)?.label ?? "Overview");
  const showLoading = poolsQuery.isLoading && pools.length === 0;

  function renderView() {
    if (tokenAddress) {
      return (
        <TokenReportView
          address={tokenAddress}
          report={tokenQuery.data}
          isLoading={tokenQuery.isLoading}
          error={tokenQuery.error instanceof Error ? tokenQuery.error : null}
          onRefresh={() =>
            refreshToken.mutate(undefined, {
              onSuccess: () => showToast("Laporan token disegarkan.", "success"),
              onError: (err) =>
                showToast(err instanceof Error ? err.message : "Gagal menyegarkan laporan.", "error"),
            })
          }
          isRefreshing={refreshToken.isPending}
          onRetry={() => tokenQuery.refetch()}
        />
      );
    }

    if (poolsQuery.isError && pools.length === 0 && view !== "system") {
      return (
        <ErrorState
          message={poolsQuery.error instanceof Error ? poolsQuery.error.message : "Could not load pools."}
          onRetry={() => poolsQuery.refetch()}
        />
      );
    }

    switch (view) {
      case "screener":
        return (
          <ScreenerView
            pools={pools}
            isLoading={showLoading}
            onSelectPool={setSelectedPool}
            isWatched={watchlist.has}
            onToggleWatch={watchlist.toggle}
            watchlistCount={watchlist.count}
            filters={filters}
            onFiltersChange={setFilters}
          />
        );
      case "funnel":
        return showLoading ? (
          <div className="panel">
            <TableSkeleton rows={6} />
          </div>
        ) : (
          <FunnelView pools={pools} onSelectPool={setSelectedPool} />
        );
      case "spreads":
        return showLoading ? (
          <div className="panel">
            <TableSkeleton rows={6} />
          </div>
        ) : (
          <SpreadsView pools={pools} onSelectPool={setSelectedPool} />
        );
      case "liquidity":
        return showLoading ? (
          <div className="panel">
            <TableSkeleton rows={6} />
          </div>
        ) : (
          <LiquidityView
            pools={pools}
            lpPreset={lpPreset}
            onLpPresetChange={setLpPreset}
            onSelectPool={setSelectedPool}
          />
        );
      case "signals":
        return <SignalsView history={history} isLoading={historyQuery.isLoading} />;
      case "analytics":
        return showLoading ? (
          <div className="panel">
            <TableSkeleton rows={6} />
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="panel">
                <TableSkeleton rows={6} />
              </div>
            }
          >
            <AnalyticsView pools={pools} />
          </Suspense>
        );
      case "system":
        return <SystemView status={statusQuery.data} meta={meta} isLoading={statusQuery.isLoading} />;
      case "overview":
      default:
        return showLoading ? (
          <div className="panel">
            <TableSkeleton />
          </div>
        ) : (
          <OverviewView pools={pools} history={history} onSelectPool={setSelectedPool} />
        );
    }
  }

  return (
    <div className="flex min-h-screen bg-ink-0">
      <Rail
        view={view}
        collapsed={railCollapsed}
        onToggleCollapsed={() => setRailCollapsed((v) => !v)}
        watchlistCount={watchlist.count}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={title}
          preset={preset}
          onPresetChange={setPreset}
          scannedAt={meta?.scannedAt}
          sourceHealth={meta?.sourceHealth}
          onRefresh={handleRescan}
          isRefreshing={rescan.isPending}
          onOpenPalette={() => setPaletteOpen(true)}
          scanProgress={progress}
          scanRemaining={remaining}
        />

        <main className="flex-1 px-4 pb-24 pt-4 sm:px-6 lg:pb-8">
          <div className="mx-auto max-w-[1400px] space-y-4">
            <DegradedSourceBanner sourceHealth={meta?.sourceHealth} />
            {renderView()}
            {view !== "system" && !tokenAddress && <DisclaimerBanner />}
          </div>
        </main>
      </div>

      <MobileNav view={view} />

      <PoolDrawer
        pool={selectedPool}
        preset={preset}
        onClose={() => setSelectedPool(null)}
        isWatched={selectedPool ? watchlist.has(selectedPool.address) : false}
        onToggleWatch={() => selectedPool && watchlist.toggle(selectedPool.address)}
      />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        pools={pools}
        commands={commands}
        onSelectPool={setSelectedPool}
        onNavigate={navigate}
      />
    </div>
  );
}
