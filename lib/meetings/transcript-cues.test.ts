import { cuesAreTimed, transcriptCues, type CueRow } from "@/lib/meetings/transcript-cues";

const START = "2026-09-17T10:00:00.000Z";
const at = (seconds: number) => new Date(Date.parse(START) + seconds * 1000).toISOString();

const row = (speaker: string, text: string, seconds: number, extra: Partial<CueRow> = {}): CueRow => ({
  speaker,
  text,
  ts: at(seconds),
  ...extra,
});

describe("transcriptCues", () => {
  it("times each turn against the recording's start", () => {
    const cues = transcriptCues([row("Ana", "We should wire Friday.", 30)], START);
    expect(cues).toEqual([
      { speaker: "Ana", atMs: 30_000, uncertain: false, overlapped: false, paragraphs: ["We should wire Friday."] },
    ]);
  });

  it("merges a speaker talking for a while into one turn", () => {
    const cues = transcriptCues(
      [row("Ana", "First.", 10), row("Ana", "Second.", 14), row("Bo", "Agreed.", 20)],
      START,
    );
    expect(cues).toHaveLength(2);
    expect(cues[0].paragraphs).toEqual(["First.", "Second."]);
    // The turn lands on its first row: that is the moment somebody clicking wants.
    expect(cues[0].atMs).toBe(10_000);
    expect(cues[1].speaker).toBe("Bo");
  });

  // A turn that becomes uncertain halfway through is two different claims about
  // who was speaking, and must not be merged into one.
  it("splits a turn when the room's confidence changes", () => {
    const cues = transcriptCues(
      [row("Ana", "Sure.", 10), row("Ana", "Maybe.", 12, { confidence: 0.2 })],
      START,
    );
    expect(cues).toHaveLength(2);
    expect(cues[1].uncertain).toBe(true);
  });

  it("splits on an overlap marker too", () => {
    const cues = transcriptCues(
      [row("Ana", "Sure.", 10), row("Ana", "Wait—", 12, { overlapped: true })],
      START,
    );
    expect(cues).toHaveLength(2);
    expect(cues[1].overlapped).toBe(true);
  });

  it("orders by when the words were spoken, not by how they arrived", () => {
    const cues = transcriptCues([row("Bo", "Second.", 40), row("Ana", "First.", 10)], START);
    expect(cues.map((c) => c.speaker)).toEqual(["Ana", "Bo"]);
  });

  // A host who pressed Record halfway through. The words were still said, and
  // the nearest moment the recording holds is its beginning.
  it("clamps turns from before the recording started", () => {
    const cues = transcriptCues([row("Ana", "Earlier.", -120)], START);
    expect(cues[0].atMs).toBe(0);
  });

  it("puts everything at zero when there is no recording to time against", () => {
    const cues = transcriptCues([row("Ana", "Hello.", 30)], null);
    expect(cues[0].atMs).toBe(0);
    expect(cuesAreTimed(cues)).toBe(false);
  });

  it("drops rows with nothing in them and rows with no usable time", () => {
    const cues = transcriptCues(
      [row("Ana", "   ", 10), { speaker: "Bo", text: "Real.", ts: "not a date" }, row("Cy", "Kept.", 20)],
      START,
    );
    expect(cues).toHaveLength(1);
    expect(cues[0].speaker).toBe("Cy");
  });

  it("survives no rows at all", () => {
    expect(transcriptCues(null, START)).toEqual([]);
    expect(cuesAreTimed([])).toBe(false);
  });
});

describe("cuesAreTimed", () => {
  it("is true only when there is a real clock to drive a player with", () => {
    expect(cuesAreTimed(transcriptCues([row("Ana", "a", 0), row("Bo", "b", 30)], START))).toBe(true);
    expect(cuesAreTimed(transcriptCues([row("Ana", "a", 0)], START))).toBe(false);
  });
});

// ── Following the recording ─────────────────────────────────────────────────

import { cueAt, cuesCanFollow, type TranscriptCue } from "@/lib/meetings/transcript-cues";

const cueAtMs = (atMs: number): TranscriptCue => ({
  speaker: "Rae", atMs, uncertain: false, overlapped: false, paragraphs: ["…"],
});

describe("cueAt", () => {
  const cues = [cueAtMs(0), cueAtMs(5_000), cueAtMs(12_000)];

  it("finds the turn that has started, not the nearest one", () => {
    // 11.9s is closer to 12s, but the turn at 5s is the one being spoken.
    expect(cueAt(cues, 11_900)).toBe(1);
  });

  it("lands on a turn exactly at its own start", () => {
    expect(cueAt(cues, 5_000)).toBe(1);
  });

  it("stays on the last turn past the end", () => {
    expect(cueAt(cues, 9_999_999)).toBe(2);
  });

  // Lighting up the first line during a silent lead-in would be claiming
  // somebody was speaking when they were not.
  it("has no current turn before the first word", () => {
    expect(cueAt([cueAtMs(3_000)], 1_000)).toBe(-1);
  });

  it("has nothing to say about nothing", () => {
    expect(cueAt([], 1_000)).toBe(-1);
    expect(cueAt(cues, NaN)).toBe(-1);
    expect(cueAt(cues, -1)).toBe(-1);
  });

  // Called on every timeupdate against an hour of turns, so the walk has to be
  // a search. This pins the answer, not the method — but a linear scan that
  // stopped early would fail it.
  it("agrees with a plain scan across a long transcript", () => {
    const many = Array.from({ length: 2_000 }, (_, i) => cueAtMs(i * 5_000));
    for (const ms of [0, 4_999, 5_000, 7_500_000, 9_999_999]) {
      const scanned = many.reduce((best, c, i) => (c.atMs <= ms ? i : best), -1);
      expect(cueAt(many, ms)).toBe(scanned);
    }
  });
});

describe("cuesCanFollow", () => {
  it("follows a normally timed transcript", () => {
    expect(cuesCanFollow([cueAtMs(0), cueAtMs(5_000), cueAtMs(12_000)])).toBe(true);
  });

  // A meeting recorded from halfway has every earlier turn clamped to zero.
  // Marking whichever came last in that pile as "now" would invent a fact.
  it("declines when most turns are clamped to the start", () => {
    expect(cuesCanFollow([cueAtMs(0), cueAtMs(0), cueAtMs(0), cueAtMs(9_000)])).toBe(false);
  });

  it("declines a transcript with no clock at all", () => {
    expect(cuesCanFollow([cueAtMs(0), cueAtMs(0)])).toBe(false);
    expect(cuesCanFollow([])).toBe(false);
  });
});
