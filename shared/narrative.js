// Turns a token report into Indonesian prose.
//
// This is deterministic and template-driven on purpose. The numbers in a
// narrative like this are the whole point, and a model paraphrasing them is a
// model that can get one wrong — so the sentences are assembled from the same
// report object the UI renders, and every figure in the text is the figure in
// the data by construction. `server/llmNarrative.mjs` can layer a fluent
// rewrite on top when an API key is configured, but it rewrites THIS text
// rather than reading the raw numbers itself, and the deterministic version
// stays the fallback.
//
// Editorial rule, enforced by tests: the narrative describes what the data
// shows and what it cannot show. It never tells anyone what to do with it.
// No "beli", no "jual", no "layak dikoleksi".

const RUPIAH_LOCALE = "id-ID";

export function formatUsd(value, { compact = true } = {}) {
  if (value == null || !Number.isFinite(value)) return "tidak diketahui";
  const abs = Math.abs(value);
  if (compact) {
    if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toLocaleString(RUPIAH_LOCALE, { maximumFractionDigits: 2 })} M`;
    if (abs >= 1_000_000) return `$${(value / 1_000_000).toLocaleString(RUPIAH_LOCALE, { maximumFractionDigits: 2 })} jt`;
    if (abs >= 1_000) return `$${(value / 1_000).toLocaleString(RUPIAH_LOCALE, { maximumFractionDigits: 1 })} rb`;
  }
  if (abs > 0 && abs < 0.01) return `$${value.toPrecision(3)}`;
  return `$${value.toLocaleString(RUPIAH_LOCALE, { maximumFractionDigits: 2 })}`;
}

export function formatPct(value, { digits = 1, sign = false } = {}) {
  if (value == null || !Number.isFinite(value)) return "tidak diketahui";
  const s = value.toLocaleString(RUPIAH_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${sign && value > 0 ? "+" : ""}${s}%`;
}

export function formatAge(hours) {
  if (hours == null || !Number.isFinite(hours)) return "umur tidak diketahui";
  // Must go through the locale like every other number in this file —
  // toFixed() emits a period and would read as "5.0 jam" next to "15,28%".
  const fixed = (value, digits) =>
    value.toLocaleString(RUPIAH_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  if (hours < 1) return `${Math.round(hours * 60)} menit`;
  if (hours < 48) return `${fixed(hours, hours < 10 ? 1 : 0)} jam`;
  const days = hours / 24;
  if (days < 60) return `${fixed(days, days < 10 ? 1 : 0)} hari`;
  return `${fixed(days / 30, 1)} bulan`;
}

export function formatCount(value) {
  if (value == null || !Number.isFinite(value)) return "tidak diketahui";
  return value.toLocaleString(RUPIAH_LOCALE);
}

const VERDICT_COPY = Object.freeze({
  kritis: {
    label: "Risiko kritis",
    lead: "Data menunjukkan masalah struktural yang serius",
  },
  tinggi: {
    label: "Risiko tinggi",
    lead: "Ada beberapa hal yang menonjol sebagai risiko",
  },
  sedang: {
    label: "Risiko sedang",
    lead: "Sebagian besar indikator wajar, dengan catatan",
  },
  rendah: {
    label: "Risiko rendah menurut data yang terbaca",
    lead: "Tidak ada tanda bahaya besar dari data yang bisa diukur",
  },
});

function sentence(parts) {
  return parts.filter(Boolean).join(" ");
}

/** Paragraph 1: what this thing is. */
function ringkasan(report) {
  const { identity, market, launchpad, chain } = report;
  const nama = identity.name && identity.symbol
    ? `${identity.name} ($${identity.symbol})`
    : identity.symbol
      ? `$${identity.symbol}`
      : "Token ini";

  const kategori = identity.categories?.length
    ? ` Agregator mengelompokkannya di kategori ${identity.categories.join(", ")}.`
    : "";

  const valuasi = market.valuationUsd != null
    ? `Valuasinya ${formatUsd(market.valuationUsd)}${market.valuationBasis === "fdv" ? " berdasarkan FDV — suplai beredar tidak dipublikasikan, jadi ini nilai seluruh suplai, bukan yang benar-benar beredar" : " berdasarkan market cap"}`
    : "Valuasinya tidak bisa dihitung dari data yang tersedia";

  const harga = market.priceUsd != null ? `, dengan harga ${formatUsd(market.priceUsd, { compact: false })} per token` : "";

  const gerak = market.priceChange?.h24 != null
    ? ` Dalam 24 jam terakhir harganya bergerak ${formatPct(market.priceChange.h24, { sign: true })}.`
    : "";

  const umur = ` Pasar pertamanya dibuka ${formatAge(market.ageHours)} lalu di chain ${chain}.`;

  const lp = launchpad?.completed
    ? " Token ini lulus dari launchpad dan sudah bermigrasi ke pool DEX biasa."
    : launchpad
      ? ` Token ini masih berada di launchpad dengan kurva terisi ${formatPct(launchpad.graduationPct)}.`
      : "";

  const deskripsi = identity.description ? ` ${identity.description}` : "";

  return sentence([`${nama}.${deskripsi}${kategori}`, `${valuasi}${harga}.${gerak}${umur}${lp}`]);
}

/** Paragraph 2: can you actually get out? */
function likuiditas(report) {
  const { market, pools } = report;

  if (market.liquidityUsd == null) {
    return "Tidak ada data likuiditas yang bisa dibaca untuk token ini, jadi kedalaman pasarnya tidak bisa dinilai sama sekali.";
  }

  const dasar = `Total likuiditas yang terbaca ${formatUsd(market.liquidityUsd)}, tersebar di ${formatCount(market.poolCount)} pool.`;

  const konsentrasi = market.topPoolSharePct != null && pools[0]
    ? ` Pool terdalam (${pools[0].pairLabel ?? "tanpa nama"}${pools[0].dexId ? ` di ${pools[0].dexId}` : ""}) menampung ${formatPct(market.topPoolSharePct)} dari total itu.`
    : "";

  const rasio = market.liquidityToValuationPct != null
    ? ` Dibanding valuasinya, likuiditas itu setara ${formatPct(market.liquidityToValuationPct, { digits: 2 })} — ini angka yang menentukan berapa besar posisi yang bisa keluar tanpa menghancurkan harganya sendiri.`
    : "";

  const putaran = market.turnoverRatio != null
    ? ` Volume 24 jam sebesar ${formatUsd(market.volume24hUsd)} berarti perputarannya ${market.turnoverRatio.toLocaleString(RUPIAH_LOCALE, { maximumFractionDigits: 1 })}x likuiditas.${
        market.turnoverRatio > 20
          ? " Perputaran setinggi itu tidak otomatis berarti minat nyata — wash trading dan bot menghasilkan angka yang sama persis, dan data volume agregat tidak bisa memisahkan keduanya."
          : ""
      }`
    : "";

  return sentence([dasar + konsentrasi + rasio + putaran]);
}

/** Paragraph 3: who holds it. */
function distribusi(report) {
  const d = report.distribution;

  if (d.holderCount == null && d.developerHoldingPct == null) {
    return "Data distribusi holder tidak tersedia untuk token ini, jadi konsentrasi kepemilikan tidak bisa dinilai — dan itu sendiri sebuah kekosongan, bukan kabar baik.";
  }

  const jumlah = d.holderCount != null ? `Token ini dipegang ${formatCount(d.holderCount)} alamat.` : "";

  const top = d.top10Pct != null
    ? ` 10 alamat teratas menguasai ${formatPct(d.top10Pct)} suplai${
        d.top50Pct != null ? `, dan 50 teratas menguasai ${formatPct(d.top50Pct)}` : ""
      }.${
        d.top10Pct >= 50
          ? " Dengan konsentrasi setinggi itu, harga lebih ditentukan oleh keputusan segelintir dompet daripada oleh permintaan pasar."
          : d.top10Pct >= 35
            ? " Konsentrasi di level ini masih umum untuk token muda, tapi cukup untuk membuat satu penjualan besar terasa."
            : ""
      }`
    : "";

  const dev = d.developerHoldingPct != null
    ? ` Alamat deployer masih memegang ${formatPct(d.developerHoldingPct, { digits: 2 })} suplai.`
    : " Kepemilikan deployer tidak terpublikasi.";

  return sentence([jumlah + top + dev]);
}

/** Paragraph 4: who is trading it, and how. */
function aliran(report) {
  const f = report.flow;

  if (f.trades24h == null) {
    return "Tidak ada data transaksi 24 jam yang bisa dibaca, jadi pola aliran order tidak bisa dinilai.";
  }

  const dasar = `Dalam 24 jam terakhir tercatat ${formatCount(f.trades24h)} transaksi — ${formatCount(f.buys24h)} beli berbanding ${formatCount(f.sells24h)} jual.`;

  const timpang = f.imbalancePct != null
    ? ` Ketimpangannya ${formatPct(f.imbalancePct)}${
        f.imbalancePct >= 30
          ? `, condong ke sisi ${f.buys24h > f.sells24h ? "beli" : "jual"}. Aliran satu arah berarti sisi lain sedang menjadi likuiditas keluar buat mereka.`
          : ", cukup seimbang antara kedua sisi."
      }`
    : "";

  // The trader count is an upper bound (same wallet in two pools counts
  // twice), so the per-trader figure is a floor. Say so rather than
  // presenting it as exact.
  const dompet = f.tradesPerTraderLowerBound != null
    ? ` Dari jumlah dompet unik yang dilaporkan per pool, rata-ratanya minimal ${f.tradesPerTraderLowerBound.toLocaleString(RUPIAH_LOCALE, { maximumFractionDigits: 1 })} transaksi per dompet${
        f.tradesPerTraderLowerBound >= 20
          ? " — pola yang lebih mirip bot atau perdagangan berulang daripada peserta yang banyak dan berbeda-beda"
          : ""
      }. Angka ini batas bawah: dompet yang sama berdagang di dua pool terhitung dua kali, jadi jumlah pedagang sesungguhnya lebih sedikit, bukan lebih banyak.`
    : "";

  return sentence([dasar + timpang + dompet]);
}

/** Paragraph 5: the risk read. */
function risiko(report) {
  const { verdict, flags } = report;
  const copy = VERDICT_COPY[verdict.level] ?? VERDICT_COPY.sedang;
  const material = flags.filter((f) => f.severity !== "info");

  if (!material.length) {
    return `${copy.lead}. Tidak ada indikator yang melewati ambang peringatan pada laporan ini. Itu bukan berarti aman — hanya berarti tidak ada yang tertangkap oleh data yang tersedia.`;
  }

  const daftar = material
    .slice(0, 4)
    .map((f) => `${f.label.toLowerCase()} (${f.severity})`)
    .join(", ");

  const sisa = material.length > 4 ? ` dan ${material.length - 4} temuan lain` : "";

  return `${copy.lead}: ${daftar}${sisa}. Rinciannya ada di daftar temuan di bawah, lengkap dengan angka yang memicu masing-masing.`;
}

/** Paragraph 6: the limits of the whole exercise. */
function batasan(report) {
  const unverifiable = report.checks.filter((c) => c.status === "unverifiable");
  const sosialAktif = report.social?.configured;

  const cek = unverifiable.length
    ? `${unverifiable.length} dari ${report.checks.length} pemeriksaan keamanan standar tidak punya sumber data di chain ini dan dilaporkan apa adanya sebagai "tidak terverifikasi" — bukan diloloskan diam-diam. Yang termasuk di dalamnya: ${unverifiable.map((c) => c.label.toLowerCase()).join(", ")}.`
    : "Semua pemeriksaan keamanan pada laporan ini punya sumber data.";

  const sosialTeks = sosialAktif
    ? ""
    : " Lapis intelijen sosial (tim, katalis, sentimen komunitas) belum terhubung ke sumber data X/Twitter, jadi bagian itu kosong — bukan berarti tidak ada percakapan tentang token ini.";

  return `${cek}${sosialTeks} Seluruh angka di sini berasal dari data agregat publik — volume 24 jam, cadangan pool, hitungan transaksi — bukan dari pembukuan tingkat swap. ${report.meta.disclaimer}`;
}

/**
 * @param {object} report buildTokenReport() output
 * @returns {{ sections: {key:string,title:string,body:string}[], plainText: string }}
 */
export function buildNarrative(report) {
  const sections = [
    { key: "ringkasan", title: "Ringkasan", body: ringkasan(report) },
    { key: "likuiditas", title: "Likuiditas & Kedalaman Pasar", body: likuiditas(report) },
    { key: "distribusi", title: "Distribusi Kepemilikan", body: distribusi(report) },
    { key: "aliran", title: "Aliran Order 24 Jam", body: aliran(report) },
    { key: "risiko", title: "Pembacaan Risiko", body: risiko(report) },
    { key: "batasan", title: "Batas Analisis Ini", body: batasan(report) },
  ];

  return {
    sections,
    plainText: sections.map((s) => `${s.title}\n${s.body}`).join("\n\n"),
    verdictLabel: (VERDICT_COPY[report.verdict.level] ?? VERDICT_COPY.sedang).label,
    generatedBy: "deterministic",
  };
}
