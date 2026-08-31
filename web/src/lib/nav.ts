import { Activity, BarChart3, CalendarDays, Droplets, Filter, LayoutDashboard, Scale, Server, Table2 } from "lucide-react";

export type ViewKey =
  | "overview"
  | "screener"
  | "funnel"
  | "spreads"
  | "liquidity"
  | "pnl"
  | "signals"
  | "analytics"
  | "system";

export interface NavItem {
  key: ViewKey;
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  /** Second key of the `g` leader sequence. */
  hotkey: string;
  blurb: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    key: "overview",
    label: "Overview",
    path: "/app",
    icon: LayoutDashboard,
    hotkey: "o",
    blurb: "Scan summary, movers, and the widest gaps",
  },
  {
    key: "screener",
    label: "Screener",
    path: "/app/screener",
    icon: Table2,
    hotkey: "s",
    blurb: "Every pool, filtered and sorted",
  },
  {
    key: "funnel",
    label: "Funnel",
    path: "/app/funnel",
    icon: Filter,
    hotkey: "f",
    blurb: "Security first, then volume, fee/TVL, and pair quality",
  },
  {
    key: "spreads",
    label: "Spreads",
    path: "/app/spreads",
    icon: Scale,
    hotkey: "p",
    blurb: "Tokenized stocks against the equities they track",
  },
  {
    key: "liquidity",
    label: "Liquidity",
    path: "/app/liquidity",
    icon: Droplets,
    hotkey: "l",
    blurb: "Fee income against LVR — is providing worth it?",
  },
  {
    key: "pnl",
    label: "P&L",
    path: "/app/pnl",
    icon: CalendarDays,
    hotkey: "d",
    blurb: "Untung rugi harian dari posisi LP yang sudah ditutup",
  },
  {
    key: "signals",
    label: "Signals",
    path: "/app/signals",
    icon: Activity,
    hotkey: "n",
    blurb: "Every watch and hot transition, newest first",
  },
  {
    key: "analytics",
    label: "Analytics",
    path: "/app/analytics",
    icon: BarChart3,
    hotkey: "a",
    blurb: "Score, risk, and liquidity distributions",
  },
  {
    key: "system",
    label: "System",
    path: "/app/system",
    icon: Server,
    hotkey: "y",
    blurb: "Source health, cadence, and what's configured",
  },
];

export function viewFromPath(path: string): ViewKey {
  const match = NAV_ITEMS.find((item) => item.path === path);
  if (match) return match.key;
  // Unknown /app/* paths fall back to the overview rather than a dead screen.
  return "overview";
}

/**
 * `/app/token/0x…` is a detail route, not a nav destination — it has no rail
 * entry and no hotkey, so it lives outside NAV_ITEMS and is matched here.
 * Returns null for anything that isn't a well-formed EVM address, which keeps
 * a malformed deep link on the overview instead of firing a doomed request.
 */
export function tokenAddressFromPath(path: string): string | null {
  const match = path.match(/^\/app\/token\/(0x[a-fA-F0-9]{40})\/?$/);
  return match ? match[1].toLowerCase() : null;
}

export function tokenReportPath(address: string): string {
  return `/app/token/${address.toLowerCase()}`;
}
