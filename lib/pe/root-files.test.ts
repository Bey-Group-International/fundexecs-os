import { resolveRootFiles } from "./root-files";
import { FIXTURE } from "./test-fixture";

describe("resolveRootFiles", () => {
  it("reports what was found and what was not, and falls back to an empty draft mandate", () => {
    const r = resolveRootFiles([]);
    expect(r.found).toEqual([]);
    expect(r.mandate.status).toBe("draft");
    expect(r.returnsAreDefault).toBe(true);
    expect(r.returns.base.irr).toBe(0.2);
    expect(r.statusLine).toMatch(/Root files found: none\. Not found: firm, mandate.*run on default settings\./);
  });

  it("parses a stored mandate and keeps its approved status", () => {
    const r = resolveRootFiles([{ file_key: "mandate", content: FIXTURE }, { file_key: "returns", content: { base: { irr: 0.25, moic: 3 }, downside: { irr: 0.12 }, holdYears: 4 } }, { file_key: "bogus", content: { a: 1 } }]);
    expect(r.found).toEqual(["mandate", "returns"]);
    expect(r.mandate.status).toBe("approved");
    expect(r.mandate.hardLimits).toHaveLength(4);
    expect(r.missing).not.toContain("mandate");
    expect(r.returns).toEqual({ base: { irr: 0.25, moic: 3 }, downside: { irr: 0.12 }, holdYears: 4 });
    expect(r.returnsAreDefault).toBe(false);
  });

  it("treats an unparseable or empty mandate as missing", () => {
    expect(resolveRootFiles([{ file_key: "mandate", content: "garbage" }]).found).toEqual([]);
    expect(resolveRootFiles([{ file_key: "mandate", content: { hardLimits: [] } }]).found).toEqual([]);
  });
});

describe("firm file in resolveRootFiles", () => {
  it("is null until the firm names a firm or an owner, then carries the gate owners", () => {
    expect(resolveRootFiles([]).firm).toBeNull();
    expect(resolveRootFiles([{ file_key: "firm", content: { gateOwners: { first_look: "  " } } }]).firm).toBeNull();
    const r = resolveRootFiles([{ file_key: "firm", content: { firmName: "Acme", gateOwners: { first_look: "Jane Doe" } } }]);
    expect(r.firm).toEqual({ firmName: "Acme", gateOwners: { first_look: "Jane Doe" } });
    expect(r.found).toContain("firm");
    expect(r.missing).not.toContain("firm");
  });
});

describe("evidence file in resolveRootFiles", () => {
  it("is the labelled default until the firm sets a grade, then merges with the default", () => {
    const none = resolveRootFiles([]);
    expect(none.evidenceIsDefault).toBe(true);
    expect(none.evidence.supportsPrice).toEqual({ A: true, B: true, C: false });
    const set = resolveRootFiles([{ file_key: "evidence", content: { supportsPrice: { B: false, U: true } } }]);
    expect(set.evidenceIsDefault).toBe(false);
    expect(set.evidence.supportsPrice).toEqual({ A: true, B: false, C: false }); // U is never configurable
    expect(set.found).toContain("evidence");
    expect(resolveRootFiles([{ file_key: "evidence", content: { supportsPrice: { A: "yes" } } }]).evidenceIsDefault).toBe(true);
  });
});

describe("ic_memo file in resolveRootFiles", () => {
  it("is null until the firm lists a usable section", () => {
    expect(resolveRootFiles([]).icMemo).toBeNull();
    expect(resolveRootFiles([{ file_key: "ic_memo", content: { sections: [{ key: "BAD" }] } }]).icMemo).toBeNull();
    const r = resolveRootFiles([{ file_key: "ic_memo", content: { sections: [{ key: "returns" }, { key: "asks", title: "Asks", required: true }] } }]);
    expect(r.icMemo?.sections.map((s) => s.key)).toEqual(["returns", "asks"]);
    expect(r.found).toContain("ic_memo");
  });
});

describe("reporting file in resolveRootFiles", () => {
  it("is null until the firm sets something usable", () => {
    expect(resolveRootFiles([]).reporting).toBeNull();
    expect(resolveRootFiles([{ file_key: "reporting", content: { decimals: 9 } }]).reporting).toBeNull();
    const r = resolveRootFiles([{ file_key: "reporting", content: { currency: "GBP", decimals: 0 } }]);
    expect(r.reporting).toEqual({ currency: "GBP", decimals: 0 });
    expect(r.found).toContain("reporting");
  });

  it("with all eight files saved, nothing is missing", () => {
    const rows = [
      { file_key: "firm", content: { firmName: "Acme" } },
      { file_key: "mandate", content: { hardLimits: [{ id: "g", label: "Geo", metric: "geography", allow: ["UK"] }] } },
      { file_key: "returns", content: { base: { irr: 0.2 } } },
      { file_key: "evidence", content: { supportsPrice: { A: true } } },
      { file_key: "ic_memo", content: { sections: [{ key: "returns" }] } },
      { file_key: "kpi", content: { materialityPct: 3 } },
      { file_key: "financing", content: { maxSeniorLeverage: 4 } },
      { file_key: "reporting", content: { units: "m" } },
    ];
    const r = resolveRootFiles(rows);
    expect(r.missing).toEqual([]);
    expect(r.statusLine).toMatch(/Not found: none\.$/);
  });
});

