/**
 * Whether the room can tell "off" from "cannot".
 *
 * The bug these are written against: a member with no microphone track
 * rendered identically to one who had muted themselves, so pressing "Unmute"
 * flipped the control to on, cancelled the device-recovery watcher, and told
 * the whole room they were live. A guest who denied the permission prompt
 * ended up believing they were speaking, with a host who had been told the
 * same, and a meeting waiting for them.
 *
 * So every case below is about one question: does the product ever claim a
 * member is being heard or seen when they are not.
 */
import {
  camButtonTitle,
  micButtonTitle,
  participationNotice,
  standingOf,
  toggleCanDeliver,
  type Standing,
} from "@/lib/meetings/participation";
import type { MediaFailure } from "@/lib/meetings/media-acquisition";

const live: Standing = { standing: "live" };
const muted: Standing = { standing: "muted" };
const gone = (failure: MediaFailure | null = "denied"): Standing => ({ standing: "unavailable", failure });

describe("standingOf", () => {
  it("reads a transmitting device as live", () => {
    expect(standingOf({ present: true, enabled: true, failure: null })).toEqual({ standing: "live" });
  });

  it("reads an attached but silent device as the member's own choice", () => {
    expect(standingOf({ present: true, enabled: false, failure: null })).toEqual({ standing: "muted" });
  });

  it("reads a missing device as unavailable, carrying why", () => {
    expect(standingOf({ present: false, enabled: false, failure: "in_use" })).toEqual({
      standing: "unavailable",
      failure: "in_use",
    });
  });

  it("does not credit a choice that stopped being the reason", () => {
    // Muted themselves, and then another application took the device. What they
    // chose is no longer what is stopping them, and offering "Unmute" here is
    // the lie this module exists to prevent.
    expect(standingOf({ present: false, enabled: false, failure: "in_use" }).standing).toBe("unavailable");
  });

  it("treats a missing device with no known reason as unavailable, not live", () => {
    // The default must fail safe. `present: false` with nothing known about why
    // is still a member nobody can hear.
    expect(standingOf({ present: false, enabled: true, failure: null })).toEqual({
      standing: "unavailable",
      failure: null,
    });
  });
});

describe("toggleCanDeliver", () => {
  it("lets the button act when there is a track to act on", () => {
    expect(toggleCanDeliver(live)).toBe(true);
    expect(toggleCanDeliver(muted)).toBe(true);
  });

  it("refuses when there is nothing to enable", () => {
    // The load-bearing assertion. `false` here is what stops the press
    // broadcasting `micOn: true` and cancelling the recovery watcher.
    for (const failure of ["denied", "in_use", "missing", null] as const) {
      expect(toggleCanDeliver(gone(failure))).toBe(false);
    }
  });
});

describe("participationNotice", () => {
  it("says nothing when the member has what they asked for", () => {
    expect(participationNotice(live, live)).toBeNull();
    expect(participationNotice(muted, muted)).toBeNull();
    expect(participationNotice(live, muted)).toBeNull();
  });

  it("never fires for a member who merely chose to be off", () => {
    // Somebody muted, or with their camera deliberately off, is not a problem
    // to be solved at them. A banner here would nag every member in every
    // meeting who did the ordinary thing.
    expect(participationNotice(muted, muted)).toBeNull();
  });

  it("says nobody can hear them, and what to do, for each reason", () => {
    expect(participationNotice(gone("denied"), live)).toEqual({
      reason: "no-microphone",
      retry: true,
      text: "Nobody can hear you — your browser is blocking your microphone. Allow it in the address bar, then press Retry.",
    });
    expect(participationNotice(gone("in_use"), live)?.text).toContain("another app is using your microphone");
    expect(participationNotice(gone("missing"), live)?.text).toContain("no microphone was found");
    expect(participationNotice(gone(null), live)?.text).toContain("could not be started");
  });

  it("says nobody can see them when only the camera is gone", () => {
    const notice = participationNotice(live, gone("denied"));
    expect(notice).toEqual({
      reason: "no-camera",
      retry: true,
      text: "Nobody can see you — your browser is blocking your camera. Allow it in the address bar, then press Retry.",
    });
  });

  it("leads with the microphone when both are gone", () => {
    // A meeting survives somebody nobody can see. It does not survive somebody
    // nobody can hear, and it is one address-bar decision either way.
    const notice = participationNotice(gone("denied"), gone("denied"));
    expect(notice?.reason).toBe("neither");
    expect(notice?.text).toContain("hear you");
    expect(notice?.text).toContain("microphone and camera");
  });

  it("offers a retry on every failure, including a denial", () => {
    // Re-asking IS the remedy after a denial: the member allows the site in the
    // address bar and the retry is what picks it up. The text differs because
    // the order differs, not because the button would do nothing.
    for (const failure of ["denied", "in_use", "missing", null] as const) {
      expect(participationNotice(gone(failure), live)?.retry).toBe(true);
      expect(participationNotice(live, gone(failure))?.retry).toBe(true);
    }
  });

  it("reports a reason that can be counted without reading the prose", () => {
    expect(participationNotice(gone(), live)?.reason).toBe("no-microphone");
    expect(participationNotice(live, gone())?.reason).toBe("no-camera");
    expect(participationNotice(gone(), gone())?.reason).toBe("neither");
  });

  it("does not confuse a deliberately dark camera with a missing one", () => {
    // The room disables the camera track on purpose while a background effect
    // is starting, and again when one is abandoned, so that somebody who chose
    // to hide their room is not shown it. That is `muted`, and claiming "no
    // camera found" there would be both wrong and alarming.
    expect(participationNotice(live, muted)).toBeNull();
  });
});

describe("button titles", () => {
  it("never captions a dead control as if pressing it would work", () => {
    expect(micButtonTitle(gone())).toBe("No microphone — retry");
    expect(camButtonTitle(gone())).toBe("No camera — retry");
  });

  it("still says the ordinary thing in the ordinary cases", () => {
    expect(micButtonTitle(live)).toBe("Mute");
    expect(micButtonTitle(muted)).toBe("Unmute");
    expect(camButtonTitle(live)).toBe("Turn camera off");
    expect(camButtonTitle(muted)).toBe("Turn camera on");
  });

  it("never says Unmute for a member who has no microphone", () => {
    // The exact caption that caused this. "Unmute" is a promise.
    for (const failure of ["denied", "in_use", "missing", null] as const) {
      expect(micButtonTitle(gone(failure))).not.toContain("Unmute");
    }
  });
});
