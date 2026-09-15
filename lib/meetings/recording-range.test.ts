import {
  contentRangeHeader,
  inPlaybackOrder,
  parseRange,
  rangeLength,
  slicesForRange,
  totalSize,
  type RecordingChunk,
} from "@/lib/meetings/recording-range";

// Three 100-byte parts: 0-99, 100-199, 200-299.
const CHUNKS: RecordingChunk[] = [
  { path: "m/r/part-000000.webm", size: 100 },
  { path: "m/r/part-000001.webm", size: 100 },
  { path: "m/r/part-000002.webm", size: 100 },
];

describe("totalSize", () => {
  it("adds the parts up", () => {
    expect(totalSize(CHUNKS)).toBe(300);
    expect(totalSize([])).toBe(0);
  });
});

describe("parseRange", () => {
  it("reads an open-ended range", () => {
    expect(parseRange("bytes=100-", 300)).toEqual({ start: 100, end: 299 });
  });

  it("reads a closed range", () => {
    expect(parseRange("bytes=10-20", 300)).toEqual({ start: 10, end: 20 });
  });

  // Some players probe a container's trailing metadata this way. Reading it
  // backwards serves the start of the file to something looking for the end,
  // and the video simply never plays.
  it("reads a suffix range as the LAST n bytes", () => {
    expect(parseRange("bytes=-50", 300)).toEqual({ start: 250, end: 299 });
  });

  it("clamps an end past the file", () => {
    expect(parseRange("bytes=290-999", 300)).toEqual({ start: 290, end: 299 });
  });

  it("refuses a start past the file", () => {
    expect(parseRange("bytes=300-", 300)).toBeNull();
    expect(parseRange("bytes=500-600", 300)).toBeNull();
  });

  it("refuses a backwards range", () => {
    expect(parseRange("bytes=200-100", 300)).toBeNull();
  });

  // A malformed or multi-range header is answered with the whole file, which
  // is always correct if not always minimal.
  it("returns null for anything it does not handle", () => {
    expect(parseRange(null, 300)).toBeNull();
    expect(parseRange("bytes=0-10, 20-30", 300)).toBeNull();
    expect(parseRange("items=0-10", 300)).toBeNull();
    expect(parseRange("bytes=-", 300)).toBeNull();
    expect(parseRange("bytes=-0", 300)).toBeNull();
    expect(parseRange("bytes=0-", 0)).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRange("  bytes=0-9  ", 300)).toEqual({ start: 0, end: 9 });
  });
});

describe("slicesForRange", () => {
  it("returns the whole of every part for the whole file", () => {
    const slices = slicesForRange(CHUNKS, { start: 0, end: 299 });
    expect(slices).toEqual([
      { path: CHUNKS[0].path, start: 0, end: 100 },
      { path: CHUNKS[1].path, start: 0, end: 100 },
      { path: CHUNKS[2].path, start: 0, end: 100 },
    ]);
  });

  // Seeking to the last minute of a meeting should read one object, not all of them.
  it("touches only the parts the range covers", () => {
    expect(slicesForRange(CHUNKS, { start: 250, end: 299 })).toEqual([
      { path: CHUNKS[2].path, start: 50, end: 100 },
    ]);
  });

  it("slices across a part boundary", () => {
    expect(slicesForRange(CHUNKS, { start: 90, end: 110 })).toEqual([
      { path: CHUNKS[0].path, start: 90, end: 100 },
      { path: CHUNKS[1].path, start: 0, end: 11 },
    ]);
  });

  it("handles a range inside one part", () => {
    expect(slicesForRange(CHUNKS, { start: 120, end: 130 })).toEqual([
      { path: CHUNKS[1].path, start: 20, end: 31 },
    ]);
  });

  it("handles a single byte", () => {
    expect(slicesForRange(CHUNKS, { start: 100, end: 100 })).toEqual([
      { path: CHUNKS[1].path, start: 0, end: 1 },
    ]);
  });

  it("lands exactly on a boundary without emitting an empty slice", () => {
    expect(slicesForRange(CHUNKS, { start: 0, end: 99 })).toEqual([
      { path: CHUNKS[0].path, start: 0, end: 100 },
    ]);
  });

  it("skips zero-length parts", () => {
    const withEmpty: RecordingChunk[] = [
      { path: "a", size: 10 },
      { path: "b", size: 0 },
      { path: "c", size: 10 },
    ];
    expect(slicesForRange(withEmpty, { start: 5, end: 14 })).toEqual([
      { path: "a", start: 5, end: 10 },
      { path: "c", start: 0, end: 5 },
    ]);
  });

  it("returns nothing for a range past the end", () => {
    expect(slicesForRange(CHUNKS, { start: 400, end: 500 })).toEqual([]);
  });

  it("covers exactly the requested byte count", () => {
    for (const range of [
      { start: 0, end: 299 }, { start: 5, end: 250 },
      { start: 99, end: 201 }, { start: 100, end: 199 },
    ]) {
      const covered = slicesForRange(CHUNKS, range)
        .reduce((n, s) => n + (s.end - s.start), 0);
      expect(covered).toBe(rangeLength(range));
    }
  });
});

describe("contentRangeHeader", () => {
  it("states the slice and the whole", () => {
    expect(contentRangeHeader({ start: 10, end: 20 }, 300)).toBe("bytes 10-20/300");
  });
});

describe("inPlaybackOrder", () => {
  // Parts come back from a storage listing in whatever order the API chose.
  it("restores the order the meeting happened in", () => {
    const shuffled = [
      { path: "m/r/part-000010.webm" },
      { path: "m/r/part-000002.webm" },
      { path: "m/r/part-000001.webm" },
    ];
    expect(inPlaybackOrder(shuffled).map((c) => c.path)).toEqual([
      "m/r/part-000001.webm",
      "m/r/part-000002.webm",
      "m/r/part-000010.webm",
    ]);
  });

  it("does not mutate its input", () => {
    const chunks = [{ path: "b" }, { path: "a" }];
    inPlaybackOrder(chunks);
    expect(chunks.map((c) => c.path)).toEqual(["b", "a"]);
  });
});
