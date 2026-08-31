import { useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Wallet } from "lucide-react";
import type { WalletPnl } from "../../api/types";
import { Button, Chip, Eyebrow, IconButton, Panel, Stat } from "../ui/primitives";
import { EmptyState, ErrorState, TableSkeleton } from "../ui/states";
import {
  WEEKDAYS,
  addMonths,
  buildMonthGrid,
  cumulativeSeries,
  monthLabel,
  monthTotals,
  todayAt,
  type CalendarCell,
} from "../../lib/pnlCalendar";

const usd = (value: number, digits = 2) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(value).toFixed(digits)}`;

/** Colour weight for a day, relative to the biggest move in the month. */
function toneFor(pnl: number, maxAbs: number) {
  if (maxAbs <= 0) return { className: "bg-ink-2", alpha: 0 };
  const alpha = Math.min(1, Math.max(0.12, Math.abs(pnl) / maxAbs));
  return { className: pnl >= 0 ? "bg-bloom" : "bg-flare", alpha };
}

function DayCell({
  cell,
  maxAbs,
  selected,
  onSelect,
}: {
  cell: CalendarCell;
  maxAbs: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { day } = cell;

  // A day outside the month, or one with no closed position, is rendered as
  // empty — not as a zero. A flat day and a day you did not trade are
  // different facts and must not look the same.
  if (!cell.inMonth) return <div className="min-h-[74px] rounded-lg border border-transparent" />;

  if (!day) {
    return (
      <div
        className={clsx(
          "min-h-[74px] rounded-lg border border-line/60 px-2 py-1.5",
          cell.isToday && "ring-1 ring-reticle/60"
        )}
      >
        <span className="num text-[11px] text-txt-2">{cell.dayOfMonth}</span>
      </div>
    );
  }

  const tone = toneFor(day.pnl, maxAbs);

  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      title={`${day.date} · ${day.positions} posisi · win ${day.winRatePct ?? 0}%`}
      className={clsx(
        "relative min-h-[74px] overflow-hidden rounded-lg border px-2 py-1.5 text-left transition-all duration-150",
        "hover:border-coat/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-reticle",
        selected ? "border-reticle" : "border-line",
        cell.isToday && !selected && "ring-1 ring-reticle/60"
      )}
    >
      <span className={clsx("absolute inset-0", tone.className)} style={{ opacity: tone.alpha * 0.22 }} aria-hidden />
      <span className="relative flex h-full flex-col">
        <span className="num text-[11px] text-txt-2">{cell.dayOfMonth}</span>
        <span
          className={clsx(
            "num mt-0.5 text-[12px] font-semibold leading-tight",
            day.pnl > 0 ? "text-bloom" : day.pnl < 0 ? "text-flare" : "text-txt-1"
          )}
        >
          {usd(day.pnl)}
        </span>
        <span className="mt-auto block text-[10px] leading-tight text-txt-2">
          {day.positions} pos · {day.winRatePct == null ? "—" : `${day.winRatePct.toFixed(0)}%`}
        </span>
      </span>
    </button>
  );
}

/** Daily bars plus the running total, drawn inline — no charting library. */
function MonthChart({ rows }: { rows: { date: string; pnl: number; cumulative: number }[] }) {
  if (rows.length === 0) return null;

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1e-9);
  const cumMax = Math.max(...rows.map((r) => Math.abs(r.cumulative)), 1e-9);
  const width = 100;
  const height = 40;
  const step = width / rows.length;

  const line = rows
    .map((row, i) => `${(i + 0.5) * step},${height / 2 - (row.cumulative / cumMax) * (height / 2 - 2)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-24 w-full" role="img"
      aria-label="P&L harian dan kumulatif bulan ini">
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth="0.2" className="text-line-2" />
      {rows.map((row, i) => {
        const h = (Math.abs(row.pnl) / maxAbs) * (height / 2 - 2);
        return (
          <rect
            key={row.date}
            x={i * step + step * 0.2}
            y={row.pnl >= 0 ? height / 2 - h : height / 2}
            width={step * 0.6}
            height={Math.max(h, 0.4)}
            className={row.pnl >= 0 ? "fill-bloom" : "fill-flare"}
            opacity="0.55"
          />
        );
      })}
      <polyline points={line} fill="none" strokeWidth="0.7" className="stroke-reticle" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * The banner that keeps this screen honest. Every figure on the page is
 * reconstructed from logs and hourly prices, so when part of the wallet could
 * not be accounted for, that has to be said out loud — otherwise a P&L missing
 * three positions is indistinguishable from a P&L that is simply smaller.
 */
function IncompleteBanner({ data }: { data: WalletPnl }) {
  const r = data.reconciliation;
  if (r.complete) return null;

  const reasons = [
    r.positionsUnpriced > 0 && `${r.positionsUnpriced} posisi tanpa riwayat harga`,
    r.positionsPartial > 0 && `${r.positionsPartial} posisi yang pembukaannya tidak terlihat`,
    r.positionsExcluded > 0 && `${r.positionsExcluded} posisi tanpa nilai yang bisa dihitung`,
    r.failedTxs.length > 0 && `${r.failedTxs.length} transaksi gagal dibaca`,
    r.truncated && "riwayat wallet terlalu panjang untuk ditelusuri penuh",
  ].filter(Boolean);

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-reticle/30 bg-reticle/8 px-3.5 py-2.5 text-[12px] leading-relaxed text-reticle">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">Angka ini belum lengkap.</span> {reasons.join(", ")}. Posisi tersebut
        dikeluarkan dari perhitungan, bukan dihitung nol — jadi P&amp;L sebenarnya bisa lebih tinggi atau lebih
        rendah dari yang tampil.
      </p>
    </div>
  );
}

export function PnlView({
  address,
  onAddressChange,
  data,
  isLoading,
  error,
  onRefresh,
  isRefreshing,
  onRetry,
}: {
  address: string | null;
  onAddressChange: (value: string) => void;
  data: WalletPnl | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState(address ?? "");
  const [month, setMonth] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const offset = data?.timeZoneOffsetMinutes ?? 0;
  const activeMonth = month ?? data?.summary.lastDay?.slice(0, 7) ?? todayAt(offset).slice(0, 7);

  const weeks = useMemo(
    () => buildMonthGrid(data?.days ?? [], activeMonth, offset),
    [data?.days, activeMonth, offset]
  );
  const totals = useMemo(() => monthTotals(data?.days ?? [], activeMonth), [data?.days, activeMonth]);
  const series = useMemo(() => cumulativeSeries(data?.days ?? [], activeMonth), [data?.days, activeMonth]);
  const maxAbs = useMemo(
    () => Math.max(0, ...(data?.days ?? []).filter((d) => d.date.startsWith(activeMonth)).map((d) => Math.abs(d.pnl))),
    [data?.days, activeMonth]
  );
  const selected = data?.days.find((day) => day.date === selectedDate) ?? null;

  const tzLabel = `UTC${offset >= 0 ? "+" : "−"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(
    Math.abs(offset) % 60
  ).padStart(2, "0")}`;

  const submit = () => onAddressChange(draft.trim());

  return (
    <div className="space-y-4">
      <Panel
        title="Wallet"
        action={
          data && (
            <Button size="sm" onClick={onRefresh} disabled={isRefreshing}>
              <RefreshCw size={13} className={isRefreshing ? "animate-spin" : undefined} aria-hidden /> Segarkan
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-2 p-3 sm:flex-row">
          <label className="sr-only" htmlFor="pnl-wallet">
            Alamat wallet
          </label>
          <input
            id="pnl-wallet"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="0x…"
            spellCheck={false}
            className="num h-9 min-w-0 flex-1 rounded-lg border border-line bg-ink-2 px-3 text-[13px] text-txt-0 placeholder:text-txt-2 focus:border-reticle focus:outline-none"
          />
          <Button variant="primary" size="md" onClick={submit} disabled={!draft.trim() || draft.trim() === address}>
            <Wallet size={14} aria-hidden /> Lacak
          </Button>
        </div>
        {data && (
          <p className="border-t border-line px-3 py-2 text-[11px] leading-relaxed text-txt-2">
            {data.meta.lpTransactions} transaksi LP di {data.poolCount} pool · {data.reconciliation.openPositions} posisi
            masih terbuka (tidak masuk kalender) · hari dihitung pada {tzLabel} · sumber: {data.meta.sources.join(" + ")}
          </p>
        )}
      </Panel>

      {!address && !isLoading && (
        <Panel>
          <EmptyState
            title="Masukkan alamat wallet untuk mulai"
            description="P&L disusun ulang dari log Uniswap v4 di Robinhood Chain: setiap perubahan likuiditas dinilai dengan harga pada jam kejadiannya, lalu posisi yang sudah ditutup dikelompokkan per hari."
            icon={<CalendarDays size={18} aria-hidden />}
          />
        </Panel>
      )}

      {error && <ErrorState message={error.message} onRetry={onRetry} />}

      {isLoading && (
        <Panel>
          <TableSkeleton rows={7} />
        </Panel>
      )}

      {data && !isLoading && (
        <>
          <IncompleteBanner data={data} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="P&L bersih (semua waktu)"
              value={usd(data.summary.netPnl)}
              tone={data.summary.netPnl > 0 ? "bloom" : data.summary.netPnl < 0 ? "flare" : undefined}
              hint={`${data.summary.closedPositions} posisi ditutup · ${data.summary.tradingDays} hari aktif`}
            />
            <Stat
              label="Win rate posisi"
              value={data.summary.winRatePct == null ? "—" : `${data.summary.winRatePct.toFixed(1)}%`}
              hint={`${data.summary.wins} menang / ${data.summary.losses} kalah`}
            />
            <Stat
              label="Profit factor"
              value={data.summary.profitFactor == null ? "—" : data.summary.profitFactor.toFixed(2)}
              tone={data.summary.profitFactor != null && data.summary.profitFactor >= 1 ? "bloom" : "flare"}
              hint={`untung ${usd(data.summary.grossProfit)} vs rugi ${usd(-data.summary.grossLoss)}`}
            />
            <Stat
              label="Win rate harian"
              value={data.summary.dayWinRatePct == null ? "—" : `${data.summary.dayWinRatePct.toFixed(1)}%`}
              hint={`${data.summary.greenDays} hari hijau / ${data.summary.redDays} merah · beruntun ${
                data.summary.currentStreak.days
              } hari ${data.summary.currentStreak.direction === "green" ? "hijau" : data.summary.currentStreak.direction === "red" ? "merah" : "datar"}`}
            />
          </div>

          <Panel
            title={
              <div className="flex items-center gap-2">
                <IconButton label="Bulan sebelumnya" size="sm" onClick={() => setMonth(addMonths(activeMonth, -1))}>
                  <ChevronLeft size={15} aria-hidden />
                </IconButton>
                <h2 className="min-w-[9.5rem] text-center text-[13px] font-semibold text-txt-0">
                  {monthLabel(activeMonth)}
                </h2>
                <IconButton label="Bulan berikutnya" size="sm" onClick={() => setMonth(addMonths(activeMonth, 1))}>
                  <ChevronRight size={15} aria-hidden />
                </IconButton>
              </div>
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={clsx(
                    "num text-[13px] font-semibold",
                    totals.pnl > 0 ? "text-bloom" : totals.pnl < 0 ? "text-flare" : "text-txt-1"
                  )}
                >
                  {usd(totals.pnl)}
                </span>
                <span className="text-[11px] text-txt-2">
                  {totals.tradingDays} hari · {totals.positions} posisi
                </span>
              </div>
            }
          >
            <div className="overflow-x-auto">
              <div className="min-w-[640px] p-3">
                <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_5.5rem] gap-1.5">
                  {WEEKDAYS.map((label) => (
                    <div key={label} className="engraved pb-1 text-center text-txt-2">
                      {label}
                    </div>
                  ))}
                  <div className="engraved pb-1 text-center text-txt-2">Minggu</div>

                  {weeks.map((week) => (
                    <CalendarRow
                      key={week.label}
                      week={week}
                      maxAbs={maxAbs}
                      selectedDate={selectedDate}
                      onSelect={setSelectedDate}
                    />
                  ))}
                </div>
              </div>
            </div>

            {series.length > 0 && (
              <div className="border-t border-line px-3 pb-3 pt-2">
                <Eyebrow>Harian (batang) dan kumulatif (garis)</Eyebrow>
                <MonthChart rows={series} />
              </div>
            )}
          </Panel>

          {selected && (
            <Panel
              title={`${selected.date} · ${usd(selected.pnl)}`}
              action={
                <Chip tone="coat" onClick={() => setSelectedDate(null)}>
                  Tutup
                </Chip>
              }
            >
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-line px-4 py-3 text-[12px] sm:grid-cols-4">
                <p className="text-txt-2">
                  Posisi ditutup <span className="num block text-txt-0">{selected.positions}</span>
                </p>
                <p className="text-txt-2">
                  Menang / kalah{" "}
                  <span className="num block text-txt-0">
                    {selected.wins} / {selected.losses}
                  </span>
                </p>
                <p className="text-txt-2">
                  Win rate{" "}
                  <span className="num block text-txt-0">
                    {selected.winRatePct == null ? "—" : `${selected.winRatePct.toFixed(1)}%`}
                  </span>
                </p>
                <p className="text-txt-2">
                  Fee diklaim <span className="num block text-txt-0">{usd(selected.fees)}</span>
                </p>
              </div>
              <ul className="divide-y divide-line">
                {selected.pools.map((pool) => (
                  <li key={pool.pair} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0 truncate text-[13px] text-txt-0">{pool.pair}</span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="text-[11px] text-txt-2">{pool.positions} pos</span>
                      <span className={clsx("num text-[12px]", pool.pnl >= 0 ? "text-bloom" : "text-flare")}>
                        {usd(pool.pnl)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {totals.tradingDays === 0 && (
            <Panel>
              <EmptyState
                title={`Tidak ada posisi yang ditutup pada ${monthLabel(activeMonth)}`}
                description={
                  data.summary.firstDay
                    ? `Riwayat wallet ini terbentang ${data.summary.firstDay} sampai ${data.summary.lastDay}.`
                    : undefined
                }
                icon={<CalendarDays size={18} aria-hidden />}
              />
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

/** One calendar row: seven days plus that week's total. */
function CalendarRow({
  week,
  maxAbs,
  selectedDate,
  onSelect,
}: {
  week: { label: string; cells: CalendarCell[]; pnl: number; tradingDays: number };
  maxAbs: number;
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
}) {
  return (
    <>
      {week.cells.map((cell) => (
        <DayCell
          key={cell.date}
          cell={cell}
          maxAbs={maxAbs}
          selected={selectedDate === cell.date}
          onSelect={() => onSelect(selectedDate === cell.date ? null : cell.date)}
        />
      ))}
      <div className="flex min-h-[74px] flex-col justify-center rounded-lg border border-line bg-ink-2 px-2 py-1.5 text-center">
        <span className="engraved text-txt-2">{week.label}</span>
        <span
          className={clsx(
            "num mt-1 text-[12px] font-semibold",
            week.pnl > 0 ? "text-bloom" : week.pnl < 0 ? "text-flare" : "text-txt-1"
          )}
        >
          {week.tradingDays === 0 ? "—" : usd(week.pnl)}
        </span>
        <span className="mt-0.5 text-[10px] text-txt-2">{week.tradingDays} hari</span>
      </div>
    </>
  );
}
