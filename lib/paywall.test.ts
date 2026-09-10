import {
  PAYWALL_EFFECTIVE_FROM,
  evaluatePaywall,
  isGrandfathered,
  paywallMessage,
  paywallPayload,
  recommendedPlanFor,
  type PaywallInput,
} from "@/lib/paywall";

const AFTER = "2026-10-01T00:00:00.000Z";
const BEFORE = "2026-08-01T00:00:00.000Z";

function input(overrides: Partial<PaywallInput> = {}): PaywallInput {
  return {
    balance: 1,
    required: 3,
    orgCreatedAt: AFTER,
    hasPlan: false,
    hasUnpaidHistory: false,
    ...overrides,
  };
}

describe("grandfathering", () => {
  it("exempts organizations that predate the wall", () => {
    // People already using the product did not agree to a paywall.
    expect(isGrandfathered(BEFORE)).toBe(true);
    expect(isGrandfathered(AFTER)).toBe(false);
    expect(isGrandfathered(PAYWALL_EFFECTIVE_FROM)).toBe(false);
  });

  it("never walls an org whose age we cannot establish", () => {
    // Failing open is the only safe direction: a missing or malformed timestamp
    // must not lock a real customer out of a product they are paying for.
    expect(isGrandfathered(null)).toBe(true);
    expect(isGrandfathered(undefined)).toBe(true);
    expect(isGrandfathered("not-a-date")).toBe(true);
  });

  it("lets a grandfathered org act even with no credits at all", () => {
    const state = evaluatePaywall(input({ orgCreatedAt: BEFORE, balance: 0 }));
    expect(state.walled).toBe(false);
    expect(state.grandfathered).toBe(true);
  });
});

describe("the wall", () => {
  it("does not fire while the action is affordable", () => {
    expect(evaluatePaywall(input({ balance: 3, required: 3 })).walled).toBe(false);
    expect(evaluatePaywall(input({ balance: 100, required: 3 })).walled).toBe(false);
  });

  it("fires the moment an action costs more than the balance", () => {
    const state = evaluatePaywall(input({ balance: 2, required: 3 }));
    expect(state.walled).toBe(true);
    expect(state.reason).toBe("insufficient_credits");
    expect(state.shortfall).toBe(1);
  });
});

describe("what gets offered", () => {
  it("recommends a plan big enough to actually clear the wall", () => {
    // Recommending a plan too small would put someone through checkout and
    // leave them exactly where they started.
    expect(recommendedPlanFor(100)).toBe("starter");
    expect(recommendedPlanFor(3000)).toBe("pro");
    expect(recommendedPlanFor(12000)).toBe("scale");
  });

  it("sizes on recent burn, not just the blocked action", () => {
    // A 3-credit action for someone burning 5,000/month is not a Starter case.
    expect(recommendedPlanFor(3, 5000)).toBe("scale");
  });

  it("falls back to the largest plan rather than recommending nothing", () => {
    expect(recommendedPlanFor(999_999)).toBe("scale");
  });
});

describe("unlock on commitment", () => {
  it("lets a first-time subscriber clear the wall in one click", () => {
    const state = evaluatePaywall(input({ balance: 0 }));
    expect(state.canUnlockOnCommitment).toBe(true);
    expect(paywallMessage(state)).toMatch(/right now/i);
  });

  it("refuses a second period on credit to an org that never paid for the first", () => {
    // Extending credit twice to someone who did not settle is how a capped
    // exposure stops being capped.
    const state = evaluatePaywall(input({ balance: 0, hasUnpaidHistory: true }));
    expect(state.walled).toBe(true);
    expect(state.canUnlockOnCommitment).toBe(false);
    expect(paywallMessage(state)).toMatch(/settle your outstanding invoice/i);
  });

  it("treats an existing plan-holder as topping up, not subscribing", () => {
    const state = evaluatePaywall(input({ balance: 0, hasPlan: true }));
    expect(state.canUnlockOnCommitment).toBe(false);
  });

  it("answers eligibility even when nothing is currently walled", () => {
    // The commit path asks with required: 0 — it wants to know whether this org
    // MAY take a period on credit, not whether some action is affordable.
    // Deciding that only in the walled branch refused every commit.
    const eligible = evaluatePaywall(input({ balance: 5, required: 0 }));
    expect(eligible.walled).toBe(false);
    expect(eligible.canUnlockOnCommitment).toBe(true);

    const notEligible = evaluatePaywall(input({ balance: 5, required: 0, hasUnpaidHistory: true }));
    expect(notEligible.canUnlockOnCommitment).toBe(false);
  });
});

describe("the payload a blocked route hands back", () => {
  it("carries the numbers the wall needs to explain itself", () => {
    const payload = paywallPayload(evaluatePaywall(input({ balance: 1, required: 4 })));
    expect(payload).toMatchObject({
      reason: "insufficient_credits",
      balance: 1,
      required: 4,
      canUnlockOnCommitment: true,
    });
    expect(payload?.message).toContain("4 credits");
    expect(payload?.message).toContain("you have 1");
  });

  it("is null when nothing is blocked, so a caller cannot render a phantom wall", () => {
    expect(paywallPayload(evaluatePaywall(input({ balance: 50 })))).toBeNull();
    expect(paywallPayload(evaluatePaywall(input({ orgCreatedAt: BEFORE, balance: 0 })))).toBeNull();
  });
});
