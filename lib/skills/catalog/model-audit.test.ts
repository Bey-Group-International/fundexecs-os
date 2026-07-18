// Golden tests for the model-audit deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { modelAudit, modelAuditManifest, type ModelAuditInput } from "./model-audit";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "analyst" };
const run = (input: ModelAuditInput) => modelAudit.run(input, ctx);

describe("model-audit core", () => {
  it("flags a margin above 100% as an error finding", () => {
    const r = run({ ratios: [{ label: "Gross margin", value: 1.5, kind: "margin" }] });
    const finding = r.structured.findings.find((f) => f.label === "Gross margin");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.area).toBe("ratio");
    expect(r.structured.errorCount).toBe(1);
    expect(r.structured.failedCount).toBe(1);
  });

  it("flags a failed check when lhs and rhs diverge beyond tolerance", () => {
    const r = run({ checks: [{ label: "Assets = Liabilities + Equity", lhs: 100, rhs: 90, tolerance: 1 }] });
    const finding = r.structured.findings.find((f) => f.area === "check");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(r.structured.failedCount).toBe(1);
    expect(r.structured.passedCount).toBe(0);
  });

  it("passes a check that holds within tolerance", () => {
    const r = run({ checks: [{ label: "Subtotal", lhs: 100, rhs: 100.5, tolerance: 1 }] });
    expect(r.structured.findings).toEqual([]);
    expect(r.structured.passedCount).toBe(1);
    expect(r.structured.failedCount).toBe(0);
  });

  it("an in-range clean model yields no findings and all items passed", () => {
    const r = run({
      lineItems: [{ label: "Revenue", value: 100, min: 0, max: 200, kind: "revenue" }],
      checks: [{ label: "Balance", lhs: 50, rhs: 50 }],
      ratios: [{ label: "EBITDA margin", value: 0.25, kind: "margin" }],
    });
    expect(r.structured.findings).toEqual([]);
    expect(r.structured.checkedCount).toBe(3);
    expect(r.structured.passedCount).toBe(3);
    expect(r.structured.failedCount).toBe(0);
    expect(r.structured.errorCount).toBe(0);
    expect(r.structured.warningCount).toBe(0);
  });

  it("flags a negative revenue line item as an error", () => {
    const r = run({ lineItems: [{ label: "Revenue", value: -10, kind: "revenue" }] });
    const finding = r.structured.findings.find((f) => f.area === "lineItem");
    expect(finding?.severity).toBe("error");
  });

  it("flags a line item outside a supplied range as a warning", () => {
    const r = run({ lineItems: [{ label: "Headcount", value: 500, min: 0, max: 100 }] });
    const finding = r.structured.findings.find((f) => f.area === "lineItem");
    expect(finding?.severity).toBe("warning");
    expect(r.structured.warningCount).toBe(1);
  });

  it("flags implausible growth as a warning, not an error", () => {
    const r = run({ ratios: [{ label: "YoY growth", value: 5, kind: "growth" }] });
    const finding = r.structured.findings.find((f) => f.label === "YoY growth");
    expect(finding?.severity).toBe("warning");
    expect(r.structured.errorCount).toBe(0);
  });

  it("GUARDRAIL: empty model returns empty findings and never fabricates figures", () => {
    const r = run({});
    expect(r.structured.findings).toEqual([]);
    expect(r.structured.checkedCount).toBe(0);
    expect(r.structured.summary).toBe(
      "No model supplied — this skill audits a provided model; it does not fabricate figures.",
    );
    // Nothing fabricated: no source carries any model value.
    expect(r.sources.length).toBe(0);
    expect(r.completeness).toBe(0);
  });

  it("labels a supplied value a fact and emits NO finding carrying a corrected numeric value", () => {
    const r = run({ ratios: [{ label: "Net margin", value: 1.2, kind: "margin" }] });
    // Supplied value is a FACT.
    const fact = r.sources.find((s) => s.label === "Net margin" && s.kind === "fact");
    expect(fact?.value).toBe(1.2);
    // The audit verdict is a CALCULATION whose value is a verdict string, never a corrected number.
    const verdict = r.sources.find((s) => s.label === "Net margin — audit");
    expect(verdict?.kind).toBe("calculation");
    expect(typeof verdict?.value).toBe("string");
    // NO finding carries a corrected numeric value — a finding has exactly these four keys.
    for (const f of r.structured.findings) {
      expect(Object.keys(f).sort()).toEqual(["area", "label", "message", "severity"]);
    }
  });

  it("always produces a summary, recommended action, and narrative", () => {
    const r = run({ lineItems: [{ label: "X", value: 1 }] });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.summary.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("model-audit package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/model-audit/input.schema.json")).toEqual(modelAuditManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/model-audit/output.schema.json")).toEqual(modelAuditManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/model-audit/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, modelAuditManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
