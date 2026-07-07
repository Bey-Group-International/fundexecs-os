// Coverage for the pure plan-summary row builder used by plan history.

import { planSummaryRow } from "./plan-history";
import type { ProspectingPlan } from "./prospecting-copilot";

function plan(overrides: Partial<ProspectingPlan> = {}): ProspectingPlan {
  return {
    goal: { goal: "raise_capital", persona: "LPs", keywords: [], targetRoles: [], agentKey: "capital_raiser", sequenceKey: "lp_warm_intro" },
    status: "draft",
    requiresApproval: true,
    persona: "Institutional allocators",
    prospects: [{} as never, {} as never, {} as never],
    segments: { high: [], medium: [], low: [] },
    readyForOutreach: [{} as never, {} as never],
    heldForReview: [{} as never],
    routedAgent: "capital_raiser",
    sequenceKey: "lp_warm_intro",
    outreachAngle: "",
    nextActions: [],
    ...overrides,
  };
}

describe("planSummaryRow", () => {
  it("derives counts and metadata from a plan", () => {
    const row = planSummaryRow(plan(), "  Raise capital for Fund I  ");
    expect(row.goal_text).toBe("Raise capital for Fund I"); // trimmed
    expect(row.goal_key).toBe("raise_capital");
    expect(row.routed_agent).toBe("capital_raiser");
    expect(row.prospect_count).toBe(3);
    expect(row.ready_count).toBe(2);
    expect(row.held_count).toBe(1);
  });

  it("caps an overlong goal string", () => {
    const row = planSummaryRow(plan(), "x".repeat(1000));
    expect(row.goal_text.length).toBe(500);
  });
});
