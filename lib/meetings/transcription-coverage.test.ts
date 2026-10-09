import { coverageNotice, localTranscribing, transcriptionMicNotice } from "./transcription-coverage";

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

describe("a microphone the engine will not follow", () => {
  it("warns a Safari member who picked a non-default microphone", () => {
    expect(transcriptionMicNotice("safari", "usb-conference-mic")).toMatch(/default microphone/);
  });

  it("says nothing when the chosen microphone is the default anyway", () => {
    expect(transcriptionMicNotice("safari", "")).toBeNull();
    expect(transcriptionMicNotice("safari", "default")).toBeNull();
  });

  it("says nothing on an engine that follows the track", () => {
    expect(transcriptionMicNotice("chrome", "usb-conference-mic")).toBeNull();
    expect(transcriptionMicNotice("edge", "usb-conference-mic")).toBeNull();
    expect(transcriptionMicNotice("firefox", "usb-conference-mic")).toBeNull();
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
