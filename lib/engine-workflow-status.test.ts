// Coverage for the workflow-completion honesty fix: executeWorkflow used to
// force every workflow's final status to "completed" regardless of how many
// of its steps actually failed (a Claude outage, a dead integration, an
// insufficient-credits error) — and persistOutcome ran unconditionally,
// seeding a deal/asset from empty or error-describing content when every
// step failed. workflowFinalStatus is the pure decision executeWorkflow now
// uses: "failed" (skip persistOutcome) when every step failed,
// "completed_with_errors" when some but not all failed, "completed" only
// when none did.

import { workflowFinalStatus, dispatchFailureMessage } from "./engine";

describe("workflowFinalStatus", () => {
  it("returns completed when no steps failed", () => {
    expect(workflowFinalStatus(3, 0)).toBe("completed");
  });

  it("returns completed_with_errors when some but not all steps failed", () => {
    expect(workflowFinalStatus(3, 1)).toBe("completed_with_errors");
    expect(workflowFinalStatus(3, 2)).toBe("completed_with_errors");
  });

  it("returns failed when every step failed", () => {
    expect(workflowFinalStatus(3, 3)).toBe("failed");
    expect(workflowFinalStatus(1, 1)).toBe("failed");
  });

  it("returns completed for a workflow with zero steps (never both 0 and 0 treated as all-failed)", () => {
    expect(workflowFinalStatus(0, 0)).toBe("completed");
  });
});

describe("dispatchFailureMessage", () => {
  it("returns null when there's no tool result (text-generation steps)", () => {
    expect(dispatchFailureMessage("Send outreach", null)).toBeNull();
    expect(dispatchFailureMessage("Send outreach", undefined)).toBeNull();
  });

  it("returns null when the dispatch succeeded", () => {
    expect(dispatchFailureMessage("Send outreach", { ok: true, channel: "gmail" })).toBeNull();
  });

  it("returns the tool's error string when the dispatch failed", () => {
    expect(dispatchFailureMessage("Send outreach", { ok: false, error: "rate limited" })).toBe("rate limited");
  });

  it("falls back to a generic message when the dispatch failed without an error string", () => {
    expect(dispatchFailureMessage("Send outreach", { ok: false })).toBe("Send outreach could not be dispatched.");
    expect(dispatchFailureMessage("Send outreach", { ok: false, error: 42 })).toBe(
      "Send outreach could not be dispatched.",
    );
  });
});
