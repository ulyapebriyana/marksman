import clsx from "clsx";
import { Check, Minus } from "lucide-react";
import type { PoolsResponse, StatusResponse } from "../../api/types";
import { formatDuration, formatRelativeTime } from "../../lib/format";
import { Eyebrow, Kbd, Panel, Stat } from "../ui/primitives";
import { TableSkeleton } from "../ui/states";

function HealthRow({
  name,
  ok,
  detail,
  note,
}: {
  name: string;
  ok: boolean;
  detail: string;
  note: string;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span
        className={clsx("mt-1 h-2 w-2 shrink-0 rounded-full", ok ? "bg-bloom" : "bg-flare")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-[13px] font-medium text-txt-0">{name}</p>
          <p className={clsx("text-[12px] font-medium", ok ? "text-bloom" : "text-flare")}>
            {ok ? "Responding" : "Not responding"}
          </p>
        </div>
        <p className="num mt-0.5 text-[11px] text-txt-2">{detail}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-txt-2">{note}</p>
      </div>
    </li>
  );
}

function ConfigRow({ label, on, onText, offText }: { label: string; on: boolean; onText: string; offText: string }) {
  return (
    <li className="flex items-start gap-3 bg-ink-2 px-4 py-3">
      <span
        className={clsx(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
          on ? "bg-bloom/15 text-bloom" : "bg-line text-txt-2"
        )}
        aria-hidden
      >
        {on ? <Check size={11} strokeWidth={3} /> : <Minus size={11} strokeWidth={3} />}
      </span>
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-txt-0">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-txt-2">{on ? onText : offText}</p>
      </div>
    </li>
  );
}

const SHORTCUTS: [string, string][] = [
  ["⌘K / Ctrl K", "Open the command palette"],
  ["/", "Open the command palette"],
  ["G then O", "Overview"],
  ["G then S", "Screener"],
  ["G then P", "Spreads"],
  ["G then N", "Signals"],
  ["G then A", "Analytics"],
  ["G then Y", "System"],
  ["R", "Rescan now"],
  ["T", "Toggle theme"],
  ["Esc", "Close the drawer or palette"],
];

const ENDPOINTS: [string, string][] = [
  ["GET /api/pools", "Scored pools plus scan metadata. `force=1` bypasses the cache."],
  ["GET /api/status", "Runtime health and what's configured — this page reads it."],
  ["GET /api/history", "Signal transitions, newest first, capped at 250."],
  ["POST /api/alert", "Sends one Telegram alert for a pool in the current scan."],
];

export function SystemView({
  status,
  meta,
  isLoading,
}: {
  status?: StatusResponse;
  meta?: PoolsResponse["meta"];
  isLoading: boolean;
}) {
  if (isLoading && !status) {
    return (
      <div className="panel">
        <TableSkeleton rows={5} />
      </div>
    );
  }

  const health = meta?.sourceHealth ?? status?.lastScan?.sourceHealth;
  const gecko = health?.geckoterminal;
  const equity = health?.equity;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Backend"
          value={status?.ok ? "Online" : "Unreachable"}
          tone={status?.ok ? "bloom" : "flare"}
          hint={status ? `Up ${formatDuration(status.uptimeSeconds)}` : "No response from /api/status"}
        />
        <Stat
          label="Scan cadence"
          value={`${status?.scanIntervalSeconds ?? 60}s`}
          hint={meta?.scannedAt ? `Last scan ${formatRelativeTime(meta.scannedAt)}` : "No scan recorded yet"}
        />
        <Stat
          label="Operational preset"
          value={<span className="capitalize">{status?.activePreset ?? "—"}</span>}
          tone="reticle"
          hint="Drives history and alerts, whatever you browse"
        />
        <Stat
          label="Tokenized addresses"
          value={status?.tokenMapSize ?? "—"}
          hint="Entries in the server's token map"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Data sources" action={<Eyebrow>From the last scan</Eyebrow>}>
          {!health ? (
            <p className="px-4 py-6 text-center text-[12px] text-txt-2">No scan has completed yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              <HealthRow
                name="DexScreener"
                ok={health.dexscreener.ok}
                detail={
                  health.dexscreener.pairsReturned != null
                    ? `${health.dexscreener.pairsReturned} pairs returned`
                    : "no pair count reported"
                }
                note="Keyword search plus a direct sweep of known tokenized addresses. The only source that carries honeypot and danger labels."
              />
              <HealthRow
                name="GeckoTerminal"
                ok={gecko?.ok ?? false}
                detail={`${gecko?.successCount ?? 0} calls ok · ${gecko?.failureCount ?? 0} failed${
                  gecko?.bulkPoolsReturned != null ? ` · ${gecko.bulkPoolsReturned} pools listed` : ""
                }`}
                note="Chain-wide pool listing and 1h candles. Rate limited to about 30 calls a minute, so failures here usually mean throttling."
              />
              <HealthRow
                name="Equity price feed"
                ok={equity?.ok ?? false}
                detail={`${equity?.successCount ?? 0} quotes ok · ${equity?.failureCount ?? 0} failed`}
                note="Supplies the real stock price. Without it, every gap reads as unavailable rather than zero."
              />
            </ul>
          )}
        </Panel>

        <Panel title="Optional integrations">
          <ul className="space-y-px bg-line">
            <ConfigRow
              label="Equity API key"
              on={status?.stockApiConfigured ?? false}
              onText="Configured — premium and discount figures are live."
              offText="Not set. Add STOCK_API_KEY to the server .env; until then premium stays unavailable and tokenized pools carry a missing-underlying-price flag."
            />
            <ConfigRow
              label="Telegram alerts"
              on={status?.telegramConfigured ?? false}
              onText="Configured — manual alerts from the pool drawer will send."
              offText="Not set. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to send alerts; the button reports why it didn't send."
            />
          </ul>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Keyboard shortcuts">
          <ul className="divide-y divide-line">
            {SHORTCUTS.map(([keys, description]) => (
              <li key={keys} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <span className="text-[12px] text-txt-1">{description}</span>
                <Kbd>{keys}</Kbd>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="HTTP API" action={<Eyebrow>All responses no-store</Eyebrow>}>
          <ul className="divide-y divide-line">
            {ENDPOINTS.map(([route, description]) => (
              <li key={route} className="px-4 py-3">
                <code className="font-mono text-[12px] text-reticle">{route}</code>
                <p className="mt-1 text-[11px] leading-relaxed text-txt-2">{description}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel title="How pool discovery works">
        <div className="space-y-3 px-4 py-4 text-[12px] leading-relaxed text-txt-2">
          <p>
            DexScreener has no “list every pool on this chain” endpoint — only keyword search and per-token lookups. A pool
            whose name matches none of the seed queries would never appear.
          </p>
          <p>
            So every scan unions two sources: GeckoTerminal's chain-wide listing (top pools by liquidity plus the newest
            pools) as the primary, and the DexScreener keyword sweep as the secondary. Pools found in both keep the
            DexScreener record, because it carries the security labels GeckoTerminal doesn't provide.
          </p>
          <p className="text-txt-1">
            The consequence worth knowing: a pool found only through the bulk listing has no honeypot or danger label yet,
            so its security score reflects liquidity and trade count alone.
          </p>
        </div>
      </Panel>
    </div>
  );
}
