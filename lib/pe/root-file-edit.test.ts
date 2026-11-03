import { mandateApprovalBlockers, validateRootFileText } from "./root-file-edit";
import { ROOT_FILE_META } from "./root-file-templates";
import { parseMandateTests } from "./mandate-tests";
import { FIXTURE } from "./test-fixture";

describe("validateRootFileText", () => {
  it("rejects bad JSON, non-objects, unknown keys and oversize input", () => {
    expect(validateRootFileText("mandate", "{nope").errors[0]).toMatch(/Not valid JSON/);
    expect(validateRootFileText("mandate", "[1]").errors[0]).toMatch(/must be a JSON object/);
    expect(validateRootFileText("bogus", "{}").errors[0]).toMatch(/Unknown root file/);
    expect(validateRootFileText("firm", JSON.stringify({ x: "a".repeat(60_000) })).errors[0]).toMatch(/Too large/);
  });

  it("stores the parsed mandate, forces draft, and reports what was dropped", () => {
    const v = validateRootFileText("mandate", JSON.stringify({ ...FIXTURE, status: "approved", approvedBy: "Me", hardLimits: [...FIXTURE.hardLimits, { id: "bad", metric: "ebitda" }] }));
    expect(v.ok).toBe(true);
    const n = v.normalized as Record<string, unknown>;
    expect(n.status).toBe("draft");
    expect(n.approvedBy).toBeUndefined();
    expect((n.hardLimits as unknown[]).length).toBe(4);
    expect(v.warnings.join(" ")).toMatch(/1 malformed criterion/);
    expect(v.warnings.join(" ")).toMatch(/reset to draft/);
    expect(v.readBySkills).toBe(true);
  });

  it("refuses a mandate with no usable criteria", () => {
    expect(validateRootFileText("mandate", JSON.stringify({ hardLimits: [{ nope: 1 }] })).ok).toBe(false);
  });

  it("accepts the typed policy files and rejects unusable ones with a pointer to the format", () => {
    expect(validateRootFileText("returns", JSON.stringify({ base: { irr: 0.25, moic: 3 }, holdYears: 4 })).normalized).toEqual({ base: { irr: 0.25, moic: 3 }, downside: undefined, holdYears: 4 });
    expect(validateRootFileText("returns", JSON.stringify({ base: { irr: 25 } })).warnings.join(" ")).toMatch(/IRR is a decimal/);
    expect(validateRootFileText("returns", "{}").errors[0]).toMatch(/No usable base hurdle/);
    expect(validateRootFileText("financing", JSON.stringify({ maxSeniorLeverage: 4.5 })).ok).toBe(true);
    expect(validateRootFileText("financing", JSON.stringify({ covenantWarnHeadroomPct: -1 })).ok).toBe(false);
    expect(validateRootFileText("kpi", JSON.stringify({ materialityPct: 3 })).ok).toBe(true);
    expect(validateRootFileText("kpi", "{}").ok).toBe(false);
  });

  it("stores untyped files as written and says no skill reads them", () => {
    const v = validateRootFileText("firm", JSON.stringify({ firmName: "X" }));
    expect(v.ok).toBe(true);
    expect(v.readBySkills).toBe(false);
    expect(v.warnings[0]).toMatch(/No skill reads this file yet/);
  });
});

describe("mandate approval", () => {
  it("is blocked for a missing or incomplete mandate and allowed for a clean one", () => {
    expect(mandateApprovalBlockers(null)).toEqual(["There is no mandate to approve."]);
    expect(mandateApprovalBlockers(parseMandateTests({ hardLimits: [{ id: "a", label: "Size", metric: "ebitda" }] }))[0]).toMatch(/no threshold/);
    expect(mandateApprovalBlockers(FIXTURE)).toEqual([]);
  });
});

describe("starter templates carry no invented numbers", () => {
  it("every typed starter either fails validation or saves as an UNAPPROVABLE draft", () => {
    for (const m of ROOT_FILE_META.filter((x) => x.typed)) {
      const v = validateRootFileText(m.key, m.starter);
      if (m.key === "mandate") {
        expect(v.ok).toBe(true);
        expect(mandateApprovalBlockers(parseMandateTests(v.normalized)).length).toBeGreaterThan(0);
      } else {
        expect(v.ok).toBe(false);
      }
    }
  });
});
