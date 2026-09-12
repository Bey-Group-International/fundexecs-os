import {
  canExit,
  exitLabel,
  hostLeaveNote,
  isAwaitingReport,
  isCallRunning,
  leaveWithoutEndingLabel,
  nextPhase,
  type CallPhase,
} from "@/lib/meetings/call-phase";

const ALL: CallPhase[] = ["live", "ending", "failed", "left"];

describe("canExit", () => {
  it("allows an exit press while live", () => {
    expect(canExit("live")).toBe(true);
  });

  it("ignores an exit press while the report is generating", () => {
    // The press that used to post a second report and a second batch of tasks.
    expect(canExit("ending")).toBe(false);
  });

  it("allows a retry after a failed report", () => {
    expect(canExit("failed")).toBe(true);
  });

  it("ignores an exit press once already gone", () => {
    expect(canExit("left")).toBe(false);
  });
});

describe("isCallRunning", () => {
  it("is true only while live", () => {
    expect(isCallRunning("live")).toBe(true);
    for (const phase of ALL.filter((p) => p !== "live")) {
      expect(isCallRunning(phase)).toBe(false);
    }
  });
});

describe("isAwaitingReport", () => {
  it("shows the progress overlay only while ending", () => {
    expect(isAwaitingReport("ending")).toBe(true);
    for (const phase of ALL.filter((p) => p !== "ending")) {
      expect(isAwaitingReport(phase)).toBe(false);
    }
  });
});

describe("exitLabel", () => {
  it("names the action while live", () => {
    expect(exitLabel("live", true)).toBe("End for all");
    expect(exitLabel("live", false)).toBe("Leave");
  });

  it("shows progress while ending, so the press visibly did something", () => {
    expect(exitLabel("ending", true)).toBe("Ending…");
    expect(exitLabel("ending", false)).toBe("Leaving…");
  });

  it("offers the action again after a failure", () => {
    expect(exitLabel("failed", true)).toBe("End for all");
  });
});

describe("nextPhase", () => {
  it("ends into the report wait", () => {
    expect(nextPhase("live", "end")).toBe("ending");
  });

  it("leaves outright", () => {
    expect(nextPhase("live", "leave")).toBe("left");
  });

  it("holds at ending when the exit is pressed again", () => {
    expect(nextPhase("ending", "end")).toBe("ending");
    expect(nextPhase("ending", "leave")).toBe("ending");
  });

  it("moves to failed only from the wait it belongs to", () => {
    expect(nextPhase("ending", "report_failed")).toBe("failed");
    expect(nextPhase("live", "report_failed")).toBe("live");
    expect(nextPhase("left", "report_failed")).toBe("left");
  });

  it("completes on a successful report", () => {
    expect(nextPhase("ending", "report_ok")).toBe("left");
  });

  it("retries from failed back into the wait", () => {
    expect(nextPhase("failed", "end")).toBe("ending");
  });

  it("lets the user stop waiting from any phase", () => {
    for (const phase of ALL) expect(nextPhase(phase, "abandon")).toBe("left");
  });

  it("lets a host ending the room override any local phase", () => {
    for (const phase of ALL) expect(nextPhase(phase, "remote_end")).toBe("left");
  });

  it("never leaves a phase outside the known set", () => {
    const events = ["leave", "end", "report_ok", "report_failed", "abandon", "remote_end"] as const;
    for (const phase of ALL) {
      for (const event of events) expect(ALL).toContain(nextPhase(phase, event));
    }
  });
});

describe("leaveWithoutEndingLabel", () => {
  // The distinction is the whole point of the control: a host pressing this is
  // choosing the thing that does NOT end the call for everyone else.
  it("says what it does not do", () => {
    expect(leaveWithoutEndingLabel("live")).toBe("Leave without ending");
  });

  it("shows progress while ending, like every other exit control", () => {
    expect(leaveWithoutEndingLabel("ending")).toBe("Leaving…");
  });

  it("offers the action again after a failed report", () => {
    expect(leaveWithoutEndingLabel("failed")).toBe("Leave without ending");
  });

  // It must never read "Ending…", which is the label for the exit that takes
  // everyone with it.
  it("is never confusable with the end-for-all label", () => {
    const phases: CallPhase[] = ["live", "ending", "failed", "left"];
    for (const phase of phases) {
      expect(leaveWithoutEndingLabel(phase)).not.toBe(exitLabel(phase, true));
    }
  });
});

describe("hostLeaveNote", () => {
  it("says the meeting survives, which is the reason to press it", () => {
    expect(hostLeaveNote(0)).toMatch(/keeps running/);
    expect(hostLeaveNote(0)).toMatch(/rejoin/);
  });

  // Nothing else ends the meeting, so a host who leaves and never comes back
  // leaves a room with no report. Better said than discovered.
  it("warns that no report is generated", () => {
    expect(hostLeaveNote(0)).toMatch(/No report/);
  });

  // The cost that falls on someone else: admission is checked against host_id
  // server-side, so nobody left in the room can answer a knock.
  it("names the people who would be stranded", () => {
    expect(hostLeaveNote(1)).toBe(
      "1 person is still waiting to be admitted, and only you can let them in."
      + " The meeting keeps running, and you can rejoin from your meetings list.",
    );
    expect(hostLeaveNote(3)).toMatch(/^3 people are still waiting/);
  });

  it("does not claim anyone is waiting when nobody is", () => {
    expect(hostLeaveNote(0)).not.toMatch(/waiting/);
    // A count that arrived negative is not a reason to announce phantom guests.
    expect(hostLeaveNote(-1)).toBe(hostLeaveNote(0));
  });
});
