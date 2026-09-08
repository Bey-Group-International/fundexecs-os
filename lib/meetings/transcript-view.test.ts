import {
  parseTranscript,
  speakerInitials,
  transcriptSpeakers,
  transcriptWordCount,
} from "@/lib/meetings/transcript-view";

describe("parseTranscript", () => {
  it("reads a speaker and what they said", () => {
    expect(parseTranscript("Alina: Morning everyone.")).toEqual([
      { speaker: "Alina", uncertain: false, overlapped: false, paragraphs: ["Morning everyone."] },
    ]);
  });

  // A person saying three sentences is one person speaking, not three events.
  it("merges consecutive lines from the same speaker into one turn", () => {
    const turns = parseTranscript("Ray: Let's start.\nRay: With the marks.\nAlina: Sure.");
    expect(turns).toHaveLength(2);
    expect(turns[0].speaker).toBe("Ray");
    expect(turns[0].paragraphs).toEqual(["Let's start.", "With the marks."]);
    expect(turns[1].speaker).toBe("Alina");
  });

  it("reads the uncertainty note formatTranscriptLine writes", () => {
    const [turn] = parseTranscript("Ray (uncertain): Maybe October.");
    expect(turn.speaker).toBe("Ray");
    expect(turn.uncertain).toBe(true);
    expect(turn.overlapped).toBe(false);
    expect(turn.paragraphs).toEqual(["Maybe October."]);
  });

  it("distinguishes people talking over each other from plain uncertainty", () => {
    const [turn] = parseTranscript("Ray (uncertain — people speaking over each other): Hold on.");
    expect(turn.uncertain).toBe(true);
    expect(turn.overlapped).toBe(true);
  });

  // Merging across a change in confidence would make the marker claim more or
  // less than the room actually reported.
  it("does not merge across a change in confidence", () => {
    const turns = parseTranscript("Ray: Certain line.\nRay (uncertain): Unsure line.");
    expect(turns).toHaveLength(2);
    expect(turns[0].uncertain).toBe(false);
    expect(turns[1].uncertain).toBe(true);
  });

  // "The question is this: do we hold the close" must not become a speaker
  // called "The question is this".
  it("does not mistake a sentence containing a colon for a speaker", () => {
    const turns = parseTranscript("Ray: The question is this: do we hold the close?");
    expect(turns).toHaveLength(1);
    expect(turns[0].speaker).toBe("Ray");
    expect(turns[0].paragraphs).toEqual(["The question is this: do we hold the close?"]);
  });

  it("rejects a prefix that is really prose", () => {
    const turns = parseTranscript("Ray: Fine.\nThat settles it, then: we hold.");
    expect(turns).toHaveLength(1);
    expect(turns[0].speaker).toBe("Ray");
    // The prose is kept, attached to whoever was speaking.
    expect(turns[0].paragraphs).toEqual(["Fine.", "That settles it, then: we hold."]);
  });

  it("rejects a prefix containing a clause break", () => {
    const turns = parseTranscript("Ray: Fine.\nOne more thing; before we close: the fee basis.");
    expect(turns).toHaveLength(1);
    expect(turns[0].speaker).toBe("Ray");
  });

  it("rejects a prefix longer than a name", () => {
    const turns = parseTranscript("Ray: Fine.\nThe only thing left to settle: the date.");
    expect(turns).toHaveLength(1);
  });

  it("still accepts a four-word name", () => {
    expect(parseTranscript("Dr Alina Marie Reyes: Morning.")[0].speaker).toBe("Dr Alina Marie Reyes");
  });

  it("rejects a prefix ending in sentence punctuation", () => {
    const [turn] = parseTranscript("Ray: We agreed. So: October it is.");
    expect(turn.speaker).toBe("Ray");
  });

  // This text has been through a model context window, an export and possibly a
  // paste. A line that does not parse is still something somebody said.
  it("keeps an unattributed opening line rather than dropping it", () => {
    const turns = parseTranscript("Something nobody attributed\nAlina: Morning.");
    expect(turns).toHaveLength(2);
    expect(turns[0].speaker).toBe("");
    expect(turns[0].paragraphs).toEqual(["Something nobody attributed"]);
  });

  it("ignores blank lines rather than emitting empty turns", () => {
    const turns = parseTranscript("\n\nAlina: Morning.\n\n\nRay: Hello.\n\n");
    expect(turns).toHaveLength(2);
    expect(turns.every((t) => t.paragraphs.every((p) => p.length > 0))).toBe(true);
  });

  it("handles an empty or missing transcript", () => {
    expect(parseTranscript("")).toEqual([]);
    expect(parseTranscript("   \n  ")).toEqual([]);
    expect(parseTranscript(undefined as unknown as string)).toEqual([]);
  });

  it("survives a colon with no text after it", () => {
    expect(() => parseTranscript("Alina:")).not.toThrow();
    expect(parseTranscript("Alina:")[0].speaker).toBe("");
  });

  it("accepts a name with punctuation in it", () => {
    expect(parseTranscript("Dr Reyes-Whitfield: Morning.")[0].speaker).toBe("Dr Reyes-Whitfield");
  });

  it("accepts an email address as a speaker", () => {
    expect(parseTranscript("ray@example.com: Morning.")[0].speaker).toBe("ray@example.com");
  });
});

describe("transcriptSpeakers", () => {
  it("lists distinct speakers in the order they first spoke", () => {
    const turns = parseTranscript("Ray: One.\nAlina: Two.\nRay: Three.");
    expect(transcriptSpeakers(turns)).toEqual(["Ray", "Alina"]);
  });

  it("leaves unattributed turns out", () => {
    expect(transcriptSpeakers(parseTranscript("Nobody said this"))).toEqual([]);
  });
});

describe("speakerInitials", () => {
  it("takes first and last initials", () => {
    expect(speakerInitials("Alina Reyes")).toBe("AR");
    expect(speakerInitials("Alina Marie Reyes")).toBe("AR");
  });

  it("takes two letters from a single name", () => {
    expect(speakerInitials("Ray")).toBe("RA");
  });

  // "ray@example.com" as "RM" would be reading the local part as a name.
  it("takes one letter from an address", () => {
    expect(speakerInitials("ray@example.com")).toBe("R");
  });

  it("has something to show for a missing name", () => {
    expect(speakerInitials("")).toBe("?");
    expect(speakerInitials("   ")).toBe("?");
  });
});

describe("transcriptWordCount", () => {
  it("counts across turns and paragraphs", () => {
    expect(transcriptWordCount(parseTranscript("Ray: one two three.\nRay: four five."))).toBe(5);
  });

  it("is zero for nothing", () => {
    expect(transcriptWordCount([])).toBe(0);
  });
});
