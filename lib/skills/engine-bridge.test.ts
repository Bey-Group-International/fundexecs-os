// Tests for step → skill detection.
import { detectSkillForStep } from "./engine-bridge";

describe("detectSkillForStep", () => {
  it("detects screen-deal", () => {
    expect(detectSkillForStep("Screen this opportunity against our mandate")).toBe("screen-deal");
    expect(detectSkillForStep("Qualify the deal")).toBe("screen-deal");
    expect(detectSkillForStep("Mandate-fit check")).toBe("screen-deal");
  });

  it("detects returns", () => {
    expect(detectSkillForStep("Build a preliminary returns case")).toBe("returns");
    expect(detectSkillForStep("Run the LBO")).toBe("returns");
    expect(detectSkillForStep("Estimate IRR and MOIC")).toBe("returns");
  });

  it("detects dd-checklist", () => {
    expect(detectSkillForStep("Generate a diligence checklist")).toBe("dd-checklist");
    expect(detectSkillForStep("Prepare the diligence request list")).toBe("dd-checklist");
  });

  it("detects ic-memo", () => {
    expect(detectSkillForStep("Prepare an IC pre-read")).toBe("ic-memo");
    expect(detectSkillForStep("Assemble the investment committee memo")).toBe("ic-memo");
  });

  it("detects source-deals", () => {
    expect(detectSkillForStep("Source targets for the mandate")).toBe("source-deals");
    expect(detectSkillForStep("Build a sourcing list")).toBe("source-deals");
    expect(detectSkillForStep("Rank the candidates by fit")).toBe("source-deals");
  });

  it("still routes a diligence request list to dd-checklist, not source-deals", () => {
    // The dd-checklist rule precedes source-deals, so "request list" stays diligence.
    expect(detectSkillForStep("Prepare the diligence request list")).toBe("dd-checklist");
  });

  it("prefers the more specific skill (ic-memo over returns)", () => {
    // A step that mentions both IC pre-read and returns resolves to the memo.
    expect(detectSkillForStep("IC pre-read summarizing the returns case")).toBe("ic-memo");
  });

  it("returns null for a non-skill step", () => {
    expect(detectSkillForStep("Draft an intro email to the founder")).toBeNull();
    expect(detectSkillForStep("Schedule a management meeting")).toBeNull();
    expect(detectSkillForStep("")).toBeNull();
  });

  it("only returns registered skill ids", () => {
    const id = detectSkillForStep("Screen the deal");
    expect(id).toBe("screen-deal");
  });

  it("detects the PE department skills", () => {
    const cases: Array<[string, string]> = [
      ["Prepare the final investment report", "final-investment-report"],
      ["Set the bid price range and walk-away price", "bid-range"],
      ["Compile the red flag register", "red-flag-register"],
      ["Run the quality of earnings bridge", "qoe-bridge"],
      ["Test customer concentration", "revenue-quality"],
      ["Covenant headroom for Q4", "covenant-watch"],
      ["Build the 13-week cash forecast", "cash-13-week"],
      ["KPI variance for March", "kpi-variance"],
      ["Compare the lender term sheets", "financing-terms"],
      ["Assess IPO readiness", "ipo-readiness"],
      ["Exit readiness and equity story", "exit-readiness"],
      ["Exit options paper", "exit-routes"],
      ["Data room preparation", "data-room-prep"],
      ["First look at the teaser", "first-look"],
      ["Define the mandate screen", "mandate-screen"],
      ["Target screening of the CRM export", "target-screen"],
      ["Size the debt package and test covenants", "debt-structure"],
      ["Debt structure for the downside case", "debt-structure"],
      ["Run a sensitivity table on entry and exit multiple", "sensitivity"],
      ["Break-even analysis for the bid", "sensitivity"],
      ["Legal due diligence issues list", "legal-dd"],
      ["Build the contract abstract table", "legal-dd"],
    ];
    for (const [step, id] of cases) expect([step, detectSkillForStep(step)]).toEqual([step, id]);
  });

  it("does not let the PE rules steal the existing routes", () => {
    expect(detectSkillForStep("Bid range with IRR and MOIC")).toBe("bid-range"); // specific beats the generic returns rule
    expect(detectSkillForStep("Estimate IRR and MOIC")).toBe("returns");
    expect(detectSkillForStep("Mandate-fit check")).toBe("screen-deal");
    expect(detectSkillForStep("Screen this opportunity against our mandate")).toBe("screen-deal");
  });
});

