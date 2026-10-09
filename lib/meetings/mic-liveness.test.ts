// Whether a microphone that has gone quiet is a stall, and what to do about it.
//
// The reported shape: a member talks for minutes, the controls say "live", the
// connection is healthy, and nobody hears a word — because the track went
// `muted` without ending and nothing was watching for that on the audio side.

import {
  MIC_REOPEN_COOLDOWN_MS,
  MIC_STALL_MS,
  micStallAction,
  type MicFacts,
} from "./mic-liveness";
import { CAMERA_STALL_MS } from "./camera-liveness";

/** A stalled microphone the member expects to be live, with overrides. */
function facts(over: Partial<MicFacts> = {}): MicFacts {
  return {
    on: true,
    readyState: "live",
    muted: true,
    visible: true,
    lastReopenAt: null,
    now: 100_000,
    ...over,
  };
}

describe("a microphone that is working", () => {
  it("is left alone", () => {
    expect(micStallAction(facts({ muted: false }))).toBe("ignore");
  });

  // Muting is a disabled track, and the browser may mute it too. Either way
  // the member asked for silence, and reopening would be a device opened for
  // somebody who had just switched it off.
  it("is left alone when the member themselves muted", () => {
    expect(micStallAction(facts({ on: false }))).toBe("ignore");
    expect(micStallAction(facts({ on: false, muted: false }))).toBe("ignore");
  });

  // A track that ended is the device-loss listener's, which moves the call to
  // the system default; two repairs racing for one microphone is worse than one.
  it("leaves a track that has ended to the device-loss listener", () => {
    expect(micStallAction(facts({ readyState: "ended" }))).toBe("ignore");
  });
});

describe("a microphone that stalled", () => {
  it("is reopened the first time", () => {
    expect(micStallAction(facts())).toBe("reopen");
  });

  // A reopen that lands another muted track must not become a loop that
  // reopens the microphone every few seconds for the rest of the meeting.
  it("is reported rather than reopened again straight away", () => {
    expect(micStallAction(facts({ lastReopenAt: 100_000 - MIC_STALL_MS }))).toBe("notice");
    expect(micStallAction(facts({ lastReopenAt: 100_000 - MIC_REOPEN_COOLDOWN_MS + 1 }))).toBe("notice");
  });

  // A second, unrelated stall later in the call still gets the repair.
  it("is reopened again once the cooldown has passed", () => {
    expect(micStallAction(facts({ lastReopenAt: 100_000 - MIC_REOPEN_COOLDOWN_MS }))).toBe("reopen");
    expect(micStallAction(facts({ lastReopenAt: 0 }))).toBe("reopen");
  });
});

describe("a phone in a pocket", () => {
  // Backgrounding mutes the capture and un-mutes it on return. A reopen while
  // hidden is refused or replaces a track that was about to recover by itself.
  it("stands down while the page is hidden", () => {
    expect(micStallAction(facts({ visible: false }))).toBe("ignore");
    expect(micStallAction(facts({ visible: false, lastReopenAt: 99_000 }))).toBe("ignore");
  });

  it("acts once the page is back, for a track that stayed muted", () => {
    expect(micStallAction(facts({ visible: true }))).toBe("reopen");
  });
});

describe("when to look", () => {
  // Some hardware blips `mute` around a profile change, and a fresh track can
  // report muted before its first buffer lands. The camera's stall settled on
  // the same figure for the same reasons; a shorter one here would reopen
  // microphones that were about to come back.
  it("waits as long as the camera does before calling a blip a stall", () => {
    expect(MIC_STALL_MS).toBe(CAMERA_STALL_MS);
  });

  it("does not wait so long that a sentence goes unheard", () => {
    expect(MIC_STALL_MS).toBeLessThanOrEqual(5_000);
  });

  it("reopens at most once a minute", () => {
    expect(MIC_REOPEN_COOLDOWN_MS).toBeGreaterThanOrEqual(60_000);
  });
});
