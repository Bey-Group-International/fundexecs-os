// Tests for the unified action & safety contract.
import {
  classifySideEffect,
  requiresApproval,
  isNonDelegable,
  tierForSideEffect,
  verbsFor,
  ALL_SIDE_EFFECT_LEVELS,
  type SideEffectLevel,
} from "./action-contract";

describe("action contract — side-effect → gate tier", () => {
  it("maps read-only / drafts / analysis to Tier 1, no approval, immediate", () => {
    for (const level of ["read-only", "local-draft", "internal-write", "capital-analysis"] as SideEffectLevel[]) {
      const c = classifySideEffect(level);
      expect(c.tier).toBe(1);
      expect(c.approval).toBe("none");
      expect(c.executesImmediately).toBe(true);
      expect(requiresApproval(level)).toBe(false);
    }
  });

  it("maps external / compliance / destructive to Tier 2 operator approval with preview", () => {
    for (const level of ["external-communication", "external-data-write", "compliance-sensitive", "destructive"] as SideEffectLevel[]) {
      const c = classifySideEffect(level);
      expect(c.tier).toBe(2);
      expect(c.approval).toBe("operator");
      expect(c.executesImmediately).toBe(false);
      expect(c.requiresPreview).toBe(true);
    }
  });

  it("ALWAYS makes capital-binding + transaction-execution Tier 3, non-delegable", () => {
    for (const level of ["capital-binding", "transaction-execution"] as SideEffectLevel[]) {
      const c = classifySideEffect(level);
      expect(c.tier).toBe(3);
      expect(c.approval).toBe("human_nondelegable");
      expect(isNonDelegable(level)).toBe(true);
      expect(c.executesImmediately).toBe(false);
    }
  });

  it("no non-Tier-3 level is ever non-delegable", () => {
    for (const level of ALL_SIDE_EFFECT_LEVELS) {
      if (tierForSideEffect(level) !== 3) expect(isNonDelegable(level)).toBe(false);
    }
  });

  it("classifies every level (total function)", () => {
    expect(ALL_SIDE_EFFECT_LEVELS).toHaveLength(10);
    for (const level of ALL_SIDE_EFFECT_LEVELS) {
      const c = classifySideEffect(level);
      expect([1, 2, 3]).toContain(c.tier);
    }
  });

  it("offers run for immediate levels and approve/preview for gated ones", () => {
    expect(verbsFor("read-only")).toContain("run");
    expect(verbsFor("read-only")).not.toContain("approve");
    expect(verbsFor("capital-binding")).toContain("approve");
    expect(verbsFor("capital-binding")).toContain("dry-run");
    expect(verbsFor("capital-binding")).not.toContain("run");
  });
});
