// lib/lp-onboarding.test.ts
import {
  buildOnboardingSteps,
  onboardingProgressPct,
  type OnboardingStatus,
} from "@/lib/lp-onboarding";

// --- buildOnboardingSteps ----------------------------------------------------
describe("buildOnboardingSteps", () => {
  it("always returns 5 steps (pending, accreditation, subscription, committed, complete)", () => {
    const steps = buildOnboardingSteps("pending");
    expect(steps).toHaveLength(5);
    expect(steps.map((s) => s.key)).toEqual([
      "pending",
      "accreditation",
      "subscription",
      "committed",
      "complete",
    ]);
  });

  it("does not include 'expired' in the step list", () => {
    const steps = buildOnboardingSteps("expired");
    expect(steps.map((s) => s.key)).not.toContain("expired");
  });

  it("marks the current step correctly for 'accreditation'", () => {
    const steps = buildOnboardingSteps("accreditation");
    const current = steps.find((s) => s.current);
    expect(current?.key).toBe("accreditation");
  });

  it("marks all steps before the current as completed", () => {
    const steps = buildOnboardingSteps("subscription");
    expect(steps[0].completed).toBe(true); // pending
    expect(steps[1].completed).toBe(true); // accreditation
    expect(steps[2].completed).toBe(false); // subscription (current)
    expect(steps[2].current).toBe(true);
  });

  it("marks no step as completed when status is 'pending'", () => {
    const steps = buildOnboardingSteps("pending");
    expect(steps.every((s) => !s.completed)).toBe(true);
  });

  it("marks all steps as completed when status is 'complete'", () => {
    const steps = buildOnboardingSteps("complete");
    // All but 'complete' itself are completed; 'complete' is current
    const completedSteps = steps.filter((s) => s.completed);
    expect(completedSteps).toHaveLength(4);
  });

  it("each step has a label and description", () => {
    const steps = buildOnboardingSteps("pending");
    steps.forEach((s) => {
      expect(typeof s.label).toBe("string");
      expect(s.label.length).toBeGreaterThan(0);
      expect(typeof s.description).toBe("string");
    });
  });
});

// --- onboardingProgressPct ---------------------------------------------------
describe("onboardingProgressPct", () => {
  const cases: [OnboardingStatus, number][] = [
    ["pending", 10],
    ["accreditation", 30],
    ["subscription", 60],
    ["committed", 85],
    ["complete", 100],
    ["expired", 0],
  ];

  it.each(cases)("returns %d%% for status '%s'", (status, expected) => {
    expect(onboardingProgressPct(status)).toBe(expected);
  });

  it("progress increases through the funnel order", () => {
    const funnel: OnboardingStatus[] = ["pending", "accreditation", "subscription", "committed", "complete"];
    const pcts = funnel.map(onboardingProgressPct);
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i]).toBeGreaterThan(pcts[i - 1]);
    }
  });
});
