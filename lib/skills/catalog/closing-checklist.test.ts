// Golden tests for the closing-checklist deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { closingChecklist, closingChecklistManifest, type ClosingChecklistInput } from "./closing-checklist";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "legal_closing" };
const run = (input: ClosingChecklistInput) => closingChecklist.run(input, ctx);

describe("closing-checklist core", () => {
  it("merges canonical checklist with supplied completion status and computes readiness", () => {
    const r = run({
      deal: { name: "Project Atlas", type: "acquisition" },
      completedItems: ["KYC / AML cleared", "Legal opinions delivered"],
    });
    // 8 canonical tasks, 2 reported done.
    expect(r.structured.totalItems).toBe(8);
    expect(r.structured.doneItems).toBe(2);
    expect(r.structured.readinessPct).toBe(25); // round(2/8*100)
    const kyc = r.structured.items.find((i) => i.key === "kyc_aml_cleared");
    expect(kyc?.status).toBe("done");
    const funds = r.structured.items.find((i) => i.key === "funds_flow_confirmed");
    expect(funds?.status).toBe("open");
    // readinessPct is a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "Closing readiness")?.kind).toBe("calculation");
    // Supplied completion is a FACT.
    expect(r.sources.find((s) => s.label === "KYC / AML cleared — reported complete")?.kind).toBe("fact");
  });

  it("treats every standard item as open when no completion status is supplied", () => {
    const r = run({ deal: { name: "Project Blank" } });
    expect(r.structured.totalItems).toBe(8);
    expect(r.structured.doneItems).toBe(0);
    expect(r.structured.readinessPct).toBe(0);
    expect(r.structured.items.every((i) => i.status === "open")).toBe(true);
    expect(r.structured.openItems.length).toBe(8);
    expect(r.structured.missingContext.some((m) => m.includes("No completion status supplied"))).toBe(true);
    // Nothing fabricated: no fact source carries a "done" completion value.
    expect(r.sources.some((s) => s.kind === "fact" && s.value === "done")).toBe(false);
  });

  it("surfaces an unsatisfied blocking condition precedent as a blocking item", () => {
    const r = run({
      deal: { name: "Project CP" },
      conditionsPrecedent: [
        { label: "Regulatory approval received", satisfied: false, blocking: true },
        { label: "Landlord consent obtained", satisfied: true, blocking: true },
      ],
    });
    expect(r.structured.blockingItems).toContain("Regulatory approval received");
    expect(r.structured.blockingItems).not.toContain("Landlord consent obtained");
    // The CP is merged into the item list.
    const cpItem = r.structured.items.find((i) => i.label === "Regulatory approval received");
    expect(cpItem?.category).toBe("condition_precedent");
    expect(cpItem?.status).toBe("open");
    // recommendedAction points at the blocking item, never at closing.
    expect(r.structured.recommendedAction).toContain("Resolve");
    expect(r.structured.recommendedAction).toContain("before scheduling close");
    // Supplied CP satisfaction is a FACT.
    expect(r.sources.find((s) => s.label === "CP: Regulatory approval received — satisfied")?.kind).toBe("fact");
  });

  it("flags an open CRITICAL canonical task as a blocking item", () => {
    const r = run({ deal: { name: "Project Critical" } });
    // KYC / AML, purchase agreement and closing conditions are critical → all open here.
    expect(r.structured.blockingItems).toContain("KYC / AML cleared");
    expect(r.structured.blockingItems).toContain("Signed purchase agreement / subscription documents executed");
    expect(r.structured.blockingItems).toContain("Closing conditions satisfied");
  });

  it("routes to a human for final closing authorization when all items are complete, never auto-closing", () => {
    const completedItems = [
      "Signed purchase agreement / subscription documents executed",
      "Funds flow memo confirmed",
      "KYC / AML cleared",
      "Board & IC approvals recorded",
      "Disclosure schedules finalized",
      "Closing conditions satisfied",
      "Legal opinions delivered",
      "Post-closing filings prepared",
    ];
    const r = run({ deal: { name: "Project Done" }, completedItems });
    expect(r.structured.readinessPct).toBe(100);
    expect(r.structured.openItems).toEqual([]);
    expect(r.structured.blockingItems).toEqual([]);
    expect(r.structured.recommendedAction).toContain("route to a human for final closing authorization");
    expect(r.structured.recommendedAction).toContain("never auto-close");
  });

  it("never fabricates completion — nothing is done unless the caller reports it", () => {
    const r = run({ deal: { name: "Project Honest" }, completedItems: ["Funds flow memo confirmed"] });
    expect(r.structured.doneItems).toBe(1);
    const factsDone = r.sources.filter((s) => s.kind === "fact" && s.value === "done");
    expect(factsDone.length).toBe(1);
    expect(factsDone[0].label).toBe("Funds flow memo confirmed — reported complete");
  });

  it("always produces a recommended action and a narrative", () => {
    const r = run({ deal: { name: "X" } });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("closing-checklist package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/closing-checklist/input.schema.json")).toEqual(closingChecklistManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/closing-checklist/output.schema.json")).toEqual(closingChecklistManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/closing-checklist/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, closingChecklistManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
