// lib/gates.test.ts
// Unit tests for the gate layer — the control primitive for autonomous action.
// The critical invariant under test: Tier 3 is NEVER delegable, no matter how
// permissive a mandate claims to be.
import {
  tierForAction,
  gateDecision,
  blastRadiusBreach,
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

describe("blastRadiusBreach", () => {
  it("returns null when there are no rules or no context", () => {
    expect(blastRadiusBreach(undefined, { targetDomain: "acme.com" })).toBeNull();
    expect(blastRadiusBreach({ forbiddenDomains: ["acme.com"] }, undefined)).toBeNull();
    expect(blastRadiusBreach({}, {})).toBeNull();
  });

  it("flags a target on the forbidden-domain list", () => {
    expect(
      blastRadiusBreach({ forbiddenDomains: ["acme.com"] }, { targetDomain: "acme.com" }),
    ).toContain("do-not-contact");
  });

  it("matches subdomains and normalizes email/protocol/www", () => {
    const br = { forbiddenDomains: ["acme.com"] };
    expect(blastRadiusBreach(br, { targetDomain: "gp@ir.acme.com" })).not.toBeNull();
    expect(blastRadiusBreach(br, { targetDomain: "https://www.acme.com/contact" })).not.toBeNull();
    expect(blastRadiusBreach(br, { targetDomain: "notacme.com" })).toBeNull();
  });

  it("flags an amount over the per-action dollar ceiling but not at or under it", () => {
    const br = { maxDollarPerAction: 50_000 };
    expect(blastRadiusBreach(br, { dollarAmount: 50_001 })).toContain("per-action ceiling");
    expect(blastRadiusBreach(br, { dollarAmount: 50_000 })).toBeNull();
  });

  it("flags when the daily send cap has been reached", () => {
    const br = { maxOutreachPerDay: 25 };
    expect(blastRadiusBreach(br, { sendsToday: 25 })).toContain("daily automated-send cap");
    expect(blastRadiusBreach(br, { sendsToday: 24 })).toBeNull();
  });
});

describe("gateDecision — blast-radius layer", () => {
  const mandate: Mandate = {
    autoApprove: ["send_outreach"],
    autonomyCeiling: 2,
    blastRadius: {
      forbiddenDomains: ["competitor.com"],
      maxOutreachPerDay: 25,
      maxDollarPerAction: 50_000,
    },
  };

  it("revokes auto-approve when the target is a forbidden domain", () => {
    const decision = gateDecision("send_outreach", mandate, undefined, {
      targetDomain: "team@competitor.com",
    });
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toContain("do-not-contact");
  });

  it("still auto-approves when the target is allowed", () => {
    const decision = gateDecision("send_outreach", mandate, undefined, {
      targetDomain: "gp@friendly.com",
    });
    expect(decision.requiresApproval).toBe(false);
  });

  it("revokes auto-approve when the daily send cap is hit", () => {
    const decision = gateDecision("send_outreach", mandate, undefined, { sendsToday: 25 });
    expect(decision.requiresApproval).toBe(true);
    expect(decision.reason).toContain("daily automated-send cap");
  });

  it("is a no-op when no context is supplied (unchanged behavior)", () => {
    expect(gateDecision("send_outreach", mandate).requiresApproval).toBe(false);
  });

  it("never gates a non-pre-authorized action any less — blast radius only tightens", () => {
    // share_materials is not pre-authorized, so it is gated regardless of context.
    expect(
      gateDecision("share_materials", mandate, undefined, { targetDomain: "friendly.com" })
        .requiresApproval,
    ).toBe(true);
  });

  it("leaves Tier-3 always gated regardless of blast-radius context", () => {
    expect(
      gateDecision("move_capital", mandate, undefined, { dollarAmount: 1 }).requiresApproval,
    ).toBe(true);
  });
});
