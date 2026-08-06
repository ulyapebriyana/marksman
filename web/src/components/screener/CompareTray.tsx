import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";
import type { Pool } from "../../api/types";
import { buyPressure, momentum1h, poolLabel, turnover, txns24h } from "../../lib/poolMath";
import { formatAge, formatCount, formatPct, formatPrice, formatUsd } from "../../lib/format";
import { Button } from "../ui/primitives";
import { PremiumBadge, RiskBadge, SignalBadge } from "../ui/badges";

const ROWS: { label: string; read: (pool: Pool) => React.ReactNode }[] = [
  { label: "Signal", read: (p) => <SignalBadge status={p.signalStatus} /> },
  { label: "Score", read: (p) => <span className="num text-txt-0">{p.score.total.toFixed(1)}</span> },
  { label: "Risk", read: (p) => <RiskBadge value={p.risk.value} /> },
  { label: "Price", read: (p) => <span className="num">{formatPrice(p.priceUsd)}</span> },
  {
    label: "1h move",
    read: (p) => {
      const move = momentum1h(p);
      return (
        <span className={clsx("num", move == null ? "text-txt-2" : move >= 0 ? "text-bloom" : "text-flare")}>
          {formatPct(move, { signed: true })}
        </span>
      );
    },
  },
  { label: "Premium", read: (p) => <PremiumBadge premiumPct={p.premiumPct} /> },
  { label: "Liquidity", read: (p) => <span className="num">{formatUsd(p.liquidityUsd)}</span> },
  { label: "Volume 24h", read: (p) => <span className="num">{formatUsd(p.volume.h24)}</span> },
  {
    label: "Turnover",
    read: (p) => {
      const rate = turnover(p);
      return <span className="num">{rate == null ? "—" : `${rate.toFixed(2)}×`}</span>;
    },
  },
  { label: "Txns 24h", read: (p) => <span className="num">{formatCount(txns24h(p))}</span> },
  {
    label: "Buy pressure",
    read: (p) => {
      const pressure = buyPressure(p);
      return <span className="num">{pressure == null ? "—" : `${pressure.toFixed(0)}%`}</span>;
    },
  },
  { label: "Age", read: (p) => <span className="num">{formatAge(p.ageMs)}</span> },
  {
    label: "Preset gate",
    read: (p) =>
      p.presetGate.passed ? (
        <span className="text-bloom">Passed</span>
      ) : (
        <span className="text-flare" title={p.presetGate.misses.join(", ")}>
          {p.presetGate.misses.length} miss{p.presetGate.misses.length === 1 ? "" : "es"}
        </span>
      ),
  },
];

export function CompareTray({
  pools,
  onRemove,
  onClear,
  onSelectPool,
}: {
  pools: Pool[];
  onRemove: (address: string) => void;
  onClear: () => void;
  onSelectPool: (pool: Pool) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (pools.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(3.75rem+env(safe-area-inset-bottom))] lg:pb-4">
      <div className="slide-in mx-auto max-w-[1400px] overflow-hidden rounded-2xl border border-line-2 bg-ink-1/95 shadow-pop backdrop-blur-xl">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span className="engraved text-txt-2">Comparing {pools.length}</span>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {pools.map((pool) => (
              <span
                key={pool.address}
                className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-ink-2 py-1 pl-2.5 pr-1 text-[12px] text-txt-0"
              >
                <button onClick={() => onSelectPool(pool)} className="max-w-[10rem] truncate hover:text-reticle">
                  {poolLabel(pool)}
                </button>
                <button
                  onClick={() => onRemove(pool.address)}
                  aria-label={`Remove ${poolLabel(pool)} from comparison`}
                  className="rounded-full p-0.5 text-txt-2 transition-colors hover:text-flare"
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            ))}
          </div>

          <Button size="sm" variant="ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
            {expanded ? <ChevronDown size={13} aria-hidden /> : <ChevronUp size={13} aria-hidden />}
            {expanded ? "Hide" : "Compare"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </div>

        {expanded && (
          <div className="max-h-[45vh] overflow-auto border-t border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 bg-ink-1">
                <tr className="border-b border-line">
                  <th scope="col" className="w-32 px-4 py-2.5 text-left">
                    <span className="engraved text-txt-2">Metric</span>
                  </th>
                  {pools.map((pool) => (
                    <th key={pool.address} scope="col" className="px-4 py-2.5 text-left">
                      <button
                        onClick={() => onSelectPool(pool)}
                        className="truncate text-[13px] font-semibold text-txt-0 hover:text-reticle"
                      >
                        {poolLabel(pool)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-line last:border-0">
                    <th scope="row" className="whitespace-nowrap px-4 py-2 text-left text-[12px] font-normal text-txt-2">
                      {row.label}
                    </th>
                    {pools.map((pool) => (
                      <td key={pool.address} className="px-4 py-2 text-txt-1">
                        {row.read(pool)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
