// lib/next-best-action.test.ts
import {
  nbaFromDecayAlerts,
  nbaFromRelationshipScores,
  buildNBAList,
  formatDueLabel,
} from "@/lib/next-best-action";
import type { DecayAlert } from "@/lib/relationship-score";
import type { RelationshipScore } from "@/lib/relationship-score";

// --- Fixtures ----------------------------------------------------------------
function makeAlert(overrides: Partial<DecayAlert> = {}): DecayAlert {
  return {
    investorId: "inv-1",
    investorName: "Acme Capital",
    daysSilent: 45,
    lastContactAt: "2025-12-01T00:00:00Z",
    priority: "medium",
    suggestedAction: "Re-engage with a check-in.",
    ...overrides,
  };
}

function makeScore(overrides: Partial<RelationshipScore> = {}): RelationshipScore {
  return {
    investorId: "inv-1",
    investorName: "Acme Capital",
    score: 60,
    temperature: "active",
    lastContactAt: "2025-12-01T00:00:00Z",
    daysSinceContact: 15,
    interactionCount: 5,
    decayAlert: false,
    decayDays: null,
    scoreBreakdown: { recency: 28, frequency: 18, dealOverlap: 12, introValue: 2 },
    ...overrides,
  };
}

// --- nbaFromDecayAlerts ------------------------------------------------------
describe("nbaFromDecayAlerts", () => {
  it("returns empty array for no alerts", () => {
    expect(nbaFromDecayAlerts([])).toEqual([]);
  });

  it("maps a critical alert to priority 95", () => {
    const items = nbaFromDecayAlerts([makeAlert({ priority: "critical" })]);
    expect(items[0].priority).toBe(95);
  });

  it("maps a high alert to priority 80", () => {
    const items = nbaFromDecayAlerts([makeAlert({ priority: "high" })]);
    expect(items[0].priority).toBe(80);
  });

  it("maps a medium alert to priority 65", () => {
    const items = nbaFromDecayAlerts([makeAlert({ priority: "medium" })]);
    expect(items[0].priority).toBe(65);
  });

  it("sets actionType to contact_overdue", () => {
    const items = nbaFromDecayAlerts([makeAlert()]);
    expect(items[0].actionType).toBe("contact_overdue");
  });

  it("limits to 10 items even if more alerts are given", () => {
    const alerts = Array.from({ length: 15 }, (_, i) =>
      makeAlert({ investorId: `inv-${i}` })
    );
    expect(nbaFromDecayAlerts(alerts)).toHaveLength(10);
  });

  it("sets investorId on the NBA item", () => {
    const items = nbaFromDecayAlerts([makeAlert({ investorId: "inv-99" })]);
    expect(items[0].investorId).toBe("inv-99");
  });
});

// --- nbaFromRelationshipScores -----------------------------------------------
describe("nbaFromRelationshipScores", () => {
  it("returns empty for no active stalled scores", () => {
    expect(nbaFromRelationshipScores([])).toEqual([]);
  });

  it("includes active investors with score in [40, 80)", () => {
    const items = nbaFromRelationshipScores([makeScore({ temperature: "active", score: 60 })]);
    expect(items).toHaveLength(1);
    expect(items[0].actionType).toBe("deal_followup");
  });

  it("excludes committed investors", () => {
    const items = nbaFromRelationshipScores([makeScore({ temperature: "committed", score: 60 })]);
    expect(items).toHaveLength(0);
  });

  it("excludes active investors with score >= 80", () => {
    const items = nbaFromRelationshipScores([makeScore({ temperature: "active", score: 85 })]);
    expect(items).toHaveLength(0);
  });

  it("limits to 5 stalled investors", () => {
    const scores = Array.from({ length: 8 }, (_, i) =>
      makeScore({ investorId: `inv-${i}`, score: 55 })
    );
    expect(nbaFromRelationshipScores(scores)).toHaveLength(5);
  });
});

// --- buildNBAList ------------------------------------------------------------
describe("buildNBAList", () => {
  it("returns up to maxItems (default 5)", () => {
    const alerts = Array.from({ length: 4 }, (_, i) =>
      makeAlert({ investorId: `inv-${i}`, priority: "medium" })
    );
    const scores: RelationshipScore[] = [];
    expect(buildNBAList(alerts, scores)).toHaveLength(4);
  });

  it("deduplicates same investor across decay + score items", () => {
    const alerts = [makeAlert({ investorId: "inv-1", priority: "high" })];
    const scores = [makeScore({ investorId: "inv-1", score: 55 })];
    const items = buildNBAList(alerts, scores, { maxItems: 10 });
    const ids = items.map((i) => i.investorId);
    // Should have only 1 item for inv-1
    expect(ids.filter((id) => id === "inv-1")).toHaveLength(1);
  });

  it("sorts by priority descending", () => {
    const alerts = [
      makeAlert({ investorId: "a", priority: "medium" }),
      makeAlert({ investorId: "b", priority: "critical" }),
    ];
    const items = buildNBAList(alerts, [], { maxItems: 10 });
    expect(items[0].investorId).toBe("b");
  });

  it("respects custom maxItems", () => {
    const alerts = Array.from({ length: 6 }, (_, i) =>
      makeAlert({ investorId: `inv-${i}` })
    );
    expect(buildNBAList(alerts, [], { maxItems: 3 })).toHaveLength(3);
  });
});

// --- formatDueLabel ----------------------------------------------------------
describe("formatDueLabel", () => {
  it("returns Today when dueAt is undefined", () => {
    expect(formatDueLabel(undefined)).toBe("Today");
  });

  it("returns Overdue for a past date", () => {
    const past = new Date(Date.now() - 2 * 86400000).toISOString();
    expect(formatDueLabel(past)).toBe("Overdue");
  });

  it("returns Tomorrow for a date exactly 1 day in the future", () => {
    // Math.ceil(exactly 86400000ms / 86400000) = 1
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    expect(formatDueLabel(tomorrow)).toBe("Tomorrow");
  });

  it("returns In N days for multi-day future dates", () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString();
    expect(formatDueLabel(future)).toBe("In 5 days");
  });
});
