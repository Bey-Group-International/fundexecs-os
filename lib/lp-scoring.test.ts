import {
  scoreLpFit,
  checkSizeSubScore,
  factorsFromInvestor,
  lpMandateFrom,
  rankLps,
  type LpMandate,
  type LpFactors,
} from "./lp-scoring";

const MANDATE: LpMandate = {
  strategy: "private_equity",
  checkMin: 5_000_000,
  checkMax: 25_000_000,
  geographies: ["North America", "Europe"],
  emergingManager: false,
};

const IDEAL_LP: LpFactors = {
  investorType: "institution",
  typicalCheckMin: 10_000_000,
  typicalCheckMax: 50_000_000,
  jurisdiction: "United States",
  sectors: ["private equity", "buyout"],
  openToEmergingManagers: true,
  allocationSignal: "actively allocating to buyout funds this vintage",
  pipelineStage: "diligence",
};

describe("scoreLpFit", () => {
  it("scores a well-matched institutional LP as high tier", () => {
    const res = scoreLpFit(MANDATE, IDEAL_LP);
    expect(res.score).toBeGreaterThanOrEqual(70);
    expect(res.tier).toBe("high");
  });

  it("scores an all-unknown LP around the neutral midpoint (medium)", () => {
    const blank: LpFactors = {
      investorType: "unknown_type", // falls to default sub-score 0.3
      typicalCheckMin: null,
      typicalCheckMax: null,
      jurisdiction: null,
      sectors: [],
      openToEmergingManagers: null,
      allocationSignal: null,
      pipelineStage: null,
    };
    // No mandate constraints → geography/sector neutral; unknown check neutral.
    const res = scoreLpFit(
      { strategy: null, checkMin: null, checkMax: null, geographies: [], emergingManager: false },
      blank,
    );
    expect(res.score).toBeGreaterThanOrEqual(40);
    expect(res.score).toBeLessThanOrEqual(60);
  });

  it("scores a clear mismatch as low tier", () => {
    const mismatch: LpFactors = {
      investorType: "other",
      typicalCheckMin: 10_000, // writes far too small vs 5M–25M band
      typicalCheckMax: 50_000,
      jurisdiction: "Singapore",
      sectors: ["venture capital", "seed"],
      openToEmergingManagers: false,
      allocationSignal: null,
      pipelineStage: null,
    };
    const res = scoreLpFit(MANDATE, mismatch);
    expect(res.tier).toBe("low");
    expect(res.score).toBeLessThan(50);
  });

  it("produces a breakdown whose contributions sum to the (pre-clamp/round) score", () => {
    const res = scoreLpFit(MANDATE, IDEAL_LP);
    const sum = res.factors.reduce((s, f) => s + f.contribution, 0);
    expect(Math.round(sum)).toBe(res.score);
  });

  it("uses six weighted factors that sum to 1.0", () => {
    const res = scoreLpFit(MANDATE, IDEAL_LP);
    expect(res.factors).toHaveLength(6);
    const totalWeight = res.factors.reduce((s, f) => s + f.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 6);
  });

  it("treats emerging-manager openness as neutral for an established firm", () => {
    const closed = scoreLpFit(MANDATE, { ...IDEAL_LP, openToEmergingManagers: false });
    const open = scoreLpFit(MANDATE, { ...IDEAL_LP, openToEmergingManagers: true });
    // Established firm (MANDATE.emergingManager false) → the factor is neutral
    // regardless of the LP's openness, so both score identically.
    expect(closed.score).toBe(open.score);
  });

  it("rewards emerging-manager openness only when the firm is emerging", () => {
    const emergingMandate: LpMandate = { ...MANDATE, emergingManager: true };
    const open = scoreLpFit(emergingMandate, { ...IDEAL_LP, openToEmergingManagers: true });
    const closed = scoreLpFit(emergingMandate, { ...IDEAL_LP, openToEmergingManagers: false });
    expect(open.score).toBeGreaterThan(closed.score);
  });
});

describe("checkSizeSubScore", () => {
  it("gives full credit when bands overlap", () => {
    expect(checkSizeSubScore(10_000_000, 50_000_000, 5_000_000, 25_000_000)).toBe(1);
  });
  it("is neutral when the investor band is unknown", () => {
    expect(checkSizeSubScore(null, null, 5_000_000, 25_000_000)).toBe(0.5);
  });
  it("treats an unconstrained mandate as always overlapping a known investor", () => {
    expect(checkSizeSubScore(1_000_000, 2_000_000, null, null)).toBe(1);
  });
  it("half-credits a near-miss below the band", () => {
    // investor max 3M vs mandate min 5M → 3M >= 5M/2 → 0.5
    expect(checkSizeSubScore(1_000_000, 3_000_000, 5_000_000, 25_000_000)).toBe(0.5);
  });
  it("low-credits a far miss", () => {
    expect(checkSizeSubScore(10_000, 50_000, 5_000_000, 25_000_000)).toBe(0.15);
  });
});

describe("factorsFromInvestor", () => {
  it("defaults the new signal columns when absent", () => {
    const f = factorsFromInvestor({
      investor_type: "lp",
      typical_check_min: 1_000_000,
      typical_check_max: 5_000_000,
      jurisdiction: "UK",
    });
    expect(f.sectors).toEqual([]);
    expect(f.openToEmergingManagers).toBeNull();
    expect(f.allocationSignal).toBeNull();
    expect(f.pipelineStage).toBeNull();
  });
});

describe("lpMandateFrom", () => {
  it("marks a firm with <=1 prior funds as an emerging manager", () => {
    const m = lpMandateFrom({ primary_strategy: "credit", fund_count: 1 }, null);
    expect(m.emergingManager).toBe(true);
    expect(m.strategy).toBe("credit");
    expect(m.geographies).toEqual([]);
  });
  it("marks a firm with multiple funds as established, and reads the thesis band", () => {
    const m = lpMandateFrom(
      { primary_strategy: "private_equity", fund_count: 4 },
      { check_size_min: 2_000_000, check_size_max: 10_000_000, geographies: ["Asia"] },
    );
    expect(m.emergingManager).toBe(false);
    expect(m.checkMin).toBe(2_000_000);
    expect(m.geographies).toEqual(["Asia"]);
  });
});

describe("rankLps", () => {
  it("sorts by descending score, breaking ties by name", () => {
    const ranked = rankLps([
      { id: "b", name: "Bravo", mandate: MANDATE, factors: IDEAL_LP },
      { id: "a", name: "Alpha", mandate: MANDATE, factors: IDEAL_LP },
      {
        id: "c",
        name: "Charlie",
        mandate: MANDATE,
        factors: { ...IDEAL_LP, investorType: "other", typicalCheckMin: 10_000, typicalCheckMax: 50_000 },
      },
    ]);
    // Alpha and Bravo tie on score → alphabetical; Charlie (mismatch) last.
    expect(ranked.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(ranked[2].id).toBe("c");
  });
});
