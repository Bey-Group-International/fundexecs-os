// Verifies Earn's directive planner on its deterministic path. With no
// ANTHROPIC_API_KEY (the test/CI environment), planEarnDirective returns the
// fallback plan — so these assertions cover delegate-vs-execute selection and
// the plan shape without a network call. The Claude-backed path returns the
// same EarnPlan shape, normalized by the same code.
import { planEarnDirective, fallbackPlan } from "./earn-plan";

describe("planEarnDirective (no-key fallback)", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  beforeAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterAll(() => {
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  });

  it("routes a campaign-style directive to delegate (A)", async () => {
    const plan = await planEarnDirective({ prompt: "Open an outbound raise for Fund IV" });
    expect(plan.kind).toBe("A");
    expect(plan.bullets.length).toBeGreaterThanOrEqual(2);
    expect(plan.recommendation).toBeTruthy();
    expect(plan.closing).toBeTruthy();
  });

  it("routes a reasoning-style directive to execute (B)", async () => {
    const plan = await planEarnDirective({ prompt: "Tighten the thesis and flag diligence gaps" });
    expect(plan.kind).toBe("B");
  });

  it("never throws — always returns a usable plan", async () => {
    const plan = await planEarnDirective({ prompt: "" });
    expect(plan.kind === "A" || plan.kind === "B").toBe(true);
    expect(plan.bullets.length).toBeGreaterThan(0);
  });
});

describe("fallbackPlan", () => {
  it("produces bullets in both branches and picks kind by intent", () => {
    expect(fallbackPlan("run a raise").kind).toBe("A");
    expect(fallbackPlan("run a raise").bullets.length).toBeGreaterThanOrEqual(2);
    expect(fallbackPlan("draft a memo").kind).toBe("B");
    expect(fallbackPlan("draft a memo").bullets.length).toBeGreaterThanOrEqual(2);
  });
});
