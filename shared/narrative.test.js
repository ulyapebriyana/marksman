import { describe, it, expect } from "vitest";
import { buildTokenReport } from "./tokenReport.js";
import { buildNarrative, formatUsd, formatPct, formatAge, formatCount } from "./narrative.js";

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);
const HOUR = 3_600_000;

function report(over = {}) {
  const { info = {}, market = {}, pairs, poolDetails = [], social = null } = over;
  return buildTokenReport(
    {
      address: "0xabc0000000000000000000000000000000000001",
      info: {
        name: "Test Token",
        symbol: "TEST",
        categories: [],
        holders: { count: 1000, top10Pct: 20, next20Pct: 10, next20MorePct: 5, restPct: 65 },
        developerHoldingPct: 1,
        isHoneypot: "unknown",
        launchpad: null,
        ...info,
      },
      market: { priceUsd: 1, fdvUsd: 1_000_000, marketCapUsd: null, topPoolAddresses: [], ...market },
      dexToken: {
        pairs: pairs ?? [
          {
            address: "0xpool1",
            dexId: "uniswap",
            labels: [],
            baseToken: { symbol: "TEST" },
            quoteToken: { symbol: "WETH" },
            liquidityUsd: 100_000,
            volume: { h24: 200_000 },
            priceUsd: 1,
            priceChange: { h24: 5 },
            txns: { h24: { buys: 500, sells: 500 } },
            createdAt: NOW - 30 * 24 * HOUR,
          },
        ],
        links: { websites: [], socials: [] },
      },
      poolDetails,
      social,
    },
    { now: NOW }
  );
}

describe("formatters", () => {
  it("formats USD in Indonesian short scale", () => {
    expect(formatUsd(1_500_000)).toBe("$1,5 jt");
    expect(formatUsd(2_400)).toBe("$2,4 rb");
    expect(formatUsd(3_200_000_000)).toBe("$3,2 M");
  });

  it("keeps precision on sub-cent prices instead of rounding them to zero", () => {
    expect(formatUsd(0.0007166, { compact: false })).toBe("$0.000717");
  });

  it("says 'tidak diketahui' rather than inventing a zero", () => {
    expect(formatUsd(null)).toBe("tidak diketahui");
    expect(formatPct(null)).toBe("tidak diketahui");
    expect(formatCount(null)).toBe("tidak diketahui");
    expect(formatAge(null)).toBe("umur tidak diketahui");
  });

  it("uses Indonesian decimal commas for percentages", () => {
    expect(formatPct(15.28, { digits: 2 })).toBe("15,28%");
    expect(formatPct(4.2, { sign: true })).toBe("+4,2%");
  });

  it("scales age units by magnitude", () => {
    expect(formatAge(0.5)).toBe("30 menit");
    expect(formatAge(5)).toBe("5,0 jam");
    expect(formatAge(12)).toBe("12 jam");
    expect(formatAge(24 * 10)).toBe("10 hari");
    expect(formatAge(24 * 90)).toBe("3,0 bulan");
  });
});

describe("buildNarrative", () => {
  it("produces all six sections", () => {
    const n = buildNarrative(report());
    expect(n.sections.map((s) => s.key)).toEqual([
      "ringkasan",
      "likuiditas",
      "distribusi",
      "aliran",
      "risiko",
      "batasan",
    ]);
    for (const s of n.sections) expect(s.body.length).toBeGreaterThan(20);
  });

  // The editorial line of the whole project: describe the data, never tell
  // anyone what to do with it. Bare "beli"/"jual" are legitimate here — they
  // name the two sides of order flow — so this matches ADVISORY CONSTRUCTIONS
  // rather than banning the nouns, which is the distinction that actually
  // matters.
  it("never phrases anything as advice", () => {
    const variants = [
      report(),
      report({ info: { holders: { count: 5, top10Pct: 80 } }, market: { marketCapUsd: 100 } }),
      report({ pairs: [] }),
      report({ info: { launchpad: { completed: true, graduationPct: 100 } } }),
      report({ social: { configured: true, mentions: [] } }),
    ];

    const advisory = [
      /\b(belilah|juallah|akumulasikan|koleksilah)\b/i,
      /\bsebaiknya\s+(beli|jual|masuk|keluar|hindari)\b/i,
      /\b(layak|patut|wajib)\s+(dibeli|dikoleksi|dimiliki|dihindari)\b/i,
      /\b(kami|kita)\s+(merekomendasikan|menyarankan)\b/i,
      /\bdisarankan untuk\b/i,
      /\btarget harga\b/i,
      /\b(cuan|pasti naik|dijamin|peluang emas|jangan sampai ketinggalan)\b/i,
      /\bsinyal (beli|jual)\b/i,
    ];

    for (const r of variants) {
      const text = buildNarrative(r).plainText;
      for (const pattern of advisory) {
        expect(text, `advisory phrasing ${pattern} in: ${text.slice(0, 120)}`).not.toMatch(pattern);
      }
    }
  });

  it("describes order flow with the words beli/jual as plain nouns", () => {
    const body = buildNarrative(report()).sections[3].body;
    expect(body).toMatch(/beli berbanding/);
    expect(body).toMatch(/jual/);
  });

  it("always carries the not-financial-advice disclaimer", () => {
    expect(buildNarrative(report()).plainText).toContain("Bukan saran finansial");
  });

  it("states the FDV caveat when circulating supply is unknown", () => {
    const n = buildNarrative(report({ market: { marketCapUsd: null, fdvUsd: 500_000 } }));
    expect(n.sections[0].body).toContain("FDV");
    expect(n.sections[0].body).toContain("bukan yang benar-benar beredar");
  });

  it("degrades to an explicit statement when there are no pools at all", () => {
    const n = buildNarrative(report({ pairs: [] }));
    expect(n.sections[1].body).toContain("tidak bisa dinilai");
    expect(n.sections[3].body).toContain("tidak bisa dinilai");
  });

  it("calls missing holder data a gap rather than good news", () => {
    const n = buildNarrative(report({ info: { holders: null, developerHoldingPct: null } }));
    expect(n.sections[2].body).toContain("bukan kabar baik");
  });

  it("names the unverifiable checks in the limits section", () => {
    const n = buildNarrative(report());
    expect(n.sections[5].body).toContain("tidak terverifikasi");
    expect(n.sections[5].body).toContain("verifikasi source code kontrak");
  });

  it("says the social layer is disconnected rather than implying silence", () => {
    const n = buildNarrative(report());
    expect(n.sections[5].body).toContain("bukan berarti tidak ada percakapan");
  });

  it("drops the social caveat once a social source is configured", () => {
    const n = buildNarrative(report({ social: { configured: true, mentions: [] } }));
    expect(n.sections[5].body).not.toContain("bukan berarti tidak ada percakapan");
  });

  it("warns that extreme turnover does not distinguish real demand from wash trading", () => {
    const n = buildNarrative(
      report({
        pairs: [
          {
            address: "0xp",
            dexId: "uniswap",
            labels: [],
            baseToken: { symbol: "TEST" },
            quoteToken: { symbol: "WETH" },
            liquidityUsd: 10_000,
            volume: { h24: 5_000_000 },
            priceUsd: 1,
            priceChange: { h24: 0 },
            txns: { h24: { buys: 100, sells: 100 } },
            createdAt: NOW - 30 * 24 * HOUR,
          },
        ],
      })
    );
    expect(n.sections[1].body).toContain("wash trading");
  });

  it("labels the trades-per-wallet figure as a lower bound", () => {
    const n = buildNarrative(
      report({
        poolDetails: [{ address: "0xpool1", txns: { h24: { buys: 500, sells: 500, buyers: 20, sellers: 20 } } }],
      })
    );
    expect(n.sections[3].body).toContain("batas bawah");
  });

  it("marks itself as deterministic so the UI can say how it was produced", () => {
    expect(buildNarrative(report()).generatedBy).toBe("deterministic");
  });
});
