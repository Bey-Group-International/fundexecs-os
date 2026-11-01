import {
  ELEVATED_MIN_REASON,
  HIGH_MIN_REASON,
  approvalRequirement,
  approvalRiskBlocker,
  assessRisk,
  normalizeCountry,
  riskLists,
  type RiskInput,
} from "@/lib/lp-risk";

const lists = riskLists({});
const base: RiskInput = {
  lpType: "entity",
  entityType: "company",
  country: "United States",
  ownerThresholdPct: 25,
  owners: [{ role: "owner", ownershipPct: 60, country: "United States" }],
  checks: [{ kind: "identity", status: "clear", method: "stripe_identity" }],
};
const codes = (i: Partial<RiskInput>) => assessRisk({ ...base, ...i }, lists).factors.map((f) => f.code);

describe("normalizeCountry", () => {
  it("folds case, accents, punctuation and known aliases", () => {
    expect(normalizeCountry("  IRAN ")).toBe("iran");
    expect(normalizeCountry("Islamic Republic of Iran")).toBe("iran");
    expect(normalizeCountry("D.P.R.K.")).toBe("north korea");
    expect(normalizeCountry("Korea, North")).toBe("north korea");
    expect(normalizeCountry("Burma")).toBe("myanmar");
    expect(normalizeCountry("Côte d'Ivoire")).toBe("cote divoire");
  });
  it("leaves other countries as plain names and copes with non-text", () => {
    expect(normalizeCountry("United States")).toBe("united states");
    expect(normalizeCountry(null)).toBe("");
    expect(normalizeCountry(42)).toBe("");
  });
});

describe("riskLists", () => {
  it("uses the built-in high-risk list when nothing is set", () => {
    expect(lists.high).toEqual(expect.arrayContaining(["iran", "north korea"]));
    expect(lists.elevated).toEqual([]);
  });
  it("lets the environment REPLACE a list, normalizing what it finds", () => {
    const l = riskLists({ LP_HIGH_RISK_COUNTRIES: "Russia, Belarus", LP_ELEVATED_RISK_COUNTRIES: "burma" });
    expect(l.high).toEqual(["russia", "belarus"]);
    expect(l.elevated).toEqual(["myanmar"]);
  });
});

describe("assessRisk", () => {
  it("is low for an ordinary, well-documented LP", () => {
    expect(assessRisk(base, lists)).toEqual({ tier: "low", factors: [] });
  });

  it("is high when the LP, or any owner, is in a high-risk jurisdiction", () => {
    expect(assessRisk({ ...base, country: "Iran" }, lists).tier).toBe("high");
    expect(codes({ owners: [{ role: "owner", ownershipPct: 60, country: "Burma" }] })).toContain("owner_high_risk_country");
  });

  it("is high when sanctions, PEP or adverse-media screening was flagged or failed", () => {
    for (const kind of ["sanctions", "pep", "adverse_media"] as const) {
      for (const status of ["flagged", "failed"] as const) {
        expect(assessRisk({ ...base, checks: [{ kind, status }] }, lists).tier).toBe("high");
      }
    }
    expect(assessRisk({ ...base, checks: [{ kind: "sanctions", status: "clear" }] }, lists).tier).toBe("low");
  });

  it("is elevated for a structure that can hide who is behind it", () => {
    expect(assessRisk({ ...base, entityType: "trust" }, lists)).toMatchObject({ tier: "elevated" });
    expect(codes({ entityType: "family_office" })).toContain("opaque_structure");
  });

  it("is elevated when no owner at or above the threshold is listed, but not for institutions", () => {
    const thin = { owners: [{ role: "owner", ownershipPct: 10, country: null }] };
    expect(codes(thin)).toContain("no_owner_over_threshold");
    expect(codes({ ...thin, ownerThresholdPct: 10 })).not.toContain("no_owner_over_threshold");
    expect(codes({ ...thin, entityType: "pension" })).not.toContain("no_owner_over_threshold");
    expect(codes({ ...thin, lpType: "individual" })).not.toContain("no_owner_over_threshold");
  });

  it("is elevated when the ID check was recorded by hand", () => {
    expect(codes({ checks: [{ kind: "identity", status: "clear", method: "manual" }] })).toContain("id_attested_by_hand");
    expect(codes({ checks: [{ kind: "identity", status: "pending", method: "manual" }] })).not.toContain("id_attested_by_hand");
  });

  it("takes the highest tier among its reasons and lists every one", () => {
    const a = assessRisk({ ...base, entityType: "trust", country: "Cuba" }, lists);
    expect(a.tier).toBe("high");
    expect(a.factors.map((f) => f.code)).toEqual(expect.arrayContaining(["lp_high_risk_country", "opaque_structure"]));
  });

  it("never throws on missing data", () => {
    expect(assessRisk({ lpType: undefined, entityType: undefined, country: undefined, ownerThresholdPct: undefined, owners: [], checks: [] }, lists).tier).toBe("low");
  });
});

describe("what approval requires", () => {
  const tierOf = (tier: "low" | "elevated" | "high") => ({ tier, factors: [] });
  it("asks nothing extra for a low-risk LP", () => {
    expect(approvalRiskBlocker(tierOf("low"), "admin", "ok")).toBeNull();
    expect(approvalRequirement("low")).toMatchObject({ ownerOnly: false, minReasonChars: 0, note: null });
  });
  it("asks an elevated-risk approver for real reasoning, from an admin or an owner", () => {
    expect(approvalRiskBlocker(tierOf("elevated"), "admin", "x".repeat(ELEVATED_MIN_REASON - 1))).toMatch(/Elevated risk/);
    expect(approvalRiskBlocker(tierOf("elevated"), "admin", "x".repeat(ELEVATED_MIN_REASON))).toBeNull();
  });
  it("lets only an owner approve a high-risk LP, and with fuller reasoning", () => {
    const long = "x".repeat(HIGH_MIN_REASON);
    expect(approvalRiskBlocker(tierOf("high"), "admin", long)).toMatch(/only an organization owner/);
    expect(approvalRiskBlocker(tierOf("high"), "member", long)).toMatch(/only an organization owner/);
    expect(approvalRiskBlocker(tierOf("high"), null, long)).toMatch(/only an organization owner/);
    expect(approvalRiskBlocker(tierOf("high"), "owner", "x".repeat(HIGH_MIN_REASON - 1))).toMatch(/High risk/);
    expect(approvalRiskBlocker(tierOf("high"), "owner", long)).toBeNull();
  });
  it("counts reasoning without surrounding spaces", () => {
    expect(approvalRiskBlocker(tierOf("elevated"), "owner", `   ${"x".repeat(ELEVATED_MIN_REASON - 1)}   `)).not.toBeNull();
  });
});
