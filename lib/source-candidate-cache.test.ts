import { __test } from "@/lib/source-candidate-cache";
import type { SourcingMandate } from "@/lib/source-ai";

const { existingFingerprint, contextFingerprint, keyParams } = __test;

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

describe("contextFingerprint", () => {
  it("is stable for the same context", () => {
    const ctx = { user: "Mara", learned: "favors private credit" };
    expect(contextFingerprint(ctx)).toBe(contextFingerprint({ ...ctx }));
  });

  it("separates operators with different learned preferences", () => {
    expect(contextFingerprint({ learned: "favors private credit" }))
      .not.toBe(contextFingerprint({ learned: "favors family office" }));
  });

  it("changes when any part of the context changes", () => {
    const base = { user: "Mara", portfolio: "3 deals", activity: "2 added", learned: "favors credit" };
    expect(contextFingerprint({ ...base, user: "Dev" })).not.toBe(contextFingerprint(base));
    expect(contextFingerprint({ ...base, activity: "5 added" })).not.toBe(contextFingerprint(base));
  });

  it("treats absent and empty context alike", () => {
    expect(contextFingerprint(undefined)).toBe("none");
    expect(contextFingerprint({})).toBe("none");
  });

  it("cannot be collided by shifting text across fields", () => {
    // A plain concatenation would make these two identical.
    expect(contextFingerprint({ user: "ab", portfolio: "c" }))
      .not.toBe(contextFingerprint({ user: "a", portfolio: "bc" }));
  });
});

describe("keyParams personalization", () => {
  const base = {
    module: "source/lp_pipeline",
    mandate: MANDATE,
    query: "family offices",
    existing: ["Acme Capital"],
    enriched: false,
  };

  it("gives two operators with different preferences different keys", () => {
    const mine = keyParams({ ...base, context: { learned: "favors private credit" } });
    const theirs = keyParams({ ...base, context: { learned: "favors family office" } });
    expect(mine).not.toEqual(theirs);
  });

  it("invalidates when new feedback changes the digest", () => {
    const before = keyParams({ ...base, context: { learned: "favors private credit" } });
    const after = keyParams({ ...base, context: { learned: "favors private credit, logistics" } });
    expect(before).not.toEqual(after);
  });

  it("still matches for the same operator context", () => {
    const ctx = { user: "Mara", learned: "favors private credit" };
    expect(keyParams({ ...base, context: ctx })).toEqual(keyParams({ ...base, context: { ...ctx } }));
  });
});
