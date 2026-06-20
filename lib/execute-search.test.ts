// lib/execute-search.test.ts
// Unit tests for the Execute-hub planner's pure paths: the deterministic keyword
// fallback and the model-output normalizer. No network or database is touched
// (ANTHROPIC_API_KEY is unset in the test env).
import { planExecuteSearch, type ExecuteSearchPlan, __test } from "@/lib/execute-search";

const { EXECUTE_AGENTS, coerceAgent, fallbackPlan, normalizePlan } = __test;

describe("coerceAgent", () => {
  it("accepts the three Execute agents and rejects others", () => {
    expect(coerceAgent("investor_relations")).toBe("investor_relations");
    expect(coerceAgent("portfolio_ops")).toBe("portfolio_ops");
    expect(coerceAgent("fund_admin")).toBe("fund_admin");
    expect(coerceAgent("associate")).toBeNull();
    expect(coerceAgent("analyst")).toBeNull();
    expect(coerceAgent(123)).toBeNull();
  });
});

describe("fallbackPlan (Earn planner, no API key)", () => {
  it("routes LP/report language to investor_relations", () => {
    const plan = fallbackPlan("Draft this quarter's LP update");
    expect(plan.steps.map((s) => s.agent)).toContain("investor_relations");
  });

  it("routes capital-call/accounting language to fund_admin", () => {
    const plan = fallbackPlan("Summarize the capital calls and waterfall due");
    expect(plan.steps.map((s) => s.agent)).toContain("fund_admin");
  });

  it("routes KPI/portfolio language to portfolio_ops", () => {
    const plan = fallbackPlan("Portfolio KPI and budget variance flags this month");
    expect(plan.steps.map((s) => s.agent)).toContain("portfolio_ops");
  });

  it("defaults to IR + Fund Admin when nothing matches", () => {
    const plan = fallbackPlan("hello there");
    expect(plan.steps.map((s) => s.agent)).toEqual(["investor_relations", "fund_admin"]);
  });

  it("dedupes agents and caps at four steps", () => {
    const plan = fallbackPlan("lp update report distribution capital call fee accounting kpi budget portfolio");
    expect(plan.steps.length).toBeLessThanOrEqual(4);
    const agents = plan.steps.map((s) => s.agent);
    expect(new Set(agents).size).toBe(agents.length);
    for (const a of agents) expect(EXECUTE_AGENTS).toContain(a);
  });

  it("seeds every step instruction with the prompt", () => {
    const plan = fallbackPlan("Draft the LP update");
    for (const s of plan.steps) expect(s.instruction).toBe("Draft the LP update");
  });
});

describe("normalizePlan", () => {
  it("drops unknown agents and keeps valid ones in order", () => {
    const plan = normalizePlan(
      {
        summary: "Test",
        steps: [
          { agent: "investor_relations", title: "Update", instruction: "i1" },
          { agent: "associate", title: "bad", instruction: "x" },
          { agent: "fund_admin", title: "Calls", instruction: "i2" },
        ],
      } as never,
      "fallback prompt",
    );
    expect(plan.steps.map((s) => s.agent)).toEqual(["investor_relations", "fund_admin"]);
    expect(plan.summary).toBe("Test");
  });

  it("falls back when no valid steps remain", () => {
    const plan = normalizePlan({ summary: "x", steps: [{ agent: "analyst", title: "t", instruction: "q" }] } as never, "draft LP update");
    expect(plan.steps.length).toBeGreaterThan(0);
    for (const s of plan.steps) expect(EXECUTE_AGENTS).toContain(s.agent);
  });

  it("caps at four steps and fills missing title/instruction", () => {
    const plan = normalizePlan(
      {
        summary: "",
        steps: [
          { agent: "investor_relations" },
          { agent: "portfolio_ops" },
          { agent: "fund_admin" },
          { agent: "investor_relations" },
          { agent: "portfolio_ops" },
        ],
      } as never,
      "the original prompt",
    );
    expect(plan.steps.length).toBe(4);
    for (const s of plan.steps) {
      expect(s.title).toBeTruthy();
      expect(s.instruction).toBe("the original prompt");
    }
    expect(plan.summary).toContain("the original prompt");
  });
});

describe("planExecuteSearch (fallback, no API key)", () => {
  it("returns a usable plan with 1–4 Execute-agent steps", async () => {
    const plan: ExecuteSearchPlan = await planExecuteSearch("Draft this quarter's LP update");
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(plan.steps.length).toBeLessThanOrEqual(4);
    for (const s of plan.steps) {
      expect(EXECUTE_AGENTS).toContain(s.agent);
      expect(s.title).toBeTruthy();
      expect(s.instruction).toBeTruthy();
    }
  });
});
