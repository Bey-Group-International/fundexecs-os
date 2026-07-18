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
});
