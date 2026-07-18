// Tests for the governed skill runtime (pure path — executeSkillCore).
import { executeSkillCore } from "./runner";
import type { SkillContext } from "./types";

const base: SkillContext = { workspaceId: "org1", principalId: "p1", executive: "analyst" };

const goodInput = {
  mandate: { sectors: ["software"], minRevenue: 10, maxRevenue: 100 },
  deal: { companyName: "Acme", sector: "Software", revenue: 40, ebitda: 8, enterpriseValue: 64 },
};

describe("executeSkillCore", () => {
  it("runs a permitted skill end-to-end and validates I/O", () => {
    const r = executeSkillCore("screen-deal", goodInput, base);
    expect(r.ok).toBe(true);
    expect(r.status).toBe("succeeded");
    expect(r.inputValidation.valid).toBe(true);
    expect(r.outputValidation.valid).toBe(true);
    expect(r.structured).not.toBeNull();
    expect(r.approvalTier).toBe(1);
    expect(r.requiresApproval).toBe(false); // Tier 1, analyst ceiling covers it
  });

  it("rejects a run by an executive not permitted to run the skill", () => {
    const r = executeSkillCore("screen-deal", goodInput, { ...base, executive: "investor_relations" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe("rejected");
    expect(r.warnings.join(" ")).toContain("not permitted");
  });

  it("fails a run whose input does not validate — the core never runs", () => {
    const r = executeSkillCore("screen-deal", { deal: {} }, base); // missing mandate + companyName
    expect(r.ok).toBe(false);
    expect(r.status).toBe("failed");
    expect(r.inputValidation.valid).toBe(false);
    expect(r.structured).toBeNull();
  });

  it("fails cleanly for an unknown skill", () => {
    const r = executeSkillCore("does-not-exist", {}, base);
    expect(r.ok).toBe(false);
    expect(r.warnings.join(" ")).toContain("Unknown skill");
  });

  it("surfaces flagged missing data as a warning", () => {
    const r = executeSkillCore("screen-deal", { mandate: {}, deal: { companyName: "Bare" } }, base);
    expect(r.warnings.join(" ")).toContain("Missing inputs flagged");
  });
});
