import { coverageNotice, localTranscribing } from "./transcription-coverage";

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
