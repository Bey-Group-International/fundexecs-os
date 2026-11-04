import { mandateApprovalBlockers, validateRootFileText } from "./root-file-edit";
import { ROOT_FILE_META } from "./root-file-templates";
import { parseMandateTests } from "./mandate-tests";
import { FIXTURE } from "./test-fixture";

describe("validateRootFileText", () => {
  it("rejects bad JSON, non-objects, unknown keys and oversize input", () => {
    expect(validateRootFileText("mandate", "{nope").errors[0]).toMatch(/Not valid JSON/);
    expect(validateRootFileText("mandate", "[1]").errors[0]).toMatch(/must be a JSON object/);
    expect(validateRootFileText("bogus", "{}").errors[0]).toMatch(/Unknown root file/);
    expect(validateRootFileText("reporting", JSON.stringify({ x: "a".repeat(60_000) })).errors[0]).toMatch(/Too large/);
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
    const v = validateRootFileText("reporting", JSON.stringify({ boardPack: { sections: ["KPIs"] } }));
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
  it("every typed starter either fails validation, saves as an UNAPPROVABLE draft, or is exactly the skill's own default", () => {
    for (const m of ROOT_FILE_META.filter((x) => x.typed)) {
      const v = validateRootFileText(m.key, m.starter);
      if (m.key === "mandate") {
        expect(v.ok).toBe(true);
        expect(mandateApprovalBlockers(parseMandateTests(v.normalized)).length).toBeGreaterThan(0);
      } else if (m.key === "ic_memo") {
        // Structure only, no numbers: it saves, and is identical to what the skill does with no file.
        expect(v.ok).toBe(true);
        expect((v.normalized as { sections: Array<{ required: boolean }> }).sections.every((s) => s.required === false)).toBe(true);
      } else {
        expect(v.ok).toBe(false);
      }
    }
  });
});


describe("firm file (gate owners)", () => {
  it("stores only known gates with real names and reports what it ignored", () => {
    const v = validateRootFileText("firm", JSON.stringify({ firmName: " Acme Capital ", gateOwners: { first_look: " Jane Doe, deal lead ", bid_price: "", made_up_gate: "X", ipo_decision: "y".repeat(200) } }));
    expect(v.ok).toBe(true);
    expect(v.normalized).toEqual({ firmName: "Acme Capital", gateOwners: { first_look: "Jane Doe, deal lead" } });
    expect(v.warnings.join(" ")).toMatch(/Unknown gate\(s\) ignored: made_up_gate/);
    expect(v.warnings.join(" ")).toMatch(/over 120 characters was dropped for: ipo_decision/);
    expect(v.readBySkills).toBe(true);
  });

  it("rejects a file with no name and no owner (the starter is all blanks, so it is never stored as-is)", () => {
    expect(validateRootFileText("firm", JSON.stringify({ gateOwners: { first_look: "  " } })).ok).toBe(false);
    expect(validateRootFileText("firm", "{}").errors[0]).toMatch(/No usable firm values/);
  });
});

describe("evidence file (price-support policy)", () => {
  it("stores the full merged policy, locks U, and warns on unusual settings", () => {
    const v = validateRootFileText("evidence", JSON.stringify({ supportsPrice: { A: true, B: false, C: true, U: true } }));
    expect(v.ok).toBe(true);
    expect(v.normalized).toEqual({ supportsPrice: { A: true, B: false, C: true } });
    expect(v.warnings.join(" ")).toMatch(/"U" \(untested\) can never support a price/);
    expect(v.warnings.join(" ")).toMatch(/Grade C .* is set to support a price/);
    expect(v.readBySkills).toBe(true);
    expect(validateRootFileText("evidence", JSON.stringify({ supportsPrice: { A: false } })).warnings.join(" ")).toMatch(/Grade A .* NOT to support a price/);
  });

  it("rejects a policy that sets nothing, and the all-null starter", () => {
    expect(validateRootFileText("evidence", "{}").errors[0]).toMatch(/No usable evidence policy/);
    expect(validateRootFileText("evidence", JSON.stringify({ supportsPrice: { A: "yes", B: 1 } })).ok).toBe(false);
    expect(validateRootFileText("evidence", ROOT_FILE_META.find((m) => m.key === "evidence")!.starter).ok).toBe(false);
  });
});

describe("ic_memo file (memo structure)", () => {
  it("stores the parsed structure and explains dropped entries and placeholder sections", () => {
    const v = validateRootFileText("ic_memo", JSON.stringify({ sections: [{ key: "recommendation", required: true }, { key: "asks", title: "Asks" }, { key: "BAD" }] }));
    expect(v.ok).toBe(true);
    expect(v.normalized).toEqual({ sections: [{ key: "recommendation", title: "Recommendation", required: true }, { key: "asks", title: "Asks", required: false }] });
    expect(v.warnings.join(" ")).toMatch(/Section 3: key must be lowercase/);
    expect(v.warnings.join(" ")).toMatch(/cannot generate: asks.*open placeholders/);
    expect(v.readBySkills).toBe(true);
  });

  it("rejects a file with no usable section, but accepts the skill-structure starter", () => {
    expect(validateRootFileText("ic_memo", JSON.stringify({ sections: [{ key: "BAD" }] })).errors[0]).toMatch(/No usable sections/);
    const starter = validateRootFileText("ic_memo", ROOT_FILE_META.find((m) => m.key === "ic_memo")!.starter);
    expect(starter.ok).toBe(true);
    expect((starter.normalized as { sections: unknown[] }).sections).toHaveLength(12);
    expect(starter.warnings).toEqual([]); // identical to the default: nothing dropped, nothing custom
  });
});
