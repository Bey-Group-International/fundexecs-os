import {
  buildTimeline,
  evictionFor,
  formatClock,
  partAtTime,
  partsToAppend,
  rangeHeaderFor,
  KEEP_BEHIND_MS,
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

describe("evictionFor", () => {
  // Ten five-second parts: a fifty-second recording, so the thirty-second
  // keep-behind window is a real fraction of it rather than the whole thing.
  const timeline = buildTimeline(
    Array.from({ length: 10 }, (_, i) => part(i, 1000, i * CHUNK_MS, CHUNK_MS)),
  );
  const all = new Set(timeline.map((p) => p.idx));

  it("holds everything until the viewer is past the keep-behind window", () => {
    expect(evictionFor(timeline, all, 0)).toBeNull();
    expect(evictionFor(timeline, all, KEEP_BEHIND_MS)).toBeNull();
    // One part's worth past the window is the first moment anything can go.
    expect(evictionFor(timeline, all, KEEP_BEHIND_MS + CHUNK_MS)).not.toBeNull();
  });

  it("removes only whole parts, on a part boundary", () => {
    // 38s in, keeping 30s: the cutoff is 8s, which falls INSIDE part 1
    // (5s–10s). Part 1 must survive whole — a removal at 8s would leave the
    // browser holding a cluster with no beginning.
    const plan = evictionFor(timeline, all, 38_000);
    expect(plan).toEqual({ untilMs: CHUNK_MS, dropped: [0] });
  });

  it("never removes the part the viewer is watching", () => {
    // Keeping nothing behind: the cutoff IS the playhead, and the part holding
    // it ends after the playhead, so it is still excluded.
    const plan = evictionFor(timeline, all, 12_000, 0);
    expect(plan!.untilMs).toBe(10_000);
    expect(plan!.dropped).toEqual([0, 1]);
    expect(plan!.dropped).not.toContain(partAtTime(timeline, 12_000));
  });

  it("names every part it drops, so the player can forget them", () => {
    const plan = evictionFor(timeline, all, 45_000, 0);
    // 45s in, keeping nothing: parts 0–8 end at or before 45s, part 8 holds it.
    expect(plan!.dropped).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(plan!.untilMs).toBe(45_000);
  });

  it("reports only the parts that were actually resident", () => {
    // Somebody who seeked straight to the end holds the tail and nothing else.
    // The removal still spans the front of the recording, but there is nothing
    // of parts 0–2 to forget.
    const appended = new Set([6, 7, 8, 9]);
    const plan = evictionFor(timeline, appended, 45_000, 0);
    expect(plan!.dropped).toEqual([6, 7, 8]);
  });

  it("asks for nothing when nothing resident is behind the viewer", () => {
    // Watching part 7 with only parts 7-9 resident: the front of the recording
    // is already gone, so a remove would free nothing and must not be queued.
    expect(evictionFor(timeline, new Set([7, 8, 9]), 38_000)).toBeNull();
  });

  it("asks for nothing on an empty timeline, an empty buffer, or a broken clock", () => {
    expect(evictionFor([], all, 45_000)).toBeNull();
    expect(evictionFor(timeline, new Set(), 45_000)).toBeNull();
    expect(evictionFor(timeline, all, NaN)).toBeNull();
    expect(evictionFor(timeline, all, -1)).toBeNull();
  });

  it("bounds what an hour-long recording keeps resident", () => {
    // The measured complaint, as a rule rather than a number in a commit
    // message: watched end to end, the old player held all 720 parts.
    const hour = buildTimeline(
      Array.from({ length: 720 }, (_, i) => part(i, 940_000, i * CHUNK_MS, CHUNK_MS)),
    );
    const resident = new Set(hour.map((p) => p.idx));
    for (let ms = 0; ms < 720 * CHUNK_MS; ms += 1000) {
      const plan = evictionFor(hour, resident, ms);
      if (plan) for (const idx of plan.dropped) resident.delete(idx);
    }
    // Only the keep-behind window and the part being watched survive.
    expect(resident.size).toBeLessThanOrEqual(KEEP_BEHIND_MS / CHUNK_MS + 1);
  });
});
