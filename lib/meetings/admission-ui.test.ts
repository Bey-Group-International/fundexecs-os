import { admissionStatusCopy, canPressJoin, isAwaitingAdmission, type AdmissionUiState } from "./admission-ui";

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
