// Golden tests for the risk-register deterministic core.
import { riskRegister, type RiskRegisterInput } from "./risk-register";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "risk_compliance" };
const run = (input: RiskRegisterInput) => riskRegister.run(input, ctx);

describe("risk-register core", () => {
  it("scores each risk (likelihood × impact) and assigns severity", () => {
    const r = run({
      entityName: "Acme Fund",
      risks: [
        { name: "Key-person dependency", category: "Operational", likelihood: 4, impact: 5, mitigation: "Succession plan", owner: "COO" },
        { name: "FX exposure", category: "Market", likelihood: 3, impact: 3, mitigation: "Hedging policy", owner: "CFO" },
        { name: "Vendor lock-in", category: "Operational", likelihood: 2, impact: 2, mitigation: "Second source", owner: "CTO" },
      ],
    });
    const high = r.structured.register.find((e) => e.name === "Key-person dependency");
    const med = r.structured.register.find((e) => e.name === "FX exposure");
    const low = r.structured.register.find((e) => e.name === "Vendor lock-in");
    expect(high?.score).toBe(20); // 4 × 5
    expect(high?.severity).toBe("high");
    expect(med?.score).toBe(9); // 3 × 3
    expect(med?.severity).toBe("medium");
    expect(low?.score).toBe(4); // 2 × 2
    expect(low?.severity).toBe("low");
    expect(r.structured.highCount).toBe(1);
    expect(r.structured.mediumCount).toBe(1);
    expect(r.structured.lowCount).toBe(1);
    expect(r.structured.riskCount).toBe(3);
    // The score is recorded as a CALCULATION, never a fact.
    expect(r.sources.find((s) => s.label === 'Risk "Key-person dependency" score')?.kind).toBe("calculation");
  });

  it("ranks the register by score descending, unscored last", () => {
    const r = run({
      entityName: "Acme Fund",
      risks: [
        { name: "Low", likelihood: 1, impact: 2, mitigation: "m", owner: "o" },
        { name: "Unscored", mitigation: "m", owner: "o" },
        { name: "High", likelihood: 5, impact: 5, mitigation: "m", owner: "o" },
        { name: "Medium", likelihood: 2, impact: 4, mitigation: "m", owner: "o" },
      ],
    });
    expect(r.structured.register.map((e) => e.name)).toEqual(["High", "Medium", "Low", "Unscored"]);
    expect(r.structured.register[3].severity).toBe("unscored");
  });

  it("returns an empty register and FLAGS an empty risk set — never fabricates risks", () => {
    const r = run({ entityName: "Acme Fund", risks: [] });
    expect(r.structured.register).toEqual([]);
    expect(r.structured.riskCount).toBe(0);
    expect(r.structured.highCount).toBe(0);
    expect(r.structured.missingFields).toContain(
      "No risks supplied — this skill scores a provided risk set; it does not fabricate risks.",
    );
    // Nothing fabricated: no sources invented.
    expect(r.sources.length).toBe(0);
  });

  it("treats a missing risks field the same as an empty set", () => {
    const r = run({ entityName: "Acme Fund" });
    expect(r.structured.register).toEqual([]);
    expect(r.structured.riskCount).toBe(0);
    expect(r.structured.missingFields).toContain(
      "No risks supplied — this skill scores a provided risk set; it does not fabricate risks.",
    );
  });

  it("FLAGS missing likelihood/impact, mitigation, and owner per risk instead of inventing them", () => {
    const r = run({
      entityName: "Acme Fund",
      risks: [{ name: "Cyber breach", category: "Technology" }],
    });
    const entry = r.structured.register[0];
    expect(entry.score).toBeNull();
    expect(entry.likelihood).toBeNull();
    expect(entry.impact).toBeNull();
    expect(entry.severity).toBe("unscored");
    expect(entry.gaps).toEqual(expect.arrayContaining(["Missing likelihood/impact", "No mitigation", "No owner"]));
    expect(r.structured.missingFields).toEqual(expect.arrayContaining(['Risk "Cyber breach" — likelihood/impact']));
    // Nothing fabricated: no fact source carries a likelihood/impact number.
    expect(r.sources.some((s) => s.kind === "fact" && s.label.includes("likelihood"))).toBe(false);
  });

  it("counts unmitigated risks", () => {
    const r = run({
      entityName: "Acme Fund",
      risks: [
        { name: "A", likelihood: 3, impact: 3, mitigation: "planned", owner: "o" },
        { name: "B", likelihood: 2, impact: 2, owner: "o" },
        { name: "C", likelihood: 1, impact: 1 },
      ],
    });
    expect(r.structured.unmitigatedCount).toBe(2);
  });

  it("recommends escalation when a high-severity risk is present", () => {
    const r = run({
      entityName: "Acme Fund",
      risks: [{ name: "Regulatory action", likelihood: 5, impact: 4, mitigation: "Counsel engaged", owner: "GC" }],
    });
    expect(r.structured.highCount).toBe(1);
    expect(r.structured.recommendedAction.toLowerCase()).toContain("escalate");
  });

  it("always produces a recommended next action and a narrative", () => {
    const r = run({ entityName: "Acme Fund", risks: [] });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});
