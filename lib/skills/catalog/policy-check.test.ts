// Golden tests for the policy-check deterministic core.
import { policyCheck, type PolicyCheckInput } from "./policy-check";
import type { SkillContext } from "@/lib/skills/types";

const ctx: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "risk_compliance" };
const run = (input: PolicyCheckInput) => policyCheck.run(input, ctx);

describe("policy-check core", () => {
  it("flags an explicitly restricted policy and requires escalation", () => {
    const r = run({
      action: "wire funds to counterparty",
      policies: [{ name: "Sanctions block", rule: "No dealings with sanctioned entities", restricted: true }],
    });
    expect(r.structured.flags[0].status).toBe("restricted");
    expect(r.structured.restrictedCount).toBe(1);
    expect(r.structured.requiresEscalation).toBe(true);
  });

  it("flags a forbidden counterparty domain", () => {
    const r = run({
      action: "share materials",
      context: { counterpartyDomain: "badactor.com" },
      policies: [{ name: "Blocked domains", rule: "No sharing with blocked domains", forbiddenDomains: ["badactor.com", "shell.io"] }],
    });
    expect(r.structured.flags[0].status).toBe("restricted");
    expect(r.structured.requiresEscalation).toBe(true);
  });

  it("flags a dollar amount over the policy limit", () => {
    const r = run({
      action: "approve payment",
      context: { dollarAmount: 500_000 },
      policies: [{ name: "Spend cap", rule: "Max single spend 250k", maxDollar: 250_000 }],
    });
    expect(r.structured.flags[0].status).toBe("restricted");
    expect(r.structured.restrictedCount).toBe(1);
  });

  it("flags a jurisdiction outside the permitted set", () => {
    const r = run({
      action: "onboard investor",
      context: { jurisdiction: "IR" },
      policies: [{ name: "Jurisdiction allowlist", rule: "US/EU only", jurisdictions: ["US", "EU"] }],
    });
    expect(r.structured.flags[0].status).toBe("restricted");
  });

  it("returns review (never a silent pass) when the relevant context is MISSING", () => {
    const r = run({
      action: "approve payment",
      // dollarAmount omitted on purpose
      policies: [{ name: "Spend cap", rule: "Max single spend 250k", maxDollar: 250_000 }],
    });
    expect(r.structured.flags[0].status).toBe("review");
    expect(r.structured.reviewCount).toBe(1);
    expect(r.structured.requiresEscalation).toBe(false);
    expect(r.structured.missingContext).toEqual(expect.arrayContaining(["Dollar amount — needed to evaluate a dollar-limit policy."]));
  });

  it("returns ok when the action clears the supplied policies on the given context", () => {
    const r = run({
      action: "approve payment",
      context: { counterpartyDomain: "trusted.com", dollarAmount: 100_000, jurisdiction: "US" },
      policies: [
        { name: "Spend cap", rule: "Max single spend 250k", maxDollar: 250_000 },
        { name: "Blocked domains", rule: "No blocked domains", forbiddenDomains: ["badactor.com"] },
        { name: "Jurisdiction allowlist", rule: "US/EU only", jurisdictions: ["US", "EU"] },
      ],
    });
    expect(r.structured.flags.every((f) => f.status === "ok")).toBe(true);
    expect(r.structured.restrictedCount).toBe(0);
    expect(r.structured.reviewCount).toBe(0);
    expect(r.structured.requiresEscalation).toBe(false);
  });

  it("flags the absence of a policy set instead of assuming the action is fine", () => {
    const r = run({ action: "move capital" });
    expect(r.structured.flags).toEqual([]);
    expect(r.structured.missingContext).toContain("No policies supplied — provide the applicable policy set to evaluate.");
    expect(r.structured.requiresEscalation).toBe(false);
    expect(r.completeness).toBe(0);
  });

  // GUARDRAIL: SUPPORT only — never a final determination, never an authorization.
  it("NEVER authorizes: recommendedAction always defers the final call to a compliance/legal officer", () => {
    const cases: PolicyCheckInput[] = [
      { action: "a", policies: [{ name: "P", rule: "r", restricted: true }] }, // restricted
      { action: "b", policies: [{ name: "P", rule: "r", maxDollar: 10 }] }, // review (missing dollar)
      { action: "c", context: { dollarAmount: 1 }, policies: [{ name: "P", rule: "r", maxDollar: 10 }] }, // ok
      { action: "d" }, // no policies
    ];
    for (const input of cases) {
      const r = run(input);
      expect(r.structured.recommendedAction).toMatch(/compliance or legal officer makes the final determination/i);
      expect(r.structured.recommendedAction).toMatch(/does not authorize|not an authorization/i);
    }
  });

  it("labels supplied values as facts and counts as calculations — nothing fabricated", () => {
    const r = run({
      action: "approve payment",
      context: { dollarAmount: 500_000 },
      policies: [{ name: "Spend cap", rule: "Max 250k", maxDollar: 250_000 }],
    });
    expect(r.sources.find((s) => s.label === "Dollar amount")?.kind).toBe("fact");
    expect(r.sources.find((s) => s.label === "Restricted policy count")?.kind).toBe("calculation");
    // No fact source invents a counterparty domain that was never supplied.
    expect(r.sources.some((s) => s.label === "Counterparty domain")).toBe(false);
  });

  it("always produces a narrative and a recommended action", () => {
    const r = run({ action: "x", policies: [{ name: "P", rule: "r" }] });
    expect(r.narrative.length).toBeGreaterThan(0);
    expect(r.structured.recommendedAction.length).toBeGreaterThan(0);
  });
});
