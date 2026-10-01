import {
  ECHO_ATTENUATION,
  ECHO_DETECTED_NOTICE,
  ECHO_MIN_SAMPLES,
  ECHO_RENOTICE_MS,
  ECHO_WINDOW_MS,
  createEchoWatch,
  echoRisk,
  echoRiskNotice,
  isDefaultSink,
  observeEcho,
  type EchoDevice,
  type EchoWatch,
} from "@/lib/meetings/echo";

const HEADSET_MIC: EchoDevice = { deviceId: "mic-headset", groupId: "g-headset" };
const HEADSET_OUT: EchoDevice = { deviceId: "out-headset", groupId: "g-headset" };
const LAPTOP_MIC: EchoDevice = { deviceId: "mic-laptop", groupId: "g-laptop" };
const DESK_SPEAKERS: EchoDevice = { deviceId: "out-desk", groupId: "g-desk" };
const ALL = [HEADSET_MIC, HEADSET_OUT, LAPTOP_MIC, DESK_SPEAKERS];

describe("isDefaultSink", () => {
  it("counts both spellings browsers use", () => {
    // "" is a sink nobody has set; "default" is what Chrome enumerates its
    // default device as, so a member who picks the entry labelled "Default"
    // gets the string. Treating only one as default reports somebody who
    // changed nothing.
    expect(isDefaultSink("")).toBe(true);
    expect(isDefaultSink("default")).toBe(true);
    expect(isDefaultSink(null)).toBe(true);
    expect(isDefaultSink(undefined)).toBe(true);
    expect(isDefaultSink("out-desk")).toBe(false);
  });
});

describe("echoRisk", () => {
  it("is none while output is on the default device", () => {
    // The default device is the one the canceller references, so nothing in the
    // configuration has disabled it.
    expect(echoRisk({ micId: "mic-laptop", speakerId: "", devices: ALL })).toBe("none");
    expect(echoRisk({ micId: "mic-laptop", speakerId: "default", devices: ALL })).toBe("none");
  });

  it("recognises a headset by groupId, not by its name", () => {
    expect(echoRisk({ micId: "mic-headset", speakerId: "out-headset", devices: ALL })).toBe("same-device");
  });

  it("flags output moved to a device the microphone is not on", () => {
    expect(echoRisk({ micId: "mic-laptop", speakerId: "out-desk", devices: ALL })).toBe("output-off-default");
  });

  it("says unknown rather than reassuring when the devices cannot be compared", () => {
    // Guessing in the reassuring direction is how this check comes to mean
    // nothing: the member with the problem is told there isn't one.
    expect(echoRisk({ micId: "mic-laptop", speakerId: "out-unlisted", devices: ALL })).toBe("unknown");
    expect(echoRisk({ micId: "", speakerId: "out-desk", devices: ALL })).toBe("unknown");
    expect(echoRisk({ micId: "mic-laptop", speakerId: "out-desk", devices: [] })).toBe("unknown");
    expect(echoRisk({ micId: "mic-laptop", speakerId: "out-desk" })).toBe("unknown");
  });

  it("says unknown when a device row has no groupId", () => {
    const vague = [{ deviceId: "mic-laptop", groupId: "" }, { deviceId: "out-desk", groupId: "" }];
    expect(echoRisk({ micId: "mic-laptop", speakerId: "out-desk", devices: vague })).toBe("unknown");
  });
});

describe("echoRiskNotice", () => {
  it("speaks up for the two cases that need it", () => {
    expect(echoRiskNotice("output-off-default")).toMatch(/echo cancellation cannot remove it/i);
    expect(echoRiskNotice("unknown")).toMatch(/other than your system default/i);
  });

  it("stays quiet when there is nothing to say", () => {
    expect(echoRiskNotice("none")).toBeNull();
    expect(echoRiskNotice("same-device")).toBeNull();
  });

  it("tells the member what to DO, not just what is wrong", () => {
    expect(echoRiskNotice("output-off-default")).toMatch(/headphones|system default/i);
  });
});

/** Feed `count` samples 120ms apart, as the voice meter does. */
function feed(
  watch: EchoWatch,
  count: number,
  shape: (i: number) => { localLevel: number; remoteLevel: number; micLive?: boolean },
  startAt = 1_000_000,
) {
  let last = observeEcho(watch, { now: startAt, localLevel: 0, remoteLevel: 0, micLive: true });
  for (let i = 0; i < count; i++) {
    const s = shape(i);
    last = observeEcho(watch, {
      now: startAt + (i + 1) * 120,
      localLevel: s.localLevel,
      remoteLevel: s.remoteLevel,
      micLive: s.micLive ?? true,
    });
  }
  return last;
}

/** Somebody else talking, coming back out of the speakers attenuated. */
const ECHOING = () => ({ remoteLevel: 0.5, localLevel: 0.5 * ECHO_ATTENUATION * 0.8 });
/** Two people talking over each other: local is at its own mouth's distance. */
const DOUBLE_TALK = () => ({ remoteLevel: 0.5, localLevel: 0.55 });
/** Somebody else talking into a room that is not feeding back. */
const CLEAN = () => ({ remoteLevel: 0.5, localLevel: 0.01 });

describe("observeEcho", () => {
  it("fires on a sustained attenuated capture of the remote voice", () => {
    const watch = createEchoWatch();
    const v = feed(watch, 40, ECHOING);
    expect(v.echoing).toBe(true);
    expect(v.fraction).toBeGreaterThanOrEqual(0.6);
  });

  it("reports `started` exactly once", () => {
    // The caller shows a notice on it, and a flag that stays true would show it
    // again on every one of the eight samples a second.
    const watch = createEchoWatch();
    let starts = 0;
    for (let i = 0; i < 60; i++) {
      const v = observeEcho(watch, {
        now: 1_000_000 + i * 120,
        ...ECHOING(),
        micLive: true,
      });
      if (v.started) starts += 1;
    }
    expect(starts).toBe(1);
  });

  it("does NOT fire on two people talking at once", () => {
    // The case that would make this feature unusable. Both levels are up
    // together, exactly as in echo; what separates them is that a person at
    // their own microphone is not attenuated.
    const watch = createEchoWatch();
    expect(feed(watch, 60, DOUBLE_TALK).echoing).toBe(false);
  });

  it("does not fire on a clean call where somebody else is talking", () => {
    const watch = createEchoWatch();
    expect(feed(watch, 60, CLEAN).echoing).toBe(false);
  });

  it("does not fire while the microphone is muted", () => {
    // A muted microphone cannot echo, whatever the levels say.
    const watch = createEchoWatch();
    const v = feed(watch, 60, () => ({ ...ECHOING(), micLive: false }));
    expect(v.echoing).toBe(false);
  });

  it("does not fire on silence, however long", () => {
    const watch = createEchoWatch();
    expect(feed(watch, 80, () => ({ remoteLevel: 0, localLevel: 0 })).echoing).toBe(false);
  });

  it("will not form a verdict from too few samples", () => {
    // Without the floor, the first two ticks of a call are a perfectly
    // correlated window and the notice fires before a sentence has been said.
    const watch = createEchoWatch();
    const v = feed(watch, ECHO_MIN_SAMPLES - 2, ECHOING);
    expect(v.samples).toBeLessThan(ECHO_MIN_SAMPLES);
    expect(v.echoing).toBe(false);
  });

  it("excludes silent samples from the denominator", () => {
    // A long quiet stretch must not wash out an echo that happens whenever
    // anybody speaks. Half the samples are silence; the verdict still forms
    // from the audible half.
    const watch = createEchoWatch();
    const v = feed(watch, 60, (i) => (i % 2 === 0 ? ECHOING() : { remoteLevel: 0, localLevel: 0 }));
    expect(v.fraction).toBe(1);
  });

  it("tolerates interruptions, because a real echo is full of them", () => {
    // Two samples in three look like echo; the third is the member actually
    // speaking over it. A rule needing every sample would never fire.
    const watch = createEchoWatch();
    expect(feed(watch, 90, (i) => (i % 3 === 2 ? DOUBLE_TALK() : ECHOING())).echoing).toBe(true);
  });

  it("clears once the echo stops, but not on a silence", () => {
    const watch = createEchoWatch();
    expect(feed(watch, 60, ECHOING).echoing).toBe(true);

    // Silence does not clear it: the echo has only stopped being provoked.
    const afterQuiet = feed(watch, 20, () => ({ remoteLevel: 0, localLevel: 0 }), 1_100_000);
    expect(afterQuiet.echoing).toBe(true);

    // A clean stretch with enough audible samples does.
    const afterClean = feed(watch, 60, CLEAN, 1_200_000);
    expect(afterClean.echoing).toBe(false);
  });

  it("does not raise again straight away after clearing", () => {
    const watch = createEchoWatch();
    feed(watch, 60, ECHOING);
    const cleared = feed(watch, 60, CLEAN, 1_200_000);
    expect(cleared.echoing).toBe(false);

    // Same problem again a minute later. Said once is enough; saying it again
    // is what teaches people to dismiss it reflexively.
    const again = feed(watch, 60, ECHOING, 1_260_000);
    expect(again.echoing).toBe(false);
  });

  it("will raise again after long enough", () => {
    const watch = createEchoWatch();
    feed(watch, 60, ECHOING);
    feed(watch, 60, CLEAN, 1_200_000);
    const later = feed(watch, 60, ECHOING, 1_200_000 + ECHO_RENOTICE_MS + 60_000);
    expect(later.echoing).toBe(true);
  });

  it("only counts samples inside the window", () => {
    const watch = createEchoWatch();
    feed(watch, 40, ECHOING);
    // Jump well past the window. The old samples are still in the ring and
    // must not be counted.
    const v = observeEcho(watch, {
      now: 1_000_000 + ECHO_WINDOW_MS * 10,
      remoteLevel: 0.5,
      localLevel: 0.01,
      micLive: true,
    });
    expect(v.samples).toBe(1);
  });

  it("survives a non-finite level rather than forming a verdict from it", () => {
    const watch = createEchoWatch();
    const v = feed(watch, 60, () => ({ remoteLevel: Number.NaN, localLevel: Number.NaN }));
    expect(v.echoing).toBe(false);
    expect(v.samples).toBe(0);
  });

  it("allocates nothing per sample", () => {
    // It runs eight times a second for the length of every call. The ring is
    // fixed at construction and the counters are numbers; nothing here should
    // grow.
    const watch = createEchoWatch();
    const sizes = () => [watch.at.length, watch.audible.length, watch.suspect.length];
    const before = sizes();
    feed(watch, 500, ECHOING);
    expect(sizes()).toEqual(before);
  });

  it("keeps answering correctly after the ring has wrapped many times", () => {
    const watch = createEchoWatch();
    feed(watch, 1_000, CLEAN);
    expect(observeEcho(watch, { now: 2_000_000, ...CLEAN(), micLive: true }).echoing).toBe(false);
    expect(feed(watch, 60, ECHOING, 2_100_000).echoing).toBe(true);
  });
});

describe("ECHO_DETECTED_NOTICE", () => {
  it("says what is happening and what to do", () => {
    expect(ECHO_DETECTED_NOTICE).toMatch(/hearing themselves/i);
    expect(ECHO_DETECTED_NOTICE).toMatch(/headphones|mute/i);
  });
});
