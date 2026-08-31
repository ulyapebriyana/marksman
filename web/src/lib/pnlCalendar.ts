import type { PnlDay } from "../api/types";

/**
 * Laying days out as a month grid.
 *
 * Every date here is handled as a "YYYY-MM-DD" string, never as a Date. The
 * server has already bucketed each position into a calendar day at a stated
 * time zone offset; parsing those strings back into local Date objects would
 * re-apply the browser's own offset and quietly slide days across midnight.
 */

export interface CalendarCell {
  date: string;
  dayOfMonth: number;
  /** Null for a day with no closed position — absent is not the same as flat. */
  day: PnlDay | null;
  inMonth: boolean;
  isToday: boolean;
}

export interface CalendarWeek {
  label: string;
  cells: CalendarCell[];
  pnl: number;
  tradingDays: number;
}

export const WEEKDAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/** "2026-08" -> "Agustus 2026" */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] ?? month} ${year}`;
}

export function addMonths(month: string, delta: number): string {
  const [year, m] = month.split("-").map(Number);
  const index = year * 12 + (m - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Today in the same fixed offset the report was bucketed at. */
export function todayAt(offsetMinutes: number): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * Builds the weeks of `month`, padded to whole Sunday-started rows. Leading
 * and trailing cells belong to the neighbouring months and carry no P&L, so a
 * figure never appears under the wrong month.
 */
export function buildMonthGrid(days: PnlDay[], month: string, offsetMinutes = 0): CalendarWeek[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const [year, monthIndex] = month.split("-").map(Number);
  const today = todayAt(offsetMinutes);

  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const leading = first.getUTCDay();

  const cells: CalendarCell[] = [];
  const push = (date: Date, inMonth: boolean) => {
    const key = date.toISOString().slice(0, 10);
    cells.push({
      date: key,
      dayOfMonth: date.getUTCDate(),
      day: inMonth ? byDate.get(key) ?? null : null,
      inMonth,
      isToday: key === today,
    });
  };

  for (let i = leading; i > 0; i--) push(new Date(Date.UTC(year, monthIndex - 1, 1 - i)), false);
  for (let d = 1; d <= daysInMonth; d++) push(new Date(Date.UTC(year, monthIndex - 1, d)), true);
  while (cells.length % 7 !== 0) {
    push(new Date(Date.UTC(year, monthIndex - 1, daysInMonth + (cells.length % 7) - leading + 1)), false);
  }

  const weeks: CalendarWeek[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    const traded = week.filter((cell) => cell.day);
    weeks.push({
      label: `Minggu ${weeks.length + 1}`,
      cells: week,
      pnl: traded.reduce((sum, cell) => sum + (cell.day?.pnl ?? 0), 0),
      tradingDays: traded.length,
    });
  }
  return weeks;
}

/** Month totals, computed from the day rows so they can never disagree. */
export function monthTotals(days: PnlDay[], month: string) {
  const rows = days.filter((day) => day.date.startsWith(month));
  const green = rows.filter((day) => day.pnl > 0).length;
  const red = rows.filter((day) => day.pnl < 0).length;
  return {
    pnl: rows.reduce((sum, day) => sum + day.pnl, 0),
    positions: rows.reduce((sum, day) => sum + day.positions, 0),
    fees: rows.reduce((sum, day) => sum + day.fees, 0),
    tradingDays: rows.length,
    greenDays: green,
    redDays: red,
    best: rows.reduce<PnlDay | null>((a, d) => (a == null || d.pnl > a.pnl ? d : a), null),
    worst: rows.reduce<PnlDay | null>((a, d) => (a == null || d.pnl < a.pnl ? d : a), null),
  };
}

/** Running total through the month, for the cumulative line. */
export function cumulativeSeries(days: PnlDay[], month: string) {
  let running = 0;
  return days
    .filter((day) => day.date.startsWith(month))
    .map((day) => ({ date: day.date, pnl: day.pnl, cumulative: (running += day.pnl) }));
}
