// Tests for gate enforcement by blast radius — reusing lib/gates.ts, never a
// parallel model, and PROACTIVE TIGHTENS gates (never loosens).
import { resolveProactiveGate } from "./gate";
import type { ProactiveCandidate, ProvenancedClaim } from "./types";
import type { ActionKind, Mandate } from "@/lib/gates";

function candidate(sendAction: ActionKind, claims: ProvenancedClaim[] = []): ProactiveCandidate {
  return {
    signal: {
      triggerKey: "t",
      hub: "source",
      signalClass: claims.length ? "market" : "internal",
      subjectType: "investor",
      subjectId: "1",
      subjectName: "LP",
      summary: "s",
      occurredAt: new Date().toISOString(),
      baseConfidence: 60,
      baseUrgency: 60,
      metadata: {},
    },
    sendAction,
    claims,
    objective: "o",
    title: "t",
  };
}

const claim: ProvenancedClaim = {
  claim: "DPI top-quartile (P85 vs 2021 vintage)",
  source: "carta",
  asOf: "2026-07-01",
  confidence: 0.9,
  verified: true,
};

describe("resolveProactiveGate — blast radius", () => {
  it("Tier 2 external send requires operator sign-off by default", () => {
    const g = resolveProactiveGate(candidate("send_outreach"));
    expect(g.sendTier).toBe(2);
    expect(g.requiresApproval).toBe(true);
    expect(g.nonSkippable).toBe(false);
    expect(g.draftAutoRuns).toBe(true);
  });

  it("Tier 3 compliance/capital-binding is non-skippable and never delegable", () => {
    const g = resolveProactiveGate(candidate("move_capital"));
    expect(g.sendTier).toBe(3);
    expect(g.nonSkippable).toBe(true);
    expect(g.requiresApproval).toBe(true);
  });

  it("a mandate cannot lift a Tier 3 send", () => {
    const mandate: Mandate = { autoApprove: ["move_capital"], autonomyCeiling: 2 };
    const g = resolveProactiveGate(candidate("move_capital"), { mandate });
    expect(g.requiresApproval).toBe(true);
    expect(g.nonSkippable).toBe(true);
  });

  it("a mandate CAN pre-authorize a Tier 2 send (gate reuse, not fork)", () => {
    const mandate: Mandate = { autoApprove: ["send_outreach"], autonomyCeiling: 2 };
    const g = resolveProactiveGate(candidate("send_outreach"), { mandate });
    expect(g.sendTier).toBe(2);
    expect(g.requiresApproval).toBe(false);
  });
});

describe("resolveProactiveGate — external data tightens the gate", () => {
  it("floors an internal-tier send to investor-facing when it carries PMI claims", () => {
    // draft_message is Tier 1 alone; with an external claim it must not auto-send.
    const g = resolveProactiveGate(candidate("draft_message", [claim]));
    expect(g.externallyGrounded).toBe(true);
    expect(g.sendTier).toBe(2);
    expect(g.requiresApproval).toBe(true);
    expect(g.reason).toMatch(/externally grounded/i);
  });

  it("a mandate-pre-authorized Tier 2 send falls back to the human gate when the backing is unverifiable", () => {
    const mandate: Mandate = { autoApprove: ["send_outreach"], autonomyCeiling: 2 };
    const g = resolveProactiveGate(candidate("send_outreach", [claim]), {
      mandate,
      backingVerifiable: false,
    });
    expect(g.requiresApproval).toBe(true);
  });
});
