import { useState } from "react";
import clsx from "clsx";
import { Header } from "./components/Header";
import { StatSummary } from "./components/StatSummary";
import { PoolTable } from "./components/PoolTable";
import { HistoryFeed } from "./components/HistoryFeed";
import { PoolDetailDrawer } from "./components/PoolDetailDrawer";
import { DisclaimerBanner } from "./components/DisclaimerBanner";
import { DegradedSourceBanner } from "./components/DegradedSourceBanner";
import { ErrorState, TableSkeleton } from "./components/StateViews";
import { usePools, useForceRescan, useHistory, useStatus } from "./hooks/usePools";
import type { Pool, PresetKey } from "./api/types";

const PRESET_STORAGE_KEY = "marksman-preset";

function getInitialPreset(): PresetKey {
  const stored = localStorage.getItem(PRESET_STORAGE_KEY);
  return stored === "steady" || stored === "marksman" ? stored : "marksman";
}

type Tab = "pools" | "history";

export default function App() {
  const [preset, setPreset] = useState<PresetKey>(getInitialPreset);
  const [tab, setTab] = useState<Tab>("pools");
  const [selectedPool, setSelectedPool] = useState<Pool | null>(null);

  const poolsQuery = usePools(preset);
  const historyQuery = useHistory();
  const statusQuery = useStatus();
  const rescan = useForceRescan(preset);

  function handlePresetChange(next: PresetKey) {
    setPreset(next);
    localStorage.setItem(PRESET_STORAGE_KEY, next);
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <Header
        preset={preset}
        onPresetChange={handlePresetChange}
        scannedAt={poolsQuery.data?.meta.scannedAt}
        sourceHealth={poolsQuery.data?.meta.sourceHealth}
        onRefresh={() => rescan.mutate()}
        isRefreshing={rescan.isPending || poolsQuery.isFetching}
      />

      <main className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-5 sm:px-6">
        <DisclaimerBanner />
        <DegradedSourceBanner sourceHealth={poolsQuery.data?.meta.sourceHealth} />

        {poolsQuery.data && <StatSummary pools={poolsQuery.data.pools} />}

        <div className="inline-flex w-fit rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5">
          {(["pools", "history"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                "rounded-md px-3.5 py-1.5 text-xs font-medium capitalize transition-colors",
                tab === t ? "bg-[var(--color-surface-raised)] text-[var(--color-text)]" : "text-[var(--color-text-faint)]"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "pools" &&
          (poolsQuery.isLoading ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              <TableSkeleton />
            </div>
          ) : poolsQuery.isError ? (
            <ErrorState
              message={poolsQuery.error instanceof Error ? poolsQuery.error.message : "Failed to load pools"}
              onRetry={() => poolsQuery.refetch()}
            />
          ) : (
            <PoolTable pools={poolsQuery.data?.pools ?? []} onSelectPool={setSelectedPool} />
          ))}

        {tab === "history" &&
          (historyQuery.isLoading ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              <TableSkeleton rows={5} />
            </div>
          ) : historyQuery.isError ? (
            <ErrorState message="Failed to load signal history" onRetry={() => historyQuery.refetch()} />
          ) : (
            <HistoryFeed history={historyQuery.data?.history ?? []} />
          ))}

        <footer className="py-6 text-center text-[11px] text-[var(--color-text-faint)]">
          Marksman scans Robinhood Chain (chainId 4663) every {statusQuery.data?.scanIntervalSeconds ?? 60}s via
          DexScreener + GeckoTerminal. Read-only, no wallet connection.
        </footer>
      </main>

      <PoolDetailDrawer pool={selectedPool} preset={preset} onClose={() => setSelectedPool(null)} />
    </div>
  );
}
