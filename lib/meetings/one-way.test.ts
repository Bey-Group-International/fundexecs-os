import {
  MEETING_KIND,
  ONE_WAY_KIND,
  acknowledgement,
  blockedReason,
  callClock,
  callTitle,
  captureLabel,
  captureSources,
  defaultCallTitle,
  disclosureScript,
  isMeetingKind,
  isOneWay,
  mayStartRecording,
  readAcknowledgement,
  type CaptureSource,
} from "@/lib/meetings/one-way";

describe("captureSources", () => {
  // Capturing the computer's output alone records the far end and not the
  // person holding the call — half a conversation, and in a two-party-consent
  // state the half that did not agree to be recorded.
  it("always includes the microphone", () => {
    expect(captureSources(false)).toEqual(["microphone"]);
    expect(captureSources(true)).toEqual(["microphone", "computer"]);
  });
});

describe("captureLabel", () => {
  it("says what is being captured", () => {
    expect(captureLabel(["microphone"])).toBe("Microphone");
    expect(captureLabel(["microphone", "computer"])).toBe("Microphone and computer audio");
    expect(captureLabel([])).toBe("Nothing");
  });
});

describe("disclosureScript", () => {
  it("names the person and their organisation", () => {
    const line = disclosureScript("Priya Raman", "Bey Group");
    expect(line).toContain("Priya Raman at Bey Group");
    expect(line).toContain("recording this call");
  });

  it("drops the organisation when there is none", () => {
    expect(disclosureScript("Priya Raman", null)).toContain("Priya Raman is recording");
  });

  // The fallback has to read as a sentence, not as a blank where a name goes.
  it("still reads as English with no name at all", () => {
    const line = disclosureScript("  ", null);
    expect(line).toContain("I am recording this call");
    expect(line).not.toContain("  is");
  });

  it("asks, rather than announcing", () => {
    expect(disclosureScript("Ada", null).trim().endsWith("?")).toBe(true);
  });
});

describe("mayStartRecording", () => {
  const base = { acknowledged: true, disclosure: "We are recording.", sources: ["microphone"] as CaptureSource[] };

  it("allows a recording that has been acknowledged", () => {
    expect(mayStartRecording(base)).toBe(true);
  });

  it("refuses without the acknowledgement", () => {
    expect(mayStartRecording({ ...base, acknowledged: false })).toBe(false);
  });

  // A record that says somebody ticked a box, without saying what the box
  // claimed, is not a record of anything.
  it("refuses when there is no disclosure to store", () => {
    expect(mayStartRecording({ ...base, disclosure: "   " })).toBe(false);
  });

  it("refuses to record without a microphone", () => {
    expect(mayStartRecording({ ...base, sources: ["computer"] })).toBe(false);
  });
});

describe("blockedReason", () => {
  it("names the one thing standing in the way", () => {
    expect(blockedReason({ acknowledged: false, disclosure: "x", sources: ["microphone"] }))
      .toMatch(/consent/i);
    expect(blockedReason({ acknowledged: true, disclosure: "", sources: ["microphone"] }))
      .toMatch(/disclosure/i);
    expect(blockedReason({ acknowledged: true, disclosure: "x", sources: ["computer"] }))
      .toMatch(/microphone/i);
  });

  it("is silent when nothing is wrong", () => {
    expect(blockedReason({ acknowledged: true, disclosure: "x", sources: ["microphone"] })).toBeNull();
  });
});

describe("the stored acknowledgement", () => {
  it("keeps the words that were shown, not just that a box was ticked", () => {
    const now = new Date("2026-09-23T14:05:00.000Z");
    const ack = acknowledgement({ disclosure: "  We are recording.  ", sources: ["microphone"], now });
    expect(ack).toEqual({
      at: "2026-09-23T14:05:00.000Z",
      disclosure: "We are recording.",
      sources: ["microphone"],
    });
  });

  it("round-trips through the reader", () => {
    const ack = acknowledgement({ disclosure: "Recording.", sources: ["microphone", "computer"] });
    expect(readAcknowledgement(JSON.parse(JSON.stringify(ack)))).toEqual(ack);
  });

  // Read on a report months later. A row an older version wrote must not throw
  // the page away.
  it("survives a row that is missing pieces", () => {
    expect(readAcknowledgement({ at: "2026-01-01T00:00:00.000Z", disclosure: "x" }))
      .toEqual({ at: "2026-01-01T00:00:00.000Z", disclosure: "x", sources: [] });
    expect(readAcknowledgement({ at: "2026-01-01T00:00:00.000Z", disclosure: "x", sources: ["mic", 7] }))
      .toEqual({ at: "2026-01-01T00:00:00.000Z", disclosure: "x", sources: [] });
  });

  // The important half: it will not invent one. A report that implied consent
  // was recorded when nothing was stored would be worse than one that says so.
  it("is null when there is nothing usable", () => {
    expect(readAcknowledgement(null)).toBeNull();
    expect(readAcknowledgement("yes")).toBeNull();
    expect(readAcknowledgement({})).toBeNull();
    expect(readAcknowledgement({ at: "2026-01-01T00:00:00.000Z" })).toBeNull();
    expect(readAcknowledgement({ disclosure: "x" })).toBeNull();
  });
});

describe("titles", () => {
  // Twenty calls all called "Recorded call" is twenty identical rows.
  it("dates and times the default", () => {
    const title = defaultCallTitle(new Date("2026-09-23T14:05:00.000Z"));
    expect(title).toMatch(/^Call · /);
    expect(title).toMatch(/\d/);
  });

  it("prefers what the person typed", () => {
    expect(callTitle("  Dunbar follow-up  ")).toBe("Dunbar follow-up");
  });

  it("falls back when they typed nothing", () => {
    const now = new Date("2026-09-23T14:05:00.000Z");
    expect(callTitle("   ", now)).toBe(defaultCallTitle(now));
    expect(callTitle(null, now)).toBe(defaultCallTitle(now));
  });
});

describe("isOneWay", () => {
  // The default matters: every row written before this column existed is a
  // meeting, and guessing otherwise would hide real meetings from Upcoming.
  it("treats an unmarked row as a meeting", () => {
    expect(isOneWay({})).toBe(false);
    expect(isOneWay({ kind: null })).toBe(false);
    expect(isOneWay(null)).toBe(false);
    expect(isOneWay({ kind: MEETING_KIND })).toBe(false);
  });

  it("recognises a one-way session", () => {
    expect(isOneWay({ kind: ONE_WAY_KIND })).toBe(true);
  });
});

describe("isMeetingKind", () => {
  it("accepts only the two kinds that exist", () => {
    expect(isMeetingKind(MEETING_KIND)).toBe(true);
    expect(isMeetingKind(ONE_WAY_KIND)).toBe(true);
    expect(isMeetingKind("solo")).toBe(false);
    expect(isMeetingKind(null)).toBe(false);
  });
});

describe("callClock", () => {
  it("reads as a call length", () => {
    expect(callClock(0)).toBe("0:00");
    expect(callClock(65)).toBe("1:05");
    expect(callClock(545)).toBe("9:05");
    expect(callClock(3731)).toBe("1:02:11");
  });

  it("does not go backwards on nonsense", () => {
    expect(callClock(-5)).toBe("0:00");
    expect(callClock(9.7)).toBe("0:09");
  });
});
