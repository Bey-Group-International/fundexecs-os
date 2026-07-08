// Verifies the live-Earn driver's deterministic behavior. With no
// ANTHROPIC_API_KEY (the test/CI environment), planLiveEarn takes its scripted
// fallback path — so these assertions cover flow selection and prompt injection
// without a network call. The Claude-backed overlay shares the same Step[]
// contract, exercised structurally here.
import { planLiveEarn } from "./command-center-live";
import { FLOW_A, FLOW_B } from "./command-center/flows";

function firstUserText(steps: { kind: string; role?: string; text?: string }[]): string | undefined {
  const s = steps.find((x) => x.kind === "say" && x.role === "user");
  return s?.text;
}

describe("planLiveEarn (no-key fallback)", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterAll(() => {
    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("routes a campaign-style directive to Flow A (delegate the team)", async () => {
    const plan = await planLiveEarn({ prompt: "Open an outbound raise for Fund IV" });
    expect(plan.kind).toBe("A");
    expect(plan.steps.length).toBe(FLOW_A.length);
  });

  it("routes a reasoning-style directive to Flow B (Earn executes)", async () => {
    const plan = await planLiveEarn({ prompt: "Tighten the thesis and flag diligence gaps" });
    expect(plan.kind).toBe("B");
    expect(plan.steps.length).toBe(FLOW_B.length);
  });

  it("injects the operator's own words into the opening user line", async () => {
    const prompt = "Line up anchor LPs for the first close";
    const plan = await planLiveEarn({ prompt });
    expect(firstUserText(plan.steps)).toBe(prompt);
  });

  it("preserves the flow choreography (a gateApproval and a done step remain)", async () => {
    const plan = await planLiveEarn({ prompt: "Review the data room for risk flags" });
    const kinds = plan.steps.map((s) => s.kind);
    expect(kinds).toContain("gateApproval");
    expect(kinds[kinds.length - 1]).toBe("done");
  });

  it("never throws — always returns a usable plan", async () => {
    const plan = await planLiveEarn({ prompt: "" });
    expect(plan.kind === "A" || plan.kind === "B").toBe(true);
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
  });
});
