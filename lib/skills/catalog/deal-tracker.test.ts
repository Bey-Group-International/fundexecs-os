// Golden tests for the deal-tracker deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { dealTracker, dealTrackerManifest, type DealTrackerInput } from "./deal-tracker";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "legal_closing" };
const run = (input: DealTrackerInput) => dealTracker.run(input, ctx);

describe("deal-tracker core", () => {
  it("rolls up a supplied milestone set: counts, completion, and overall status", () => {
    const r = run({
      deal: { name: "Project Atlas", stage: "signing", targetCloseDate: "2026-09-30" },
      milestones: [
        { label: "CP checklist", status: "done", owner: "Legal", dueDate: "2026-08-01" },
        { label: "Disclosure schedules", status: "in_progress", owner: "Legal", dueDate: "2026-09-01" },
        { label: "Board consent", status: "not_started", owner: "Corp Sec", dueDate: "2026-09-15" },
        { label: "Funds flow", status: "in_progress", owner: "Finance", dueDate: "2026-09-25" },
      ],
    });
    expect(r.structured.totalMilestones).toBe(4);
    expect(r.structured.byStatus).toEqual({ not_started: 1, in_progress: 2, blocked: 0, done: 1 });
    expect(r.structured.completionPct).toBe(25); // 1 of 4 done
    expect(r.structured.overallStatus).toBe("on_track");
    expect(r.structured.atRisk).toEqual([]);
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });

  it("GUARDRAIL: empty milestone set returns an empty roll-up and never invents milestones", () => {
    const r = run({ deal: { name: "Project Atlas" }, milestones: [] });
    expect(r.structured.tracked).toEqual([]);
    expect(r.structured.totalMilestones).toBe(0);
    expect(r.structured.completionPct).toBe(0);
    expect(r.structured.nextActions).toEqual([]);
    expect(r.structured.overallStatus).toBe("not_started");
    expect(r.structured.missingContext).toContain(
      "No milestones supplied — this skill tracks a provided milestone set; it does not fabricate milestones.",
    );
    // Nothing fabricated: no source carries a milestone.
    expect(r.sources.some((s) => s.label.includes("— milestone"))).toBe(false);
    expect(r.sources.some((s) => s.label.includes("— status"))).toBe(false);
  });

  it("treats a missing milestones field the same as an empty set", () => {
    const r = run({ deal: { name: "Project Atlas" } });
    expect(r.structured.tracked).toEqual([]);
    expect(r.structured.totalMilestones).toBe(0);
    expect(r.structured.missingContext[0]).toContain("does not fabricate milestones");
  });

  it("flags a blocked milestone as at risk and emits an Unblock next action", () => {
    const r = run({
      deal: { name: "Project Atlas" },
      milestones: [
        { label: "Escrow agreement", status: "blocked", owner: "Legal" },
        { label: "KYC pack", status: "done", owner: "Compliance" },
      ],
    });
    const blocked = r.structured.tracked.find((t) => t.label === "Escrow agreement");
    expect(blocked?.atRisk).toBe(true);
    expect(r.structured.atRisk).toContain("Escrow agreement");
    expect(r.structured.overallStatus).toBe("at_risk");
    expect(r.structured.nextActions).toContain("Unblock: Escrow agreement");
  });

  it("flags a critical milestone that is not done as at risk with an Advance next action", () => {
    const r = run({
      deal: { name: "Project Atlas" },
      milestones: [
        { label: "Regulatory approval", status: "in_progress", critical: true },
        { label: "Press release", status: "in_progress" },
      ],
    });
    const critical = r.structured.tracked.find((t) => t.label === "Regulatory approval");
    expect(critical?.atRisk).toBe(true);
    expect(r.structured.atRisk).toContain("Regulatory approval");
    expect(r.structured.overallStatus).toBe("at_risk");
    expect(r.structured.nextActions).toContain("Advance critical: Regulatory approval");
    // A critical milestone that IS done is not at risk.
    const r2 = run({ deal: { name: "X" }, milestones: [{ label: "Reg approval", status: "done", critical: true }] });
    expect(r2.structured.tracked[0].atRisk).toBe(false);
    expect(r2.structured.overallStatus).toBe("complete");
  });

  it("labels completionPct a calculation, never a fact", () => {
    const r = run({
      deal: { name: "Project Atlas" },
      milestones: [
        { label: "A", status: "done" },
        { label: "B", status: "not_started" },
      ],
    });
    expect(r.structured.completionPct).toBe(50);
    const pct = r.sources.find((s) => s.label === "Deal — completion %");
    expect(pct?.kind).toBe("calculation");
    expect(r.sources.some((s) => s.label === "Deal — completion %" && s.kind === "fact")).toBe(false);
  });

  it("labels a defaulted status an assumption, and a supplied status a fact", () => {
    const r = run({
      deal: { name: "Project Atlas" },
      milestones: [
        { label: "No status milestone" }, // status omitted → defaulted
        { label: "Explicit milestone", status: "in_progress" },
      ],
    });
    // Defaulted status → assumption, NOT fact.
    const defaulted = r.sources.find((s) => s.label === "No status milestone — status");
    expect(defaulted?.kind).toBe("assumption");
    expect(defaulted?.value).toBe("not_started");
    expect(r.sources.some((s) => s.label === "No status milestone — status" && s.kind === "fact")).toBe(false);
    // Supplied status → fact.
    const explicit = r.sources.find((s) => s.label === "Explicit milestone — status");
    expect(explicit?.kind).toBe("fact");
    // The tracked milestone carries the defaulted status.
    expect(r.structured.tracked[0].status).toBe("not_started");
    expect(r.structured.missingContext.some((m) => m.includes("defaulted"))).toBe(true);
  });

  it("records supplied milestone fields as facts and flags missing owner / dueDate", () => {
    const r = run({
      deal: { name: "Project Atlas" },
      milestones: [{ label: "Signature pages", status: "not_started" }],
    });
    expect(r.sources.some((s) => s.label === "Signature pages — milestone" && s.kind === "fact")).toBe(true);
    expect(r.structured.tracked[0].owner).toBeNull();
    expect(r.structured.tracked[0].dueDate).toBeNull();
    expect(r.structured.missingContext.some((m) => m.includes("Owner missing"))).toBe(true);
    expect(r.structured.missingContext.some((m) => m.includes("Due date missing"))).toBe(true);
    // Nothing fabricated: no owner / due-date fact for a milestone that supplied neither.
    expect(r.sources.some((s) => s.label === "Signature pages — owner")).toBe(false);
    expect(r.sources.some((s) => s.label === "Signature pages — due date")).toBe(false);
  });

  it("caps nextActions at a reasonable number and notes truncation", () => {
    const milestones = Array.from({ length: 14 }, (_, i) => ({
      label: `Blocker ${i}`,
      status: "blocked" as const,
    }));
    const r = run({ deal: { name: "Project Atlas" }, milestones });
    expect(r.structured.nextActions.length).toBe(10);
    expect(r.structured.missingContext.some((m) => m.includes("capped"))).toBe(true);
  });
});

describe("deal-tracker package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/deal-tracker/input.schema.json")).toEqual(dealTrackerManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/deal-tracker/output.schema.json")).toEqual(dealTrackerManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/deal-tracker/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, dealTrackerManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
