import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Inbox size={28} className="text-[var(--color-text-faint)]" />
      <p className="text-sm font-medium text-[var(--color-text-dim)]">{title}</p>
      {description && <p className="max-w-sm text-xs text-[var(--color-text-faint)]">{description}</p>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <AlertTriangle size={28} className="text-[var(--color-hot)]" />
      <p className="max-w-md text-sm font-medium text-[var(--color-text)]">{message}</p>
      <p className="text-xs text-[var(--color-text-faint)]">Screener temporarily degraded — no action needed.</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border-strong)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-raised)]"
        >
          <RefreshCw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-11 animate-pulse rounded-md bg-[var(--color-surface-raised)]" />
      ))}
    </div>
  );
}
