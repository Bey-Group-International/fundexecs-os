// lib/run-search.test.ts
// Unit tests for the Run-hub evaluation planner's pure paths: the deterministic
// keyword fallback and plan normalization used when no model key is present. No
// network or database is touched (ANTHROPIC_API_KEY is unset in the test env).
import { planRunSearch, __test } from "@/lib/run-search";

const { fallbackPlan, normalizePlan, coerceAgent, RUN_AGENTS } = __test;

describe("coerceAgent", () => {
  it("accepts only Run agents and rejects everything else", () => {
    expect(coerceAgent("analyst")).toBe("analyst");
    expect(coerceAgent("diligence")).toBe("diligence");
    expect(coerceAgent("associate")).toBeNull();
    expect(coerceAgent("capital_raiser")).toBeNull();
    expect(coerceAgent(42)).toBeNull();
    for (const a of RUN_AGENTS) expect(coerceAgent(a)).toBe(a);
  });
});

describe("fallbackPlan (Earn planner, no API key)", () => {
  it("routes risk/diligence language to the diligence agent", () => {
    const plan = fallbackPlan("Flag the top risks across diligence");
    const agents = plan.steps.map((s) => s.agent);
    expect(agents).toContain("diligence");
    expect(agents).not.toContain("analyst");
  });

  it("routes modeling/underwriting language to the analyst", () => {
    const plan = fallbackPlan("Stress the base case and report the IRR range");
    const agents = plan.steps.map((s) => s.agent);
    expect(agents).toContain("analyst");
    expect(agents).not.toContain("diligence");
  });

  it("includes both agents when the request implies both", () => {
    const plan = fallbackPlan("Build the underwriting model and flag the diligence risks");
    const agents = plan.steps.map((s) => s.agent);
    expect(agents).toContain("analyst");
    expect(agents).toContain("diligence");
  });

  it("defaults to analyst + diligence when nothing matches", () => {
    const plan = fallbackPlan("hello there");
    expect(plan.steps.map((s) => s.agent)).toEqual(["analyst", "diligence"]);
  });

  it("caps at four steps and always names the owning agent", () => {
    const plan = fallbackPlan("model risk diligence underwriting valuation document irr");
    expect(plan.steps.length).toBeLessThanOrEqual(4);
    for (const s of plan.steps) {
      expect(RUN_AGENTS).toContain(s.agent);
      expect(s.title).toBeTruthy();
      expect(s.instruction).toBeTruthy();
    }
  });
});

describe("normalizePlan", () => {
  it("drops unknown agents and keeps valid Run steps", () => {
    const plan = normalizePlan(
      {
        summary: "Test",
        steps: [
          { agent: "analyst", title: "Model", instruction: "do it" },
          { agent: "capital_raiser", title: "nope", instruction: "x" },
          { agent: "diligence", title: "Risks", instruction: "find them" },
        ],
      } as never,
      "fallback prompt",
    );
    expect(plan.steps.map((s) => s.agent)).toEqual(["analyst", "diligence"]);
    expect(plan.summary).toBe("Test");
  });

  it("falls back when no valid steps remain", () => {
    const plan = normalizePlan(
      { summary: "x", steps: [{ agent: "bad", title: "t", instruction: "q" }] } as never,
      "assess the risks",
    );
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const s of plan.steps) expect(RUN_AGENTS).toContain(s.agent);
  });

  it("falls back when given null", () => {
    const plan = normalizePlan(null, "evaluate my deals");
    expect(plan.steps.length).toBeGreaterThan(0);
  });
});

describe("planRunSearch (fallback, no API key)", () => {
  it("produces a valid plan for an evaluation request", async () => {
    const plan = await planRunSearch("Assess my live deals for IC readiness");
    expect(plan.summary).toBeTruthy();
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.length).toBeLessThanOrEqual(4);
    for (const s of plan.steps) {
      expect(RUN_AGENTS).toContain(s.agent);
      expect(s.title).toBeTruthy();
      expect(s.instruction).toBeTruthy();
    }
  });

  it("handles an empty prompt without throwing", async () => {
    const plan = await planRunSearch("");
    expect(plan.steps.length).toBeGreaterThan(0);
  });
});
