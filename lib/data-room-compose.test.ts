// lib/data-room-compose.test.ts
import { composeDraft, type ComposeFoundation } from "@/lib/data-room-compose";

function f(overrides: Partial<ComposeFoundation> = {}): ComposeFoundation {
  return {
    orgName: "Acme Capital",
    tagline: "Disciplined lower-middle-market buyouts",
    description: "Acme is a lower-middle-market buyout firm.",
    entityType: "LP",
    jurisdiction: "Delaware",
    website: "https://acme.vc",
    thesisTitle: "Control buyouts in industrials",
    thesisSummary: "We buy founder-owned industrials.",
    assetClasses: ["Buyout"],
    geographies: ["North America"],
    targetIrr: 25,
    targetMoic: 3,
    dealCount: 4,
    realizedCount: 2,
    grossIrr: 28,
    pooledMoic: 2.4,
    totalInvested: "$120.0M",
    team: [{ name: "Jane Doe", title: "Managing Partner" }],
    entities: ["Acme GP LLC"],
    ...overrides,
  };
}

describe("composeDraft", () => {
  it("uses the executive-summary template by document name", () => {
    const md = composeDraft("Executive Summary", "marketing", f());
    expect(md).toContain("# Executive Summary — Acme Capital");
    expect(md).toContain("Weighted gross IRR: 28%");
  });

  it("uses the one-pager name to pick the exec-summary template", () => {
    const md = composeDraft("Firm One-Pager", "overview", f());
    expect(md).toContain("Executive Summary");
  });

  it("composes a thesis from the section", () => {
    const md = composeDraft("Strategy Memo", "thesis", f());
    expect(md).toContain("# Investment Strategy");
    expect(md).toContain("Target gross IRR: 25%");
  });

  it("marks missing data with TODO rather than inventing it", () => {
    const md = composeDraft("Team Bios", "team", f({ team: [] }));
    expect(md).toContain("[TODO");
  });

  it("always returns non-empty markdown", () => {
    expect(composeDraft("Mystery Doc", "references", f()).length).toBeGreaterThan(0);
  });
});
