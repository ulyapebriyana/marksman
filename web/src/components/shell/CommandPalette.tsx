import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { CornerDownLeft, Search } from "lucide-react";
import type { Pool } from "../../api/types";
import { NAV_ITEMS } from "../../lib/nav";
import { matchesSearch, poolLabel } from "../../lib/poolMath";
import { formatUsd } from "../../lib/format";
import { useFocusTrap, useScrollLock } from "../../hooks/useMisc";
import { Kbd } from "../ui/primitives";
import { SignalBadge } from "../ui/badges";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon?: ReactNode;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  pools,
  commands,
  onSelectPool,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  pools: Pool[];
  commands: Command[];
  onSelectPool: (pool: Pool) => void;
  onNavigate: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useFocusTrap(open);

  useScrollLock(open);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // Focus after the trap has run so the input wins over the first button.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo(() => {
    const term = query.trim().toLowerCase();

    const navItems: Command[] = NAV_ITEMS.map((item) => ({
      id: `nav-${item.key}`,
      label: item.label,
      hint: item.blurb,
      group: "Go to",
      icon: <item.icon size={15} aria-hidden />,
      run: () => onNavigate(item.path),
    }));

    const matchedCommands = [...navItems, ...commands].filter(
      (command) => !term || command.label.toLowerCase().includes(term) || command.group.toLowerCase().includes(term)
    );

    const matchedPools = (term ? pools.filter((pool) => matchesSearch(pool, term)) : pools.slice(0, 6)).slice(0, 8);

    return { commands: matchedCommands, pools: matchedPools, total: matchedCommands.length + matchedPools.length };
  }, [query, pools, commands, onNavigate]);

  // Flattened list so arrow keys cross the group boundary naturally.
  const flat = useMemo(
    () => [
      ...items.commands.map((command) => ({ kind: "command" as const, command })),
      ...items.pools.map((pool) => ({ kind: "pool" as const, pool })),
    ],
    [items]
  );

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  function activate(index: number) {
    const entry = flat[index];
    if (!entry) return;
    if (entry.kind === "command") entry.command.run();
    else onSelectPool(entry.pool);
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => (c + 1) % Math.max(1, flat.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => (c - 1 + Math.max(1, flat.length)) % Math.max(1, flat.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(cursor);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  let runningIndex = -1;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button
        className="absolute inset-0 cursor-default bg-[var(--c-scrim)] backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close command palette"
        tabIndex={-1}
      />

      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        className="fade-in relative flex max-h-[68vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line-2 bg-ink-1 shadow-pop"
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4">
          <Search size={16} className="shrink-0 text-txt-2" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder="Search pools, or jump to a view…"
            aria-label="Search pools or run a command"
            className="h-14 w-full bg-transparent text-[15px] text-txt-0 placeholder:text-txt-2 focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto p-2">
          {flat.length === 0 && (
            <p className="px-3 py-10 text-center text-[13px] text-txt-2">
              Nothing matches “{query}”. Try a symbol, a ticker, or a pool address.
            </p>
          )}

          {items.commands.length > 0 && (
            <>
              <p className="engraved px-3 pb-1.5 pt-2 text-txt-2">Commands</p>
              {items.commands.map((command) => {
                runningIndex += 1;
                const index = runningIndex;
                const active = index === cursor;
                return (
                  <button
                    key={command.id}
                    data-active={active}
                    onMouseMove={() => setCursor(index)}
                    onClick={() => activate(index)}
                    className={clsx(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors",
                      active ? "bg-ink-3" : "hover:bg-ink-2"
                    )}
                  >
                    <span className={clsx("shrink-0", active ? "text-reticle" : "text-txt-2")}>{command.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-txt-0">{command.label}</span>
                      {command.hint && <span className="block truncate text-[11px] text-txt-2">{command.hint}</span>}
                    </span>
                    <span className="engraved shrink-0 text-txt-2">{command.group}</span>
                    {active && <CornerDownLeft size={13} className="shrink-0 text-txt-2" aria-hidden />}
                  </button>
                );
              })}
            </>
          )}

          {items.pools.length > 0 && (
            <>
              <p className="engraved px-3 pb-1.5 pt-3 text-txt-2">Pools</p>
              {items.pools.map((pool) => {
                runningIndex += 1;
                const index = runningIndex;
                const active = index === cursor;
                return (
                  <button
                    key={pool.address}
                    data-active={active}
                    onMouseMove={() => setCursor(index)}
                    onClick={() => activate(index)}
                    className={clsx(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                      active ? "bg-ink-3" : "hover:bg-ink-2"
                    )}
                  >
                    <SignalBadge status={pool.signalStatus} compact />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-txt-0">{poolLabel(pool)}</span>
                      <span className="block truncate text-[11px] text-txt-2">
                        {pool.isTokenizedStock ? `Tokenized ${pool.stockTicker} · ` : ""}
                        {formatUsd(pool.liquidityUsd)} liquidity
                      </span>
                    </span>
                    <span className="num shrink-0 text-[12px] text-txt-1">{pool.score.total.toFixed(0)}</span>
                    {active && <CornerDownLeft size={13} className="shrink-0 text-txt-2" aria-hidden />}
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-4 border-t border-line px-4 py-2.5 text-[11px] text-txt-2">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↵</Kbd> open
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Kbd>?</Kbd> all shortcuts
          </span>
        </div>
      </div>
    </div>
  );
}
