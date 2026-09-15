import {
  chooseTranscript,
  restoreTranscript,
  transcriptLineCount,
  type StoredLine,
} from "@/lib/meetings/transcript-restore";
import { TRANSCRIPT_LIMIT, TRUNCATION_NOTE, clampTranscript } from "@/lib/meetings/report-analysis";

function row(over: Partial<StoredLine> = {}): StoredLine {
  return {
    speaker: "Alina",
    text: "we should hold the close",
    ts: "2026-09-15T10:00:00.000Z",
    confidence: 1,
    overlapped: false,
    ...over,
  };
}

describe("restoreTranscript", () => {
  it("renders rows as the lines the report model reads", () => {
    expect(restoreTranscript([row()])).toBe("Alina: we should hold the close");
  });

  // Participants flush on their own timers, so the order rows were INSERTED in
  // is the order their networks happened to answer in. A model handed that
  // reads a conversation whose turns are shuffled, and summarises it that way.
  it("orders by when the words were spoken, not when they were saved", () => {
    const out = restoreTranscript([
      row({ speaker: "Rae", text: "agreed", ts: "2026-09-15T10:00:05.000Z" }),
      row({ speaker: "Alina", text: "shall we", ts: "2026-09-15T10:00:01.000Z" }),
    ]);
    expect(out).toBe("Alina: shall we\nRae: agreed");
  });

  it("marks a doubtful line, and says when two people were talking", () => {
    expect(restoreTranscript([row({ confidence: 0.2 })]))
      .toBe("Alina (uncertain): we should hold the close");
    expect(restoreTranscript([row({ confidence: 0.2, overlapped: true })]))
      .toBe("Alina (uncertain — people speaking over each other): we should hold the close");
  });

  // Rows predating attribution carry no confidence. Reading that as doubt would
  // put "(uncertain)" against every line of every meeting held before it.
  it("treats a row with no confidence recorded as confident", () => {
    expect(restoreTranscript([row({ confidence: null, overlapped: null })]))
      .toBe("Alina: we should hold the close");
  });

  it("names an unattributed line rather than dropping it", () => {
    expect(restoreTranscript([row({ speaker: null })]))
      .toBe("Unknown speaker: we should hold the close");
  });

  it("does not mutate the rows it was handed", () => {
    const rows = [row({ ts: "2026-09-15T10:00:05.000Z" }), row({ ts: "2026-09-15T10:00:01.000Z" })];
    restoreTranscript(rows);
    expect(rows[0].ts).toBe("2026-09-15T10:00:05.000Z");
  });
});

describe("chooseTranscript", () => {
  // The case this exists for: the host's tab reloaded mid-call, so their memory
  // holds a fragment of a meeting the rows remember whole.
  it("takes the stored copy when it holds more of the meeting", () => {
    const posted = "Alina: and finally";
    const stored = "Alina: shall we\nRae: agreed\nAlina: and finally";
    expect(chooseTranscript(posted, stored)).toBe(stored);
  });

  // The other direction: a participant whose writes were failing still
  // broadcast to the room, and the posted copy holds the final seconds.
  it("keeps the posted copy when it holds more", () => {
    const posted = "Alina: shall we\nRae: agreed\nAlina: done";
    expect(chooseTranscript(posted, "Alina: shall we")).toBe(posted);
  });

  it("falls back to whichever one exists", () => {
    expect(chooseTranscript("", "Alina: shall we")).toBe("Alina: shall we");
    expect(chooseTranscript("Alina: shall we", "")).toBe("Alina: shall we");
    expect(chooseTranscript("", "")).toBe("");
  });

  it("counts lines, not characters", () => {
    // A single very long line must not outrank a fuller record. Length is what
    // a duplicated transcript wins on.
    const posted = `Alina: ${"x".repeat(500)}`;
    const stored = "Alina: a\nRae: b";
    expect(chooseTranscript(posted, stored)).toBe(stored);
  });

  it("ignores blank lines on both sides", () => {
    expect(transcriptLineCount("a\n\n\nb")).toBe(2);
  });
});

describe("clampTranscript", () => {
  it("leaves a transcript inside the budget alone", () => {
    const text = "Alina: shall we\nRae: agreed";
    expect(clampTranscript(text)).toBe(text);
  });

  // Two and a half hours of talking fits, so in practice nothing is cut.
  it("keeps a long meeting whole", () => {
    const hour = Array.from({ length: 3_000 }, (_, i) => `Alina: line ${i}`).join("\n");
    expect(hour.length).toBeLessThan(TRANSCRIPT_LIMIT);
    expect(clampTranscript(hour)).toBe(hour);
  });

  it("keeps the end, where a meeting decides things", () => {
    const long = Array.from({ length: 40_000 }, (_, i) => `Alina: line ${i}`).join("\n");
    const out = clampTranscript(long);
    expect(out.length).toBeLessThanOrEqual(TRANSCRIPT_LIMIT);
    expect(out.endsWith("Alina: line 39999")).toBe(true);
  });

  // It used to cut mid-word, so the transcript opened on a fragment attributed
  // to nobody — which reads exactly like a speaker whose name was not captured.
  it("cuts on a line boundary, never mid-sentence", () => {
    const long = Array.from({ length: 40_000 }, (_, i) => `Alina: line ${i}`).join("\n");
    const [, first] = clampTranscript(long).split("\n");
    expect(first).toMatch(/^Alina: line \d+$/);
  });

  it("tells the model it is reading a fragment", () => {
    const long = Array.from({ length: 40_000 }, (_, i) => `Alina: line ${i}`).join("\n");
    expect(clampTranscript(long).startsWith(TRUNCATION_NOTE)).toBe(true);
  });

  it("is idempotent — it runs on both the route and the analysis path", () => {
    const long = Array.from({ length: 40_000 }, (_, i) => `Alina: line ${i}`).join("\n");
    const once = clampTranscript(long);
    expect(clampTranscript(once)).toBe(once);
  });

  it("still yields something for one enormous unbroken line", () => {
    const blob = "x".repeat(TRANSCRIPT_LIMIT * 2);
    const out = clampTranscript(blob);
    expect(out.length).toBeLessThanOrEqual(TRANSCRIPT_LIMIT);
    expect(out.length).toBeGreaterThan(TRUNCATION_NOTE.length);
  });
});
