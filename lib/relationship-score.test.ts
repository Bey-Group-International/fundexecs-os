// lib/relationship-score.test.ts
import {
  computeRelationshipScore,
  extractDecayAlerts,
  type RelationshipScore,
} from "@/lib/relationship-score";

// --- Helpers -----------------------------------------------------------------
const BASE_DATE = "2026-01-01T00:00:00Z";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function makeScore(overrides: Partial<Parameters<typeof computeRelationshipScore>[0]> = {}) {
  return computeRelationshipScore({
    investorId: "inv-1",
    investorName: "Acme Capital",
    interactionCount: 5,
    lastContactAt: daysAgo(10),
    hasCommitment: false,
    hasActiveDeal: false,
    sharedConnectionCount: 0,
    temperature: "warm",
    ...overrides,
  });
}

// --- computeRelationshipScore ------------------------------------------------
describe("computeRelationshipScore", () => {
  it("returns a score with all required fields", () => {
    const result = makeScore();
    expect(result).toHaveProperty("investorId", "inv-1");
    expect(result).toHaveProperty("investorName", "Acme Capital");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.scoreBreakdown).toHaveProperty("recency");
    expect(result.scoreBreakdown).toHaveProperty("frequency");
    expect(result.scoreBreakdown).toHaveProperty("dealOverlap");
    expect(result.scoreBreakdown).toHaveProperty("introValue");
  });

  it("recency dimension: contact within 7 days scores 40", () => {
    const result = makeScore({ lastContactAt: daysAgo(5), interactionCount: 0, sharedConnectionCount: 0 });
    expect(result.scoreBreakdown.recency).toBe(40);
  });

  it("recency dimension: contact 30 days ago scores 28", () => {
    const result = makeScore({ lastContactAt: daysAgo(30), interactionCount: 0, sharedConnectionCount: 0 });
    expect(result.scoreBreakdown.recency).toBe(28);
  });

  it("recency dimension: no contact scores 0", () => {
    const result = makeScore({ lastContactAt: null, interactionCount: 0, sharedConnectionCount: 0 });
    expect(result.scoreBreakdown.recency).toBe(0);
    expect(result.daysSinceContact).toBeNull();
  });

  it("frequency dimension: 20+ interactions scores 30", () => {
    const result = makeScore({ interactionCount: 25, lastContactAt: null, sharedConnectionCount: 0 });
    expect(result.scoreBreakdown.frequency).toBe(30);
  });

  it("frequency dimension: 0 interactions scores 0", () => {
    const result = makeScore({ interactionCount: 0, lastContactAt: null, sharedConnectionCount: 0 });
    expect(result.scoreBreakdown.frequency).toBe(0);
  });

  it("dealOverlap dimension: commitment gives 20, activeDeal gives 12, none gives 0", () => {
    const committed = makeScore({ hasCommitment: true, hasActiveDeal: false });
    const active = makeScore({ hasCommitment: false, hasActiveDeal: true });
    const none = makeScore({ hasCommitment: false, hasActiveDeal: false });
    expect(committed.scoreBreakdown.dealOverlap).toBe(20);
    expect(active.scoreBreakdown.dealOverlap).toBe(12);
    expect(none.scoreBreakdown.dealOverlap).toBe(0);
  });

  it("introValue dimension: caps at 10 (5 shared connections = 10)", () => {
    const result = makeScore({ sharedConnectionCount: 5, lastContactAt: null, interactionCount: 0 });
    expect(result.scoreBreakdown.introValue).toBe(10);
    const capped = makeScore({ sharedConnectionCount: 10, lastContactAt: null, interactionCount: 0 });
    expect(capped.scoreBreakdown.introValue).toBe(10);
  });

  it("decay alert: 29 days → NO alert", () => {
    const result = makeScore({ lastContactAt: daysAgo(29), hasCommitment: false });
    expect(result.decayAlert).toBe(false);
    expect(result.decayDays).toBeNull();
  });

  it("decay alert: 30 days → alert triggered", () => {
    const result = makeScore({ lastContactAt: daysAgo(30), hasCommitment: false });
    expect(result.decayAlert).toBe(true);
    expect(result.decayDays).toBe(30);
  });

  it("decay alert: committed investor never triggers alert even at 60 days", () => {
    const result = makeScore({ lastContactAt: daysAgo(60), hasCommitment: true });
    expect(result.decayAlert).toBe(false);
    expect(result.decayDays).toBeNull();
  });

  it("temperature is passed through unchanged", () => {
    expect(makeScore({ temperature: "cold" }).temperature).toBe("cold");
    expect(makeScore({ temperature: "committed" }).temperature).toBe("committed");
  });

  it("total score does not exceed 100", () => {
    const result = makeScore({
      interactionCount: 30,
      lastContactAt: daysAgo(3),
      hasCommitment: true,
      sharedConnectionCount: 10,
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

// --- extractDecayAlerts ------------------------------------------------------
describe("extractDecayAlerts", () => {
  function makeRS(overrides: Partial<RelationshipScore> = {}): RelationshipScore {
    return {
      investorId: "inv-1",
      investorName: "Acme",
      score: 30,
      temperature: "warm",
      lastContactAt: daysAgo(60),
      daysSinceContact: 60,
      interactionCount: 2,
      decayAlert: true,
      decayDays: 60,
      scoreBreakdown: { recency: 8, frequency: 10, dealOverlap: 0, introValue: 0 },
      ...overrides,
    };
  }

  it("excludes scores with no decay alert", () => {
    const s = makeRS({ decayAlert: false, decayDays: null });
    expect(extractDecayAlerts([s])).toHaveLength(0);
  });

  it("classifies 90+ days as critical priority", () => {
    const alerts = extractDecayAlerts([makeRS({ daysSinceContact: 95, decayDays: 95 })]);
    expect(alerts[0].priority).toBe("critical");
  });

  it("classifies 60-89 days as high priority", () => {
    const alerts = extractDecayAlerts([makeRS({ daysSinceContact: 65, decayDays: 65 })]);
    expect(alerts[0].priority).toBe("high");
  });

  it("classifies 30-59 days as medium priority", () => {
    const alerts = extractDecayAlerts([makeRS({ daysSinceContact: 45, decayDays: 45 })]);
    expect(alerts[0].priority).toBe("medium");
  });

  it("sorts results by daysSilent descending", () => {
    const scores = [
      makeRS({ investorId: "a", daysSinceContact: 40, decayDays: 40 }),
      makeRS({ investorId: "b", daysSinceContact: 100, decayDays: 100 }),
    ];
    const alerts = extractDecayAlerts(scores);
    expect(alerts[0].investorId).toBe("b");
  });

  it("uses active-diligence message for active temperature", () => {
    const s = makeRS({ temperature: "active", investorName: "Test LP" });
    const alerts = extractDecayAlerts([s]);
    expect(alerts[0].suggestedAction).toContain("fund update");
  });
});
