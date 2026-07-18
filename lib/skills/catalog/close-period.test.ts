// Golden tests for the close-period deterministic core.
import { closePeriod, type ClosePeriodInput } from "./close-period";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "fund_admin" };
const run = (input: ClosePeriodInput) => closePeriod.run(input, ctx);

const ALL_TASKS = ["bank_recs", "accruals", "capital_activity", "fee_calc", "nav_tieout", "lp_statements", "subdoc_updates", "investor_reporting"];

describe("close-period core", () => {
  it("assembles all eight canonical tasks in canonical order, all open with no input", () => {
    const r = run({ fundName: "Fund I" });
    expect(r.structured.checklist.map((c) => c.key)).toEqual(ALL_TASKS);
    expect(r.structured.totalTasks).toBe(8);
    expect(r.structured.completeCount).toBe(0);
    expect(r.structured.readiness).toBe(0);
    expect(r.structured.checklist.every((c) => c.status === "open")).toBe(true);
    expect(r.structured.openTasks).toHaveLength(8);
  });

  it("marks only the operator-supplied tasks complete and computes rounded readiness", () => {
    const r = run({ fundName: "Fund II", periodEnd: "2026-06-30", tasksComplete: ["bank_recs", "accruals", "capital_activity"] });
    expect(r.structured.completeCount).toBe(3);
    expect(r.structured.readiness).toBe(0.38); // round(3/8, 2)
    const complete = r.structured.checklist.filter((c) => c.status === "complete").map((c) => c.key);
    expect(complete).toEqual(["bank_recs", "accruals", "capital_activity"]);
    // A task marked done is recorded as a FACT, never fabricated.
    expect(r.sources.some((s) => s.kind === "fact" && s.ref === "task:bank_recs")).toBe(true);
  });

  it("reaches readiness 1 when every canonical task is complete", () => {
    const r = run({ fundName: "Fund III", periodEnd: "2026-06-30", tasksComplete: ALL_TASKS });
    expect(r.structured.readiness).toBe(1);
    expect(r.structured.completeCount).toBe(8);
    expect(r.structured.openTasks).toEqual([]);
  });

  it("flags a missing periodEnd instead of inventing it", () => {
    const r = run({ fundName: "Fund IV" });
    expect(r.structured.missingFields.some((m) => /period-end/i.test(m))).toBe(true);
    expect(r.missingData).toEqual(r.structured.missingFields);
    // Nothing fabricated: no fact source carries a period-end value.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Period-end")).toBe(false);
  });

  it("ignores unknown task keys — only canonical keys count toward readiness", () => {
    const r = run({ fundName: "Fund V", tasksComplete: ["bank_recs", "not_a_real_task"] });
    expect(r.structured.completeCount).toBe(1);
    expect(r.structured.checklist.map((c) => c.key)).toEqual(ALL_TASKS);
  });

  it("GUARDRAIL: recommendedAction always states closing is a Tier-3 action requiring human authorization", () => {
    const incomplete = run({ fundName: "Fund VI", tasksComplete: ["bank_recs"] });
    expect(incomplete.structured.recommendedAction).toMatch(/Resolve open items before requesting close/i);
    expect(incomplete.structured.recommendedAction).toMatch(/Tier-3 action requiring explicit human authorization/i);

    const ready = run({ fundName: "Fund VI", tasksComplete: ALL_TASKS });
    // Even when fully ready, it never closes — it only recommends REQUESTING close.
    expect(ready.structured.recommendedAction).toMatch(/Tier-3 action requiring explicit human authorization/i);
    expect(ready.structured.recommendedAction).toMatch(/never performed by this skill/i);
  });

  it("GUARDRAIL: the skill never lists a close/post action among its permitted actions", () => {
    const prohibited = closePeriod.manifest.prohibitedActions;
    expect(prohibited).toEqual(expect.arrayContaining(["close_period", "post_to_closed_period", "reopen_period", "post_journal_entry"]));
    expect(closePeriod.manifest.approvalTier).toBe(1); // PREPARING is Tier 1; closing is not this skill's to do
    expect(closePeriod.manifest.tools).toEqual([]);
  });

  it("always produces a recommended action and a narrative that says it only prepares", () => {
    const r = run({ fundName: "Fund VII" });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.narrative).toMatch(/never closes, reopens, or posts/i);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});
