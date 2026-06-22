// lib/ownership-intel.test.ts
// Unit tests for the pure scorers/rankers behind Ownership & Buyer Intelligence.
// No database, no model — all inputs are small in-memory fixtures, so the same
// guarantees hold in CI with no ANTHROPIC_API_KEY.
import {
  scoreBuyerFit,
  rankBuyersForTarget,
  addOnFitScore,
  summarizeAcquisitions,
  __test,
  type BuyerLike,
  type TargetLike,
  type AcquisitionLike,
} from "@/lib/ownership-intel";

function buyer(overrides: Partial<BuyerLike> = {}): BuyerLike {
  return {
    name: "Test Buyer",
    buyerType: "pe",
    thesis: null,
    sectors: ["Industrial Services"],
    geographies: ["Southeast US"],
    checkMin: 5_000_000,
    checkMax: 50_000_000,
    appetite: 70,
    ...overrides,
  };
}

const target: TargetLike = {
  name: "Acme Industrial Services",
  sector: "Industrial Services",
  geography: "Southeast US",
  size: 20_000_000,
};

describe("scoreBuyerFit", () => {
  it("returns a clamped 0–100 score", () => {
    const { score } = scoreBuyerFit(buyer(), target);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("rewards a sector + geography + check-band match strongly", () => {
    const { score, reasons } = scoreBuyerFit(buyer(), target);
    expect(score).toBeGreaterThanOrEqual(85);
    expect(reasons.some((r) => /Industrial Services/i.test(r))).toBe(true);
  });

  it("matches sectors on shared tokens, not just exact strings", () => {
    const b = buyer({ sectors: ["Industrial Services & Distribution"] });
    const { reasons } = scoreBuyerFit(b, target);
    expect(reasons.some((r) => /Active in/i.test(r))).toBe(true);
  });

  it("scores a wrong-sector buyer below an on-sector one", () => {
    const onSector = scoreBuyerFit(buyer(), target).score;
    const offSector = scoreBuyerFit(buyer({ sectors: ["Healthcare IT"] }), target).score;
    expect(offSector).toBeLessThan(onSector);
  });

  it("flags deals above the buyer's check ceiling", () => {
    const big: TargetLike = { ...target, size: 500_000_000 };
    const { reasons } = scoreBuyerFit(buyer(), big);
    expect(reasons.some((r) => /stretch/i.test(r))).toBe(true);
  });

  it("treats missing data as neutral, not a penalty", () => {
    const bare = scoreBuyerFit({ name: "Mystery" }, { name: "Mystery Co" });
    expect(bare.score).toBeGreaterThan(0);
    expect(bare.score).toBeLessThan(60);
  });

  it("rewards high appetite", () => {
    const hot = scoreBuyerFit(buyer({ appetite: 95 }), target).score;
    const cold = scoreBuyerFit(buyer({ appetite: 5 }), target).score;
    expect(hot).toBeGreaterThan(cold);
  });
});

describe("rankBuyersForTarget", () => {
  it("ranks the best fit first and drops weak matches", () => {
    const pool: BuyerLike[] = [
      buyer({ name: "Perfect", sectors: ["Industrial Services"], geographies: ["Southeast US"], appetite: 90 }),
      buyer({ name: "Wrong sector", sectors: ["Biotech"], geographies: ["Europe"], appetite: 10, checkMin: 1, checkMax: 2 }),
      buyer({ name: "Okay", sectors: ["Industrial Services"], geographies: ["Midwest US"], appetite: 40 }),
    ];
    const ranked = rankBuyersForTarget(pool, target, { minScore: 35 });
    expect(ranked[0].buyer.name).toBe("Perfect");
    expect(ranked.map((r) => r.buyer.name)).not.toContain("Wrong sector");
  });

  it("respects the limit", () => {
    const pool = Array.from({ length: 12 }, (_, i) => buyer({ name: `B${i}` }));
    expect(rankBuyersForTarget(pool, target, { limit: 3 })).toHaveLength(3);
  });

  it("returns scores in non-increasing order", () => {
    const pool = [buyer({ name: "A", appetite: 90 }), buyer({ name: "B", appetite: 30 }), buyer({ name: "C", appetite: 60 })];
    const ranked = rankBuyersForTarget(pool, target);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });
});

describe("addOnFitScore", () => {
  const platform = { name: "Southeast HVAC Group", sector: "HVAC Services", geography: "Southeast US" };

  it("scores a same-vertical, same-geography tuck-in highly", () => {
    const { score, reasons } = addOnFitScore(
      { name: "Local HVAC", sector: "HVAC Services", geography: "Southeast US", size: 10_000_000 },
      platform,
    );
    expect(score).toBeGreaterThanOrEqual(70);
    expect(reasons.some((r) => /consolidation/i.test(r))).toBe(true);
  });

  it("credits a new-geography candidate as expansion", () => {
    const { reasons } = addOnFitScore(
      { name: "West HVAC", sector: "HVAC Services", geography: "West US", size: 12_000_000 },
      platform,
    );
    expect(reasons.some((r) => /expansion/i.test(r))).toBe(true);
  });

  it("favors smaller tuck-ins over large targets", () => {
    const small = addOnFitScore({ name: "S", sector: "HVAC Services", geography: "Southeast US", size: 10_000_000 }, platform).score;
    const large = addOnFitScore({ name: "L", sector: "HVAC Services", geography: "Southeast US", size: 500_000_000 }, platform).score;
    expect(small).toBeGreaterThan(large);
  });

  it("clamps to 0–100", () => {
    const { score } = addOnFitScore({ name: "X", sector: "HVAC Services", geography: "Southeast US", size: 1 }, platform);
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

describe("summarizeAcquisitions", () => {
  const rows: AcquisitionLike[] = [
    { acquirerName: "RollUp Co", targetName: "Alpha", announcedOn: "2019-03-01", priceAmount: 10_000_000, structure: "add_on", sector: "HVAC" },
    { acquirerName: "RollUp Co", targetName: "Beta", announcedOn: "2021-06-15", priceAmount: 25_000_000, structure: "add_on", sector: "HVAC" },
    { acquirerName: "RollUp Co", targetName: "Gamma", announcedOn: "2024-01-20", priceAmount: null, structure: "majority", sector: "Plumbing" },
    { acquirerName: "Other Inc", targetName: "Delta", announcedOn: null, priceAmount: 5_000_000, structure: "merger", sector: "HVAC" },
  ];

  it("counts deals and sums disclosed price", () => {
    const s = summarizeAcquisitions(rows);
    expect(s.count).toBe(4);
    expect(s.totalDisclosed).toBe(40_000_000);
  });

  it("computes the year span from announced dates", () => {
    expect(summarizeAcquisitions(rows).span).toBe("2019–2024");
  });

  it("identifies the most acquisitive name", () => {
    const s = summarizeAcquisitions(rows);
    expect(s.topAcquirer).toEqual({ name: "RollUp Co", count: 3 });
  });

  it("ranks sectors by frequency and counts structures", () => {
    const s = summarizeAcquisitions(rows);
    expect(s.topSectors[0]).toBe("HVAC");
    expect(s.byStructure.add_on).toBe(2);
    expect(s.byStructure.majority).toBe(1);
  });

  it("handles an empty history", () => {
    const s = summarizeAcquisitions([]);
    expect(s.count).toBe(0);
    expect(s.span).toBe("");
    expect(s.topAcquirer).toBeNull();
  });

  it("uses a single year when all deals are same-year", () => {
    const s = summarizeAcquisitions([rows[0]]);
    expect(s.span).toBe("2019");
  });
});

describe("normalize helpers (deterministic, no model)", () => {
  it("fallbackBuyers produces ranked, deduped candidates", () => {
    const cands = __test.fallbackBuyers(target);
    expect(cands.length).toBeGreaterThan(0);
    const names = cands.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (let i = 1; i < cands.length; i++) {
      expect(cands[i - 1].fitScore).toBeGreaterThanOrEqual(cands[i].fitScore);
    }
  });

  it("fallbackAddOns produces ranked candidates", () => {
    const addOns = __test.fallbackAddOns({ name: "P", sector: "HVAC", geography: "Southeast US" });
    expect(addOns.length).toBeGreaterThan(0);
    for (let i = 1; i < addOns.length; i++) {
      expect(addOns[i - 1].fitScore).toBeGreaterThanOrEqual(addOns[i].fitScore);
    }
  });

  it("coerceBuyerType maps unknowns to a safe default", () => {
    expect(__test.coerceBuyerType("strategic")).toBe("strategic");
    expect(__test.coerceBuyerType("Search Fund")).toBe("search_fund");
    expect(__test.coerceBuyerType("nonsense")).toBe("financial");
  });

  it("normalizeBuyers dedupes by name and scores deterministically", () => {
    const raw = [
      { name: "Dup", buyerType: "pe", thesis: "x", rationale: "r", sectors: ["Industrial Services"] },
      { name: "Dup", buyerType: "pe", thesis: "y", rationale: "r2" },
      { name: "Two", buyerType: "strategic", thesis: "z", rationale: "r3" },
    ];
    const out = __test.normalizeBuyers(raw, target);
    expect(out.map((b) => b.name)).toEqual(expect.arrayContaining(["Dup", "Two"]));
    expect(out.filter((b) => b.name === "Dup")).toHaveLength(1);
  });
});
