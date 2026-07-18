// Tests for the operational executive capability registry.
import {
  EXECUTIVES,
  EXECUTIVE_BY_KEY,
  canRunSkill,
  canExecutiveActAt,
  isActionProhibited,
  executivesForSkill,
  type ExecutiveKey,
} from "./registry";
import { AGENT_BY_KEY } from "@/lib/agents";

describe("executive registry", () => {
  it("activates the operational roles the roster lacked", () => {
    const keys = EXECUTIVES.map((e) => e.key);
    expect(keys).toContain("investment_committee");
    expect(keys).toContain("risk_compliance");
    expect(keys).toContain("legal_closing");
  });

  it("backs every executive with a REAL execution AgentKey (no engine drift)", () => {
    for (const exec of EXECUTIVES) {
      expect(AGENT_BY_KEY[exec.backingAgent]).toBeDefined();
    }
  });

  it("never lets any executive act autonomously at Tier 3", () => {
    for (const exec of EXECUTIVES) {
      expect(canExecutiveActAt(exec.key, 3)).toBe(false);
    }
  });

  it("respects the approval ceiling", () => {
    // Analyst is internal-only (ceiling 1): may act at Tier 1, not Tier 2.
    expect(canExecutiveActAt("analyst", 1)).toBe(true);
    expect(canExecutiveActAt("analyst", 2)).toBe(false);
    // Investor Relations may reach Tier 2 (external) — with approval.
    expect(canExecutiveActAt("investor_relations", 2)).toBe(true);
  });

  it("enforces per-executive skill permissions", () => {
    expect(canRunSkill("analyst", "screen-deal")).toBe(true);
    expect(canRunSkill("investor_relations", "screen-deal")).toBe(false);
    // Earn orchestrates — the wildcard permits any skill.
    expect(canRunSkill("earn", "anything")).toBe(true);
  });

  it("prohibits capital-binding actions for fund admin and flags Tier 3 for all", () => {
    expect(isActionProhibited("fund_admin", "post_journal_entry")).toBe(true);
    expect(isActionProhibited("fund_admin", "move_capital")).toBe(true);
    // Tier 3 is structurally prohibited even if not explicitly listed.
    expect(isActionProhibited("analyst", "sign_document")).toBe(true);
  });

  it("resolves the executives permitted to run a skill", () => {
    const execs = executivesForSkill("screen-deal").map((e) => e.key);
    expect(execs).toEqual(expect.arrayContaining<ExecutiveKey>(["analyst", "investment_committee", "diligence"]));
    expect(execs).not.toContain("investor_relations");
  });

  it("every executive carries a bounded domain + review standard", () => {
    for (const exec of EXECUTIVES) {
      expect(exec.domain.length).toBeGreaterThan(0);
      expect(exec.reviewStandard.length).toBeGreaterThan(0);
      expect(exec.approvalCeiling).toBeLessThanOrEqual(2); // never 3
    }
  });

  it("EXECUTIVE_BY_KEY is complete", () => {
    for (const exec of EXECUTIVES) {
      expect(EXECUTIVE_BY_KEY[exec.key]).toBe(exec);
    }
  });
});
