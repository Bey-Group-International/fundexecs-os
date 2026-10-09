import {
  coverageNotice,
  engineFollowsTrack,
  localTranscribing,
  transcriptionMicNotice,
  type RecognizerMicFacts,
} from "./transcription-coverage";

describe("what a client reports about its own transcription", () => {
  it("is not transcribing when the browser has no recognition at all", () => {
    expect(localTranscribing("unsupported", false)).toBe(false);
  });

  it("is not transcribing when the engine refused to run", () => {
    expect(localTranscribing("error", false)).toBe(false);
  });

  it("is not transcribing while the engine is deaf to the call's microphone", () => {
    // Status says "active"; the deaf watch says it has answered nothing while
    // its owner audibly talked. The watch is the one telling the truth.
    expect(localTranscribing("active", true)).toBe(false);
  });

  it("is transcribing while the engine runs and hears", () => {
    expect(localTranscribing("active", false)).toBe(true);
  });

  it("counts a recognizer waiting for a microphone as covered", () => {
    // A member with no live microphone has no words to miss. Reporting them
    // uncovered would raise the banner against everyone who joined muted.
    expect(localTranscribing("idle", false)).toBe(true);
  });

  // An engine that keeps dying is still being restarted, so it is not an
  // error — and it is transcribing nobody, so it is not covered.
  it("is not transcribing while the engine keeps failing", () => {
    expect(localTranscribing("failing", false)).toBe(false);
  });

  // Transcribing into a buffer whose every flush is refused reaches the
  // member's own screen and nobody else's record.
  it("is not transcribing while its saves keep failing", () => {
    expect(localTranscribing("active", false, false)).toBe(false);
    expect(localTranscribing("idle", false, false)).toBe(false);
    expect(localTranscribing("active", false, true)).toBe(true);
  });
});

describe("whether the engine follows the handed track", () => {
  it("recognises the engine surface that shipped with track support", () => {
    expect(engineFollowsTrack({ available: () => Promise.resolve("available") })).toBe(true);
  });

  it("treats every older engine as capturing the system default", () => {
    expect(engineFollowsTrack({})).toBe(false);
    expect(engineFollowsTrack({ available: "soon" })).toBe(false);
    expect(engineFollowsTrack(undefined)).toBe(false);
    expect(engineFollowsTrack(null)).toBe(false);
  });
});

describe("a microphone the engine will not follow", () => {
  const facts = (over: Partial<RecognizerMicFacts> = {}): RecognizerMicFacts => ({
    status: "active",
    followsTrack: false,
    micId: "usb-conference-mic",
    micLabel: "Jabra Speak 750",
    micGroupId: "group-conference",
    defaultGroupId: "group-builtin",
    ...over,
  });

  // THE REGRESSION. The old rule warned by browser brand — Safari only — so a
  // member on any Chrome or Edge that predates track support, transcribed from
  // the laptop across the table while the call used their conference mic, was
  // told nothing.
  it("warns any engine without track support, not only Safari", () => {
    const notice = transcriptionMicNotice(facts());
    expect(notice).toMatch(/default microphone/);
    expect(notice).toContain("Jabra Speak 750");
    expect(notice).toMatch(/missing or wrong/);
  });

  it("says nothing on an engine that follows the track", () => {
    expect(transcriptionMicNotice(facts({ followsTrack: true }))).toBeNull();
  });

  it("says nothing when the chosen microphone is the default anyway", () => {
    expect(transcriptionMicNotice(facts({ micId: "" }))).toBeNull();
    expect(transcriptionMicNotice(facts({ micId: "default" }))).toBeNull();
  });

  // The default device picked by its concrete id is still the default device:
  // the recognizer and the call are on one microphone, and a warning here
  // teaches people to dismiss the real one.
  it("says nothing when the chosen device IS the physical default", () => {
    expect(
      transcriptionMicNotice(facts({ micGroupId: "group-builtin", defaultGroupId: "group-builtin" })),
    ).toBeNull();
  });

  // When the device identity cannot be proven, the warning shows: a spare
  // warning costs a dismissal, a missing one costs the meeting's words.
  it("still warns when the device groups are unknown", () => {
    expect(transcriptionMicNotice(facts({ micGroupId: null, defaultGroupId: null }))).toMatch(/default microphone/);
    expect(transcriptionMicNotice(facts({ defaultGroupId: "" }))).toMatch(/default microphone/);
  });

  it("names the microphone generically when the track carries no label", () => {
    expect(transcriptionMicNotice(facts({ micLabel: null }))).toContain("the microphone you picked");
  });

  // A browser with no recognizer at all is transcribing from NO microphone —
  // that is the coverage banner's story, and a warning about which microphone
  // a non-existent engine listens to would be nonsense beside it.
  it("says nothing while no engine is actually listening", () => {
    expect(transcriptionMicNotice(facts({ status: "unsupported" }))).toBeNull();
    expect(transcriptionMicNotice(facts({ status: "error" }))).toBeNull();
    expect(transcriptionMicNotice(facts({ status: "failing" }))).toBeNull();
  });
});

describe("the coverage banner", () => {
  it("says nothing while everyone is covered", () => {
    expect(coverageNotice([])).toBeNull();
    expect(coverageNotice(["  ", ""])).toBeNull();
  });

  it("names the one person and what is being lost", () => {
    const text = coverageNotice(["Maya"])!;
    expect(text).toContain("Maya isn't being transcribed");
    expect(text).toContain("not reaching the transcript or the report");
    expect(text).toContain("Chrome, Edge or Safari");
  });

  it("names several people as a list", () => {
    const text = coverageNotice(["Maya", "Li", "Tom"])!;
    expect(text).toContain("Maya, Li and Tom aren't being transcribed");
  });

  it("does not name anyone twice", () => {
    // Two announcements from the same person — a rejoin, a repeated hello —
    // must not read as two people.
    expect(coverageNotice(["Maya", "Maya"])!).toContain("Maya isn't");
  });
});
