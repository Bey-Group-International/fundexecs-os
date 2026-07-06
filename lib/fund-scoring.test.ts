// lib/fund-scoring.test.ts
import {
  scoreFund,
  rankFunds,
  factorsFromFund,
  type FundFactors,
  type FundRowLike,
  type TrackRecordRowLike,
} from "@/lib/fund-scoring";

// A benchmark-ish, all-known fund used as the "all else equal" baseline.
const BASE: FundFactors = {
  fund_size_usd: 500_000_000,
  vintage_year: 2020,
  gp_experience_funds: 3,
  sector_specialized: true,
  prior_gross_irr: 0.15,
  prior_moic: 1.8,
  committed_ratio: 0.6,
};

describe("scoreFund — bounds & clamping", () => {
  it("always returns a score within [0,100]", () => {
    const worst = scoreFund({
      fund_size_usd: 1,
      vintage_year: 1990,
      gp_experience_funds: 0,
      sector_specialized: false,
      prior_gross_irr: -0.5,
      prior_moic: 0,
      committed_ratio: 5,
    });
    const best = scoreFund({
      fund_size_usd: 500_000_000,
      vintage_year: 2022,
      gp_experience_funds: 50,
      sector_specialized: true,
      prior_gross_irr: 2, // absurdly high, must not blow past 100
      prior_moic: 20,
      committed_ratio: 0.6,
    });
    for (const r of [worst, best]) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
    expect(best.score).toBeGreaterThan(worst.score);
  });

  it("factor contributions sum to the (unclamped) score for a mid-range fund", () => {
    const r = scoreFund(BASE);
    const total = r.factors.reduce((s, f) => s + f.contribution, 0);
    expect(total).toBeCloseTo(r.score, 6);
  });

  it("exposes all six weighted factors, weights summing to 1", () => {
    const r = scoreFund(BASE);
    expect(r.factors).toHaveLength(6);
    const w = r.factors.reduce((s, f) => s + f.weight, 0);
    expect(w).toBeCloseTo(1, 6);
    for (const f of r.factors) {
      expect(f.label).toBeTruthy();
      expect(f.note).toBeTruthy();
    }
  });
});

describe("scoreFund — monotonicity (all else equal)", () => {
  it("higher prior IRR ⇒ strictly higher score", () => {
    const low = scoreFund({ ...BASE, prior_gross_irr: 0.05 });
    const mid = scoreFund({ ...BASE, prior_gross_irr: 0.15 });
    const high = scoreFund({ ...BASE, prior_gross_irr: 0.3 });
    expect(low.score).toBeLessThan(mid.score);
    expect(mid.score).toBeLessThan(high.score);
  });

  it("more GP experience ⇒ higher score", () => {
    const a = scoreFund({ ...BASE, gp_experience_funds: 0 });
    const b = scoreFund({ ...BASE, gp_experience_funds: 5 });
    expect(b.score).toBeGreaterThan(a.score);
  });

  it("specialization scores above generalist", () => {
    const spec = scoreFund({ ...BASE, sector_specialized: true });
    const gen = scoreFund({ ...BASE, sector_specialized: false });
    expect(spec.score).toBeGreaterThan(gen.score);
  });

  it("higher prior MOIC ⇒ higher score", () => {
    const a = scoreFund({ ...BASE, prior_moic: 1.2 });
    const b = scoreFund({ ...BASE, prior_moic: 2.5 });
    expect(b.score).toBeGreaterThan(a.score);
  });
});

describe("scoreFund — tiers", () => {
  it("classifies a strong fund as top and a weak fund as lower", () => {
    const strong = scoreFund({
      fund_size_usd: 500_000_000,
      vintage_year: 2021,
      gp_experience_funds: 8,
      sector_specialized: true,
      prior_gross_irr: 0.28,
      prior_moic: 2.6,
      committed_ratio: 0.6,
    });
    const weak = scoreFund({
      fund_size_usd: 5_000_000_000,
      vintage_year: 2021,
      gp_experience_funds: 0,
      sector_specialized: false,
      prior_gross_irr: 0.02,
      prior_moic: 0.9,
      committed_ratio: 0.02,
    });
    expect(strong.tier).toBe("top");
    expect(strong.score).toBeGreaterThanOrEqual(75);
    expect(weak.tier).toBe("lower");
    expect(weak.score).toBeLessThan(40);
  });

  it("tier is monotonic in score across the boundary set", () => {
    const order = { lower: 0, mid: 1, upper: 2, top: 3 } as const;
    const samples = [0.02, 0.1, 0.15, 0.22, 0.3].map((irr) =>
      scoreFund({ ...BASE, prior_gross_irr: irr }),
    );
    for (let i = 1; i < samples.length; i++) {
      expect(order[samples[i].tier]).toBeGreaterThanOrEqual(
        order[samples[i - 1].tier],
      );
    }
  });
});

describe("rankFunds", () => {
  it("sorts by descending score", () => {
    const ranked = rankFunds([
      { id: "a", name: "Weak Fund", factors: { ...BASE, prior_gross_irr: 0.03 } },
      { id: "b", name: "Strong Fund", factors: { ...BASE, prior_gross_irr: 0.3 } },
      { id: "c", name: "Middling Fund", factors: { ...BASE, prior_gross_irr: 0.15 } },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["b", "c", "a"]);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it("breaks score ties by name for a stable order", () => {
    const ranked = rankFunds([
      { id: "z", name: "Zeta", factors: BASE },
      { id: "a", name: "Alpha", factors: BASE },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(["Alpha", "Zeta"]);
  });
});

describe("factorsFromFund — null-safe DB mapping", () => {
  const fund: FundRowLike = {
    id: "f1",
    name: "Fund I",
    fund_type: "fund",
    vintage_year: 2020,
    target_size: 300_000_000,
    committed_capital: 250_000_000,
    called_capital: 150_000_000,
    distributed_capital: 0,
  };

  it("maps a populated track record into aggregated factors", () => {
    const records: TrackRecordRowLike[] = [
      { asset_class: "real_estate", vintage_year: 2015, gross_irr: 0.2, gross_moic: 2.0, is_realized: true },
      { asset_class: "real_estate", vintage_year: 2017, gross_irr: 0.1, gross_moic: 1.6, is_realized: true },
    ];
    const f = factorsFromFund(fund, records);
    expect(f.fund_size_usd).toBe(300_000_000);
    expect(f.gp_experience_funds).toBe(2); // two distinct vintages
    expect(f.sector_specialized).toBe(true); // single asset class
    expect(f.prior_gross_irr).toBeCloseTo(0.15, 6); // mean of realized
    expect(f.prior_moic).toBeCloseTo(1.8, 6);
    expect(f.committed_ratio).toBeCloseTo(0.6, 6); // 150 / 250
  });

  it("handles an empty track record without throwing", () => {
    const f = factorsFromFund(fund, []);
    expect(f.gp_experience_funds).toBe(0);
    expect(f.sector_specialized).toBe(false);
    expect(f.prior_gross_irr).toBeNull();
    expect(f.prior_moic).toBeNull();
    // Still fully scoreable.
    const s = scoreFund(f);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
  });

  it("falls back to committed_capital when target_size is null, and null size when neither", () => {
    const noTarget = factorsFromFund({ ...fund, target_size: null }, []);
    expect(noTarget.fund_size_usd).toBe(250_000_000);
    const noSize = factorsFromFund(
      { ...fund, target_size: null, committed_capital: 0 },
      [],
    );
    expect(noSize.fund_size_usd).toBeNull();
    expect(noSize.committed_ratio).toBeNull(); // committed == 0 → no ratio
  });

  it("flags mixed asset classes as generalist", () => {
    const records: TrackRecordRowLike[] = [
      { asset_class: "real_estate", vintage_year: 2015, gross_irr: 0.2, gross_moic: 2.0, is_realized: true },
      { asset_class: "credit", vintage_year: 2016, gross_irr: 0.1, gross_moic: 1.4, is_realized: false },
    ];
    const f = factorsFromFund(fund, records);
    expect(f.sector_specialized).toBe(false);
    expect(f.gp_experience_funds).toBe(2);
  });
});
