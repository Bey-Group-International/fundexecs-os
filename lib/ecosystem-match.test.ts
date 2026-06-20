// lib/ecosystem-match.test.ts
// Unit tests for the instant ecosystem matchmaking core. Pure functions, so
// every fixture is a small in-memory object — no database is touched.
import {
  classifyLane,
  scoreOrgMatch,
  rankEcosystemMatches,
  buildInboundAlert,
  buildDigestAlert,
  LANE_LABEL,
  type EcoOrgProfile,
} from "@/lib/ecosystem-match";

function makeOrg(overrides: Partial<EcoOrgProfile> = {}): EcoOrgProfile {
  return {
    id: "org-1",
    name: "Acme Capital",
    operatorRole: "gp",
    strategy: "private_equity",
    location: "New York, NY",
    jurisdiction: "United States",
    aumRange: "100m_500m",
    ...overrides,
  };
}

describe("classifyLane", () => {
  it("maps a GP and a family office to the capital lane", () => {
    const gp = makeOrg({ operatorRole: "gp" });
    const fo = makeOrg({ id: "org-2", operatorRole: "family_office" });
    expect(classifyLane(gp, fo)).toBe("capital");
    // Symmetric — order does not matter.
    expect(classifyLane(fo, gp)).toBe("capital");
  });

  it("reclassifies a capital fit to debt when either side runs credit", () => {
    const lender = makeOrg({ operatorRole: "family_office", strategy: "credit" });
    const gp = makeOrg({ id: "org-2", operatorRole: "gp", strategy: "real_estate" });
    expect(classifyLane(gp, lender)).toBe("debt");
  });

  it("maps two GPs to shared dealflow", () => {
    const a = makeOrg({ operatorRole: "gp" });
    const b = makeOrg({ id: "org-2", operatorRole: "gp" });
    expect(classifyLane(a, b)).toBe("deals");
  });

  it("maps an advisory to the providers lane", () => {
    const advisory = makeOrg({ operatorRole: "advisory" });
    const gp = makeOrg({ id: "org-2", operatorRole: "gp" });
    expect(classifyLane(advisory, gp)).toBe("providers");
  });

  it("maps an operator to the partners lane", () => {
    const operator = makeOrg({ operatorRole: "operator" });
    const gp = makeOrg({ id: "org-2", operatorRole: "gp" });
    expect(classifyLane(operator, gp)).toBe("partners");
  });

  it("returns null when either role is unknown", () => {
    const known = makeOrg({ operatorRole: "gp" });
    const unknown = makeOrg({ id: "org-2", operatorRole: null });
    expect(classifyLane(known, unknown)).toBeNull();
    expect(classifyLane(unknown, known)).toBeNull();
  });
});

describe("scoreOrgMatch", () => {
  it("returns null when there is no role complementarity", () => {
    const a = makeOrg({ operatorRole: null });
    const b = makeOrg({ id: "org-2" });
    expect(scoreOrgMatch(a, b)).toBeNull();
  });

  it("scores a same-strategy, same-geo, same-scale capital match near the top", () => {
    const gp = makeOrg({ operatorRole: "gp", strategy: "private_equity" });
    const fo = makeOrg({
      id: "org-2",
      operatorRole: "family_office",
      strategy: "private_equity",
      location: "New York, NY",
      aumRange: "100m_500m",
    });
    const match = scoreOrgMatch(gp, fo)!;
    expect(match).not.toBeNull();
    expect(match.lane).toBe("capital");
    // lane 30 + strategy 25 + geography 25 + scale 20 = 100.
    expect(match.score).toBe(100);
    expect(match.reasons.length).toBeGreaterThan(0);
  });

  it("scores a thin, mismatched fit well below the alert threshold", () => {
    const gp = makeOrg({
      operatorRole: "gp",
      strategy: "real_estate",
      location: "Tokyo",
      jurisdiction: "Japan",
      aumRange: "over_1b",
    });
    const operator = makeOrg({
      id: "org-2",
      operatorRole: "operator",
      strategy: "credit",
      location: "London",
      jurisdiction: "United Kingdom",
      aumRange: "sub_25m",
    });
    const match = scoreOrgMatch(gp, operator)!;
    // partners base 20, no strategy/geo/scale alignment → stays a weak match.
    expect(match.score).toBeLessThan(60);
  });

  it("rewards a cross-strategy fit in a funding lane (a credit lender for a RE GP)", () => {
    const gp = makeOrg({ operatorRole: "gp", strategy: "real_estate" });
    const lender = makeOrg({
      id: "org-2",
      operatorRole: "family_office",
      strategy: "credit",
      location: "New York, NY",
      aumRange: "100m_500m",
    });
    const match = scoreOrgMatch(gp, lender)!;
    // Credit on either side reclassifies the capital fit to debt...
    expect(match.lane).toBe("debt");
    // ...and a different-but-complementary mandate still earns funding-lane
    // credit: debt 30 + complement 12 + geo 25 + scale 20 = 87.
    expect(match.score).toBe(87);
    expect(match.reasons.some((r) => /complementary/i.test(r))).toBe(true);
  });

  it("gives no strategy credit to a cross-strategy fit outside a funding lane", () => {
    const a = makeOrg({ operatorRole: "operator", strategy: "real_estate", location: "Berlin", jurisdiction: "Germany", aumRange: "sub_25m" });
    const b = makeOrg({ id: "org-2", operatorRole: "advisory", strategy: "private_equity", location: "Berlin", jurisdiction: "Germany", aumRange: "sub_25m" });
    const match = scoreOrgMatch(a, b)!;
    // partners lane: base 20 + strategy 0 (cross, non-funding) + geo 25 + scale 20 = 65.
    expect(match.lane).toBe("partners");
    expect(match.score).toBe(65);
  });

  it("clamps to 100 and never exceeds it", () => {
    const a = makeOrg({ operatorRole: "gp" });
    const b = makeOrg({ id: "org-2", operatorRole: "family_office" });
    const match = scoreOrgMatch(a, b)!;
    expect(match.score).toBeLessThanOrEqual(100);
  });
});

describe("rankEcosystemMatches", () => {
  const viewer = makeOrg({ id: "me", operatorRole: "gp", strategy: "private_equity" });

  it("excludes the viewer itself", () => {
    const self = { ...viewer };
    const ranked = rankEcosystemMatches(viewer, [self]);
    expect(ranked).toHaveLength(0);
  });

  it("drops matches below the minimum score and sorts strongest first", () => {
    const strong = makeOrg({
      id: "strong",
      name: "Strong FO",
      operatorRole: "family_office",
      strategy: "private_equity",
      location: "New York, NY",
      aumRange: "100m_500m",
    });
    const weak = makeOrg({
      id: "weak",
      name: "Weak Op",
      operatorRole: "operator",
      strategy: "credit",
      location: "Singapore",
      jurisdiction: "Singapore",
      aumRange: "sub_25m",
    });
    const ranked = rankEcosystemMatches(viewer, [weak, strong], { minScore: 60 });
    expect(ranked.map((m) => m.org.id)).toEqual(["strong"]);
  });

  it("caps the surfaced set to the limit", () => {
    const candidates = Array.from({ length: 8 }, (_, i) =>
      makeOrg({
        id: `fo-${i}`,
        name: `FO ${i}`,
        operatorRole: "family_office",
        strategy: "private_equity",
        location: "New York, NY",
        aumRange: "100m_500m",
      }),
    );
    const ranked = rankEcosystemMatches(viewer, candidates, { minScore: 60, limit: 5 });
    expect(ranked).toHaveLength(5);
  });
});

describe("alert copy", () => {
  const viewer = makeOrg({ name: "Northwind Partners", operatorRole: "gp", strategy: "private_equity" });
  const fo = makeOrg({ id: "org-2", name: "Harbor Family Office", operatorRole: "family_office" });

  it("builds an inbound alert that headlines the lane and leaks no contact info", () => {
    const match = scoreOrgMatch(viewer, fo)!;
    const copy = buildInboundAlert(viewer, match);
    expect(copy.subject).toContain(LANE_LABEL[match.lane]);
    expect(copy.subject).toContain("Northwind Partners");
    expect(copy.intent).toBe("Ecosystem match");
    // The teaser must not carry an email address.
    expect(copy.preview).not.toMatch(/@/);
    expect(copy.aiSummary).toMatch(/warm intro/i);
  });

  it("builds a reciprocal digest summarizing the matches", () => {
    const matches = rankEcosystemMatches(viewer, [fo], { minScore: 0 });
    const copy = buildDigestAlert(viewer, matches);
    expect(copy.subject).toMatch(/1 new ecosystem match\b/);
    expect(copy.preview).toContain("Harbor Family Office");
    expect(copy.intent).toBe("Ecosystem matches");
  });

  it("pluralizes the digest subject for multiple matches", () => {
    const fo2 = makeOrg({ id: "org-3", name: "Second FO", operatorRole: "family_office" });
    const matches = rankEcosystemMatches(viewer, [fo, fo2], { minScore: 0 });
    const copy = buildDigestAlert(viewer, matches);
    expect(copy.subject).toMatch(/2 new ecosystem matches/);
  });
});
