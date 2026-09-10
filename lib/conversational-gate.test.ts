// Coverage for the pre-flight credit gate the conversational AI routes (chat,
// followups, clarify, prompt planning, meeting analysis) now share. Before
// this, these routes called Claude directly with zero cost metering — a
// scripted loop against any one of them had no bound at all.

const spendCredits = jest.fn();
const paywallFor = jest.fn();
jest.mock("@/lib/credits", () => ({ spendCredits: (...a: unknown[]) => spendCredits(...a) }));
jest.mock("@/lib/paywall.server", () => ({ paywallFor: (...a: unknown[]) => paywallFor(...a) }));

import { anthropicConfigured, gateConversationalSpend, CONVERSATIONAL_COST } from "./conversational-gate";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("anthropicConfigured", () => {
  it("is false with no ANTHROPIC_API_KEY", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(anthropicConfigured()).toBe(false);
  });

  it("is true once ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(anthropicConfigured()).toBe(true);
  });
});

describe("gateConversationalSpend", () => {
  it("is a no-op (always ok, never spends) when Claude isn't configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await gateConversationalSpend("org-1", CONVERSATIONAL_COST.chat, "chat");
    expect(result).toEqual({ ok: true });
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("debits the given cost and succeeds when the org has enough credits", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    spendCredits.mockResolvedValue({ ok: true, balance: 97 });

    const result = await gateConversationalSpend("org-1", CONVERSATIONAL_COST.chat, "chat");

    expect(result).toEqual({ ok: true });
    expect(spendCredits).toHaveBeenCalledWith("org-1", CONVERSATIONAL_COST.chat, "chat");
  });

  it("rejects with a 402-shaped result and a clear message when credits are insufficient", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    spendCredits.mockResolvedValue({ ok: false, insufficient: true, balance: 0 });
    paywallFor.mockResolvedValue(null);

    const result = await gateConversationalSpend("org-1", CONVERSATIONAL_COST.meetingAnalyze, "meeting_analyze");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(402);
    expect(result.error).toContain("Insufficient credits");
    expect(result.error).toContain(String(CONVERSATIONAL_COST.meetingAnalyze));
    // A grandfathered org gets no wall to click, so the refusal has to say
    // where to go instead of handing over a bare number.
    expect(result.error).toContain("Wallet");
  });

  it("carries the paywall so the caller can resolve it in place", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    spendCredits.mockResolvedValue({ ok: false, insufficient: true, balance: 1 });
    paywallFor.mockResolvedValue({
      reason: "insufficient_credits",
      balance: 1,
      required: 3,
      recommendedPlan: "pro",
      canUnlockOnCommitment: true,
      message: "This needs 3 credits and you have 1.",
    });

    const result = await gateConversationalSpend("org-1", CONVERSATIONAL_COST.chat, "chat");

    expect(result.status).toBe(402);
    expect(result.paywall).toMatchObject({ recommendedPlan: "pro", canUnlockOnCommitment: true });
    // The wall's own wording wins — it names the shortfall and the way out.
    expect(result.error).toBe("This needs 3 credits and you have 1.");
  });

  it("still refuses cleanly when the paywall lookup itself fails", async () => {
    // The refusal is already decided; a lookup failure must not turn a 402 into
    // a 500 and hand the operator a crash instead of an explanation.
    process.env.ANTHROPIC_API_KEY = "sk-test";
    spendCredits.mockResolvedValue({ ok: false, insufficient: true, balance: 0 });
    paywallFor.mockRejectedValue(new Error("db down"));

    const result = await gateConversationalSpend("org-1", CONVERSATIONAL_COST.chat, "chat");

    expect(result.status).toBe(402);
    expect(result.paywall).toBeUndefined();
    expect(result.error).toContain("Insufficient credits");
  });
});
