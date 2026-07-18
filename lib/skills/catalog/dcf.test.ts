// Golden tests for the dcf deterministic core.
import { dcf, type DcfInput } from "./dcf";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "analyst" };
const run = (input: DcfInput) => dcf.run(input, ctx);

describe("dcf core", () => {
  it("computes a clean DCF: EV, terminal value, equity, and per-share", () => {
    const r = run({
      companyName: "FlowCo",
      baseFcf: 100,
      projectionYears: 5,
      fcfGrowth: 0,
      discountRate: 0.1,
      terminalGrowth: 0.02,
      netDebt: 200,
      sharesOutstanding: 100,
    });
    const o = r.structured;
    expect(o.pvExplicit).toBe(379.1); // Σ 100 / 1.1^t, t=1..5
    expect(o.terminalValue).toBe(1275); // 100 × 1.02 / (0.10 − 0.02)
    expect(o.pvTerminal).toBe(791.7); // 1275 / 1.1^5
    expect(o.enterpriseValue).toBe(1170.8); // pvExplicit + pvTerminal
    expect(o.equityValue).toBe(970.8); // EV − netDebt
    expect(o.perShare).toBe(9.71); // equity / shares
    expect(o.cashFlows).toHaveLength(5);
    expect(o.assumptionsUsed).toEqual([]); // every input supplied — no defaults
    // The EV is a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === "Enterprise value")?.kind).toBe("calculation");
  });

  it("flags missing data instead of inventing it", () => {
    const r = run({ companyName: "Mystery Co" });
    const o = r.structured;
    expect(o.enterpriseValue).toBeNull();
    expect(o.equityValue).toBeNull();
    expect(o.perShare).toBeNull();
    expect(o.cashFlows).toEqual([]);
    expect(o.sensitivities).toEqual([]);
    expect(o.missingFields).toEqual(expect.arrayContaining(["Base FCF", "Discount rate (WACC)", "Shares outstanding"]));
    expect(o.keyRisks).toEqual(expect.arrayContaining(["Enterprise value not computable — base FCF and/or discount rate missing."]));
    // Nothing fabricated: no fact source carries a base-FCF number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label === "Base free cash flow")).toBe(false);
  });

  it("enforces the terminal-growth guard: discount rate must exceed terminal growth", () => {
    const r = run({ companyName: "GuardCo", baseFcf: 100, discountRate: 0.02, terminalGrowth: 0.02 });
    const o = r.structured;
    expect(o.enterpriseValue).toBeNull();
    expect(o.terminalValue).toBeNull();
    expect(o.pvTerminal).toBeNull();
    expect(o.keyRisks).toContain("Discount rate must exceed terminal growth");
    // Explicit cash flows still computed (they only need the discount rate).
    expect(o.cashFlows).toHaveLength(5);
  });

  it("labels every default as an ASSUMPTION, never a fact", () => {
    const r = run({ companyName: "BareCo", baseFcf: 100, discountRate: 0.1 });
    const o = r.structured;
    // projectionYears, fcfGrowth, terminalGrowth, netDebt all default.
    expect(o.assumptionsUsed.length).toBeGreaterThanOrEqual(4);
    expect(r.sources.find((s) => s.label === "Assumed terminal growth")?.kind).toBe("assumption");
    expect(r.sources.find((s) => s.label === "Assumed net debt")?.kind).toBe("assumption");
    expect(o.enterpriseValue).not.toBeNull();
  });

  it("produces sensitivities: EV falls as the discount rate rises and rises with terminal growth", () => {
    const r = run({ companyName: "SensCo", baseFcf: 100, discountRate: 0.1, terminalGrowth: 0.02, projectionYears: 5, fcfGrowth: 0 });
    const s = r.structured.sensitivities;
    expect(s).toHaveLength(4);
    const dLow = s.find((p) => p.param === "discountRate" && p.value === 0.09)!;
    const dHigh = s.find((p) => p.param === "discountRate" && p.value === 0.11)!;
    expect(dLow.enterpriseValue!).toBeGreaterThan(dHigh.enterpriseValue!);
    const tLow = s.find((p) => p.param === "terminalGrowth" && p.value === 0.015)!;
    const tHigh = s.find((p) => p.param === "terminalGrowth" && p.value === 0.025)!;
    expect(tHigh.enterpriseValue!).toBeGreaterThan(tLow.enterpriseValue!);
  });

  it("returns per-share as null when shares outstanding are absent", () => {
    const r = run({ companyName: "NoShares", baseFcf: 100, discountRate: 0.1 });
    expect(r.structured.perShare).toBeNull();
    expect(r.structured.equityValue).not.toBeNull();
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({ companyName: "X" });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});
