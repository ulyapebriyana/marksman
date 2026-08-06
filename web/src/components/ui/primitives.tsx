import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-reticle text-reticle-ink hover:brightness-110 active:brightness-95 font-semibold",
  secondary: "border border-line-2 bg-ink-2 text-txt-0 hover:bg-ink-3 hover:border-coat/50",
  ghost: "text-txt-1 hover:bg-ink-3 hover:text-txt-0",
  danger: "border border-flare/40 bg-flare/10 text-flare hover:bg-flare/20",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs rounded-lg",
  md: "h-9 gap-2 px-3.5 text-sm rounded-lg",
  lg: "h-11 gap-2 px-5 text-[15px] rounded-xl",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all duration-150",
        "disabled:pointer-events-none disabled:opacity-45",
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Square icon-only button. `label` is required — it becomes the accessible name. */
export function IconButton({
  label,
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const dim = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-lg transition-all duration-150",
        "disabled:pointer-events-none disabled:opacity-45",
        BUTTON_VARIANT[variant],
        dim,
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Segmented control                                                           */
/* -------------------------------------------------------------------------- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
  ariaLabel,
  fill = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  size?: "sm" | "md";
  className?: string;
  ariaLabel?: string;
  /** Stretch the options to fill the container — used in the mobile top bar. */
  fill?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={clsx("rounded-lg border border-line bg-ink-1 p-0.5", fill ? "flex" : "inline-flex shrink-0", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={clsx(
              "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all duration-150",
              fill && "flex-1",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-[13px]",
              active ? "bg-ink-3 text-txt-0 shadow-lift" : "text-txt-2 hover:text-txt-0"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chip / Toggle                                                               */
/* -------------------------------------------------------------------------- */

export function Chip({
  active,
  onClick,
  children,
  tone = "coat",
  className,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  tone?: "coat" | "reticle" | "bloom" | "flare";
  className?: string;
  title?: string;
}) {
  const toneClass = {
    coat: "border-coat/50 bg-coat/15 text-coat",
    reticle: "border-reticle/50 bg-reticle/15 text-reticle",
    bloom: "border-bloom/50 bg-bloom/15 text-bloom",
    flare: "border-flare/50 bg-flare/15 text-flare",
  }[tone];

  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      title={title}
      aria-pressed={onClick ? Boolean(active) : undefined}
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-150",
        active ? toneClass : "border-line bg-transparent text-txt-2",
        onClick && !active && "hover:border-line-2 hover:text-txt-1",
        className
      )}
    >
      {children}
    </Tag>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-left transition-colors hover:bg-ink-3"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-txt-0">{label}</span>
        {description && <span className="block text-[11px] leading-snug text-txt-2">{description}</span>}
      </span>
      <span
        className={clsx(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-reticle" : "bg-line-2"
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200",
            checked ? "translate-x-4.5" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Range slider                                                                */
/* -------------------------------------------------------------------------- */

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format: (value: number) => string;
}) {
  const fraction = max > min ? (value - min) / (max - min) : 0;
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-txt-1">{label}</span>
        <span className="num text-[12px] text-txt-0">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mk-range w-full"
        style={{ "--fill": `${fraction * 100}%` } as React.CSSProperties}
      />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-2 bg-ink-2 px-1.5 font-mono text-[10px] font-medium text-txt-1">
      {children}
    </kbd>
  );
}

/** Small-caps engraved section label — the instrument-faceplate device. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={clsx("engraved text-txt-2", className)}>{children}</p>;
}

export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx("panel overflow-hidden", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          {typeof title === "string" ? <h2 className="text-[13px] font-semibold text-txt-0">{title}</h2> : title}
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** Circular scan-cycle indicator. Reads as a lens aperture closing. */
export function ProgressRing({
  progress,
  size = 26,
  strokeWidth = 2.5,
  className,
  children,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <span className={clsx("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--c-line-2)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--c-reticle)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </span>
  );
}

/** A labelled figure. `hint` explains what the number means, in plain terms. */
export function Stat({
  label,
  value,
  hint,
  tone,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "reticle" | "bloom" | "flare" | "coat";
  icon?: ReactNode;
  className?: string;
}) {
  const toneClass = tone
    ? { reticle: "text-reticle", bloom: "text-bloom", flare: "text-flare", coat: "text-coat" }[tone]
    : "text-txt-0";

  return (
    <div className={clsx("panel px-4 py-3.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="engraved text-txt-2">{label}</p>
        {icon && <span className="text-txt-2">{icon}</span>}
      </div>
      <p className={clsx("num mt-2 text-2xl font-semibold leading-none tracking-tight", toneClass)}>{value}</p>
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-txt-2">{hint}</p>}
    </div>
  );
}
