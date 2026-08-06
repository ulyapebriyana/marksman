import { RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import clsx from "clsx";
import type { SignalStatus } from "../../api/types";
import { DEFAULT_FILTERS, activeFilterCount, type Filters } from "../../lib/poolMath";
import { formatUsd } from "../../lib/format";
import { Button, Chip, RangeField, Switch } from "../ui/primitives";

const SIGNAL_OPTIONS: { value: SignalStatus; label: string; tone: "flare" | "reticle" | "coat" }[] = [
  { value: "hot", label: "Hot", tone: "flare" },
  { value: "watch", label: "Watch", tone: "reticle" },
  { value: "none", label: "Quiet", tone: "coat" },
];

/**
 * Liquidity and volume span several orders of magnitude, so the sliders move on
 * a log scale — otherwise the entire useful range sits in the first 2% of travel.
 */
const LOG_MAX = 7; // $10,000,000
function sliderToUsd(position: number): number {
  return position <= 0 ? 0 : Math.round(10 ** (position / 100 * LOG_MAX));
}
function usdToSlider(usd: number): number {
  return usd <= 0 ? 0 : Math.round((Math.log10(usd) / LOG_MAX) * 100);
}

export function FilterPanel({
  filters,
  onChange,
  open,
  onToggle,
  resultCount,
  totalCount,
  watchlistCount,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  open: boolean;
  onToggle: () => void;
  resultCount: number;
  totalCount: number;
  watchlistCount: number;
}) {
  const activeCount = activeFilterCount(filters);
  const patch = (next: Partial<Filters>) => onChange({ ...filters, ...next });

  function toggleSignal(signal: SignalStatus) {
    const next = filters.signals.includes(signal)
      ? filters.signals.filter((s) => s !== signal)
      : [...filters.signals, signal];
    patch({ signals: next });
  }

  return (
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <div className="flex min-w-[180px] flex-1 items-center gap-2">
          <Search size={15} className="shrink-0 text-txt-2" aria-hidden />
          <input
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
            placeholder="Filter by symbol, ticker, or address…"
            aria-label="Filter pools"
            className="w-full bg-transparent text-[13px] text-txt-0 placeholder:text-txt-2 focus:outline-none"
          />
          {filters.search && (
            <button
              onClick={() => patch({ search: "" })}
              className="shrink-0 rounded p-0.5 text-txt-2 transition-colors hover:text-txt-0"
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="hidden items-center gap-1.5 sm:flex">
          {SIGNAL_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              tone={option.tone}
              active={filters.signals.includes(option.value)}
              onClick={() => toggleSignal(option.value)}
              title={`Show only ${option.label.toLowerCase()} pools`}
            >
              {option.label}
            </Chip>
          ))}
        </div>

        <span className="num whitespace-nowrap text-[11px] text-txt-2">
          {resultCount === totalCount ? `${totalCount} pools` : `${resultCount} of ${totalCount}`}
        </span>

        <Button
          size="sm"
          variant={open || activeCount > 0 ? "primary" : "secondary"}
          onClick={onToggle}
          aria-expanded={open}
        >
          <SlidersHorizontal size={13} aria-hidden />
          Filters
          {activeCount > 0 && (
            <span className="num ml-0.5 rounded-full bg-black/20 px-1.5 text-[10px]">{activeCount}</span>
          )}
        </Button>
      </div>

      {open && (
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 border-t border-line px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-4">
            <p className="engraved text-txt-2">Thresholds</p>
            <RangeField
              label="Min liquidity"
              min={0}
              max={100}
              step={1}
              value={usdToSlider(filters.minLiquidity)}
              onChange={(position) => patch({ minLiquidity: sliderToUsd(position) })}
              format={() => (filters.minLiquidity > 0 ? formatUsd(filters.minLiquidity) : "Any")}
            />
            <RangeField
              label="Min 24h volume"
              min={0}
              max={100}
              step={1}
              value={usdToSlider(filters.minVolume)}
              onChange={(position) => patch({ minVolume: sliderToUsd(position) })}
              format={() => (filters.minVolume > 0 ? formatUsd(filters.minVolume) : "Any")}
            />
          </div>

          <div className="space-y-4">
            <p className="engraved text-txt-2">Quality</p>
            <RangeField
              label="Max risk"
              min={0}
              max={100}
              step={5}
              value={filters.maxRisk}
              onChange={(maxRisk) => patch({ maxRisk })}
              format={(v) => (v >= 100 ? "Any" : `≤ ${v}`)}
            />
            <RangeField
              label="Min score"
              min={0}
              max={100}
              step={5}
              value={filters.minScore}
              onChange={(minScore) => patch({ minScore })}
              format={(v) => (v <= 0 ? "Any" : `≥ ${v}`)}
            />
          </div>

          <div className="space-y-1">
            <p className="engraved mb-3 text-txt-2">Only show</p>
            <Switch
              label="Tokenized stocks"
              description="Pools holding an ERC-20 that tracks an equity"
              checked={filters.tokenizedOnly}
              onChange={(tokenizedOnly) => patch({ tokenizedOnly })}
            />
            <Switch
              label="Passing the preset gate"
              description="Hide pools the active preset rejected"
              checked={filters.passingOnly}
              onChange={(passingOnly) => patch({ passingOnly })}
            />
            <Switch
              label="Watchlist"
              description={watchlistCount > 0 ? `${watchlistCount} pool${watchlistCount === 1 ? "" : "s"} starred` : "Nothing starred yet"}
              checked={filters.watchlistOnly}
              onChange={(watchlistOnly) => patch({ watchlistOnly })}
            />
          </div>

          <div className={clsx("sm:col-span-2 lg:col-span-3", activeCount === 0 && "hidden")}>
            <Button size="sm" variant="ghost" onClick={() => onChange({ ...DEFAULT_FILTERS, search: filters.search })}>
              <RotateCcw size={13} aria-hidden /> Reset filters
            </Button>
          </div>
        </div>
      )}

      {/* Signal chips move below the search field on narrow screens. */}
      <div className="flex items-center gap-1.5 border-t border-line px-3 py-2 sm:hidden">
        {SIGNAL_OPTIONS.map((option) => (
          <Chip
            key={option.value}
            tone={option.tone}
            active={filters.signals.includes(option.value)}
            onClick={() => toggleSignal(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
