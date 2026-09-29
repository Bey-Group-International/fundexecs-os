/**
 * The recording player's MediaSource loop.
 *
 * Rendered directly with a fake MediaSource rather than through the report,
 * because what is being tested is the append/evict loop and jsdom has no media
 * stack at all: no MediaSource, no decoder, and a <video> whose currentTime and
 * buffered are inert. Those four are stood in for here and nothing else is, so
 * what runs is the component's own arithmetic over them.
 *
 * The rules underneath — which part holds a moment, what to append next, what
 * can be released — are in lib/meetings/recording-timeline.test.ts, where they
 * need no DOM. What these pin is that the player actually CALLS them, and acts
 * on what they say. A correct eviction rule that nothing invokes bounds nothing.
 */
import { render, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { createRef } from "react";
import { RecordingPlayer, type RecordingPlayerHandle } from "./RecordingPlayer";
import { CHUNK_MS } from "@/lib/meetings/recording-policy";
import { KEEP_BEHIND_MS } from "@/lib/meetings/recording-timeline";

/** ~940KB per five-second part, as recording-policy.ts states for these bitrates. */
const PART_BYTES = 940_000;

/** Every MediaSource the player constructs, so a test can open it. */
let sources: FakeMediaSource[] = [];

class FakeSourceBuffer extends EventTarget {
  appended: number[] = [];
  removals: Array<[number, number]> = [];
  appendBuffer(bytes: BufferSource) {
    this.appended.push((bytes as Uint8Array).byteLength);
    setTimeout(() => this.dispatchEvent(new Event("updateend")), 0);
  }
  remove(startSec: number, endSec: number) {
    this.removals.push([startSec * 1000, endSec * 1000]);
    setTimeout(() => this.dispatchEvent(new Event("updateend")), 0);
  }
}

class FakeMediaSource extends EventTarget {
  readyState = "open";
  duration = 0;
  buffer: FakeSourceBuffer | null = null;
  static supported = true;
  static isTypeSupported() {
    return FakeMediaSource.supported;
  }
  constructor() {
    super();
    sources.push(this);
  }
  addSourceBuffer() {
    this.buffer = new FakeSourceBuffer();
    return this.buffer as unknown as SourceBuffer;
  }
}

function timeline(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    idx: i,
    start: i * PART_BYTES,
    end: (i + 1) * PART_BYTES,
    offsetMs: i * CHUNK_MS,
    durationMs: CHUNK_MS,
  }));
}

/** Which part indices a Range header asks for. */
function partsInRange(range: string, count: number): number[] {
  const m = /bytes=(\d+)-(\d+)/.exec(range);
  if (!m) return [];
  const [from, to] = [Number(m[1]), Number(m[2])];
  return timeline(count)
    .filter((p) => p.start >= from && p.end - 1 <= to)
    .map((p) => p.idx);
}

interface Harness {
  video: HTMLVideoElement;
  buffer: () => FakeSourceBuffer;
  /** Part indices the browser is holding, as the fake models it. */
  resident: Set<number>;
  /** Every run of parts fetched, in order. */
  fetched: number[][];
  /** Move the playhead and let the player react, as a browser would. */
  tick: (ms: number) => Promise<void>;
}

async function setup(
  partCount: number,
  opts: { supported?: boolean; ref?: React.Ref<RecordingPlayerHandle> } = {},
): Promise<Harness> {
  sources = [];
  FakeMediaSource.supported = opts.supported ?? true;

  const parts = timeline(partCount);
  const resident = new Set<number>();
  const fetched: number[][] = [];

  (window as unknown as { MediaSource: unknown }).MediaSource = FakeMediaSource;
  (globalThis as unknown as { MediaSource: unknown }).MediaSource = FakeMediaSource;
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = () => {};

  global.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/parts")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          mimeType: "video/webm;codecs=vp8,opus",
          status: "ready",
          startedAt: new Date(0).toISOString(),
          durationMs: partCount * CHUNK_MS,
          totalBytes: partCount * PART_BYTES,
          parts,
        }),
      } as unknown as Response;
    }
    const range = String((init?.headers as Record<string, string>)?.Range ?? "");
    const idxs = partsInRange(range, partCount);
    fetched.push(idxs);
    for (const i of idxs) resident.add(i);
    const m = /bytes=(\d+)-(\d+)/.exec(range);
    const size = m ? Number(m[2]) - Number(m[1]) + 1 : 0;
    return {
      ok: true,
      status: 206,
      arrayBuffer: async () => new ArrayBuffer(size),
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const { container } = render(
    <RecordingPlayer meetingId="m1" recordingId="r1" ref={opts.ref} />,
  );

  // Let the timeline fetch land, which is what decides native vs MediaSource.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const video = container.querySelector("video");
  if (!video) throw new Error("no <video> rendered");

  let currentMs = 0;
  Object.defineProperty(video, "currentTime", {
    get: () => currentMs / 1000,
    set: (sec: number) => {
      currentMs = sec * 1000;
    },
    configurable: true,
  });
  // One contiguous range, which is what the player's own appends produce.
  Object.defineProperty(video, "buffered", {
    get: () => {
      if (resident.size === 0) return { length: 0, start: () => 0, end: () => 0 };
      const idxs = [...resident].sort((a, b) => a - b);
      return {
        length: 1,
        start: () => (idxs[0] * CHUNK_MS) / 1000,
        end: () => ((idxs[idxs.length - 1] + 1) * CHUNK_MS) / 1000,
      };
    },
    configurable: true,
  });

  const source = sources[sources.length - 1];
  if (source) {
    await act(async () => {
      source.dispatchEvent(new Event("sourceopen"));
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  // The fake's removals are time ranges; reflect them in what is resident, the
  // way a browser would, so the player's next decision sees the truth.
  const applyRemovals = () => {
    const buf = sources[sources.length - 1]?.buffer;
    if (!buf) return;
    for (const [fromMs, toMs] of buf.removals) {
      for (const p of parts) {
        if (p.offsetMs >= fromMs && p.offsetMs + p.durationMs <= toMs) resident.delete(p.idx);
      }
    }
  };

  return {
    video,
    buffer: () => {
      const buf = sources[sources.length - 1]?.buffer;
      if (!buf) throw new Error("no SourceBuffer was added");
      return buf;
    },
    resident,
    fetched,
    tick: async (ms: number) => {
      currentMs = ms;
      await act(async () => {
        fireEvent.timeUpdate(video);
        await new Promise((r) => setTimeout(r, 0));
      });
      applyRemovals();
    },
  };
}

// ── Appending ───────────────────────────────────────────────────────────────

describe("filling the buffer", () => {
  it("appends the start of the recording as soon as the source opens", async () => {
    const h = await setup(20);
    expect(h.buffer().appended.length).toBeGreaterThan(0);
    expect(h.fetched[0]).toContain(0);
  });

  it("fetches a run of parts in one request rather than one each", async () => {
    const h = await setup(20);
    expect(h.fetched[0].length).toBeGreaterThan(1);
  });

  it("falls back to a plain element when MediaSource cannot play the recording", async () => {
    const h = await setup(20, { supported: false });
    // The native path is a <video src>, with no MediaSource at all.
    expect(h.video.getAttribute("src")).toContain("/stream");
    expect(sources).toHaveLength(0);
  });
});

// ── Releasing what has been watched ─────────────────────────────────────────

describe("releasing watched video", () => {
  it("holds everything while the viewer is still inside the keep-behind window", async () => {
    const h = await setup(720);
    await h.tick(KEEP_BEHIND_MS - 1000);
    expect(h.buffer().removals).toHaveLength(0);
  });

  it("gives back video the viewer is well past", async () => {
    const h = await setup(720);
    for (let ms = 0; ms <= 240_000; ms += CHUNK_MS) await h.tick(ms);
    const removals = h.buffer().removals;
    expect(removals.length).toBeGreaterThan(0);
    // Never past the keep-behind window, and never into what is playing.
    for (const [from, to] of removals) {
      expect(from).toBe(0);
      expect(to).toBeLessThanOrEqual(240_000 - KEEP_BEHIND_MS);
    }
  });

  it("keeps an hour-long recording bounded instead of holding all of it", async () => {
    const h = await setup(720);
    // One tick per part rather than four a second: the eviction decision only
    // changes on a part boundary, and an hour at browser rate is 14,400 ticks.
    for (let ms = 0; ms < 720 * CHUNK_MS; ms += CHUNK_MS) await h.tick(ms);
    // The measured complaint: before this the player held all 720 parts —
    // 677MB — for a viewer sitting on the last minute.
    expect(h.resident.size).toBeLessThanOrEqual(KEEP_BEHIND_MS / CHUNK_MS + 2);
  }, 60_000);

  // The half that is easy to get wrong. The player marks a part as appended so
  // two refills cannot fetch it twice; if eviction does not clear those marks,
  // a seek back finds everything it needs "already appended", appends nothing,
  // and plays nothing.
  it("refetches a part it released when the viewer seeks back to it", async () => {
    const ref = createRef<RecordingPlayerHandle>();
    const h = await setup(720, { ref });
    for (let ms = 0; ms <= 180_000; ms += CHUNK_MS) await h.tick(ms);
    expect(h.resident.has(0)).toBe(false);

    const before = h.fetched.length;
    await act(async () => {
      ref.current!.seekTo(0);
      await new Promise((r) => setTimeout(r, 0));
    });
    const after = h.fetched.slice(before).flat();
    expect(after).toContain(0);
  });
});
