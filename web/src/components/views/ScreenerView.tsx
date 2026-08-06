import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Columns3, Download, LayoutGrid, List, Rows2, Rows3 } from "lucide-react";
import type { Pool } from "../../api/types";
import {
  DEFAULT_FILTERS,
  applyFilters,
  downloadCsv,
  poolsToCsv,
  sortPools,
  type Filters,
  type SortKey,
} from "../../lib/poolMath";
import { STORAGE_KEYS, readStored, writeStored } from "../../lib/storage";
import { Button, IconButton, Segmented } from "../ui/primitives";
import { FilterPanel } from "../screener/FilterPanel";
import { ALL_COLUMNS, DEFAULT_COLUMNS, PoolTable, type ColumnKey } from "../screener/PoolTable";
import { PoolCards } from "../screener/PoolCards";
import { CompareTray } from "../screener/CompareTray";
import { TableSkeleton } from "../ui/states";
import { useToast } from "../../hooks/useToast";
import { useMediaQuery } from "../../hooks/useMisc";

const MAX_COMPARE = 4;

function ColumnMenu({ columns, onChange }: { columns: ColumnKey[]; onChange: (columns: ColumnKey[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <IconButton label="Choose columns" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Columns3 size={15} aria-hidden />
      </IconButton>

      {open && (
        <div className="fade-in absolute right-0 top-full z-20 mt-1.5 w-52 overflow-hidden rounded-xl border border-line-2 bg-ink-1 p-1.5 shadow-pop">
          <p className="engraved px-2.5 py-1.5 text-txt-2">Columns</p>
          {ALL_COLUMNS.map((column) => {
            const checked = columns.includes(column.key);
            return (
              <button
                key={column.key}
                onClick={() =>
                  onChange(
                    checked ? columns.filter((c) => c !== column.key) : [...columns, column.key]
                  )
                }
                role="menuitemcheckbox"
                aria-checked={checked}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-txt-1 transition-colors hover:bg-ink-2 hover:text-txt-0"
              >
                <span
                  className={clsx(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-[9px]",
                    checked ? "border-reticle bg-reticle text-reticle-ink" : "border-line-2"
                  )}
                  aria-hidden
                >
                  {checked ? "✓" : ""}
                </span>
                {column.label}
              </button>
            );
          })}
          <button
            onClick={() => onChange(DEFAULT_COLUMNS)}
            className="mt-1 w-full rounded-lg border-t border-line px-2.5 py-2 text-left text-[12px] text-txt-2 transition-colors hover:text-txt-0"
          >
            Reset to default
          </button>
        </div>
      )}
    </div>
  );
}

export function ScreenerView({
  pools,
  isLoading,
  onSelectPool,
  isWatched,
  onToggleWatch,
  watchlistCount,
  filters,
  onFiltersChange,
}: {
  pools: Pool[];
  isLoading: boolean;
  onSelectPool: (pool: Pool) => void;
  isWatched: (address: string) => boolean;
  onToggleWatch: (address: string) => void;
  watchlistCount: number;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
}) {
  const { showToast } = useToast();

  // A 12-column table inside a 375px viewport is a horizontal-scroll trap, so
  // narrow screens always get cards — and the controls that only shape the
  // table are hidden rather than left there doing nothing.
  const isWide = useMediaQuery("(min-width: 768px)");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const [layout, setLayout] = useState<"table" | "cards">(() =>
    readStored<"table" | "cards">(STORAGE_KEYS.layout, "table", (v): v is "table" | "cards" => v === "table" || v === "cards")
  );
  const [density, setDensity] = useState<"comfortable" | "compact">(() =>
    readStored<"comfortable" | "compact">(
      STORAGE_KEYS.density,
      "comfortable",
      (v): v is "comfortable" | "compact" => v === "comfortable" || v === "compact"
    )
  );
  const [columns, setColumns] = useState<ColumnKey[]>(() =>
    readStored<ColumnKey[]>(STORAGE_KEYS.columns, DEFAULT_COLUMNS, (v): v is ColumnKey[] => Array.isArray(v))
  );

  useEffect(() => writeStored(STORAGE_KEYS.layout, layout), [layout]);
  useEffect(() => writeStored(STORAGE_KEYS.density, density), [density]);
  useEffect(() => writeStored(STORAGE_KEYS.columns, columns), [columns]);

  const watchedSet = useMemo(() => new Set(pools.filter((p) => isWatched(p.address)).map((p) => p.address)), [pools, isWatched]);

  const rows = useMemo(
    () => sortPools(applyFilters(pools, filters, watchedSet), sortKey, sortDir),
    [pools, filters, watchedSet, sortKey, sortDir]
  );

  const comparePools = useMemo(
    () => compareIds.map((id) => pools.find((p) => p.address === id)).filter((p): p is Pool => p != null),
    [compareIds, pools]
  );

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  function toggleCompare(address: string) {
    setCompareIds((prev) => {
      if (prev.includes(address)) return prev.filter((a) => a !== address);
      if (prev.length >= MAX_COMPARE) {
        showToast(`Comparison holds ${MAX_COMPARE} pools. Remove one to add another.`, "info");
        return prev;
      }
      return [...prev, address];
    });
  }

  function handleExport() {
    if (rows.length === 0) {
      showToast("Nothing to export — no pools match the current filters.", "info");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    downloadCsv(`marksman-scan-${stamp}.csv`, poolsToCsv(rows));
    showToast(`Exported ${rows.length} pool${rows.length === 1 ? "" : "s"} to CSV.`, "success");
  }

  const emptyAction = (
    <Button size="sm" onClick={() => onFiltersChange(DEFAULT_FILTERS)}>
      Clear all filters
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isWide && (
          <>
            <Segmented
              ariaLabel="Result layout"
              size="sm"
              value={layout}
              onChange={setLayout}
              options={[
                { value: "table", label: <List size={14} aria-hidden />, title: "Table" },
                { value: "cards", label: <LayoutGrid size={14} aria-hidden />, title: "Cards" },
              ]}
            />

            {layout === "table" && (
              <>
                <Segmented
                  ariaLabel="Row density"
                  size="sm"
                  value={density}
                  onChange={setDensity}
                  options={[
                    { value: "comfortable", label: <Rows2 size={14} aria-hidden />, title: "Comfortable rows" },
                    { value: "compact", label: <Rows3 size={14} aria-hidden />, title: "Compact rows" },
                  ]}
                />
                <ColumnMenu columns={columns} onChange={setColumns} />
              </>
            )}
          </>
        )}

        <Button size="sm" onClick={handleExport}>
          <Download size={13} aria-hidden /> Export CSV
        </Button>
      </div>

      <FilterPanel
        filters={filters}
        onChange={onFiltersChange}
        open={filtersOpen}
        onToggle={() => setFiltersOpen((v) => !v)}
        resultCount={rows.length}
        totalCount={pools.length}
        watchlistCount={watchlistCount}
      />

      {isLoading ? (
        <div className="panel">
          <TableSkeleton />
        </div>
      ) : isWide && layout === "table" ? (
        <PoolTable
          pools={rows}
          columns={columns}
          density={density}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          onSelectPool={onSelectPool}
          isWatched={isWatched}
          onToggleWatch={onToggleWatch}
          compareIds={compareIds}
          onToggleCompare={toggleCompare}
          emptyAction={emptyAction}
        />
      ) : (
        <PoolCards
          pools={rows}
          onSelectPool={onSelectPool}
          isWatched={isWatched}
          onToggleWatch={onToggleWatch}
          compareIds={compareIds}
          onToggleCompare={toggleCompare}
          emptyAction={emptyAction}
        />
      )}

      <CompareTray
        pools={comparePools}
        onRemove={(address) => setCompareIds((prev) => prev.filter((a) => a !== address))}
        onClear={() => setCompareIds([])}
        onSelectPool={onSelectPool}
      />
    </div>
  );
}
