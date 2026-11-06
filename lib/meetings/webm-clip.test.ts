import { ClipPartPacker, WebmClipError, WebmClipper, canClip, concatBytes, type ClipCluster } from "./webm-clip";

// ── A tiny WebM writer, enough to stand in for MediaRecorder ──────────────

function idBytes(id: number): number[] {
  const out: number[] = [];
  let v = id;
  while (v > 0) {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return out;
}
function sizeBytes(n: number): number[] {
  // Always eight bytes: simple, and what libwebm does for clusters.
  const out = [0x01, 0, 0, 0, 0, 0, 0, 0];
  let v = n;
  for (let i = 7; i >= 1; i--) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
}
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
function el(id: number, body: number[]): number[] {
  return [...idBytes(id), ...sizeBytes(body.length), ...body];
}
function uint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  do {
    out.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  return out;
}

interface Frame {
  track: number;
  ms: number;
  key: boolean;
}

/** A frame's payload names its track and time, so the output can be read back. */
function payload(f: Frame): number[] {
  return [f.track, (f.ms >> 16) & 0xff, (f.ms >> 8) & 0xff, f.ms & 0xff, 0xaa, 0xbb];
}

function simpleBlock(f: Frame, clusterMs: number): number[] {
  const rel = f.ms - clusterMs;
  return el(0xa3, [0x80 | f.track, (rel >> 8) & 0xff, rel & 0xff, f.key ? 0x80 : 0x00, ...payload(f)]);
}

function header(video: boolean): number[] {
  const ebml = el(0x1a45dfa3, [...el(0x4282, [...new TextEncoder().encode("webm")])]);
  const info = el(0x1549a966, [...el(0x2ad7b1, uint(1_000_000))]);
  const tracks: number[] = [];
  if (video) tracks.push(...el(0xae, [...el(0xd7, [1]), ...el(0x83, [1])]));
  tracks.push(...el(0xae, [...el(0xd7, [2]), ...el(0x83, [2])]));
  return [...ebml, ...idBytes(0x18538067), ...UNKNOWN, ...info, ...el(0x1654ae6b, tracks)];
}

/**
 * A recording: video at 25 fps with a keyframe every `gop` ms (starting a
 * cluster, like Chrome), audio every 20 ms. Clusters are of unknown size,
 * like MediaRecorder writes.
 */
function recording(opts: { durationMs: number; gop?: number; video?: boolean; knownSize?: boolean }): Uint8Array {
  const video = opts.video !== false;
  const gop = opts.gop ?? 2000;
  const frames: Frame[] = [];
  for (let ms = 0; ms < opts.durationMs; ms += 20) frames.push({ track: 2, ms, key: true });
  if (video) for (let ms = 0; ms < opts.durationMs; ms += 40) frames.push({ track: 1, ms, key: ms % gop === 0 });
  frames.sort((a, b) => a.ms - b.ms || a.track - b.track);

  const out: number[] = [...header(video)];
  const clusterEvery = video ? gop : 1000;
  let i = 0;
  while (i < frames.length) {
    const start = frames[i].ms - (frames[i].ms % clusterEvery);
    const body: number[] = [...el(0xe7, uint(start))];
    while (i < frames.length && frames[i].ms < start + clusterEvery) body.push(...simpleBlock(frames[i++], start));
    if (opts.knownSize) out.push(...el(0x1f43b675, body));
    else out.push(...idBytes(0x1f43b675), ...UNKNOWN, ...body);
  }
  return Uint8Array.from(out);
}

/** Read every frame back out of a WebM: [track, absolute ms, key]. */
function readFrames(bytes: Uint8Array): Frame[] {
  const c = new WebmClipper({ startMs: 0, endMs: 10_000_000 });
  // Pull the blocks through the public interface: a clipper over the whole
  // file emits every frame, re-timed from its first.
  const clusters = [...c.push(bytes), ...c.end()];
  const frames: Frame[] = [];
  for (const cl of clusters) {
    const b = cl.bytes;
    // Cluster: 4-byte ID, 8-byte size, Timecode element.
    let pos = 12;
    const tcLen = b[pos + 1] & 0x7f;
    let tc = 0;
    for (let k = 0; k < tcLen; k++) tc = tc * 256 + b[pos + 2 + k];
    pos += 2 + tcLen;
    while (pos < b.length) {
      const sizeLen = Math.clz32(b[pos + 1]) - 23;
      let size = b[pos + 1] & (0xff >> sizeLen);
      for (let k = 1; k < sizeLen; k++) size = size * 256 + b[pos + 1 + k];
      const body = pos + 1 + sizeLen;
      const track = b[body] & 0x7f;
      let rel = (b[body + 1] << 8) | b[body + 2];
      if (rel & 0x8000) rel -= 0x10000;
      frames.push({ track, ms: tc + rel, key: (b[body + 3] & 0x80) !== 0 });
      // The payload still carries the frame's original time.
      const orig = (b[body + 5] << 16) | (b[body + 6] << 8) | b[body + 7];
      expect(b[body + 4]).toBe(track);
      (frames[frames.length - 1] as Frame & { orig: number }).orig = orig;
      pos = body + size;
    }
  }
  return frames;
}

function cut(bytes: Uint8Array, window: { startMs: number; endMs: number }, pieces = 1): { clipper: WebmClipper; file: Uint8Array; clusters: ClipCluster[] } {
  const clipper = new WebmClipper(window);
  const clusters: ClipCluster[] = [];
  const step = Math.ceil(bytes.length / pieces);
  for (let at = 0; at < bytes.length && !clipper.done; at += step) clusters.push(...clipper.push(bytes.subarray(at, at + step)));
  clusters.push(...clipper.end());
  return { clipper, clusters, file: concatBytes([clipper.header(), ...clusters.map((c) => c.bytes)]) };
}

type Timed = Frame & { orig: number };

describe("WebmClipper", () => {
  const rec = recording({ durationMs: 20_000, gop: 2000 });

  it("opens on the keyframe before the start and stops at the end", () => {
    const { clipper, file } = cut(rec, { startMs: 5_000, endMs: 9_000 });
    expect(clipper.baseMs).toBe(4_000);
    const frames = readFrames(file) as Timed[];
    expect(Math.min(...frames.map((f) => f.orig))).toBe(4_000);
    expect(Math.max(...frames.map((f) => f.orig))).toBeLessThan(9_000);
    // Nothing from before the keyframe, nothing from after the end.
    expect(frames.every((f) => f.orig >= 4_000 && f.orig < 9_000)).toBe(true);
    // Re-timed from zero, and each frame keeps its place.
    for (const f of frames) expect(f.ms).toBe(f.orig - 4_000);
    expect(frames[0]).toMatchObject({ track: 1, key: true, ms: 0 });
  });

  it("gives the same clip however the input is split", () => {
    const whole = cut(rec, { startMs: 5_000, endMs: 9_000 }).file;
    for (const pieces of [3, 17, 101]) expect(cut(rec, { startMs: 5_000, endMs: 9_000 }, pieces).file).toEqual(whole);
  });

  it("reads clusters of known size too", () => {
    const known = recording({ durationMs: 20_000, gop: 2000, knownSize: true });
    const frames = readFrames(cut(known, { startMs: 5_000, endMs: 9_000 }).file) as Timed[];
    expect(frames.every((f) => f.orig >= 4_000 && f.orig < 9_000)).toBe(true);
    expect(frames.length).toBe(readFrames(cut(rec, { startMs: 5_000, endMs: 9_000 }).file).length);
  });

  it("cuts audio exactly where asked", () => {
    const audio = recording({ durationMs: 20_000, video: false });
    const { clipper, file } = cut(audio, { startMs: 5_010, endMs: 6_000 });
    expect(clipper.hasVideo).toBe(false);
    expect(clipper.baseMs).toBe(5_020);
    const frames = readFrames(file) as Timed[];
    expect(frames[0].orig).toBe(5_020);
    expect(frames[frames.length - 1].orig).toBe(5_980);
  });

  it("starts output clusters on keyframes, so the clip can be seeked", () => {
    const { clusters } = cut(rec, { startMs: 5_000, endMs: 15_000 });
    expect(clusters.map((c) => [c.startMs, c.key])).toEqual([
      [0, true],
      [2_000, true],
      [4_000, true],
      [6_000, true],
      [8_000, true],
      [10_000, true],
    ]);
  });

  it("writes a header with the track list and the clip's duration", () => {
    const { clipper } = cut(rec, { startMs: 5_000, endMs: 9_000 });
    const head = clipper.header();
    // EBML magic, then the Segment of unknown size.
    expect([...head.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    const hex = Buffer.from(head).toString("hex");
    expect(hex).toContain("1654ae6b"); // Tracks
    expect(hex).toContain("4489"); // Duration
    expect(clipper.durationMs).toBeCloseTo(4_980, -1);
  });

  it("stops reading once the window is behind it", () => {
    const c = new WebmClipper({ startMs: 1_000, endMs: 2_000 });
    c.push(rec);
    expect(c.done).toBe(true);
  });

  it("after a gap before the start, waits for the next keyframe rather than bridging it", () => {
    const parts = split(rec, 8);
    const c = new WebmClipper({ startMs: 9_000, endMs: 12_000 });
    const out: ClipCluster[] = [...c.push(parts[0])];
    // Skip parts 1–3: the stream breaks in the middle of something.
    for (let i = 4; i < parts.length && !c.done; i++) out.push(...c.push(parts[i], { resync: i === 4 }));
    out.push(...c.end());
    const frames = readFrames(concatBytes([c.header(), ...out.map((x) => x.bytes)])) as Timed[];
    expect(frames[0]).toMatchObject({ track: 1, key: true });
    // Nothing from part 0 survives across the gap.
    expect(Math.min(...frames.map((f) => f.orig))).toBeGreaterThanOrEqual(8_000);
  });

  it("after a gap inside the clip, drops video until the next keyframe", () => {
    const parts = split(rec, 10);
    const c = new WebmClipper({ startMs: 0, endMs: 20_000 });
    const out: ClipCluster[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (i === 4) continue;
      out.push(...c.push(parts[i], { resync: i === 5 }));
    }
    out.push(...c.end());
    const frames = readFrames(concatBytes([c.header(), ...out.map((x) => x.bytes)])) as Timed[];
    const video = frames.filter((f) => f.track === 1);
    // The first video frame after the hole is a keyframe.
    for (let i = 1; i < video.length; i++) {
      if (video[i].orig - video[i - 1].orig > 40) expect(video[i].key).toBe(true);
    }
  });

  it("refuses what is not WebM", () => {
    const c = new WebmClipper({ startMs: 0, endMs: 1000 });
    expect(() => c.push(Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))).toThrow(WebmClipError);
    expect(() => new WebmClipper({ startMs: 0, endMs: 1000 }).end()).toThrow(WebmClipError);
    expect(() => new WebmClipper({ startMs: 5, endMs: 5 })).toThrow(WebmClipError);
  });
});

function split(bytes: Uint8Array, n: number): Uint8Array[] {
  const step = Math.ceil(bytes.length / n);
  const out: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += step) out.push(bytes.subarray(at, at + step));
  return out;
}

describe("ClipPartPacker", () => {
  const cl = (startMs: number, key = true): ClipCluster => ({ bytes: Uint8Array.of(1), startMs, lastMs: startMs + 900, key });
  it("groups clusters into parts of about five seconds, breaking only on keyframes", () => {
    const p = new ClipPartPacker(5_000);
    const done = p.add([cl(0), cl(2_000), cl(4_000), cl(5_000, false), cl(6_000), cl(8_000), cl(11_000)]);
    expect(done.map((g) => g.map((c) => c.startMs))).toEqual([
      [0, 2_000, 4_000, 5_000],
      [6_000, 8_000],
    ]);
    expect(p.add([cl(12_000)])).toEqual([]);
    expect(p.finish()!.map((c) => c.startMs)).toEqual([11_000, 12_000]);
    expect(p.finish()).toBeNull();
  });
});

describe("canClip", () => {
  it("accepts WebM, video or audio, and nothing else", () => {
    expect(canClip("video/webm;codecs=vp9,opus")).toBe(true);
    expect(canClip("audio/webm")).toBe(true);
    expect(canClip(null)).toBe(true);
    expect(canClip("video/mp4")).toBe(false);
    expect(canClip("audio/ogg")).toBe(false);
  });
});
