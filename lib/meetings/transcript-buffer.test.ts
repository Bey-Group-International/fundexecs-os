import {
  FLUSH_INTERVAL_MS,
  MAX_BATCH,
  RETRY_BACKOFF_MS,
  nextBatch,
  nextFlushDelay,
  pendingLines,
  shouldFlush,
  speakerNames,
  transcriptRows,
  type BufferableLine,
} from "@/lib/meetings/transcript-buffer";

function line(over: Partial<BufferableLine> = {}): BufferableLine {
  return {
    id: "l1",
    speakerId: "s1",
    speaker: "Alina",
    userId: "u1",
    text: "hello",
    ts: 1_000,
    final: true,
    isLocal: true,
    confidence: 1,
    overlapped: false,
    ...over,
  };
}

describe("pendingLines", () => {
  it("claims this device's own settled words", () => {
    const lines = [line({ id: "a" }), line({ id: "b", ts: 2_000 })];
    expect(pendingLines(lines, new Set()).map((l) => l.id)).toEqual(["a", "b"]);
  });

  // The duplication bug. Every participant held every line in one array and
  // saved the lot, so a three-person meeting stored each sentence three times.
  it("never claims another participant's words", () => {
    const lines = [line({ id: "mine" }), line({ id: "theirs", isLocal: false })];
    expect(pendingLines(lines, new Set()).map((l) => l.id)).toEqual(["mine"]);
  });

  it("ignores interim results, which are still being revised", () => {
    const lines = [line({ id: "settled" }), line({ id: "live", final: false })];
    expect(pendingLines(lines, new Set()).map((l) => l.id)).toEqual(["settled"]);
  });

  it("drops what the database has already confirmed", () => {
    const lines = [line({ id: "a" }), line({ id: "b" })];
    expect(pendingLines(lines, new Set(["a"])).map((l) => l.id)).toEqual(["b"]);
  });

  // The watermark bug, stated as a test. A positional high-water mark slid over
  // unsaved lines and back across saved ones whenever a remote line spliced
  // into the middle of the array by the time it was SPOKEN. Identity does not
  // care where in the array a line sits.
  it("survives a remote line splicing in below the saved ones", () => {
    const saved = new Set(["mine-1"]);
    const afterSplice = [
      line({ id: "mine-1", ts: 1_000 }),
      line({ id: "theirs", ts: 1_500, isLocal: false }),
      line({ id: "mine-2", ts: 2_000 }),
    ];
    expect(pendingLines(afterSplice, saved).map((l) => l.id)).toEqual(["mine-2"]);
  });

  it("re-offers a line whose write failed", () => {
    const lines = [line({ id: "a" })];
    // Nothing was confirmed, so nothing is forgotten.
    expect(pendingLines(lines, new Set()).map((l) => l.id)).toEqual(["a"]);
  });
});

describe("nextBatch", () => {
  it("sends the oldest words first", () => {
    const out = nextBatch([line({ id: "new", ts: 9 }), line({ id: "old", ts: 1 })]);
    expect(out.map((l) => l.id)).toEqual(["old", "new"]);
  });

  it("caps a backlog and leaves the rest for the next flush", () => {
    const many = Array.from({ length: MAX_BATCH + 10 }, (_, i) => line({ id: `l${i}`, ts: i }));
    expect(nextBatch(many)).toHaveLength(MAX_BATCH);
  });

  it("does not mutate the buffer it was handed", () => {
    const lines = [line({ id: "b", ts: 2 }), line({ id: "a", ts: 1 })];
    nextBatch(lines);
    expect(lines.map((l) => l.id)).toEqual(["b", "a"]);
  });
});

describe("transcriptRows", () => {
  it("carries the line's own id, so a retry conflicts instead of duplicating", () => {
    const [row] = transcriptRows([line({ id: "utterance-7" })], "m1");
    expect(row.id).toBe("utterance-7");
    expect(row.meeting_id).toBe("m1");
  });

  it("carries the overlap flag the report renders", () => {
    const [row] = transcriptRows([line({ overlapped: true, confidence: 0.4 })], "m1");
    expect(row.overlapped).toBe(true);
    expect(row.confidence).toBe(0.4);
  });

  it("writes the moment the words were spoken, as a timestamp", () => {
    const [row] = transcriptRows([line({ ts: 1_700_000_000_000 })], "m1");
    expect(row.ts).toBe(new Date(1_700_000_000_000).toISOString());
  });
});

describe("nextFlushDelay", () => {
  it("runs on the normal cadence while writes are landing", () => {
    expect(nextFlushDelay(0)).toBe(FLUSH_INTERVAL_MS);
  });

  it("backs off as failures repeat", () => {
    expect(nextFlushDelay(1)).toBe(RETRY_BACKOFF_MS[1]);
    expect(nextFlushDelay(2)).toBe(RETRY_BACKOFF_MS[2]);
  });

  it("holds at the longest wait rather than giving up", () => {
    const longest = RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
    expect(nextFlushDelay(40)).toBe(longest);
    expect(nextFlushDelay(400)).toBe(longest);
  });
});

describe("shouldFlush", () => {
  it("is false with nothing owed", () => {
    expect(shouldFlush([])).toBe(false);
    expect(shouldFlush([line()])).toBe(true);
  });
});

describe("speakerNames", () => {
  it("lists who spoke, in the order they first did", () => {
    const lines = [
      line({ speaker: "Rae", ts: 3_000 }),
      line({ speaker: "Alina", ts: 1_000 }),
      line({ speaker: "Rae", ts: 5_000 }),
    ];
    expect(speakerNames(lines)).toEqual(["Alina", "Rae"]);
  });

  it("includes people who were there and said nothing", () => {
    expect(speakerNames([line({ speaker: "Alina" })], ["Alina", "Priya"]))
      .toEqual(["Alina", "Priya"]);
  });

  it("ignores interim lines and blank names", () => {
    const lines = [line({ speaker: "  ", ts: 1 }), line({ speaker: "Rae", final: false, ts: 2 })];
    expect(speakerNames(lines)).toEqual([]);
  });
});
