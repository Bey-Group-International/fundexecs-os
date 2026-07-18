// Tests for the command → plan resolver.
import { planCommand } from "./dispatch";

describe("planCommand — navigation", () => {
  it("plans a read-only navigation command into a pane, no approval", () => {
    const p = planCommand("DEAL Maple Street");
    expect(p.kind).toBe("navigate");
    expect(p.pane).toEqual({ paneType: "deal", title: "Deal: Maple Street", entityLabel: "Maple Street" });
    expect(p.requiresApproval).toBe(false);
    expect(p.nonDelegable).toBe(false);
    expect(p.classification?.tier).toBe(1);
    expect(p.deepLink).toBe("/deals");
  });

  it("plans a no-arg navigation command (PIPE)", () => {
    const p = planCommand("PIPE");
    expect(p.kind).toBe("navigate");
    expect(p.pane?.paneType).toBe("pipeline");
    expect(p.missing).toHaveLength(0);
  });

  it("resolves an alias to its pane", () => {
    expect(planCommand("INVESTOR Redwood").pane?.paneType).toBe("lp");
  });
});

describe("planCommand — analysis", () => {
  it("plans an analysis command into an analysis pane, runs immediately (Tier 1)", () => {
    const p = planCommand("LBO Maple Street");
    expect(p.kind).toBe("analyze");
    expect(p.pane?.paneType).toBe("analysis");
    expect(p.pane?.title).toBe("LBO: Maple Street");
    expect(p.requiresApproval).toBe(false);
    expect(p.classification?.tier).toBe(1);
  });
});

describe("planCommand — gated workflows", () => {
  it("marks a capital-binding command Tier-3 non-delegable and previews it", () => {
    const p = planCommand("CAPCALL Fund II");
    expect(p.kind).toBe("workflow");
    expect(p.classification?.tier).toBe(3);
    expect(p.requiresApproval).toBe(true);
    expect(p.nonDelegable).toBe(true);
    expect(p.requiresPreview).toBe(true);
    expect(p.summary).toMatch(/non-delegable/i);
  });

  it("marks an external-communication command Tier-2 operator approval", () => {
    const p = planCommand("OUTREACH Q3 LP list");
    expect(p.classification?.tier).toBe(2);
    expect(p.requiresApproval).toBe(true);
    expect(p.nonDelegable).toBe(false);
    expect(p.summary).toMatch(/operator approval/i);
  });

  it("treats an internal-write command as an immediate Tier-1 draft-style action", () => {
    const p = planCommand("CREATE DEAL Maple Street");
    expect(p.classification?.tier).toBe(1);
    expect(p.requiresApproval).toBe(false);
    expect(p.kind).toBe("workflow"); // workflow category, but Tier-1
  });
});

describe("planCommand — ask earn + incomplete + unknown", () => {
  it("plans ASK EARN into a copilot pane", () => {
    const p = planCommand("ASK EARN analyze Maple and prep an IC memo");
    expect(p.kind).toBe("ask-earn");
    expect(p.pane?.paneType).toBe("copilot");
    expect(p.deepLink).toBe("/earn");
  });

  it("flags a recognized verb missing a required arg as incomplete", () => {
    const p = planCommand("DEAL");
    expect(p.kind).toBe("incomplete");
    expect(p.missing).toContain("entity");
    expect(p.pane).toBeNull();
  });

  it("falls back to unknown (NL path) for a non-command", () => {
    const p = planCommand("what deals closed last quarter?");
    expect(p.kind).toBe("unknown");
    expect(p.parsed).toBeNull();
    expect(p.summary).toMatch(/Ask Earn/);
  });

  it("returns an empty summary for empty input", () => {
    expect(planCommand("   ").summary).toBe("");
  });
});
