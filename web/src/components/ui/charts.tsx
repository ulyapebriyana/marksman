import { useId } from "react";
import clsx from "clsx";

/**
 * Hand-rolled SVG sparkline. Recharts carries a ResponsiveContainer + a full
 * cartesian layout per instance, which is far too much machinery for a 80×28
 * spark repeated on every table row.
 */
export function Sparkline({
  data,
  className,
  strokeWidth = 1.5,
  fill = true,
}: {
  data: number[];
  className?: string;
  strokeWidth?: number;
  fill?: boolean;
}) {
  const gradientId = useId();

  if (!data || data.length < 2) {
    return (
      <div className={clsx("flex items-center", className ?? "h-7 w-20")} aria-hidden>
        <span className="h-px w-full bg-line" />
      </div>
    );
  }

  const width = 100;
  const height = 32;
  const pad = strokeWidth;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = pad + (1 - (value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const isUp = data[data.length - 1] >= data[0];
  const color = isUp ? "var(--c-bloom)" : "var(--c-flare)";
  const changePct = data[0] !== 0 ? ((data[data.length - 1] - data[0]) / Math.abs(data[0])) * 100 : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={clsx("overflow-visible", className ?? "h-7 w-20")}
      role="img"
      aria-label={`1 hour price trend, ${changePct >= 0 ? "up" : "down"} ${Math.abs(changePct).toFixed(1)} percent`}
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * The spread bar: one row per tokenized stock, showing how far the on-chain
 * price sits from the equity it tracks. Centre line is parity.
 */
export function SpreadBar({ premiumPct, maxAbs }: { premiumPct: number; maxAbs: number }) {
  const bound = Math.max(maxAbs, 0.5);
  const fraction = Math.min(1, Math.abs(premiumPct) / bound);
  const isPremium = premiumPct >= 0;

  return (
    <div className="relative h-2 w-full rounded-full bg-line" title={`${premiumPct >= 0 ? "+" : ""}${premiumPct.toFixed(2)}% vs parity`}>
      <span className="absolute inset-y-[-3px] left-1/2 w-px -translate-x-1/2 bg-line-2" aria-hidden />
      <div
        className="absolute top-0 h-full rounded-full transition-all duration-500"
        style={{
          width: `${(fraction * 100) / 2}%`,
          left: isPremium ? "50%" : undefined,
          right: isPremium ? undefined : "50%",
          background: isPremium ? "var(--c-bloom)" : "var(--c-flare)",
        }}
      />
    </div>
  );
}

/** Distribution histogram — used for score and risk spread in Analytics. */
export function Histogram({
  buckets,
  color = "var(--c-coat)",
  labelFor,
}: {
  buckets: { label: string; count: number }[];
  color?: string;
  labelFor?: (bucket: { label: string; count: number }) => string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="flex h-40 items-end gap-1.5">
      {buckets.map((bucket) => (
        <div key={bucket.label} className="group flex h-full flex-1 flex-col justify-end gap-1.5">
          <span className="num text-center text-[10px] text-txt-2 opacity-0 transition-opacity group-hover:opacity-100">
            {bucket.count}
          </span>
          <div
            className="w-full rounded-t transition-all duration-500 group-hover:brightness-125"
            style={{
              height: `${(bucket.count / max) * 100}%`,
              minHeight: bucket.count > 0 ? 3 : 0,
              background: color,
              opacity: 0.85,
            }}
            title={labelFor ? labelFor(bucket) : `${bucket.label}: ${bucket.count}`}
          />
          <span className="num text-center text-[9px] leading-none text-txt-2">{bucket.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Horizontal proportion bar — buy vs sell pressure. */
export function SplitBar({ left, right, leftLabel, rightLabel }: { left: number; right: number; leftLabel: string; rightLabel: string }) {
  const total = left + right;
  const leftPct = total > 0 ? (left / total) * 100 : 50;

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
        <span className="num text-bloom">
          {leftLabel} {left}
        </span>
        <span className="num text-flare">
          {right} {rightLabel}
        </span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-line">
        <div className="bg-bloom transition-[width] duration-500" style={{ width: `${leftPct}%` }} />
        <div className="flex-1 bg-flare" />
      </div>
    </div>
  );
}
