// Coverage for the pure enrollment helper. Contract: a display SequenceTemplate
// maps to outreach_sequences steps with sequential indices, an allowed channel,
// and preserved copy/timing.

import { sequenceStepsFromTemplate } from "./prospect-enrollment";
import { sequenceTemplate } from "@/lib/outreach";

describe("sequenceStepsFromTemplate", () => {
  it("maps a template to indexed outreach steps on an allowed channel", () => {
    const template = sequenceTemplate("lp_warm_intro")!;
    const steps = sequenceStepsFromTemplate(template);

    expect(steps).toHaveLength(template.steps.length);
    expect(steps.map((s) => s.step_index)).toEqual([0, 1, 2]);
    for (const s of steps) {
      expect(s.channel).toBe("email"); // outreach_sequences enum
      expect(s.stop_if_replied).toBe(true);
      expect(typeof s.body_template).toBe("string");
    }
    expect(steps[0].delay_days).toBe(template.steps[0].delay_days);
    expect(steps[0].subject).toBe(template.steps[0].subject);
    expect(steps[0].body_template).toBe(template.steps[0].body);
  });

  it("normalizes a LinkedIn template's channel to email", () => {
    const steps = sequenceStepsFromTemplate(sequenceTemplate("linkedin_light")!);
    expect(steps.every((s) => s.channel === "email")).toBe(true);
  });
});
