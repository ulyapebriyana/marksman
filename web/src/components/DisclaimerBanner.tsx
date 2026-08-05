import { ShieldAlert } from "lucide-react";

export function DisclaimerBanner() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-faint)]">
      <ShieldAlert size={14} className="mt-0.5 shrink-0 text-[var(--color-watch)]" />
      <p>
        Marksman is an informational screener only — it does not place trades, hold funds, or touch private keys.
        Scores and signals are not financial advice. Tokenized-stock premium/discount figures depend on third-party
        price feeds and can be stale or wrong.
      </p>
    </div>
  );
}
