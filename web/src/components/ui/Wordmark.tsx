import clsx from "clsx";

/**
 * The mark is a reticle with one arm shortened — the asymmetry reads as an
 * instrument sighted slightly off parity, which is the thing Marksman looks for.
 */
export function ReticleMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.5" opacity="0.45" />
      <path d="M12 1.5v5.25M12 17.25v5.25M1.5 12h5.25M17.25 12h3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.75" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className, showTagline = false }: { className?: string; showTagline?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-2.5", className)}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-reticle/30 bg-reticle/10 text-reticle">
        <ReticleMark size={18} />
      </span>
      <span className="min-w-0">
        <span className="font-display block text-[15px] font-extrabold leading-none tracking-[-0.03em] text-txt-0">
          MARKSMAN
        </span>
        {showTagline && <span className="engraved mt-1 block text-txt-2">Robinhood Chain</span>}
      </span>
    </span>
  );
}
