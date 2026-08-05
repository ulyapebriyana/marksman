import type { SignalStatus } from "../api/types";
import clsx from "clsx";

const STYLES: Record<SignalStatus, { label: string; dot: string; text: string; pulse: boolean }> = {
  none: { label: "None", dot: "bg-[var(--color-text-faint)]", text: "text-[var(--color-text-faint)]", pulse: false },
  watch: { label: "Watch", dot: "bg-[var(--color-watch)]", text: "text-[var(--color-watch)]", pulse: false },
  hot: { label: "Hot", dot: "bg-[var(--color-hot)]", text: "text-[var(--color-hot)]", pulse: true },
};

export function SignalBadge({ status, compact = false }: { status: SignalStatus; compact?: boolean }) {
  const s = STYLES[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 font-medium", s.text, compact ? "text-xs" : "text-sm")}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", s.dot, s.pulse && "signal-pulse")} />
      {!compact && s.label}
    </span>
  );
}
