import { auditMandate, parseMandateTests, screenAgainstMandate } from "./mandate-tests";
import { FIXTURE } from "./test-fixture";

const good = { geography: "UK", sector: "Software", ownershipPct: 100, equityChequePct: 10, ebitda: 10, ebitdaMargin: 25, topCustomerPct: 12 };

describe("screenAgainstMandate", () => {
  it("passes a clean deal and scores preferences on the testable weight", () => {
    const o = screenAgainstMandate(FIXTURE, good);
    expect(o.result).toBe("pass");
    expect(o.score).toBe(100);
    expect(o.basis).toBe("approved-mandate");
  });

  it("a hard-limit fail ends the screen and cites the criterion + clause", () => {
    const o = screenAgainstMandate(FIXTURE, { ...good, geography: "France" });
    expect(o.result).toBe("fail");
    expect(o.hardFails[0].reason).toContain("LPA 9.1");
  });

  it("a deny list beats the allow list", () => {
    const o = screenAgainstMandate(FIXTURE, { ...good, sector: "Tobacco" });
    expect(o.result).toBe("fail");
    expect(o.hardFails.map((r) => r.id)).toContain("excl");
  });

  it("a missing hard-limit field is needs-data, never a silent pass", () => {
    const { geography: _g, ...rest } = good;
    const o = screenAgainstMandate(FIXTURE, rest);
    expect(o.result).toBe("needs-data");
    expect(o.needsData.join(" ")).toMatch(/Geography not provided/);
  });

  it("numeric and asserted kill facts end the deal regardless of score", () => {
    expect(screenAgainstMandate(FIXTURE, { ...good, topCustomerPct: 55 }).result).toBe("fail");
    const asserted = screenAgainstMandate(FIXTURE, { ...good, killFlags: ["Founder unwilling to roll equity"] });
    expect(asserted.result).toBe("fail");
    expect(asserted.killFactsTriggered[0].id).toBe("roll");
  });

  it("scores half for acceptable, zero for outside, and skips untestable preferences", () => {
    const o = screenAgainstMandate(FIXTURE, { ...good, ebitda: 6, ebitdaMargin: 5, sector: "Software" });
    // ebitda acceptable 0.5*50 + margin outside 0 + sector strong 20 = 45 / 100
    expect(o.score).toBe(45);
    const partial = screenAgainstMandate(FIXTURE, { ...good, ebitda: undefined });
    expect(partial.scoredWeightShare).toBe(0.5);
  });

  it("labels an unsigned mandate default-screened", () => {
    expect(screenAgainstMandate({ ...FIXTURE, status: "draft" }, good).basis).toBe("default-screened");
  });
});

describe("empty mandate", () => {
  it("is needs-data, never a vacuous pass", () => {
    const o = screenAgainstMandate({ status: "draft", hardLimits: [], preferences: [], killFacts: [] }, good);
    expect(o.result).toBe("needs-data");
    expect(o.basis).toBe("default-screened");
  });
});

describe("auditMandate", () => {
  it("flags criteria with no number, no source, and contradictions", () => {
    const issues = auditMandate({
      status: "draft",
      hardLimits: [
        { id: "a", label: "Size", metric: "ebitda", band: {} },
        { id: "b", label: "Control", metric: "ownershipPct", band: { min: 30 } },
        { id: "c", label: "Rev", metric: "revenue", band: { min: 100, max: 50 }, source: "LPA 1" },
      ],
      preferences: [{ id: "p", label: "Rev pref", metric: "revenue", strong: { min: 10, max: 20 }, weight: 10 }],
      killFacts: [{ id: "k", label: "Bad", metric: "topCustomerPct" }],
    });
    const msgs = issues.map((i) => i.message).join("\n");
    expect(msgs).toMatch(/Size.*no threshold/);
    expect(msgs).toMatch(/Control.*cites no LPA clause/);
    expect(msgs).toMatch(/below majority/);
    expect(msgs).toMatch(/min 100 above max 50/);
    expect(msgs).toMatch(/no number/);
    expect(issues.some((i) => i.severity === "blocker")).toBe(true);
  });

  it("a well-formed mandate has no blockers", () => {
    expect(auditMandate(FIXTURE).filter((i) => i.severity === "blocker")).toEqual([]);
  });
});

describe("parseMandateTests", () => {
  it("drops malformed criteria and never throws", () => {
    expect(parseMandateTests(null)).toBeNull();
    const p = parseMandateTests({ status: "approved", hardLimits: [{ id: "x", label: "ok", metric: "ebitda", band: { min: 1 } }, { id: "y", metric: "bogus" }, 5], preferences: [{ id: "p", label: "p", metric: "ebitda", weight: "x" }] });
    expect(p?.hardLimits).toHaveLength(1);
    expect(p?.preferences).toHaveLength(0);
    expect(p?.status).toBe("approved");
  });
});
