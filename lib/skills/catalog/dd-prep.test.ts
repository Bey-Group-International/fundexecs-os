// Golden tests for the dd-prep deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { ddPrep, ddPrepManifest, type DdPrepInput } from "./dd-prep";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "diligence" };
const run = (input: DdPrepInput) => ddPrep.run(input, ctx);

describe("dd-prep core", () => {
  it("produces the standard 8-workstream workplan and counts every item", () => {
    const r = run({ deal: { name: "Acme Co" } });
    expect(r.structured.workstreams).toHaveLength(8);
    expect(r.structured.workstreams.map((w) => w.workstream)).toEqual([
      "Commercial",
      "Financial",
      "Legal",
      "Tax",
      "Technology",
      "HR & Org",
      "Operations",
      "ESG",
    ]);
    const summed = r.structured.workstreams.reduce((s, w) => s + w.items.length, 0);
    expect(r.structured.totalItems).toBe(summed);
    // Core workstreams start medium, the rest standard; none high without inputs.
    expect(r.structured.workstreams.find((w) => w.workstream === "Financial")?.priority).toBe("medium");
    expect(r.structured.workstreams.find((w) => w.workstream === "Operations")?.priority).toBe("standard");
    expect(r.structured.workstreams.every((w) => w.priority !== "high")).toBe(true);
    expect(r.structured.highPriorityCount).toBe(0);
  });

  it("bumps a focus area to high priority", () => {
    const r = run({ deal: { name: "SaaS Co" }, focusAreas: ["technology"] });
    const tech = r.structured.workstreams.find((w) => w.workstream === "Technology")!;
    expect(tech.priority).toBe("high");
    // A non-focus core workstream stays medium.
    expect(r.structured.workstreams.find((w) => w.workstream === "Legal")?.priority).toBe("medium");
    // highPriorityCount counts the items sitting in high-priority workstreams.
    expect(r.structured.highPriorityCount).toBe(tech.items.length);
    expect(r.structured.recommendedAction).toMatch(/high-priority/i);
  });

  it("merges a supplied known item, labelling its status and owner as facts", () => {
    const r = run({
      deal: { name: "Acme Co" },
      knownItems: [{ workstream: "financial", item: "Quality of earnings review", status: "in_progress", owner: "Dana" }],
    });
    const fin = r.structured.workstreams.find((w) => w.workstream === "Financial")!;
    const qoe = fin.items.find((i) => i.item === "Quality of earnings review")!;
    expect(qoe.status).toBe("in_progress");
    expect(qoe.owner).toBe("Dana");
    // Deduped: the supplied item replaced the template item, not appended alongside it.
    expect(fin.items.filter((i) => i.item === "Quality of earnings review")).toHaveLength(1);
    // The supplied status and owner are FACTS.
    expect(r.sources.find((s) => s.label === "Financial: Quality of earnings review — status")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Financial: Quality of earnings review — owner")?.kind).toBe("fact");
    // A started item means Financial has recorded progress → not a coverage gap.
    expect(r.structured.coverageGaps).not.toContain("Financial");
  });

  it("labels a template default status as an assumption, never a fact", () => {
    const r = run({ deal: { name: "Acme Co" } });
    const templateStatus = r.sources.find((s) => s.label === "Commercial: Market sizing and competitive landscape review — status");
    expect(templateStatus?.kind).toBe("assumption");
    expect(templateStatus?.value).toBe("not_started");
    // With no supplied items, nothing is a fact.
    expect(r.sources.some((s) => s.kind === "fact")).toBe(false);
  });

  it("surfaces a coverage gap for a focus area not represented in the workplan", () => {
    const r = run({ deal: { name: "Acme Co" }, focusAreas: ["insurance"] });
    expect(r.structured.coverageGaps.some((g) => /insurance/i.test(g))).toBe(true);
    expect(r.structured.coverageGaps.some((g) => /not represented/i.test(g))).toBe(true);
    // A fresh, entirely not_started workstream is itself flagged as an unstarted gap.
    expect(r.structured.coverageGaps).toContain("Operations");
  });

  it("does not fabricate a phase when no timeline is supplied", () => {
    const r = run({ deal: { name: "Acme Co" }, focusAreas: ["technology"] });
    expect(r.structured.workstreams.every((w) => w.phase === null)).toBe(true);
    expect(r.structured.missingContext.some((m) => /No timeline supplied/i.test(m))).toBe(true);
  });

  it("phases items by priority when a timeline is supplied", () => {
    const r = run({ deal: { name: "Acme Co" }, focusAreas: ["technology"], timelineWeeks: 8 });
    expect(r.structured.workstreams.find((w) => w.workstream === "Technology")?.phase).toBe(1); // high
    expect(r.structured.workstreams.find((w) => w.workstream === "Financial")?.phase).toBe(2); // medium
    expect(r.structured.workstreams.find((w) => w.workstream === "Operations")?.phase).toBe(3); // standard
  });

  it("treats a supplied not_started known item as a known gap and bumps it to high", () => {
    const r = run({
      deal: { name: "Acme Co" },
      knownItems: [{ workstream: "operations", item: "Supply chain and procurement review", status: "not_started" }],
    });
    expect(r.structured.workstreams.find((w) => w.workstream === "Operations")?.priority).toBe("high");
  });

  it("never drops a supplied item whose workstream is outside the template", () => {
    const r = run({
      deal: { name: "Acme Co" },
      knownItems: [{ workstream: "Insurance", item: "Coverage adequacy review", status: "in_progress" }],
    });
    const ins = r.structured.workstreams.find((w) => w.workstream === "Insurance")!;
    expect(ins).toBeDefined();
    expect(ins.items.map((i) => i.item)).toContain("Coverage adequacy review");
  });

  it("flags missing planning context instead of inventing it", () => {
    const r = run({ deal: { name: "Bare Co" } });
    expect(r.structured.missingContext).toEqual(
      expect.arrayContaining([
        expect.stringContaining("No focus areas supplied"),
        expect.stringContaining("No known items supplied"),
        expect.stringContaining("No timeline supplied"),
      ]),
    );
    expect(r.missingData).toEqual(r.structured.missingContext);
    expect(r.completeness).toBe(0);
  });

  it("is fully deterministic — same input, identical output", () => {
    const input: DdPrepInput = {
      deal: { name: "Repeat Co", sector: "SaaS", dealType: "Buyout" },
      focusAreas: ["technology"],
      knownItems: [{ workstream: "legal", item: "Litigation, claims, and disputes review", status: "complete", owner: "Lee" }],
      timelineWeeks: 10,
    };
    expect(JSON.stringify(run(input).structured)).toBe(JSON.stringify(run(input).structured));
  });

  it("always produces a narrative and a recommended action", () => {
    const r = run({ deal: { name: "X" } });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("dd-prep package consistency", () => {
  const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/dd-prep/input.schema.json")).toEqual(ddPrepManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/dd-prep/output.schema.json")).toEqual(ddPrepManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/dd-prep/examples/example-1.json") as { input: unknown };
    const res = validate(example.input, ddPrepManifest.inputSchema);
    expect(res.valid).toBe(true);
  });
});
