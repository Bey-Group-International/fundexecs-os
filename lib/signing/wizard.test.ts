import { WIZARD_STEPS, wizardStep } from "./wizard";

describe("wizardStep", () => {
  it("maps an envelope's status to the step it is on", () => {
    expect(wizardStep("draft")).toBe(1);
    expect(wizardStep("sent")).toBe(2);
    expect(wizardStep("partially_signed")).toBe(3);
    expect(wizardStep("completed")).toBe(4);
  });
  it("has no step for a voided, declined or expired envelope", () => {
    for (const s of ["voided", "declined", "expired", "nope"]) expect(wizardStep(s)).toBeNull();
  });
  it("names three steps, in order", () => {
    expect(WIZARD_STEPS.map((s) => s.label)).toEqual(["Place blocks", "Reader signs", "Countersign"]);
  });
});
