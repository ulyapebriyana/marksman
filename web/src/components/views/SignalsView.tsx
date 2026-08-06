import { useMemo, useState } from "react";
import clsx from "clsx";
import { Activity } from "lucide-react";
import type { HistoryEntry, SignalStatus } from "../../api/types";
import { formatClock, formatDayHeading, formatPct, formatRelativeTime } from "../../lib/format";
import { Chip, Panel, Stat } from "../ui/primitives";
import { RiskBadge, SignalBadge } from "../ui/badges";
import { EmptyState, TableSkeleton } from "../ui/states";

type Filter = SignalStatus | "all";

const FILTERS: { key: Filter; label: string; tone: "coat" | "flare" | "reticle" }[] = [
  { key: "all", label: "All", tone: "coat" },
  { key: "hot", label: "Hot", tone: "flare" },
  { key: "watch", label: "Watch", tone: "reticle" },
  { key: "none", label: "Cooled off", tone: "coat" },
];

export function SignalsView({ history, isLoading }: { history: HistoryEntry[]; isLoading: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(
    () => (filter === "all" ? history : history.filter((entry) => entry.to === filter)),
    [history, filter]
  );

  // Newest first, bucketed by calendar day.
  const days = useMemo(() => {
    const groups = new Map<string, HistoryEntry[]>();
    for (const entry of rows) {
      const key = new Date(entry.at).toDateString();
      const bucket = groups.get(key);
      if (bucket) bucket.push(entry);
      else groups.set(key, [entry]);
    }
    return [...groups.entries()];
  }, [rows]);

  const counts = useMemo(
    () => ({
      hot: history.filter((e) => e.to === "hot").length,
      watch: history.filter((e) => e.to === "watch").length,
      cooled: history.filter((e) => e.to === "none").length,
    }),
    [history]
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Transitions logged" value={history.length} hint="Capped at the most recent 250" />
        <Stat label="Went hot" value={counts.hot} tone={counts.hot > 0 ? "flare" : undefined} />
        <Stat label="Went to watch" value={counts.watch} tone={counts.watch > 0 ? "reticle" : undefined} />
        <Stat label="Cooled off" value={counts.cooled} hint="Dropped back to quiet" />
      </div>

      <Panel
        title="Signal history"
        action={
          <div className="flex gap-1.5">
            {FILTERS.map((option) => (
              <Chip
                key={option.key}
                tone={option.tone}
                active={filter === option.key}
                onClick={() => setFilter(option.key)}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        }
      >
        {isLoading ? (
          <TableSkeleton rows={6} />
        ) : days.length === 0 ? (
          <EmptyState
            title={filter === "all" ? "No transitions yet" : `Nothing has moved to ${filter} yet`}
            description="Marksman logs a row the moment a pool crosses into or out of a signal state under the operational preset."
            icon={<Activity size={18} aria-hidden />}
          />
        ) : (
          <div>
            {days.map(([day, entries]) => (
              <section key={day}>
                <h3 className="engraved sticky top-16 z-10 border-y border-line bg-ink-2/95 px-4 py-2 text-txt-2 backdrop-blur">
                  {formatDayHeading(entries[0].at)} · {entries.length}
                </h3>
                <ul className="divide-y divide-line">
                  {entries.map((entry, i) => (
                    <li
                      key={`${entry.address}-${entry.at}-${i}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-2"
                    >
                      {/* The rail makes the day read as a single run of events. */}
                      <span className="relative flex w-4 shrink-0 justify-center self-stretch" aria-hidden>
                        <span className="absolute inset-y-0 w-px bg-line" />
                        <span
                          className={clsx(
                            "relative mt-1.5 h-2 w-2 rounded-full ring-4 ring-ink-1",
                            entry.to === "hot" ? "bg-flare" : entry.to === "watch" ? "bg-reticle" : "bg-txt-2"
                          )}
                        />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[13px] font-semibold text-txt-0">{entry.symbol}</span>
                          <SignalBadge status={entry.to} />
                        </span>
                        <span className="mt-0.5 block text-[11px] text-txt-2">
                          {entry.from} → {entry.to} · {entry.preset} preset ·{" "}
                          <time dateTime={new Date(entry.at).toISOString()} title={new Date(entry.at).toLocaleString()}>
                            {formatClock(entry.at)}
                          </time>{" "}
                          ({formatRelativeTime(entry.at)})
                        </span>
                      </span>

                      <span className="flex shrink-0 items-center gap-3 text-right">
                        {entry.premiumPct != null && (
                          <span
                            className={clsx(
                              "num hidden text-[12px] sm:block",
                              entry.premiumPct >= 0 ? "text-bloom" : "text-flare"
                            )}
                            title="Gap to the tracked equity at the moment of transition"
                          >
                            {formatPct(entry.premiumPct, { signed: true })}
                          </span>
                        )}
                        {entry.score != null && (
                          <span className="num text-[12px] text-txt-1" title="Score at the moment of transition">
                            {entry.score.toFixed(0)}
                          </span>
                        )}
                        {entry.risk != null && <RiskBadge value={entry.risk} showLabel={false} />}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
