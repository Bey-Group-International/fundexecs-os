import {
  buildTimeline,
  formatClock,
  partAtTime,
  partsToAppend,
  rangeHeaderFor,
  timelineBytes,
  timelineDuration,
  type StoredPart,
} from "@/lib/meetings/recording-timeline";
import { CHUNK_MS } from "@/lib/meetings/recording-policy";

const part = (idx: number, size: number, offset_ms?: number, duration_ms?: number): StoredPart => ({
  idx,
  path: `p/${idx}`,
  size,
  offset_ms,
  duration_ms,
});

describe("buildTimeline", () => {
  it("places parts on the byte stream in index order", () => {
    const timeline = buildTimeline([part(1, 200, 5000, 5000), part(0, 100, 0, 5000)]);
    expect(timeline.map((p) => [p.idx, p.start, p.end])).toEqual([
      [0, 0, 100],
      [1, 100, 300],
    ]);
  });

  it("uses the timing that was measured", () => {
    const timeline = buildTimeline([part(0, 10, 0, 4200), part(1, 10, 4200, 5100)]);
    expect(timeline.map((p) => [p.offsetMs, p.durationMs])).toEqual([
      [0, 4200],
      [4200, 5100],
    ]);
  });

  // Recordings made before timing was captured have to keep playing, with a
  // timeline that is approximate rather than one that is zero.
  it("falls back to the nominal part length when timing is missing", () => {
    const timeline = buildTimeline([part(0, 10), part(1, 10)]);
    expect(timeline.map((p) => p.offsetMs)).toEqual([0, CHUNK_MS]);
    expect(timelineDuration(timeline)).toBe(CHUNK_MS * 2);
  });

  it("stays monotonic when only some parts were timed", () => {
    const timeline = buildTimeline([part(0, 10, 0, 3000), part(1, 10), part(2, 10, 12_000, 5000)]);
    expect(timeline.map((p) => p.offsetMs)).toEqual([0, 3000, 12_000]);
  });

  it("survives an empty recording", () => {
    expect(buildTimeline([])).toEqual([]);
    expect(timelineDuration([])).toBe(0);
    expect(timelineBytes([])).toBe(0);
  });

  it("does not let a negative size move the byte cursor backwards", () => {
    const timeline = buildTimeline([part(0, -5, 0, 1000), part(1, 10, 1000, 1000)]);
    expect(timeline.map((p) => [p.start, p.end])).toEqual([
      [0, 0],
      [0, 10],
    ]);
  });
});

describe("partAtTime", () => {
  const timeline = buildTimeline([part(0, 10, 0, 5000), part(1, 10, 5000, 5000), part(2, 10, 10_000, 3000)]);

  it("finds the part holding a moment", () => {
    expect(partAtTime(timeline, 0)).toBe(0);
    expect(partAtTime(timeline, 4999)).toBe(0);
    expect(partAtTime(timeline, 5000)).toBe(1);
    expect(partAtTime(timeline, 10_500)).toBe(2);
  });

  // A scrubber dragged past the end should land on the last frame, not an error.
  it("clamps at both ends", () => {
    expect(partAtTime(timeline, -400)).toBe(0);
    expect(partAtTime(timeline, 999_999)).toBe(2);
    expect(partAtTime(timeline, NaN)).toBe(0);
  });

  it("says so when there is nothing to play", () => {
    expect(partAtTime([], 1000)).toBe(-1);
  });
});

describe("partsToAppend", () => {
  const timeline = buildTimeline(Array.from({ length: 40 }, (_, i) => part(i, 100, i * 5000, 5000)));

  it("takes enough parts to cover the time asked for", () => {
    expect(partsToAppend(timeline, 0, 12_000).map((p) => p.idx)).toEqual([0, 1, 2]);
  });

  it("always takes at least the part asked for", () => {
    expect(partsToAppend(timeline, 3, 0).map((p) => p.idx)).toEqual([3]);
  });

  // Appending is a fetch each. Queueing four minutes the moment somebody drags
  // the scrubber makes the seek slower than the watching.
  it("is bounded by a part count as well as by time", () => {
    expect(partsToAppend(timeline, 0, 10 * 60_000, 4)).toHaveLength(4);
  });

  it("stops at the end of the recording", () => {
    expect(partsToAppend(timeline, 38, 60_000).map((p) => p.idx)).toEqual([38, 39]);
  });

  it("returns nothing for a part that is not there", () => {
    expect(partsToAppend(timeline, -1, 5000)).toEqual([]);
    expect(partsToAppend(timeline, 99, 5000)).toEqual([]);
  });
});

describe("rangeHeaderFor", () => {
  it("covers a contiguous run in one request", () => {
    const timeline = buildTimeline([part(0, 100, 0, 5000), part(1, 250, 5000, 5000)]);
    expect(rangeHeaderFor(timeline)).toBe("bytes=0-349");
  });

  it("asks for nothing when there is nothing", () => {
    expect(rangeHeaderFor([])).toBeNull();
  });

  it("asks for nothing rather than an inverted range on empty parts", () => {
    expect(rangeHeaderFor(buildTimeline([part(0, 0, 0, 5000)]))).toBeNull();
  });
});

describe("formatClock", () => {
  it("reads as a clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9_000)).toBe("0:09");
    expect(formatClock(75_000)).toBe("1:15");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });

  it("does not print nonsense for nonsense", () => {
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(NaN)).toBe("0:00");
  });
});
