import clsx from "clsx";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Info,
  MessageSquareOff,
  RefreshCw,
  ShieldAlert,
  Users,
  XCircle,
} from "lucide-react";
import type {
  ReportCheckStatus,
  ReportSeverity,
  SocialSynthesis,
  TokenReport,
} from "../../api/types";
import { Button, Eyebrow, Panel, Stat } from "../ui/primitives";
import { ErrorState, TableSkeleton } from "../ui/states";
import { Link } from "../../lib/router";

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/*                                                                             */
/* This view formats in Indonesian (comma decimals, "rb"/"jt" scale) rather    */
/* than reusing lib/format.ts, which is en-US throughout for the screener.     */
/* Mixing "$1.5M" into a paragraph that reads "15,28%" looks like a bug.       */
/* -------------------------------------------------------------------------- */

const ID = "id-ID";

function usd(value: number | null | undefined, compact = true): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (compact) {
    if (abs >= 1e9) return `$${(value / 1e9).toLocaleString(ID, { maximumFractionDigits: 2 })} M`;
    if (abs >= 1e6) return `$${(value / 1e6).toLocaleString(ID, { maximumFractionDigits: 2 })} jt`;
    if (abs >= 1e3) return `$${(value / 1e3).toLocaleString(ID, { maximumFractionDigits: 1 })} rb`;
  }
  if (abs > 0 && abs < 0.01) return `$${value.toPrecision(3)}`;
  return `$${value.toLocaleString(ID, { maximumFractionDigits: 2 })}`;
}

function pct(value: number | null | undefined, digits = 1, signed = false): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const s = value.toLocaleString(ID, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${signed && value > 0 ? "+" : ""}${s}%`;
}

function count(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toLocaleString(ID);
}

function age(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}mnt`;
  if (hours < 48) return `${Math.round(hours)}j`;
  const days = hours / 24;
  if (days < 60) return `${Math.round(days)}h`;
  return `${(days / 30).toLocaleString(ID, { maximumFractionDigits: 1 })}bln`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/* Severity + status vocabulary                                                */
/* -------------------------------------------------------------------------- */

const SEVERITY: Record<ReportSeverity, { text: string; bg: string; border: string; label: string }> = {
  kritis: { text: "text-flare", bg: "bg-flare/10", border: "border-flare/40", label: "Kritis" },
  tinggi: { text: "text-flare", bg: "bg-flare/8", border: "border-flare/25", label: "Tinggi" },
  sedang: { text: "text-reticle", bg: "bg-reticle/10", border: "border-reticle/30", label: "Sedang" },
  rendah: { text: "text-bloom", bg: "bg-bloom/10", border: "border-bloom/30", label: "Rendah" },
  info: { text: "text-txt-2", bg: "bg-ink-2", border: "border-line", label: "Info" },
};

const CHECK_STATUS: Record<ReportCheckStatus, { icon: typeof CheckCircle2; text: string; label: string }> = {
  pass: { icon: CheckCircle2, text: "text-bloom", label: "Lolos" },
  fail: { icon: XCircle, text: "text-flare", label: "Gagal" },
  warn: { icon: AlertTriangle, text: "text-reticle", label: "Perhatian" },
  // Deliberately NOT styled like a pass. The whole point of this status is
  // that the check could not run — rendering it green would be a lie.
  unverifiable: { icon: HelpCircle, text: "text-txt-2", label: "Tak terverifikasi" },
};

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

function Header({ report }: { report: TokenReport }) {
  const { identity, market, launchpad } = report;
  const links = [
    ...identity.websites.map((w) => ({ label: w.label || "Situs", url: w.url })),
    ...(identity.twitterUrl ? [{ label: "X", url: identity.twitterUrl }] : []),
    ...(identity.telegramUrl ? [{ label: "Telegram", url: identity.telegramUrl }] : []),
    ...(identity.discordUrl ? [{ label: "Discord", url: identity.discordUrl }] : []),
  ];

  return (
    <div className="panel overflow-hidden">
      {identity.headerUrl && (
        <div className="h-20 w-full bg-ink-2 sm:h-28">
          <img src={identity.headerUrl} alt="" className="h-full w-full object-cover opacity-70" />
        </div>
      )}
      <div className="flex flex-wrap items-start gap-4 px-4 py-4">
        {identity.imageUrl ? (
          <img
            src={identity.imageUrl}
            alt=""
            className="h-14 w-14 shrink-0 rounded-xl border border-line-2 bg-ink-2 object-cover"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line-2 bg-ink-2 text-lg font-semibold text-txt-2">
            {identity.symbol?.slice(0, 2) ?? "??"}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-txt-0">{identity.name ?? "Token tanpa nama"}</h1>
            {identity.symbol && <span className="num text-sm text-txt-1">${identity.symbol}</span>}
            <span className="rounded-full border border-line bg-ink-2 px-2 py-0.5 text-[10px] uppercase tracking-wide text-txt-2">
              {report.chain}
            </span>
            {launchpad?.completed && (
              <span className="rounded-full border border-bloom/40 bg-bloom/10 px-2 py-0.5 text-[10px] font-medium text-bloom">
                Lulus launchpad
              </span>
            )}
          </div>

          <p className="num mt-1 text-[11px] text-txt-2" title={identity.address}>
            {shortAddress(identity.address)}
          </p>

          {(identity.categories.length > 0 || links.length > 0) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {identity.categories.map((c) => (
                <span key={c} className="rounded-full border border-line bg-ink-2 px-2 py-0.5 text-[11px] text-txt-1">
                  {c}
                </span>
              ))}
              {links.map((l) => (
                <a
                  key={l.url}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-txt-1 transition-colors hover:border-line-2 hover:text-txt-0"
                >
                  {l.label}
                  <ExternalLink size={10} aria-hidden />
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="text-right">
          <p className="num text-2xl font-semibold leading-none tracking-tight text-txt-0">
            {usd(market.priceUsd, false)}
          </p>
          <p
            className={clsx(
              "num mt-1.5 text-sm font-medium",
              (market.priceChange.h24 ?? 0) >= 0 ? "text-bloom" : "text-flare"
            )}
          >
            {pct(market.priceChange.h24, 2, true)} <span className="text-txt-2">24j</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function StatRow({ report }: { report: TokenReport }) {
  const { market } = report;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Stat
        label={market.valuationBasis === "fdv" ? "FDV" : market.valuationBasis === "market_cap" ? "Market cap" : "Valuasi"}
        value={usd(market.valuationUsd)}
        hint={
          market.valuationBasis === "fdv"
            ? "Suplai beredar tidak dipublikasikan"
            : market.valuationBasis === null
              ? "Tidak dipublikasikan sumber manapun"
              : undefined
        }
      />
      <Stat label="Volume 24j" value={usd(market.volume24hUsd)} />
      <Stat
        label="Likuiditas"
        value={usd(market.liquidityUsd)}
        hint={`${pct(market.liquidityToValuationPct, 2)} dari valuasi`}
      />
      <Stat
        label="Perputaran"
        value={market.turnoverRatio != null ? `${market.turnoverRatio.toLocaleString(ID, { maximumFractionDigits: 1 })}x` : "—"}
        hint="Volume 24j ÷ likuiditas"
      />
      <Stat label="Umur" value={age(market.ageHours)} hint={`${count(market.poolCount)} pool`} />
    </div>
  );
}

/**
 * A degraded source has to be visible, because several sections go quiet when
 * GeckoTerminal is unavailable and a silent gap reads as "this token has no
 * holders data" rather than "we could not fetch it just now".
 */
function SourceBanner({ report }: { report: TokenReport }) {
  const gecko = report.sourceHealth?.geckoterminal;
  if (!gecko || gecko.ok) return null;

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-reticle/30 bg-reticle/8 px-4 py-3">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-reticle" aria-hidden />
      <p className="text-[12px] leading-relaxed text-txt-1">
        {gecko.reason === "rate_limited"
          ? "GeckoTerminal sedang membatasi permintaan, jadi distribusi holder dan kepemilikan developer belum terambil di laporan ini."
          : "GeckoTerminal sedang tidak bisa dihubungi, jadi distribusi holder dan kepemilikan developer belum terambil di laporan ini."}{" "}
        <span className="text-txt-2">
          Ini kendala pengambilan data, bukan temuan tentang tokennya — tekan Segarkan sebentar lagi.
        </span>
      </p>
    </div>
  );
}

function VerdictBanner({ report }: { report: TokenReport }) {
  const s = SEVERITY[report.verdict.level];
  const { criticalCount, highCount, mediumCount } = report.verdict;

  return (
    <div className={clsx("rounded-xl border px-4 py-3.5", s.border, s.bg)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ShieldAlert size={18} className={s.text} aria-hidden />
          <div>
            <p className={clsx("text-[15px] font-semibold", s.text)}>{report.narrative.verdictLabel}</p>
            <p className="mt-0.5 text-[12px] text-txt-2">
              Dihitung dari indikator yang bisa diukur — bukan hasil audit keamanan.
            </p>
          </div>
        </div>
        <div className="num flex items-center gap-4 text-[12px] text-txt-1">
          {criticalCount > 0 && <span className="text-flare">{criticalCount} kritis</span>}
          {highCount > 0 && <span className="text-flare">{highCount} tinggi</span>}
          {mediumCount > 0 && <span className="text-reticle">{mediumCount} sedang</span>}
          {report.verdict.flagCount === 0 && <span className="text-bloom">tidak ada temuan material</span>}
        </div>
      </div>
    </div>
  );
}

function NarrativeSections({ report }: { report: TokenReport }) {
  return (
    <Panel title="Narasi">
      <div className="divide-y divide-line">
        {report.narrative.sections.map((section) => (
          <article key={section.key} className="px-4 py-3.5">
            <Eyebrow>{section.title}</Eyebrow>
            <p className="mt-1.5 text-[13px] leading-relaxed text-txt-1">{section.body}</p>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function Findings({ report }: { report: TokenReport }) {
  if (report.flags.length === 0) return null;
  return (
    <Panel title={`Temuan (${report.flags.length})`}>
      <ul className="divide-y divide-line">
        {report.flags.map((flag) => {
          const s = SEVERITY[flag.severity];
          return (
            <li key={flag.code} className="flex gap-3 px-4 py-3">
              <span
                className={clsx(
                  "mt-0.5 h-fit shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                  s.border,
                  s.bg,
                  s.text
                )}
              >
                {s.label}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-txt-0">{flag.label}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-txt-2">{flag.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function SecurityChecks({ report }: { report: TokenReport }) {
  const unverifiable = report.checks.filter((c) => c.status === "unverifiable").length;

  return (
    <Panel
      title="Pemeriksaan Keamanan"
      action={
        unverifiable > 0 ? (
          <span className="text-[11px] text-txt-2">
            {unverifiable} dari {report.checks.length} tidak bisa diverifikasi
          </span>
        ) : null
      }
    >
      <ul className="divide-y divide-line">
        {report.checks.map((check) => {
          const s = CHECK_STATUS[check.status];
          const Icon = s.icon;
          return (
            <li key={check.code} className="flex gap-3 px-4 py-3">
              <Icon size={16} className={clsx("mt-0.5 shrink-0", s.text)} aria-hidden />
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-medium text-txt-0">
                  {check.label}
                  <span className={clsx("text-[11px] font-normal", s.text)}>{s.label}</span>
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-txt-2">{check.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Distribution({ report }: { report: TokenReport }) {
  const d = report.distribution;
  if (d.holderCount == null && d.top10Pct == null) return null;

  // The four buckets the API publishes. Rendered as one bar so the shape of
  // the cap table is legible at a glance rather than as four numbers.
  const bands = [
    { label: "Top 10", value: d.top10Pct, className: "bg-flare" },
    { label: "11–30", value: d.rank11to30Pct, className: "bg-reticle" },
    { label: "31–50", value: d.rank31to50Pct, className: "bg-coat" },
    { label: "Sisanya", value: d.restPct, className: "bg-bloom" },
  ].filter((b) => b.value != null) as { label: string; value: number; className: string }[];

  return (
    <Panel title="Distribusi Kepemilikan">
      <div className="px-4 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[13px] text-txt-1">
            <Users size={14} className="text-txt-2" aria-hidden />
            <span className="num font-medium text-txt-0">{count(d.holderCount)}</span> pemegang
          </p>
          {d.developerHoldingPct != null && (
            <p className="text-[12px] text-txt-2">
              Deployer memegang <span className="num text-txt-1">{pct(d.developerHoldingPct, 2)}</span>
            </p>
          )}
        </div>

        {bands.length > 0 && (
          <>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-ink-2">
              {bands.map((b) => (
                <div key={b.label} className={b.className} style={{ width: `${b.value}%` }} title={`${b.label}: ${pct(b.value)}`} />
              ))}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
              {bands.map((b) => (
                <span key={b.label} className="flex items-center gap-1.5 text-[11px] text-txt-2">
                  <span className={clsx("h-2 w-2 rounded-sm", b.className)} aria-hidden />
                  {b.label} <span className="num text-txt-1">{pct(b.value)}</span>
                </span>
              ))}
            </div>
          </>
        )}

        {d.updatedAt && (
          <p className="mt-3 text-[11px] text-txt-2">
            Data holder per {new Date(d.updatedAt).toLocaleString(ID)}.
          </p>
        )}
      </div>
    </Panel>
  );
}

function FlowPanel({ report }: { report: TokenReport }) {
  const f = report.flow;
  if (f.trades24h == null) return null;

  const buyShare = f.buyRatioPct ?? 50;

  return (
    <Panel title="Aliran Order 24 Jam">
      <div className="px-4 py-4">
        <div className="flex items-baseline justify-between gap-2 text-[12px]">
          <span className="text-bloom">
            <span className="num font-medium">{count(f.buys24h)}</span> beli
          </span>
          <span className="num text-txt-2">{count(f.trades24h)} transaksi</span>
          <span className="text-flare">
            <span className="num font-medium">{count(f.sells24h)}</span> jual
          </span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-ink-2">
          <div className="bg-bloom" style={{ width: `${buyShare}%` }} />
          <div className="bg-flare" style={{ width: `${100 - buyShare}%` }} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[12px]">
          <div>
            <dt className="text-txt-2">Ketimpangan</dt>
            <dd className="num mt-0.5 text-txt-0">{pct(f.imbalancePct)}</dd>
          </div>
          <div>
            <dt className="text-txt-2">Transaksi per dompet</dt>
            <dd className="num mt-0.5 text-txt-0">
              {f.tradesPerTraderLowerBound != null
                ? `≥ ${f.tradesPerTraderLowerBound.toLocaleString(ID, { maximumFractionDigits: 1 })}`
                : "—"}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] leading-snug text-txt-2">
          {f.tradesPerTraderLowerBound != null ? (
            <>
              Angka per dompet dihitung hanya dari pool yang melaporkan dompet unik, mencakup{" "}
              <span className="num">{pct(f.traderCoveragePct)}</span> transaksi 24 jam. Itu batas bawah: dompet yang
              sama berdagang di dua pool terhitung dua kali, jadi pedagang sesungguhnya lebih sedikit, bukan lebih
              banyak.
            </>
          ) : (
            "Tidak ada pool yang melaporkan jumlah dompet unik, jadi rata-rata transaksi per dompet tidak bisa dihitung."
          )}
        </p>
      </div>
    </Panel>
  );
}

function PoolsTable({ report }: { report: TokenReport }) {
  const pools = report.pools.slice(0, 10);
  if (pools.length === 0) return null;

  return (
    <Panel
      title={`Pool (${report.pools.length})`}
      action={report.pools.length > pools.length ? <span className="text-[11px] text-txt-2">10 terdalam</span> : null}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12px]">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="px-4 py-2 font-medium text-txt-2">Pasangan</th>
              <th className="px-4 py-2 text-right font-medium text-txt-2">Likuiditas</th>
              <th className="px-4 py-2 text-right font-medium text-txt-2">Volume 24j</th>
              <th className="px-4 py-2 text-right font-medium text-txt-2">24j</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {pools.map((pool) => (
              <tr key={pool.address}>
                <td className="px-4 py-2.5">
                  <span className="text-txt-0">{pool.pairLabel ?? shortAddress(pool.address)}</span>
                  {pool.dexId && <span className="ml-1.5 text-[11px] text-txt-2">{pool.dexId}</span>}
                </td>
                <td className="num px-4 py-2.5 text-right text-txt-1">{usd(pool.liquidityUsd)}</td>
                <td className="num px-4 py-2.5 text-right text-txt-1">{usd(pool.volume24hUsd)}</td>
                <td
                  className={clsx(
                    "num px-4 py-2.5 text-right",
                    (pool.priceChange24hPct ?? 0) >= 0 ? "text-bloom" : "text-flare"
                  )}
                >
                  {pct(pool.priceChange24hPct, 1, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** The X/Twitter layer. Three distinct states, each said out loud. */
function SocialPanel({ report }: { report: TokenReport }) {
  const social = report.social;

  if (!social.configured) {
    return (
      <Panel title="Intelijen Sosial">
        <div className="flex items-start gap-3 px-4 py-4">
          <MessageSquareOff size={16} className="mt-0.5 shrink-0 text-txt-2" aria-hidden />
          <div>
            <p className="text-[13px] text-txt-1">Sumber data X/Twitter belum terhubung.</p>
            <p className="mt-1 text-[12px] leading-relaxed text-txt-2">
              Bagian tim, katalis, sentimen komunitas, dan temuan alpha butuh akses pencarian X berbayar. Kosongnya
              bagian ini berarti belum ada sumbernya — bukan berarti tidak ada yang membicarakan token ini. Isi{" "}
              <code className="num text-txt-1">SOCIAL_PROVIDER</code> dan{" "}
              <code className="num text-txt-1">SOCIAL_API_KEY</code> untuk mengaktifkannya.
            </p>
          </div>
        </div>
      </Panel>
    );
  }

  if (social.error) {
    return (
      <Panel title="Intelijen Sosial">
        <p className="px-4 py-4 text-[12px] text-txt-2">Sumber sosial gagal dihubungi: {social.error}</p>
      </Panel>
    );
  }

  const synthesis = social.synthesis;
  const mentions = social.mentions ?? [];

  return (
    <div className="space-y-4">
      {synthesis && !synthesis.error ? (
        <SynthesisSections synthesis={synthesis} />
      ) : (
        <Panel title="Intelijen Sosial" action={<span className="text-[11px] text-txt-2">{mentions.length} sebutan</span>}>
          <div className="border-b border-line px-4 py-3">
            <p className="text-[12px] leading-relaxed text-txt-2">
              {synthesis?.error
                ? synthesis.error
                : !social.synthesisConfigured
                  ? "Sintesis naratif mati — isi ANTHROPIC_API_KEY untuk merangkum sebutan ini menjadi bagian tim, katalis, komunitas, dan alpha. Di bawah adalah data mentahnya."
                  : "Belum ada sintesis untuk sebutan ini."}
            </p>
          </div>
          <ul className="divide-y divide-line">
            {mentions.slice(0, 12).map((m, i) => (
              <li key={m.id ?? i} className="px-4 py-3">
                <p className="flex items-baseline gap-2 text-[11px] text-txt-2">
                  <span className="text-txt-1">@{m.author ?? "?"}</span>
                  {m.authorFollowers != null && <span className="num">{count(m.authorFollowers)} pengikut</span>}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-txt-1">{m.text}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function SynthesisSections({ synthesis }: { synthesis: SocialSynthesis }) {
  const { tim, katalis, komunitas, alpha } = synthesis;

  return (
    <div className="space-y-4">
      {synthesis.ringkasanProyek && (
        <Panel title="Tentang Proyek">
          <p className="px-4 py-3.5 text-[13px] leading-relaxed text-txt-1">{synthesis.ringkasanProyek}</p>
        </Panel>
      )}

      {tim && (
        <Panel title={`Tim (${tim.anggota.length})`}>
          <p className="border-b border-line px-4 py-3 text-[12px] leading-relaxed text-txt-2">{tim.ringkasan}</p>
          <ul className="divide-y divide-line">
            {tim.anggota.map((a, i) => (
              <li key={`${a.handle}-${i}`} className="px-4 py-3">
                <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <EvidenceLink url={a.buktiUrl} className="font-medium text-txt-0">
                    {a.handle}
                  </EvidenceLink>
                  <span className="text-[11px] text-txt-2">{a.peran}</span>
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-txt-2">{a.catatan}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {katalis && (
        <Panel title={`Katalis (${katalis.item.length})`}>
          <p className="border-b border-line px-4 py-3 text-[12px] leading-relaxed text-txt-2">{katalis.ringkasan}</p>
          <ul className="divide-y divide-line">
            {katalis.item.map((k, i) => (
              <li key={i} className="px-4 py-3">
                <p className="text-[13px] font-medium text-txt-0">{k.judul}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-txt-2">{k.detail}</p>
                <EvidenceLink url={k.buktiUrl} className="mt-1 inline-block text-[11px] text-txt-2">
                  {k.sumberHandle}
                </EvidenceLink>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {komunitas && (
        <Panel
          title="Komunitas"
          action={
            <span className="num text-[11px] text-txt-2">
              <span className="text-bloom">{komunitas.jumlahPositif}</span> :{" "}
              <span className="text-flare">{komunitas.jumlahNegatif}</span> · {komunitas.sentimen}
            </span>
          }
        >
          <p className="border-b border-line px-4 py-3 text-[12px] leading-relaxed text-txt-2">{komunitas.ringkasan}</p>
          <ul className="divide-y divide-line">
            {komunitas.item.map((c, i) => (
              <li key={i} className="flex gap-3 px-4 py-3">
                <span
                  className={clsx(
                    "mt-1 h-2 w-2 shrink-0 rounded-full",
                    c.sisi === "positif" ? "bg-bloom" : "bg-flare"
                  )}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-[12px] leading-relaxed text-txt-1">{c.kutipan}</p>
                  <EvidenceLink url={c.buktiUrl} className="mt-0.5 inline-block text-[11px] text-txt-2">
                    {c.handle}
                  </EvidenceLink>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {alpha && (
        <Panel title={`Alpha (${alpha.item.length})`}>
          <p className="border-b border-line px-4 py-3 text-[12px] leading-relaxed text-txt-2">{alpha.ringkasan}</p>
          <ul className="divide-y divide-line">
            {alpha.item.map((a, i) => (
              <li key={i} className="px-4 py-3">
                <p className="text-[12px] leading-relaxed text-txt-1">{a.temuan}</p>
                <EvidenceLink url={a.buktiUrl} className="mt-0.5 inline-block text-[11px] text-txt-2">
                  {a.sumberHandle}
                </EvidenceLink>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <p className="px-1 text-[11px] leading-relaxed text-txt-2">
        Bagian di atas dirangkum otomatis dari {synthesis.mentionCount ?? 0} post X publik oleh {synthesis.generatedBy}.
        Isi post adalah klaim penulisnya, bukan fakta terverifikasi — telusuri tautan buktinya sebelum mempercayainya.
      </p>
    </div>
  );
}

/**
 * Evidence links point at URLs that came from third-party posts, so they get
 * `nofollow` + `noopener` and are never auto-followed by anything here.
 */
function EvidenceLink({ url, className, children }: { url?: string; className?: string; children: React.ReactNode }) {
  if (!url) return <span className={className}>{children}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={clsx(className, "transition-colors hover:text-txt-0 hover:underline")}
    >
      {children}
    </a>
  );
}

/* -------------------------------------------------------------------------- */
/* View                                                                        */
/* -------------------------------------------------------------------------- */

export function TokenReportView({
  address,
  report,
  isLoading,
  error,
  onRefresh,
  isRefreshing,
  onRetry,
}: {
  address: string;
  report: TokenReport | undefined;
  isLoading: boolean;
  error: Error | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  onRetry: () => void;
}) {
  if (isLoading && !report) {
    return (
      <div className="panel">
        <TableSkeleton rows={8} />
      </div>
    );
  }

  if (error && !report) {
    return <ErrorState message={error.message} onRetry={onRetry} />;
  }

  if (!report) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/screener" className="inline-flex items-center gap-1.5 text-[12px] text-txt-2 hover:text-txt-0">
          <ArrowLeft size={14} aria-hidden />
          Kembali ke screener
        </Link>
        <Button size="sm" onClick={onRefresh} disabled={isRefreshing}>
          <RefreshCw size={13} className={clsx(isRefreshing && "animate-spin")} aria-hidden />
          Segarkan
        </Button>
      </div>

      <Header report={report} />
      <StatRow report={report} />
      <SourceBanner report={report} />
      <VerdictBanner report={report} />
      <NarrativeSections report={report} />
      <Findings report={report} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Distribution report={report} />
        <FlowPanel report={report} />
      </div>

      <SecurityChecks report={report} />
      <SocialPanel report={report} />
      <PoolsTable report={report} />

      <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-txt-2">
        <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          {report.meta.disclaimer} Sumber data: {report.meta.sources.join(", ") || "—"}. Laporan dibuat{" "}
          {new Date(report.meta.generatedAt).toLocaleString(ID)} untuk alamat{" "}
          <span className="num">{address}</span>.
        </span>
      </p>
    </div>
  );
}
