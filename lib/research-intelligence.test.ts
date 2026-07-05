import {
  emptyPointOfContact,
  normalizeResearchEntity,
  scoreSourceQuality,
  shouldUseBrowserResearch,
  toResearchTableRow,
} from "./research-intelligence";

const now = "2026-07-05T00:00:00Z";

describe("research intelligence standards", () => {
  it("never fabricates point-of-contact fields", () => {
    expect(emptyPointOfContact()).toMatchObject({
      name: "Not publicly verified",
      role: "Not publicly verified",
      email: "Not publicly verified",
      phone: "Not publicly verified",
      verification: "unavailable",
    });
  });

  it("scores primary and filing sources as verified", () => {
    expect(scoreSourceQuality([{ title: "Company", url: "https://company.test", sourceType: "primary", observedAt: now }])).toBe("verified");
    expect(scoreSourceQuality([{ title: "10-K", url: "https://sec.test", sourceType: "filing", observedAt: now }])).toBe("verified");
  });

  it("normalizes incomplete company research into an honest entity", () => {
    const entity = normalizeResearchEntity({
      entity: "Acme Logistics",
      category: "acquisition_target",
    });
    expect(entity.website).toBe("Not publicly verified");
    expect(entity.pointOfContact.email).toBe("Not publicly verified");
    expect(entity.risks).toContain("Data completeness requires verification.");
    expect(entity.recommendedNextAction).toBe("Verify source data before outreach.");
  });

  it("renders CRM/export-ready research table rows", () => {
    const entity = normalizeResearchEntity({
      entity: "Apex Capital",
      category: "investor",
      website: "https://apex.example",
      strategicFit: "Family office mandate fit.",
      sources: [
        { title: "Apex", url: "https://apex.example", sourceType: "primary", observedAt: now },
      ],
    });

    expect(toResearchTableRow(entity)).toMatchObject({
      Entity: "Apex Capital",
      Category: "investor",
      Website: "https://apex.example",
      Confidence: "verified",
      Sources: "https://apex.example",
    });
  });

  it("detects prompts that require browser/web research", () => {
    expect(shouldUseBrowserResearch("Verify this founder's current company and email")).toBe(true);
    expect(shouldUseBrowserResearch("Source 50 acquisition targets in Texas")).toBe(true);
    expect(shouldUseBrowserResearch("Summarize our uploaded memo")).toBe(false);
  });
});
