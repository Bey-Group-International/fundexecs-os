import {
  ensureMandateFit,
  parseMoney,
  parseAmountRange,
  rangesOverlap,
  geographyMatches,
  assetClassMatches,
  computeMandateFit,
  blendFitScore,
  applyMandateFit,
} from "@/lib/source-fit";
import type { SourceCandidate, SourcingMandate } from "@/lib/source-ai";

const MANDATE: SourcingMandate = {
  thesisTitle: "Lower-mid-market industrials",
  assetClasses: ["industrials", "logistics"],
  geographies: ["Texas", "Southeast"],
  checkSizeMin: 1_000_000,
  checkSizeMax: 5_000_000,
  targetIrr: 22,
  targetMoic: 2.5,
};

function candidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    name: "Acme Capital",
    category: "family_office",
    fitScore: 70,
    rationale: "Fits the mandate.",
    firstMove: "Research and qualify.",
    ...overrides,
  };
}

describe("parseMoney", () => {
  it("reads magnitude suffixes", () => {
    expect(parseMoney("$1M")).toBe(1_000_000);
    expect(parseMoney("500k")).toBe(500_000);
    expect(parseMoney("$1.5B")).toBe(1_500_000_000);
    expect(parseMoney("2 million")).toBe(2_000_000);
  });

  it("reads plain and formatted numbers", () => {
    expect(parseMoney("1,000,000")).toBe(1_000_000);
    expect(parseMoney("250")).toBe(250);
  });

  it("returns null when there is no number", () => {
    expect(parseMoney("undisclosed")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
});

describe("parseAmountRange", () => {
  it("parses the shapes a model actually emits", () => {
    expect(parseAmountRange("$1M–$5M")).toEqual({ min: 1e6, max: 5e6 });
    expect(parseAmountRange("$500K to $2M")).toEqual({ min: 5e5, max: 2e6 });
    expect(parseAmountRange("$1M - $5M")).toEqual({ min: 1e6, max: 5e6 });
  });

  it("handles a unit stated only on the upper bound", () => {
    expect(parseAmountRange("$1–5M")).toEqual({ min: 1e6, max: 5e6 });
  });

  it("handles open-ended bounds", () => {
    expect(parseAmountRange("under $20M")).toEqual({ min: 0, max: 2e7 });
    expect(parseAmountRange("$5M+")).toEqual({ min: 5e6, max: Number.POSITIVE_INFINITY });
    expect(parseAmountRange("at least $10M")).toEqual({ min: 1e7, max: Number.POSITIVE_INFINITY });
  });

  it("treats a lone figure as a point estimate", () => {
    expect(parseAmountRange("$5M")).toEqual({ min: 5e6, max: 5e6 });
  });

  it("normalizes an inverted range", () => {
    expect(parseAmountRange("$5M–$1M")).toEqual({ min: 1e6, max: 5e6 });
  });

  it("returns null when nothing numeric is present", () => {
    expect(parseAmountRange("undisclosed")).toBeNull();
    expect(parseAmountRange(undefined)).toBeNull();
    expect(parseAmountRange(42)).toBeNull();
  });
});

describe("rangesOverlap", () => {
  it("detects overlap including touching bounds", () => {
    expect(rangesOverlap({ min: 1e6, max: 5e6 }, { min: 4e6, max: 9e6 })).toBe(true);
    expect(rangesOverlap({ min: 1e6, max: 5e6 }, { min: 5e6, max: 9e6 })).toBe(true);
  });

  it("detects disjoint bands", () => {
    expect(rangesOverlap({ min: 1e6, max: 2e6 }, { min: 5e6, max: 9e6 })).toBe(false);
  });
});

describe("geographyMatches", () => {
  it("matches a state name against a city and abbreviation", () => {
    expect(geographyMatches("Austin, TX", ["Texas"])).toBe(true);
    expect(geographyMatches("Dallas, Texas", ["Texas"])).toBe(true);
  });

  it("resolves a US region to its states", () => {
    expect(geographyMatches("Atlanta, GA", ["Southeast"])).toBe(true);
    expect(geographyMatches("Nashville, TN", ["Southeast"])).toBe(true);
    expect(geographyMatches("Seattle, WA", ["Southeast"])).toBe(false);
  });

  it("treats a country-wide mandate as covering any state", () => {
    expect(geographyMatches("Boise, ID", ["United States"])).toBe(true);
  });

  it("falls back to token containment beyond the US map", () => {
    expect(geographyMatches("London, UK", ["London"])).toBe(true);
    expect(geographyMatches("Munich", ["Berlin"])).toBe(false);
  });

  it("does not match a state code hiding inside a word", () => {
    // "Indiana" contains "in" and "ana"; a substring match would fire falsely.
    expect(geographyMatches("Indianapolis, IN", ["Oregon"])).toBe(false);
  });

  it("is false with nothing to compare", () => {
    expect(geographyMatches("", ["Texas"])).toBe(false);
    expect(geographyMatches("Austin, TX", [])).toBe(false);
  });
});

describe("assetClassMatches", () => {
  it("matches across plural and modifier differences", () => {
    expect(assetClassMatches(["industrial"], ["industrials"])).toBe(true);
    expect(assetClassMatches(["value-add real estate"], ["real estate"])).toBe(true);
  });

  it("does not match unrelated strategies", () => {
    expect(assetClassMatches(["biotech venture"], ["industrials", "logistics"])).toBe(false);
  });

  it("ignores filler terms that appear in every label", () => {
    // Sharing only "capital"/"fund" is not a strategy match.
    expect(assetClassMatches(["growth capital fund"], ["industrials capital"])).toBe(false);
  });

  it("is false with nothing to compare", () => {
    expect(assetClassMatches([], ["industrials"])).toBe(false);
    expect(assetClassMatches(["industrials"], [])).toBe(false);
  });
});

describe("computeMandateFit", () => {
  it("scores a full match at 100 with full coverage", () => {
    const fit = computeMandateFit(
      candidate({ ticketRange: "$2M–$4M", geography: "Austin, TX", strategies: ["industrials"] }),
      MANDATE,
    );
    expect(fit.score).toBe(100);
    expect(fit.coverage).toBe(1);
  });

  it("scores a full miss at 0 with full coverage", () => {
    const fit = computeMandateFit(
      candidate({ ticketRange: "$50M–$100M", geography: "Seattle, WA", strategies: ["biotech"] }),
      MANDATE,
    );
    expect(fit.score).toBe(0);
    expect(fit.coverage).toBe(1);
  });

  it("weights check size above geography", () => {
    const checkOnly = computeMandateFit(
      candidate({ ticketRange: "$2M–$4M", geography: "Seattle, WA", strategies: ["biotech"] }),
      MANDATE,
    );
    const geoOnly = computeMandateFit(
      candidate({ ticketRange: "$50M–$100M", geography: "Austin, TX", strategies: ["biotech"] }),
      MANDATE,
    );
    expect(checkOnly.score).toBeGreaterThan(geoOnly.score);
  });

  it("reports zero coverage when the candidate carries no comparable fields", () => {
    const fit = computeMandateFit(candidate({ category: "" }), MANDATE);
    expect(fit.coverage).toBe(0);
    expect(fit.signals.every((s) => s.matched === null)).toBe(true);
  });

  it("does not assess a constraint the mandate never states", () => {
    const fit = computeMandateFit(
      candidate({ ticketRange: "$2M–$4M", geography: "Austin, TX" }),
      { ...MANDATE, geographies: [], checkSizeMin: null, checkSizeMax: null },
    );
    expect(fit.signals.find((s) => s.id === "check_size")?.matched).toBeNull();
    expect(fit.signals.find((s) => s.id === "geography")?.matched).toBeNull();
    expect(fit.coverage).toBeLessThan(1);
  });

  it("handles a null mandate without throwing", () => {
    const fit = computeMandateFit(candidate({ ticketRange: "$2M" }), null);
    expect(fit.coverage).toBe(0);
    expect(fit.score).toBe(0);
  });

  it("normalizes over assessable signals only", () => {
    // Geography matches, check size unstated by the candidate, strategy misses.
    const fit = computeMandateFit(
      candidate({ geography: "Austin, TX", strategies: ["biotech"] }),
      MANDATE,
    );
    // geography 0.30 earned of (0.30 + 0.25) assessable ≈ 55
    expect(fit.score).toBe(55);
  });
});

describe("blendFitScore", () => {
  it("leaves the model score untouched at zero coverage", () => {
    const fit = computeMandateFit(candidate({ category: "" }), MANDATE);
    expect(blendFitScore(70, fit)).toBe(70);
  });

  it("lifts a model score when the mandate fully matches", () => {
    const fit = computeMandateFit(
      candidate({ ticketRange: "$2M–$4M", geography: "Austin, TX", strategies: ["industrials"] }),
      MANDATE,
    );
    expect(blendFitScore(70, fit)).toBe(85); // 70*0.5 + 100*0.5
  });

  it("cuts a model score the mandate contradicts", () => {
    const fit = computeMandateFit(
      candidate({ ticketRange: "$50M–$100M", geography: "Seattle, WA", strategies: ["biotech"] }),
      MANDATE,
    );
    expect(blendFitScore(90, fit)).toBe(45); // 90*0.5 + 0*0.5
  });

  it("stays within 0–100", () => {
    const perfect = computeMandateFit(
      candidate({ ticketRange: "$2M–$4M", geography: "Austin, TX", strategies: ["industrials"] }),
      MANDATE,
    );
    expect(blendFitScore(100, perfect)).toBeLessThanOrEqual(100);
    const miss = computeMandateFit(
      candidate({ ticketRange: "$50M", geography: "Seattle, WA", strategies: ["biotech"] }),
      MANDATE,
    );
    expect(blendFitScore(0, miss)).toBeGreaterThanOrEqual(0);
  });
});

describe("applyMandateFit", () => {
  it("preserves the model's score and replaces fitScore with the blend", () => {
    const [out] = applyMandateFit(
      [candidate({ fitScore: 70, ticketRange: "$2M–$4M", geography: "Austin, TX", strategies: ["industrials"] })],
      MANDATE,
    );
    expect(out.modelFitScore).toBe(70);
    expect(out.fitScore).toBe(85);
    expect(out.mandateFit.score).toBe(100);
  });

  it("reorders an on-mandate candidate above a louder off-mandate one", () => {
    const out = applyMandateFit(
      [
        candidate({ name: "Loud Off-Mandate", fitScore: 92, ticketRange: "$80M–$150M", geography: "Oslo, Norway", strategies: ["biotech"] }),
        candidate({ name: "Quiet On-Mandate", fitScore: 68, ticketRange: "$2M–$4M", geography: "Atlanta, GA", strategies: ["logistics"] }),
      ],
      MANDATE,
    );
    const ranked = [...out].sort((a, b) => b.fitScore - a.fitScore);
    expect(ranked[0].name).toBe("Quiet On-Mandate");
  });

  it("is a no-op on scores when there is no mandate", () => {
    const [out] = applyMandateFit([candidate({ fitScore: 77 })], null);
    expect(out.fitScore).toBe(77);
    expect(out.modelFitScore).toBe(77);
  });
});

describe("ensureMandateFit", () => {
  const onMandate = candidate({
    fitScore: 70,
    ticketRange: "$2M–$4M",
    geography: "Austin, TX",
    strategies: ["industrials"],
  });

  it("does not blend twice on a cache hit", () => {
    const [scored] = applyMandateFit([onMandate], MANDATE);
    expect(scored.fitScore).toBe(85);

    // Simulates reading the same entry back from cache repeatedly. Without the
    // guard, each pass would treat 85 as the model's score and creep toward 100.
    let round = [scored];
    for (let i = 0; i < 5; i++) round = ensureMandateFit(round, MANDATE);
    expect(round[0].fitScore).toBe(85);
    expect(round[0].modelFitScore).toBe(70);
  });

  it("scores an entry that predates the breakdown", () => {
    const legacy = { ...onMandate };
    const [filled] = ensureMandateFit([legacy], MANDATE);
    expect(filled.mandateFit.score).toBe(100);
    expect(filled.modelFitScore).toBe(70);
    expect(filled.fitScore).toBe(85);
  });

  it("fills in an entry carrying a breakdown but no model score", () => {
    const partial = { ...onMandate, mandateFit: computeMandateFit(onMandate, MANDATE) };
    const [filled] = ensureMandateFit([partial], MANDATE);
    expect(filled.modelFitScore).toBe(70);
    expect(filled.fitScore).toBe(85);
  });

  it("leaves an empty list alone", () => {
    expect(ensureMandateFit([], MANDATE)).toEqual([]);
  });
});
