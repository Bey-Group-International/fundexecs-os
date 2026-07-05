import { buildOperatingBrief } from "./operating-brief";

describe("buildOperatingBrief", () => {
  it("surfaces context, blockers, approvals, and next actions", () => {
    const brief = buildOperatingBrief({
      userRole: "owner",
      organizationName: "Apex Capital",
      operatorRole: "independent sponsor",
      strategy: "private_equity",
      activeWorkflows: 2,
      pendingApprovals: 1,
      blockedWorkflows: 1,
      openDeals: 0,
      investors: 0,
      documents: 0,
      connectedChannels: 1,
      recentSessions: 2,
    });

    expect(brief.context[0]).toContain("Apex Capital");
    expect(brief.needsAttention).toEqual(expect.arrayContaining([
      "1 approval waiting on operator review.",
      "No active deal pipeline yet — sourcing is the next operating unlock.",
    ]));
    expect(brief.blocked[0]).toBe("1 workflow blocked and needs triage.");
    expect(brief.readyForApproval[0]).toMatch(/approval queue/i);
    expect(brief.canAutomate.length).toBeGreaterThan(0);
    expect(brief.nextActions[0]).toMatch(/Source and score/i);
    expect(brief.suggestedRoles.some((r) => r.role === "scout")).toBe(true);
  });

  it("reports calm states honestly", () => {
    const brief = buildOperatingBrief({
      userRole: "member",
      organizationName: "FundExecs",
      operatorRole: null,
      strategy: null,
      activeWorkflows: 0,
      pendingApprovals: 0,
      blockedWorkflows: 0,
      openDeals: 3,
      investors: 4,
      documents: 2,
      connectedChannels: 0,
      recentSessions: 0,
    });

    expect(brief.blocked).toEqual(["No blocked workflows detected."]);
    expect(brief.readyForApproval).toEqual(["No approval gates are currently waiting."]);
    expect(brief.context).toContain("No primary strategy set");
  });
});
