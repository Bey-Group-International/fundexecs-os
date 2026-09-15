import { admissionStatusCopy, canPressJoin, isAwaitingAdmission, type AdmissionUiState,
  isAdmissionFailure,
} from "./admission-ui";

const ALL: AdmissionUiState[] = ["idle", "asking", "waiting", "timed-out"];

describe("canPressJoin", () => {
  it("is live before knocking", () => {
    expect(canPressJoin("idle")).toBe(true);
  });

  // Pressing Join again mid-wait would start a second session and orphan the
  // first — the class of bug this area has produced twice already.
  it("is dead from the moment the knock goes out", () => {
    for (const s of ALL.filter((x) => x !== "idle")) expect(canPressJoin(s)).toBe(false);
  });
});

describe("isAwaitingAdmission", () => {
  it("separates looking from knocking", () => {
    expect(isAwaitingAdmission("idle")).toBe(false);
    for (const s of ALL.filter((x) => x !== "idle")) expect(isAwaitingAdmission(s)).toBe(true);
  });
});

describe("admissionStatusCopy", () => {
  it("says nothing at all before the guest knocks", () => {
    expect(admissionStatusCopy("idle")).toBeNull();
  });

  it("has something to say in every other state", () => {
    for (const s of ALL.filter((x) => x !== "idle")) {
      const copy = admissionStatusCopy(s);
      expect(copy?.title).toBeTruthy();
      expect(copy?.detail).toBeTruthy();
    }
  });

  // The wait is still live past the timeout: the session keeps asking, and a
  // host who answers late still gets their guest in. The copy must not say the
  // chance has gone.
  it("does not tell a timed-out guest the meeting is closed to them", () => {
    const copy = admissionStatusCopy("timed-out");
    expect(copy?.detail).toMatch(/as soon as/i);
    expect(`${copy?.title} ${copy?.detail}`).not.toMatch(/denied|refused|can't join|cannot join/i);
  });

  // The point of staying on one screen — and the guest should be told, because
  // otherwise they will sit still and wait rather than fixing their camera.
  it("tells a waiting guest they can carry on setting up", () => {
    expect(admissionStatusCopy("waiting")?.detail).toMatch(/setting up/i);
  });

  it("offers no cancel while the knock is still in flight", () => {
    expect(admissionStatusCopy("asking")?.cancelLabel).toBeNull();
  });

  it("offers a way out once there is a wait to abandon", () => {
    expect(admissionStatusCopy("waiting")?.cancelLabel).toBeTruthy();
    expect(admissionStatusCopy("timed-out")?.cancelLabel).toBeTruthy();
  });
});

describe("being let in and not getting in", () => {
  // The state that used to be unreachable because nothing caught the failure:
  // the guest sat on "waiting for the host" with every timer already cleared,
  // while the host saw them admitted and gone from the panel.
  it("says the host said yes, and that the problem was afterwards", () => {
    const copy = admissionStatusCopy("failed");
    expect(copy).not.toBeNull();
    expect(copy!.title).toMatch(/couldn't join/i);
    expect(copy!.detail).toMatch(/let you in/i);
  });

  // Nothing is polling any more, so this state has to offer the way back
  // itself rather than describing something still in progress.
  it("offers a way back rather than describing a wait", () => {
    const copy = admissionStatusCopy("failed")!;
    expect(copy.cancelLabel).toMatch(/try again/i);
    expect(copy.detail).not.toMatch(/wait/i);
  });

  // Their devices were never torn down, so asking again costs one press.
  it("tells them their setup survived", () => {
    expect(admissionStatusCopy("failed")!.detail).toMatch(/camera and microphone/i);
  });

  it("is the only state that counts as a failure", () => {
    expect(isAdmissionFailure("failed")).toBe(true);
    for (const state of ["idle", "asking", "waiting", "timed-out"] as const) {
      expect(isAdmissionFailure(state)).toBe(false);
    }
  });

  // The button stays out of reach until they take the way back, so a press
  // cannot race the state it is trying to leave.
  it("does not leave the join button live underneath it", () => {
    expect(canPressJoin("failed")).toBe(false);
  });
});
