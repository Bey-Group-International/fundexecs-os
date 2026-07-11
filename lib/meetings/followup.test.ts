import { buildFollowupPrompt, formatMoney } from "./followup";

describe("formatMoney", () => {
  it("compacts to K / M / B", () => {
    expect(formatMoney(900_000)).toBe("$900.0K");
    expect(formatMoney(25_000_000)).toBe("$25.0M");
    expect(formatMoney(1_500_000_000)).toBe("$1.5B");
    expect(formatMoney(500)).toBe("$500");
  });

  it("honors a non-USD currency and guards nullish/NaN", () => {
    expect(formatMoney(10_000_000, "EUR")).toBe("EUR 10.0M");
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
    expect(formatMoney(Number.NaN)).toBeNull();
  });
});

describe("buildFollowupPrompt", () => {
  it("embeds meeting, attendee, deal, fund and captured notes plus the follow-up outline", () => {
    const prompt = buildFollowupPrompt({
      meeting: {
        title: "Project Atlas — LP Update",
        meetingType: "lp_update",
        priority: "high",
        objective: "Secure a re-up commitment for Fund III",
        agenda: "Performance, pipeline, terms",
        attendees: [
          { name: "Jane Doe", type: "external", email: "jane@lp.com" },
          { name: "Sam Internal", type: "internal" },
        ],
      },
      deal: { name: "Atlas Logistics", stage: "diligence", assetClass: "Infrastructure", targetAmount: 25_000_000 },
      fund: { name: "FundExecs Fund III", fundType: "fund", vintageYear: 2026, committedCapital: 250_000_000, currency: "USD" },
      notes: {
        summary: "LP is supportive and signaled intent to re-up.",
        actionItems: ["Sam: Send updated deck by Friday"],
        keyPoints: ["Performance ahead of plan"],
      },
    });

    // Context is present with real names/figures.
    expect(prompt).toContain("Project Atlas — LP Update");
    expect(prompt).toContain("Secure a re-up commitment for Fund III");
    expect(prompt).toContain("Jane Doe");
    expect(prompt).toContain("Atlas Logistics");
    expect(prompt).toContain("$25.0M");
    expect(prompt).toContain("FundExecs Fund III");
    expect(prompt).toContain("$250.0M");
    // Titleized enum-ish values.
    expect(prompt).toContain("Lp Update");
    // Captured report notes.
    expect(prompt).toContain("LP is supportive and signaled intent to re-up.");
    expect(prompt).toContain("Sam: Send updated deck by Friday");
    expect(prompt).toContain("Performance ahead of plan");
    // The post-meeting outline is requested.
    expect(prompt).toContain("Decisions made");
    expect(prompt).toContain("Action items");
    expect(prompt).toContain("Risks & watch-items");
    expect(prompt).toContain("Approval-sensitive language");
    expect(prompt).toContain("CRM / next-step updates");
    expect(prompt).toContain("Follow-up email");
    expect(prompt).toContain("Proposed next meeting");
    expect(prompt).toContain("Confirm before sending");
  });

  it("still returns a structured prompt with only a title (no empty headers)", () => {
    const prompt = buildFollowupPrompt({ meeting: { title: "Quick sync" } });
    expect(prompt).toContain("Quick sync");
    expect(prompt).toContain("institutional analyst for a fund manager");
    // No deal/fund/notes blocks when there's no such context.
    expect(prompt).not.toContain("DEAL\n");
    expect(prompt).not.toContain("FUND / VEHICLE");
    expect(prompt).not.toContain("CAPTURED SUMMARY");
    expect(prompt).not.toContain("CAPTURED KEY POINTS");
    expect(prompt).not.toContain("CAPTURED ACTION ITEMS");
    // Attendees block omitted when there are none.
    expect(prompt).not.toContain("ATTENDEES");
  });

  it("omits captured-notes headers when the report has no usable content", () => {
    const prompt = buildFollowupPrompt({
      meeting: { title: "Debrief" },
      notes: { summary: "  ", actionItems: [], keyPoints: null },
    });
    expect(prompt).toContain("Debrief");
    expect(prompt).not.toContain("CAPTURED SUMMARY");
    expect(prompt).not.toContain("CAPTURED ACTION ITEMS");
    expect(prompt).not.toContain("CAPTURED KEY POINTS");
  });
});
