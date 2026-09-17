import { __test } from "@/lib/source-candidate-cache";
import type { SourcingMandate } from "@/lib/source-ai";

const { existingFingerprint, keyParams } = __test;

const MANDATE: SourcingMandate = {
  thesisTitle: "Lower-mid-market industrials",
  assetClasses: ["industrials", "logistics"],
  geographies: ["Texas", "Southeast"],
  checkSizeMin: 1_000_000,
  checkSizeMax: 5_000_000,
  targetIrr: 22,
  targetMoic: 2.5,
};

describe("existingFingerprint", () => {
  it("ignores order and case", () => {
    expect(existingFingerprint(["Acme Capital", "Beta Partners"]))
      .toBe(existingFingerprint(["beta partners", "ACME CAPITAL"]));
  });

  it("changes when a name is added", () => {
    expect(existingFingerprint(["Acme Capital"]))
      .not.toBe(existingFingerprint(["Acme Capital", "Beta Partners"]));
  });

  it("collapses duplicates", () => {
    expect(existingFingerprint(["Acme Capital", "Acme Capital"]))
      .toBe(existingFingerprint(["Acme Capital"]));
  });

  it("has a stable empty form", () => {
    expect(existingFingerprint([])).toBe("none");
  });
});

describe("keyParams", () => {
  const base = { module: "source/lp_pipeline", mandate: MANDATE, query: "family offices", existing: ["Acme Capital"], enriched: false };

  it("is stable for an identical request", () => {
    expect(keyParams(base)).toEqual(keyParams({ ...base }));
  });

  it("ignores query case and surrounding space", () => {
    expect(keyParams(base)).toEqual(keyParams({ ...base, query: "  Family Offices  " }));
  });

  it("ignores the order of mandate list fields", () => {
    expect(keyParams(base)).toEqual(
      keyParams({ ...base, mandate: { ...MANDATE, assetClasses: ["logistics", "industrials"] } }),
    );
  });

  it("separates a different module, query, mandate, or enrichment mode", () => {
    expect(keyParams({ ...base, module: "source/deal_pipeline" })).not.toEqual(keyParams(base));
    expect(keyParams({ ...base, query: "lenders" })).not.toEqual(keyParams(base));
    expect(keyParams({ ...base, enriched: true })).not.toEqual(keyParams(base));
    expect(keyParams({ ...base, mandate: { ...MANDATE, checkSizeMax: 9_000_000 } })).not.toEqual(keyParams(base));
  });

  it("invalidates when the pipeline gains a row", () => {
    expect(keyParams({ ...base, existing: ["Acme Capital", "Beta Partners"] })).not.toEqual(keyParams(base));
  });

  it("handles a missing mandate", () => {
    expect(() => keyParams({ ...base, mandate: null })).not.toThrow();
  });
});
