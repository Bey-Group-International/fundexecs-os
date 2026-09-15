import {
  knockAlert,
  shouldRequestNotificationPermission,
  type KnockAlertInput,
} from "./knock-notice";

/** A host, tabbed away, with permission granted, and somebody new at the door. */
const knocking: KnockAlertInput = {
  isHost: true,
  waiting: 1,
  previousWaiting: 0,
  hidden: true,
  permission: "granted",
  name: "Ada",
};

describe("knockAlert", () => {
  it("names the person who is waiting", () => {
    expect(knockAlert(knocking)).toEqual({
      title: "Ada is waiting to join",
      body: "Open the meeting to let them in.",
    });
  });

  it("falls back to somebody rather than an empty name", () => {
    expect(knockAlert({ ...knocking, name: "   " })?.title).toBe("Someone is waiting to join");
    expect(knockAlert({ ...knocking, name: null })?.title).toBe("Someone is waiting to join");
  });

  it("counts them once there is more than one", () => {
    expect(knockAlert({ ...knocking, waiting: 3, name: null })?.title).toBe("3 people are waiting to join");
  });

  it("says nothing to a guest, who could not admit anyone anyway", () => {
    expect(knockAlert({ ...knocking, isHost: false })).toBeNull();
  });

  it("stays quiet while the host is looking at the meeting", () => {
    // The waiting bar is on screen and the chime has already played. A
    // notification on top of that is the noise that gets notifications blocked.
    expect(knockAlert({ ...knocking, hidden: false })).toBeNull();
  });

  it("does not fire on the way back down", () => {
    // Admitting three of four drops the count. Notifying there would fire for
    // something the host had just done themselves.
    expect(knockAlert({ ...knocking, waiting: 1, previousWaiting: 4 })).toBeNull();
    expect(knockAlert({ ...knocking, waiting: 0, previousWaiting: 1 })).toBeNull();
  });

  it("does not fire when the count has not moved", () => {
    expect(knockAlert({ ...knocking, waiting: 2, previousWaiting: 2 })).toBeNull();
  });

  it("never fires without permission actually granted", () => {
    for (const permission of ["default", "denied", "unsupported"] as const) {
      expect(knockAlert({ ...knocking, permission })).toBeNull();
    }
  });

  it("fires for the second of two guests, not just the first", () => {
    expect(knockAlert({ ...knocking, waiting: 2, previousWaiting: 1, name: null })).not.toBeNull();
  });
});

describe("shouldRequestNotificationPermission", () => {
  it("asks a host who has not been asked", () => {
    expect(shouldRequestNotificationPermission({ isHost: true, permission: "default" })).toBe(true);
  });

  it("never asks a guest", () => {
    expect(shouldRequestNotificationPermission({ isHost: false, permission: "default" })).toBe(false);
  });

  it("takes a refusal as an answer", () => {
    // Browsers remember a denial and will not re-prompt; treating it as a
    // question to ask again is how an origin gets permanently blocked.
    expect(shouldRequestNotificationPermission({ isHost: true, permission: "denied" })).toBe(false);
  });

  it("does not ask again once granted", () => {
    expect(shouldRequestNotificationPermission({ isHost: true, permission: "granted" })).toBe(false);
  });

  it("does not ask where there is no such API", () => {
    expect(shouldRequestNotificationPermission({ isHost: true, permission: "unsupported" })).toBe(false);
  });
});
