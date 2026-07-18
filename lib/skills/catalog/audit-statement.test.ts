// Golden tests for the audit-statement deterministic core.
import { readFileSync } from "fs";
import { join } from "path";
import { auditStatement, auditStatementManifest, type AuditStatementInput } from "./audit-statement";
import type { SkillContext } from "@/lib/skills/types";

const loadJson = (rel: string): unknown => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "fund_admin" };
const run = (input: AuditStatementInput) => auditStatement.run(input, ctx);

describe("audit-statement core", () => {
  it("ties a line exactly when statement and support agree", () => {
    const r = run({
      statementLines: [{ label: "Cash", statementValue: 10000, supportValue: 10000, schedule: "GL 1000" }],
    });
    const t = r.structured.tieOuts[0];
    expect(t.status).toBe("tied");
    expect(t.variance).toBe(0);
    expect(t.supportValue).toBe(10000);
    expect(t.schedule).toBe("GL 1000");
    expect(r.structured.tiedCount).toBe(1);
    expect(r.structured.varianceCount).toBe(0);
    expect(r.structured.unsupportedCount).toBe(0);
    expect(r.structured.totalAbsVariance).toBe(0);
    // The supplied statement value is a FACT.
    expect(r.sources.find((s) => s.label === "Cash — statement value")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Cash — support value")?.kind).toBe("fact");
  });

  it("flags a variance beyond materiality and labels the variance a calculation", () => {
    const r = run({
      statementLines: [{ label: "AR", statementValue: 5250, supportValue: 5000, schedule: "AR aging" }],
    });
    const t = r.structured.tieOuts[0];
    expect(t.status).toBe("variance");
    expect(t.variance).toBe(250); // 5250 − 5000
    expect(r.structured.varianceCount).toBe(1);
    expect(r.structured.totalAbsVariance).toBe(250);
    // The variance is a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "AR — variance")?.kind).toBe("calculation");
  });

  it("respects a supplied materiality threshold — a small variance ties within it", () => {
    const r = run({
      materialityThreshold: 100,
      statementLines: [
        { label: "Prepaid", statementValue: 1005, supportValue: 1000 }, // variance 5, within 100 → tied
        { label: "Accruals", statementValue: 2000, supportValue: 1800 }, // variance 200, beyond 100 → variance
      ],
    });
    const byLabel = Object.fromEntries(r.structured.tieOuts.map((t) => [t.label, t]));
    expect(byLabel["Prepaid"].status).toBe("tied");
    expect(byLabel["Accruals"].status).toBe("variance");
    expect(r.structured.tiedCount).toBe(1);
    expect(r.structured.varianceCount).toBe(1);
    // Supplied threshold is a FACT (not an assumption).
    expect(r.sources.find((s) => s.label === "Materiality threshold")?.kind).toBe("fact");
    expect(r.structured.totalAbsVariance).toBe(205);
  });

  it("defaults the threshold to an exact tie (0) and labels it an assumption", () => {
    const r = run({
      statementLines: [{ label: "Cash", statementValue: 1001, supportValue: 1000 }], // variance 1 > 0 → variance
    });
    expect(r.structured.tieOuts[0].status).toBe("variance");
    // Defaulted threshold is an ASSUMPTION, surfaced not silently assumed.
    expect(r.sources.find((s) => s.label === "Materiality threshold")?.kind).toBe("assumption");
    expect(r.structured.missingContext.some((m) => m.includes("Materiality threshold not supplied"))).toBe(true);
  });

  it("flags a missing support value as unsupported with a null variance — never assumes it equals the statement value", () => {
    const r = run({
      statementLines: [{ label: "Investments", statementValue: 750000 }],
    });
    const t = r.structured.tieOuts[0];
    expect(t.status).toBe("unsupported");
    expect(t.variance).toBeNull();
    expect(t.supportValue).toBeNull();
    expect(r.structured.unsupportedCount).toBe(1);
    expect(r.structured.tiedCount).toBe(0);
    // Nothing fabricated: no fact source carries a support value for this line.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Investments — support value")).toBe(false);
    // And it never counts toward totalAbsVariance.
    expect(r.structured.totalAbsVariance).toBe(0);
    expect(r.structured.missingContext.some((m) => m.includes("Investments"))).toBe(true);
  });

  it("GUARDRAIL: no statement lines returns an empty tie-out and never fabricates balances", () => {
    const r = run({});
    expect(r.structured.tieOuts).toEqual([]);
    expect(r.structured.tiedCount).toBe(0);
    expect(r.structured.varianceCount).toBe(0);
    expect(r.structured.unsupportedCount).toBe(0);
    expect(r.structured.totalAbsVariance).toBe(0);
    expect(r.structured.missingContext).toContain(
      "No statement lines supplied — this skill ties out provided lines against support; it does not fabricate balances.",
    );
    // Nothing fabricated: no sources at all.
    expect(r.sources.length).toBe(0);
    expect(r.completeness).toBe(0);
  });

  it("is PREPARATION only — it never issues an opinion or signs off, and its recommended action says so", () => {
    const r = run({ statementLines: [{ label: "Cash", statementValue: 100, supportValue: 100 }] });
    expect(r.structured.recommendedAction).toMatch(/does not issue an (audit )?opinion|sign off/i);
    // The manifest prohibits signing / posting / capital actions outright.
    expect(auditStatement.manifest.prohibitedActions).toEqual(
      expect.arrayContaining(["post_journal_entry", "close_period", "move_capital", "sign_document"]),
    );
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({ statementLines: [{ label: "X", statementValue: 1, supportValue: 1 }] });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});

describe("audit-statement package consistency", () => {
  it("input schema on disk matches the manifest", () => {
    expect(loadJson("skills/audit-statement/input.schema.json")).toEqual(auditStatementManifest.inputSchema);
  });

  it("output schema on disk matches the manifest", () => {
    expect(loadJson("skills/audit-statement/output.schema.json")).toEqual(auditStatementManifest.outputSchema);
  });

  it("the example input validates against the schema", async () => {
    const { validate } = await import("../validate");
    const example = loadJson("skills/audit-statement/examples/example-1.json") as { input: unknown };
    const r = validate(example.input, auditStatementManifest.inputSchema);
    expect(r.valid).toBe(true);
  });
});
