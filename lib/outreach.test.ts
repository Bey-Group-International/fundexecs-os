// lib/outreach.test.ts — pure helpers only (no DB, no react import).
import {
  nextStep,
  renderString,
  renderTemplate,
  sequenceProgress,
  coerceChannel,
  coerceStepAction,
  sequenceTemplate,
  DEFAULT_SEQUENCES,
  type StepLike,
  type EnrollmentLike,
} from "@/lib/outreach";

const NOW = new Date("2026-06-22T12:00:00.000Z");

function step(o: Partial<StepLike> & { step_order: number }): StepLike {
  return {
    delay_days: 0,
    subject: null,
    body: null,
    action: "send_outreach",
    ...o,
  };
}

function enr(o: Partial<EnrollmentLike> = {}): EnrollmentLike {
  return { current_step: 0, status: "active", last_sent_at: null, ...o };
}

const STEPS: StepLike[] = [
  step({ step_order: 1, delay_days: 0, subject: "Hi {{name}}", body: "From {{firm}}", action: "send_intro_request" }),
  step({ step_order: 2, delay_days: 4, subject: "Follow up", action: "share_materials" }),
  step({ step_order: 3, delay_days: 6, subject: "Close", action: "send_outreach" }),
];

describe("nextStep", () => {
  it("returns the first step as immediately due when nothing has been sent", () => {
    const res = nextStep(STEPS, enr(), NOW);
    expect(res?.step.step_order).toBe(1);
    expect(res?.due).toBe(true);
    expect(res?.dueAt).toBeNull();
  });

  it("honors delay_days: the next step is scheduled until its delay elapses", () => {
    const lastSent = new Date("2026-06-22T00:00:00.000Z").toISOString(); // 12h ago vs NOW
    const res = nextStep(STEPS, enr({ current_step: 1, last_sent_at: lastSent }), NOW);
    // Step 2 has delay 4 days, sent only 12h ago → not yet due.
    expect(res?.step.step_order).toBe(2);
    expect(res?.due).toBe(false);
    expect(res?.dueAt).toBe(new Date(new Date(lastSent).getTime() + 4 * 24 * 60 * 60 * 1000).toISOString());
  });

  it("marks the next step due once enough time has passed", () => {
    const lastSent = new Date("2026-06-15T12:00:00.000Z").toISOString(); // 7 days ago
    const res = nextStep(STEPS, enr({ current_step: 1, last_sent_at: lastSent }), NOW);
    expect(res?.step.step_order).toBe(2); // delay 4d, 7d elapsed → due
    expect(res?.due).toBe(true);
  });

  it("returns null when the sequence is finished", () => {
    expect(nextStep(STEPS, enr({ current_step: 3, last_sent_at: NOW.toISOString() }), NOW)).toBeNull();
  });

  it("returns null when the enrollment is not active", () => {
    expect(nextStep(STEPS, enr({ status: "replied" }), NOW)).toBeNull();
    expect(nextStep(STEPS, enr({ status: "stopped" }), NOW)).toBeNull();
  });

  it("sorts steps by order before picking the due one", () => {
    const shuffled = [STEPS[2], STEPS[0], STEPS[1]];
    const res = nextStep(shuffled, enr(), NOW);
    expect(res?.step.step_order).toBe(1);
  });
});

describe("renderString / renderTemplate", () => {
  it("interpolates known placeholders", () => {
    expect(renderString("Hi {{name}} from {{firm}}", { name: "Dana", firm: "Acme" })).toBe("Hi Dana from Acme");
  });

  it("tolerates whitespace inside braces", () => {
    expect(renderString("Hi {{  name  }}", { name: "Dana" })).toBe("Hi Dana");
  });

  it("leaves unknown / missing placeholders intact", () => {
    expect(renderString("Hi {{name}} {{missing}}", { name: "Dana" })).toBe("Hi Dana {{missing}}");
    expect(renderString("Hi {{name}}", {})).toBe("Hi {{name}}");
  });

  it("returns empty string for null/undefined templates", () => {
    expect(renderString(null, { name: "Dana" })).toBe("");
    expect(renderString(undefined, {})).toBe("");
  });

  it("renderTemplate fills subject + body and coerces the action", () => {
    const out = renderTemplate(STEPS[0], { name: "Dana", firm: "Acme" });
    expect(out.subject).toBe("Hi Dana");
    expect(out.body).toBe("From Acme");
    expect(out.action).toBe("send_intro_request");
  });

  it("renderTemplate falls back to a safe action for unknown labels", () => {
    const out = renderTemplate(step({ step_order: 1, action: "move_capital" }), {});
    expect(out.action).toBe("send_outreach");
  });
});

describe("sequenceProgress", () => {
  it("reports zero progress for a fresh active enrollment", () => {
    const p = sequenceProgress(enr(), STEPS);
    expect(p).toMatchObject({ total: 3, sent: 0, pct: 0, nextStepOrder: 1, label: "Step 0 of 3" });
  });

  it("reports partial progress mid-sequence", () => {
    const p = sequenceProgress(enr({ current_step: 1 }), STEPS);
    expect(p.sent).toBe(1);
    expect(p.pct).toBe(33);
    expect(p.nextStepOrder).toBe(2);
    expect(p.label).toBe("Step 1 of 3");
  });

  it("clamps sent to total and reports completion", () => {
    const p = sequenceProgress(enr({ current_step: 5, status: "completed" }), STEPS);
    expect(p.sent).toBe(3);
    expect(p.pct).toBe(100);
    expect(p.nextStepOrder).toBeNull();
    expect(p.label).toBe("Completed");
  });

  it("labels replied / stopped distinctly and stops advancing", () => {
    expect(sequenceProgress(enr({ status: "replied", current_step: 1 }), STEPS).label).toBe("Replied");
    expect(sequenceProgress(enr({ status: "stopped", current_step: 1 }), STEPS).nextStepOrder).toBeNull();
  });

  it("handles an empty sequence safely", () => {
    const p = sequenceProgress(enr(), []);
    expect(p).toMatchObject({ total: 0, sent: 0, pct: 0, nextStepOrder: null });
  });
});

describe("coercers + templates", () => {
  it("coerceChannel falls back to email for unknown channels", () => {
    expect(coerceChannel("linkedin")).toBe("linkedin");
    expect(coerceChannel("call")).toBe("call");
    expect(coerceChannel("carrier-pigeon")).toBe("email");
  });

  it("coerceStepAction restricts to the outreach subset", () => {
    expect(coerceStepAction("share_materials")).toBe("share_materials");
    expect(coerceStepAction("capital_call")).toBe("send_outreach");
  });

  it("DEFAULT_SEQUENCES are well-formed and resolvable by key", () => {
    expect(DEFAULT_SEQUENCES.length).toBeGreaterThan(0);
    for (const t of DEFAULT_SEQUENCES) {
      expect(t.steps.length).toBeGreaterThan(0);
      expect(sequenceTemplate(t.key)).toBe(t);
      // First step is always immediate (delay 0); later steps wait.
      expect(t.steps[0].delay_days).toBe(0);
      for (const s of t.steps) {
        expect(coerceStepAction(s.action)).toBe(s.action);
      }
    }
    expect(sequenceTemplate("nope")).toBeNull();
  });
});
