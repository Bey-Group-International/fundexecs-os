// lib/gates.test.ts
// Unit tests for the gate layer — the control primitive for autonomous action.
// The critical invariant under test: Tier 3 is NEVER delegable, no matter how
// permissive a mandate claims to be.
import {
  tierForAction,
  gateDecision,
  TIER_LABEL,
  TIER_DESCRIPTION,
  type ActionKind,
  type GateTier,
  type Mandate,
} from "@/lib/gates";

const TIER_1_ACTIONS: ActionKind[] = [
  "draft_message",
  "draft_memo",
  "update_pipeline",
  "score",
  "research",
  "build_list",
];

const TIER_2_ACTIONS: ActionKind[] = [
  "send_outreach",
  "send_intro_request",
  "share_materials",
  "send_diligence_request",
  "distribute_report",
];

const TIER_3_ACTIONS: ActionKind[] = [
  "sign_document",
  "submit_term_sheet",
  "move_capital",
  "capital_call",
  "execute_subdoc",
];

const ALL_ACTIONS: ActionKind[] = [
  ...TIER_1_ACTIONS,
  ...TIER_2_ACTIONS,
  ...TIER_3_ACTIONS,
];

describe("tierForAction", () => {
  it.each(TIER_1_ACTIONS)("classifies %s as Tier 1", (action) => {
    expect(tierForAction(action)).toBe(1);
  });

  it.each(TIER_2_ACTIONS)("classifies %s as Tier 2", (action) => {
    expect(tierForAction(action)).toBe(2);
  });

  it.each(TIER_3_ACTIONS)("classifies %s as Tier 3", (action) => {
    expect(tierForAction(action)).toBe(3);
  });

  it("maps every known action to exactly one tier", () => {
    const tiers = ALL_ACTIONS.map(tierForAction);
    expect(tiers).toHaveLength(16);
    expect(tiers.every((t) => t === 1 || t === 2 || t === 3)).toBe(true);
  });
});

describe("TIER_LABEL and TIER_DESCRIPTION", () => {
  it("has a label and description for each tier", () => {
    ([1, 2, 3] as GateTier[]).forEach((t) => {
      expect(typeof TIER_LABEL[t]).toBe("string");
      expect(TIER_LABEL[t].length).toBeGreaterThan(0);
      expect(typeof TIER_DESCRIPTION[t]).toBe("string");
      expect(TIER_DESCRIPTION[t].length).toBeGreaterThan(0);
    });
  });
});

describe("gateDecision — Tier 1 (internal)", () => {
  it.each(TIER_1_ACTIONS)("never requires approval for %s", (action) => {
    const decision = gateDecision(action);
    expect(decision.tier).toBe(1);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.reason).toBe(TIER_DESCRIPTION[1]);
  });

  it("stays free even when a (nonsensical) mandate is supplied", () => {
    const mandate: Mandate = { autoApprove: [], autonomyCeiling: 1 };
    expect(gateDecision("draft_memo", mandate).requiresApproval).toBe(false);
  });
});

describe("gateDecision — Tier 3 (capital-binding) safety invariant", () => {
  it.each(TIER_3_ACTIONS)("always requires approval for %s with no mandate", (action) => {
    const decision = gateDecision(action);
    expect(decision.tier).toBe(3);
    expect(decision.requiresApproval).toBe(true);
  });

  it.each(TIER_3_ACTIONS)(
    "always requires approval for %s even with a maximally permissive mandate",
    (action) => {
      // The most permissive mandate possible: ceiling at 3, every Tier-3 action
      // explicitly pre-authorized. Tier 3 must STILL be gated — this is the
      // structural line a COO can never cross.
      const mandate: Mandate = {
        autoApprove: [...TIER_3_ACTIONS, action],
        autonomyCeiling: 3,
      };
      const decision = gateDecision(action, mandate);
      expect(decision.tier).toBe(3);
      expect(decision.requiresApproval).toBe(true);
    },
  );
});

describe("gateDecision — Tier 2 (external-facing)", () => {
  it.each(TIER_2_ACTIONS)("is gated by default (no mandate) for %s", (action) => {
    const decision = gateDecision(action);
    expect(decision.tier).toBe(2);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toBe(TIER_DESCRIPTION[2]);
  });

  it("is NOT gated when a mandate pre-authorizes the action within ceiling >= 2", () => {
    const mandate: Mandate = {
      autoApprove: ["send_outreach"],
      autonomyCeiling: 2,
    };
    const decision = gateDecision("send_outreach", mandate);
    expect(decision.tier).toBe(2);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.reason).toBe("Pre-authorized by your active mandate.");
  });

  it("is NOT gated when ceiling is 3 and the action is pre-authorized", () => {
    const mandate: Mandate = {
      autoApprove: ["distribute_report"],
      autonomyCeiling: 3,
    };
    expect(gateDecision("distribute_report", mandate).requiresApproval).toBe(false);
  });

  it("stays gated when the ceiling is only 1, even if pre-authorized", () => {
    const mandate: Mandate = {
      autoApprove: ["send_outreach"],
      autonomyCeiling: 1,
    };
    const decision = gateDecision("send_outreach", mandate);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toBe(TIER_DESCRIPTION[2]);
  });

  it("stays gated when the action is not in the mandate's autoApprove list", () => {
    const mandate: Mandate = {
      autoApprove: ["send_outreach"],
      autonomyCeiling: 2,
    };
    const decision = gateDecision("share_materials", mandate);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toBe(TIER_DESCRIPTION[2]);
  });

  it("stays gated when the mandate authorizes only Tier-3 actions (irrelevant to Tier 2)", () => {
    const mandate: Mandate = {
      autoApprove: ["move_capital"],
      autonomyCeiling: 2,
    };
    expect(gateDecision("send_outreach", mandate).requiresApproval).toBe(true);
  });
});

describe("gateDecision — trust layer (verification-aware auto-approve)", () => {
  const mandate: Mandate = { autoApprove: ["send_outreach"], autonomyCeiling: 2 };

  it("revokes the auto-approve bypass when the backing output is unverifiable", () => {
    const decision = gateDecision("send_outreach", mandate, { verifiable: false });
    expect(decision.tier).toBe(2);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toContain("sign-off required");
  });

  it("still auto-approves when the backing output is verifiable", () => {
    const decision = gateDecision("send_outreach", mandate, { verifiable: true });
    expect(decision.requiresApproval).toBe(false);
    expect(decision.reason).toBe("Pre-authorized by your active mandate.");
  });

  it("does not affect Tier-1 internal work even when unverifiable", () => {
    expect(gateDecision("draft_message", mandate, { verifiable: false }).requiresApproval).toBe(false);
  });

  it("leaves Tier-3 always gated regardless of backing", () => {
    expect(gateDecision("move_capital", mandate, { verifiable: true }).requiresApproval).toBe(true);
  });

  it("is a no-op when no backing is supplied (unchanged behavior)", () => {
    expect(gateDecision("send_outreach", mandate).requiresApproval).toBe(false);
  });

  it("does not relax a non-pre-authorized action just because it is verifiable", () => {
    expect(gateDecision("share_materials", mandate, { verifiable: true }).requiresApproval).toBe(true);
  });
});
