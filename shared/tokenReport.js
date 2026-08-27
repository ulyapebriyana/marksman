// Builds one token's analysis report from already-fetched raw sources. Pure —
// no I/O, no clock reads except the `now` you pass in — so every threshold
// below is pinned by tests rather than discovered in production.
//
// The report is deliberately RISK-SHAPED, not recommendation-shaped. Every
// section answers "what does the data say about this token" and none of them
// answers "should you buy it". That distinction is the whole editorial line of
// this codebase (see the README) and the narrative layer preserves it.
//
// Anything the available APIs cannot actually establish is reported as
// `unverifiable` with a pointer for checking by hand — never as a silent pass.
// A null from an upstream is missing data, not a clean bill of health.

/** Severity ladder, worst first. Ordering here drives sorting and the verdict. */
export const SEVERITY_ORDER = Object.freeze(["kritis", "tinggi", "sedang", "rendah", "info"]);

export const REPORT_TUNABLES = Object.freeze({
  // Holder concentration, as a % of supply held by the top 10 addresses.
  holderTop10HighPct: 50,
  holderTop10MediumPct: 35,
  // Deployer's remaining holding, as a % of supply.
  devHoldingHighPct: 10,
  devHoldingMediumPct: 5,
  // Absolute liquidity floors, USD.
  thinLiquidityUsd: 10_000,
  veryThinLiquidityUsd: 3_000,
  // Liquidity as a % of market cap — how much of the "value" can actually exit.
  liquidityToMcapThinPct: 2,
  liquidityToMcapMediumPct: 5,
  // 24h volume / liquidity. Very high turnover is either genuine heat or
  // wash trading; the report flags it as needing a look, never as a positive.
  turnoverSuspiciousRatio: 20,
  // Trades per unique trader in 24h — high means few wallets round-tripping.
  tradesPerTraderHigh: 20,
  tradesPerTraderMedium: 10,
  // Token age, in hours.
  veryNewHours: 24,
  newHours: 72,
  // Share of all liquidity sitting in the single deepest pool.
  singlePoolShareHighPct: 90,
  // 24h price change, as a %.
  drawdownPct: -25,
  // Minimum unique 24h traders before flow numbers mean anything at all.
  minTradersForFlow: 20,
  // |buys - sells| / total.
  flowImbalanceHighPct: 30,
});

function pct(part, whole) {
  if (part == null || whole == null || whole === 0) return null;
  return (part / whole) * 100;
}

function ratio(a, b) {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

/**
 * Every number that ends up in user-facing Indonesian prose goes through
 * here. `toFixed()` emits a period, which reads as a thousands separator to
 * an Indonesian reader and looks broken next to the comma decimals the rest
 * of the report uses.
 */
function dec(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "?";
  return value.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function hoursSince(iso, now) {
  if (!iso) return null;
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (now - t) / 3_600_000;
}

function flag(code, severity, label, detail, extra = {}) {
  return { code, severity, label, detail, ...extra };
}

/**
 * Identity, links and categories — merged across both sources because each
 * has holes the other fills on this chain.
 */
function buildIdentity(info, dexToken, address) {
  const firstPair = dexToken?.pairs?.[0];
  const socials = dexToken?.links?.socials ?? [];
  const twitter =
    socials.find((s) => s.type === "twitter")?.url ??
    (info?.twitterHandle ? `https://x.com/${info.twitterHandle}` : null);

  return {
    address: (info?.address ?? address ?? "").toLowerCase(),
    name: info?.name ?? firstPair?.baseToken?.name ?? null,
    symbol: info?.symbol ?? firstPair?.baseToken?.symbol ?? null,
    decimals: info?.decimals ?? null,
    imageUrl: info?.imageUrl ?? dexToken?.links?.imageUrl ?? null,
    headerUrl: dexToken?.links?.headerUrl ?? null,
    description: info?.description ?? null,
    categories: info?.categories ?? [],
    websites: (dexToken?.links?.websites ?? []).concat(
      (info?.websites ?? []).map((url) => ({ url, label: "Website" }))
    ),
    twitterUrl: twitter,
    telegramUrl: info?.telegramHandle ? `https://t.me/${info.telegramHandle}` : null,
    discordUrl: info?.discordUrl ?? null,
    gtScore: info?.gtScore ?? null,
    gtVerified: info?.gtVerified ?? false,
  };
}

/**
 * Pools the token trades in, unioned across both sources by address and
 * ranked by liquidity. Liquidity is summed here rather than taken from
 * GeckoTerminal's `total_reserve_in_usd`, which counts only pools it indexes.
 */
function buildPools(dexToken, poolDetails, now) {
  const byAddress = new Map();

  for (const p of dexToken?.pairs ?? []) {
    if (!p.address) continue;
    byAddress.set(p.address.toLowerCase(), {
      address: p.address,
      dexId: p.dexId,
      pairLabel:
        p.baseToken?.symbol && p.quoteToken?.symbol ? `${p.baseToken.symbol} / ${p.quoteToken.symbol}` : null,
      labels: p.labels ?? [],
      url: p.url,
      liquidityUsd: p.liquidityUsd,
      volume24hUsd: p.volume?.h24 ?? null,
      priceUsd: p.priceUsd,
      priceChange24hPct: p.priceChange?.h24 ?? null,
      // Carried so buildMarket() can fall back to DexScreener's valuation
      // when the GeckoTerminal token endpoint is rate-limited or down —
      // without these the whole report loses its market cap in exactly the
      // degraded case the fallback exists for.
      fdv: p.fdv ?? null,
      marketCap: p.marketCap ?? null,
      createdAt: p.createdAt ?? null,
      ageHours: hoursSince(p.createdAt, now),
      buys24h: p.txns?.h24?.buys ?? null,
      sells24h: p.txns?.h24?.sells ?? null,
      buyers24h: null,
      sellers24h: null,
    });
  }

  // Pool detail is richer (unique buyers/sellers, fee percentage) — layer it
  // over the DexScreener copy rather than replacing it, so pools that only
  // one source knows about survive.
  for (const d of poolDetails ?? []) {
    if (!d?.address) continue;
    const key = d.address.toLowerCase();
    const existing = byAddress.get(key) ?? { address: d.address, labels: [] };
    byAddress.set(key, {
      ...existing,
      dexId: existing.dexId ?? d.dexId,
      pairLabel: existing.pairLabel ?? d.name,
      liquidityUsd: existing.liquidityUsd ?? d.liquidityUsd,
      volume24hUsd: existing.volume24hUsd ?? d.volume?.h24 ?? null,
      priceUsd: existing.priceUsd ?? d.priceUsd,
      priceChange24hPct: existing.priceChange24hPct ?? d.priceChange?.h24 ?? null,
      createdAt: existing.createdAt ?? d.createdAt,
      ageHours: existing.ageHours ?? hoursSince(d.createdAt, now),
      feePercentage: d.feePercentage ?? null,
      lockedLiquidityPct: d.lockedLiquidityPct ?? null,
      buys24h: existing.buys24h ?? d.txns?.h24?.buys ?? null,
      sells24h: existing.sells24h ?? d.txns?.h24?.sells ?? null,
      buyers24h: d.txns?.h24?.buyers ?? null,
      sellers24h: d.txns?.h24?.sellers ?? null,
    });
  }

  return [...byAddress.values()].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
}

/** Aggregate market state across every pool found. */
function buildMarket(market, pools, now) {
  const liquidityUsd = pools.reduce((sum, p) => sum + (p.liquidityUsd ?? 0), 0) || null;
  const volume24hUsd = pools.reduce((sum, p) => sum + (p.volume24hUsd ?? 0), 0) || null;
  const deepest = pools[0] ?? null;

  // Age is the oldest pool, not the newest — a token is as old as its first
  // market, and a fresh pool on an old token must not read as a fresh token.
  const ages = pools.map((p) => p.ageHours).filter((h) => h != null);
  const ageHours = ages.length ? Math.max(...ages) : null;

  // The deepest pool may not be the one carrying a valuation, so scan for the
  // first pool that reports one rather than trusting pools[0] to have it.
  const fdvUsd = market?.fdvUsd ?? pools.find((p) => p.fdv != null)?.fdv ?? null;
  // GeckoTerminal returns market_cap_usd null whenever circulating supply is
  // unknown. FDV is the honest stand-in; the report says which one it used.
  const marketCapUsd = market?.marketCapUsd ?? pools.find((p) => p.marketCap != null)?.marketCap ?? null;

  return {
    priceUsd: market?.priceUsd ?? deepest?.priceUsd ?? null,
    fdvUsd,
    marketCapUsd,
    valuationUsd: marketCapUsd ?? fdvUsd,
    valuationBasis: marketCapUsd != null ? "market_cap" : fdvUsd != null ? "fdv" : null,
    liquidityUsd,
    volume24hUsd,
    totalSupply: market?.normalizedTotalSupply ?? null,
    priceChange: {
      m5: deepest?.priceChange?.m5 ?? null,
      h1: deepest?.priceChange?.h1 ?? null,
      h6: deepest?.priceChange?.h6 ?? null,
      h24: deepest?.priceChange24hPct ?? null,
    },
    ageHours,
    poolCount: pools.length,
    topPoolSharePct: pct(deepest?.liquidityUsd, liquidityUsd),
    liquidityToValuationPct: pct(liquidityUsd, marketCapUsd ?? fdvUsd),
    turnoverRatio: ratio(volume24hUsd, liquidityUsd),
    generatedAtAgeBasis: now,
  };
}

/** 24h order flow, aggregated across pools. */
function buildFlow(pools) {
  const sum = (key) => {
    const vals = pools.map((p) => p[key]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  const buys = sum("buys24h");
  const sells = sum("sells24h");
  const buyers = sum("buyers24h");
  const sellers = sum("sellers24h");
  const trades = buys != null && sells != null ? buys + sells : null;

  // Unique traders can't be unioned across pools without wallet-level data —
  // the same wallet trading two pools is counted twice. Treated as an upper
  // bound, which makes trades-per-trader a LOWER bound: the bot-concentration
  // flag can only under-report, never over-report.
  const traders = buyers != null && sellers != null ? buyers + sellers : null;

  // Unique-trader counts come from a per-pool detail call that only some
  // pools get (it is rate-limited and budgeted). Dividing total trades by the
  // traders of a SUBSET produces a ratio with no meaning — and one that
  // swings several-fold between refreshes as the covered set changes. So
  // measure how much of the day's volume the covered pools actually account
  // for, and derive the ratio only from those pools.
  const covered = pools.filter((p) => p.buyers24h != null || p.sellers24h != null);
  const coveredTrades = covered.reduce((total, p) => total + (p.buys24h ?? 0) + (p.sells24h ?? 0), 0);
  const coveragePct = pct(coveredTrades, trades);

  return {
    buys24h: buys,
    sells24h: sells,
    trades24h: trades,
    buyersUpperBound: buyers,
    sellersUpperBound: sellers,
    tradersUpperBound: traders,
    buyRatioPct: pct(buys, trades),
    imbalancePct: trades ? pct(Math.abs(buys - sells), trades) : null,
    /** Share of 24h trades happening in pools that reported unique traders. */
    traderCoveragePct: coveragePct,
    // Both sides of this ratio now come from the same pools, so it is a real
    // (if conservative) figure rather than an artefact of which calls landed.
    tradesPerTraderLowerBound: coveredTrades > 0 ? ratio(coveredTrades, traders) : null,
  };
}

/** Supply distribution and who is holding it. */
function buildDistribution(info) {
  const h = info?.holders ?? null;
  return {
    holderCount: h?.count ?? null,
    top10Pct: h?.top10Pct ?? null,
    rank11to30Pct: h?.next20Pct ?? null,
    rank31to50Pct: h?.next20MorePct ?? null,
    restPct: h?.restPct ?? null,
    top50Pct:
      h && h.top10Pct != null && h.next20Pct != null && h.next20MorePct != null
        ? h.top10Pct + h.next20Pct + h.next20MorePct
        : null,
    updatedAt: h?.updatedAt ?? null,
    developerAddress: info?.developerAddress ?? null,
    developerHoldingPct: info?.developerHoldingPct ?? null,
  };
}

/**
 * The security checklist. Each entry is `pass`, `fail`, `warn`, or
 * `unverifiable` — the last one is a first-class result here, not a gap to
 * paper over. On an EVM chain without a contract-introspection provider,
 * several standard checks genuinely cannot run, and saying so is the honest
 * output.
 */
function buildChecks(info, pools, tun, sourceHealth) {
  const checks = [];
  // A missing value means two very different things depending on whether the
  // source answered at all. Saying "this token publishes none" when we were
  // simply rate-limited would be a confident wrong answer.
  const geckoDown = sourceHealth?.geckoterminal?.ok === false;
  const missingReason = geckoDown
    ? sourceHealth.geckoterminal.reason === "rate_limited"
      ? "Sumber data (GeckoTerminal) sedang membatasi permintaan, jadi angka ini belum terambil — bukan berarti tidak ada. Coba segarkan sebentar lagi."
      : "Sumber data (GeckoTerminal) sedang tidak bisa dihubungi, jadi angka ini belum terambil. Coba segarkan sebentar lagi."
    : null;

  const dangerLabels = pools.flatMap((p) =>
    (p.labels ?? []).filter((l) => /honeypot|danger|scam|rug/i.test(String(l)))
  );

  checks.push(
    dangerLabels.length
      ? {
          code: "honeypot_label",
          status: "fail",
          label: "Label bahaya dari agregator",
          detail: `DexScreener menandai pool dengan label: ${dangerLabels.join(", ")}.`,
        }
      : info?.isHoneypot === "unknown" || info?.isHoneypot == null
        ? {
            code: "honeypot_label",
            status: "unverifiable",
            label: "Simulasi honeypot",
            detail:
              "Tidak ada penyedia simulasi jual-beli yang mengindeks chain ini. Tidak ada label bahaya dari DexScreener, tapi itu bukan hasil tes honeypot. Uji manual dengan transaksi jual bernilai kecil sebelum masuk besar.",
          }
        : {
            code: "honeypot_label",
            status: info.isHoneypot === true ? "fail" : "pass",
            label: "Simulasi honeypot",
            detail: info.isHoneypot === true ? "Token terdeteksi honeypot." : "Tidak terdeteksi sebagai honeypot.",
          }
  );

  // mint_authority / freeze_authority come back null on EVM because they are
  // Solana fields. Null here means "field not applicable", so reporting a
  // pass would be inventing a result the API never gave.
  checks.push({
    code: "contract_authority",
    status: "unverifiable",
    label: "Fungsi mint / freeze / blacklist",
    detail:
      "Field mint & freeze authority yang tersedia adalah konsep Solana dan selalu kosong untuk chain EVM ini — kosong berarti 'tidak berlaku', bukan 'sudah dicek aman'. Baca kode kontraknya langsung di block explorer untuk memastikan tidak ada fungsi mint, pause, atau blacklist.",
  });

  checks.push({
    code: "contract_verified",
    status: "unverifiable",
    label: "Verifikasi source code kontrak",
    detail:
      "Tidak ada API verifikasi kontrak untuk chain ini di sumber yang dipakai. Cek manual di block explorer apakah source code-nya sudah diverifikasi.",
  });

  const top10 = info?.holders?.top10Pct ?? null;
  checks.push(
    top10 == null
      ? {
          code: "holder_concentration",
          status: "unverifiable",
          label: "Konsentrasi holder",
          detail: missingReason ?? "Data distribusi holder tidak dipublikasikan untuk token ini.",
        }
      : {
          code: "holder_concentration",
          status:
            top10 >= tun.holderTop10HighPct ? "fail" : top10 >= tun.holderTop10MediumPct ? "warn" : "pass",
          label: "Konsentrasi holder",
          detail: `10 alamat teratas memegang ${dec(top10, 1)}% suplai (ambang waspada ${tun.holderTop10MediumPct}%, ambang tinggi ${tun.holderTop10HighPct}%).`,
        }
  );

  const dev = info?.developerHoldingPct ?? null;
  checks.push(
    dev == null
      ? {
          code: "developer_holding",
          status: "unverifiable",
          label: "Kepemilikan developer",
          detail: missingReason ?? "Alamat deployer tidak dipublikasikan untuk token ini.",
        }
      : {
          code: "developer_holding",
          status: dev >= tun.devHoldingHighPct ? "fail" : dev >= tun.devHoldingMediumPct ? "warn" : "pass",
          label: "Kepemilikan developer",
          detail: `Deployer masih memegang ${dec(dev, 2)}% suplai.`,
        }
  );

  const lockedKnown = pools.some((p) => p.lockedLiquidityPct != null);
  checks.push({
    code: "liquidity_locked",
    status: lockedKnown ? "pass" : "unverifiable",
    label: "Penguncian likuiditas",
    detail: lockedKnown
      ? `Persentase likuiditas terkunci dilaporkan: ${pools.find((p) => p.lockedLiquidityPct != null).lockedLiquidityPct}%.`
      : "Tidak ada data lock likuiditas dari sumber manapun untuk chain ini. Likuiditas yang tidak terkunci bisa ditarik kapan saja oleh pemiliknya.",
  });

  return checks;
}

/** Risk flags derived from the computed sections. */
function buildRiskFlags({ market, flow, distribution, launchpad, checks }, tun) {
  const flags = [];

  for (const c of checks) {
    if (c.status === "fail" && c.code === "honeypot_label") {
      flags.push(flag(c.code, "kritis", c.label, c.detail));
    }
  }

  const top10 = distribution.top10Pct;
  if (top10 != null && top10 >= tun.holderTop10HighPct) {
    flags.push(
      flag(
        "holder_concentration",
        "tinggi",
        "Suplai terkonsentrasi",
        `10 dompet teratas menguasai ${dec(top10, 1)}% suplai. Keputusan jual segelintir alamat bisa menggerakkan harga sendirian.`
      )
    );
  } else if (top10 != null && top10 >= tun.holderTop10MediumPct) {
    flags.push(
      flag(
        "holder_concentration",
        "sedang",
        "Suplai cukup terkonsentrasi",
        `10 dompet teratas menguasai ${dec(top10, 1)}% suplai.`
      )
    );
  }

  const dev = distribution.developerHoldingPct;
  if (dev != null && dev >= tun.devHoldingHighPct) {
    flags.push(
      flag("developer_holding", "tinggi", "Holding developer besar", `Deployer memegang ${dec(dev, 2)}% suplai.`)
    );
  } else if (dev != null && dev >= tun.devHoldingMediumPct) {
    flags.push(
      flag("developer_holding", "sedang", "Holding developer perlu dipantau", `Deployer memegang ${dec(dev, 2)}% suplai.`)
    );
  }

  const liq = market.liquidityUsd;
  if (liq != null && liq < tun.veryThinLiquidityUsd) {
    flags.push(
      flag("liquidity_very_thin", "kritis", "Likuiditas sangat tipis", `Total likuiditas hanya $${Math.round(liq).toLocaleString("id-ID")}. Order kecil pun akan menggeser harga tajam.`)
    );
  } else if (liq != null && liq < tun.thinLiquidityUsd) {
    flags.push(
      flag("liquidity_thin", "tinggi", "Likuiditas tipis", `Total likuiditas $${Math.round(liq).toLocaleString("id-ID")}, di bawah ambang $${tun.thinLiquidityUsd.toLocaleString("id-ID")}.`)
    );
  }

  const lvPct = market.liquidityToValuationPct;
  if (lvPct != null && lvPct < tun.liquidityToMcapThinPct) {
    flags.push(
      flag(
        "liquidity_vs_valuation",
        "tinggi",
        "Likuiditas kecil dibanding valuasi",
        `Likuiditas hanya ${dec(lvPct, 2)}% dari valuasi ${market.valuationBasis === "fdv" ? "FDV" : "market cap"}. Sebagian besar 'nilai' token itu tidak punya jalan keluar.`
      )
    );
  } else if (lvPct != null && lvPct < tun.liquidityToMcapMediumPct) {
    flags.push(
      flag("liquidity_vs_valuation", "sedang", "Rasio likuiditas terhadap valuasi rendah", `Likuiditas ${dec(lvPct, 2)}% dari valuasi.`)
    );
  }

  const turnover = market.turnoverRatio;
  if (turnover != null && turnover > tun.turnoverSuspiciousRatio) {
    flags.push(
      flag(
        "turnover_extreme",
        "sedang",
        "Perputaran ekstrem",
        `Volume 24 jam ${dec(turnover, 1)}x likuiditas. Bisa berarti minat nyata, bisa juga wash trading atau bot — angka ini sendiri tidak membedakan keduanya.`
      )
    );
  }

  const tpt = flow.tradesPerTraderLowerBound;
  if (tpt != null && flow.tradersUpperBound >= tun.minTradersForFlow) {
    if (tpt >= tun.tradesPerTraderHigh) {
      flags.push(
        flag("trader_concentration", "tinggi", "Aktivitas didominasi sedikit dompet", `Minimal ${dec(tpt, 1)} transaksi per dompet dalam 24 jam — pola khas bot atau perdagangan berulang, bukan distribusi peserta yang luas.`)
      );
    } else if (tpt >= tun.tradesPerTraderMedium) {
      flags.push(
        flag("trader_concentration", "sedang", "Transaksi per dompet tinggi", `Minimal ${dec(tpt, 1)} transaksi per dompet dalam 24 jam.`)
      );
    }
  }

  const age = market.ageHours;
  if (age != null && age < tun.veryNewHours) {
    flags.push(flag("very_new", "tinggi", "Token sangat baru", `Pasar pertama baru berumur ${dec(age, 1)} jam. Belum ada rekam jejak apa pun untuk dinilai.`));
  } else if (age != null && age < tun.newHours) {
    flags.push(flag("new", "sedang", "Token baru", `Pasar pertama berumur ${dec((age / 24), 1)} hari.`));
  }

  if (market.topPoolSharePct != null && market.topPoolSharePct >= tun.singlePoolShareHighPct && market.poolCount > 1) {
    flags.push(
      flag("single_pool_dependency", "sedang", "Bergantung pada satu pool", `${dec(market.topPoolSharePct, 1)}% likuiditas ada di satu pool. Kalau pool itu ditarik, sisanya tidak menahan apa-apa.`)
    );
  }

  const chg = market.priceChange?.h24;
  if (chg != null && chg <= tun.drawdownPct) {
    flags.push(flag("drawdown", "sedang", "Koreksi tajam 24 jam", `Harga turun ${dec(Math.abs(chg), 1)}% dalam 24 jam.`));
  }

  const imb = flow.imbalancePct;
  if (imb != null && imb >= tun.flowImbalanceHighPct && flow.trades24h >= tun.minTradersForFlow) {
    const side = flow.buys24h > flow.sells24h ? "beli" : "jual";
    flags.push(
      flag("flow_imbalance", "sedang", `Aliran order condong ke ${side}`, `Ketimpangan ${dec(imb, 1)}% antara jumlah transaksi beli dan jual.`)
    );
  }

  if (launchpad?.completed) {
    flags.push(
      flag("launchpad_graduated", "info", "Lulus launchpad", "Token sudah menyelesaikan kurva launchpad dan bermigrasi ke pool DEX biasa. Ini menandakan bonding curve terisi penuh, bukan jaminan kualitas.")
    );
  } else if (launchpad && !launchpad.completed) {
    flags.push(
      flag("launchpad_active", "sedang", "Masih di launchpad", `Kurva launchpad baru terisi ${dec(launchpad.graduationPct, 1)}%. Token belum bermigrasi ke pool DEX penuh.`)
    );
  }

  const unverifiable = checks.filter((c) => c.status === "unverifiable").length;
  if (unverifiable > 0) {
    flags.push(
      flag("unverifiable_checks", "info", `${unverifiable} pemeriksaan tidak bisa diverifikasi`, "Beberapa pemeriksaan keamanan standar tidak punya sumber data di chain ini dan harus dicek manual. Lihat daftar Pemeriksaan Keamanan.", { count: unverifiable })
    );
  }

  return flags.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

/**
 * Overall risk level. Driven by the worst flag present plus a count rule, so
 * a pile of "sedang" flags escalates rather than averaging itself away.
 */
function buildVerdict(flags) {
  const counted = flags.filter((f) => f.severity !== "info");
  const has = (sev) => counted.some((f) => f.severity === sev);
  const countOf = (sev) => counted.filter((f) => f.severity === sev).length;

  let level;
  if (has("kritis")) level = "kritis";
  else if (countOf("tinggi") >= 2) level = "kritis";
  else if (has("tinggi")) level = "tinggi";
  else if (countOf("sedang") >= 3) level = "tinggi";
  else if (has("sedang")) level = "sedang";
  else level = "rendah";

  return {
    level,
    flagCount: counted.length,
    criticalCount: countOf("kritis"),
    highCount: countOf("tinggi"),
    mediumCount: countOf("sedang"),
  };
}

/**
 * @param {object} raw
 * @param {object|null} raw.info        getTokenInfo() result
 * @param {object|null} raw.market      getTokenMarket() result
 * @param {object|null} raw.dexToken    getDexScreenerToken() result
 * @param {object[]}    [raw.poolDetails] getPoolDetail() results
 * @param {object|null} [raw.social]    social intel, or null when unconfigured
 * @param {{ now?: number, tunables?: object, chain?: string }} [opts]
 */
export function buildTokenReport(raw, opts = {}) {
  const { now = Date.now(), tunables = REPORT_TUNABLES, chain = "robinhood" } = opts;
  const { info, market: marketRaw, dexToken, poolDetails = [], social = null, sourceHealth = null } = raw;

  const identity = buildIdentity(info, dexToken, raw.address);
  const pools = buildPools(dexToken, poolDetails, now);
  const market = buildMarket(marketRaw, pools, now);
  const flow = buildFlow(pools);
  const distribution = buildDistribution(info);
  const launchpad = info?.launchpad ?? null;
  const checks = buildChecks(info, pools, tunables, sourceHealth);
  const flags = buildRiskFlags({ market, flow, distribution, launchpad, checks }, tunables);
  const verdict = buildVerdict(flags);

  const sources = [];
  if (info || marketRaw) sources.push("GeckoTerminal");
  if (dexToken?.pairs?.length) sources.push("DexScreener");

  return {
    chain,
    identity,
    market,
    flow,
    distribution,
    launchpad,
    pools,
    checks,
    flags,
    verdict,
    sourceHealth,
    social: social ?? { configured: false, sections: null },
    meta: {
      generatedAt: new Date(now).toISOString(),
      sources,
      disclaimer:
        "Laporan ini disusun otomatis dari data publik agregat dan bersifat informasional. Bukan saran finansial, bukan rekomendasi beli atau jual.",
    },
  };
}
