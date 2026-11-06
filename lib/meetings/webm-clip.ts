// lib/meetings/webm-clip.ts
// Cutting a window out of a recorded WebM, without decoding it.
//
// A shared clip used to be served from the recording's own parts, which
// meant the first part (about five seconds of the start of the meeting,
// because it carries the stream's header) and a part of slack on each side
// went to anyone with the link. A clip is now its own file, made once on the
// server: the original header, then only the frames inside the window, with
// their timestamps moved so the clip starts at zero. Nothing outside that
// file is ever served for a clip.
//
// WebM is Matroska: nested EBML elements, each an ID, a size and a body.
// What MediaRecorder writes is a "live" file: a Segment and Clusters of
// unknown size, no cue index, no duration. A Cluster holds a timecode and
// blocks; each block holds one frame (or laced frames) of one track, with a
// timecode relative to its cluster. Frames are never touched here — only the
// block's two-byte relative timecode is rewritten — so this is a remux, not a
// re-encode, and it runs in the time it takes to copy the bytes.
//
// The cut is exact for audio. Video can only begin at a keyframe, so a clip
// starts at the last video keyframe at or before the window's start: at most
// one keyframe interval (a few seconds) earlier than asked. The player still
// opens at the asked-for start, and the server-side cut is what bounds what
// can be fetched. The end is exact for every track.
//
// Streaming: the recording arrives as five-second parts and a clip may be
// twenty minutes, so the input is fed in pieces and clusters come out as soon
// as they are complete. Parts that are skipped (before the window) or missing
// (an upload that never landed) break the byte stream; the caller says so and
// the reader looks for the next cluster header rather than misreading the
// middle of a frame as an element.
//
// Pure: bytes in, bytes out. No Storage, no Node APIs.

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
  Position: 0xa7,
  PrevSize: 0xab,
  Void: 0xec,
  SilentTracks: 0x5854,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
} as const;

/** Elements that may sit inside a Cluster. Anything else ends an unknown-size one. */
const CLUSTER_CHILDREN = new Set<number>([
  ID.Timecode,
  ID.SimpleBlock,
  ID.BlockGroup,
  ID.Position,
  ID.PrevSize,
  ID.Void,
  ID.SilentTracks,
]);

const VIDEO_TRACK = 1;

/** How far apart output clusters may start, at most, in timecode ticks (int16 headroom). */
const MAX_CLUSTER_SPAN_TICKS = 30_000;
/** Audio-only clips are cut into clusters of about this long, so they can be seeked. */
const AUDIO_CLUSTER_MS = 5_000;
/** Blocks this far past the end mean the window is over: stop reading. */
const END_SLACK_MS = 3_000;

export class WebmClipError extends Error {}

interface Vint {
  length: number;
  value: number;
  unknown: boolean;
}

function readVint(buf: Uint8Array, pos: number): Vint | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  if (first === 0) throw new WebmClipError("Invalid element size");
  const length = Math.clz32(first) - 23;
  if (pos + length > buf.length) return null;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i++) {
    value = value * 256 + buf[pos + i];
    if (buf[pos + i] !== 0xff) allOnes = false;
  }
  return { length, value, unknown: allOnes };
}

function readId(buf: Uint8Array, pos: number): { length: number; id: number } | null {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  if (first === 0) throw new WebmClipError("Invalid element ID");
  const length = Math.clz32(first) - 23;
  if (length > 4) throw new WebmClipError("Invalid element ID");
  if (pos + length > buf.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + buf[pos + i];
  return { length, id };
}

interface Header {
  id: number;
  /** Bytes taken by the ID and size. */
  headerLength: number;
  size: number;
  unknown: boolean;
}

function readHeader(buf: Uint8Array, pos: number): Header | null {
  const id = readId(buf, pos);
  if (!id) return null;
  const size = readVint(buf, pos + id.length);
  if (!size) return null;
  return { id: id.id, headerLength: id.length + size.length, size: size.value, unknown: size.unknown };
}

function readUint(buf: Uint8Array, start: number, length: number): number {
  let v = 0;
  for (let i = 0; i < length; i++) v = v * 256 + buf[start + i];
  return v;
}

/** The children of a known-size element's body. */
function* children(buf: Uint8Array, start: number, end: number): Generator<{ id: number; start: number; end: number }> {
  let pos = start;
  while (pos < end) {
    const h = readHeader(buf, pos);
    if (!h || h.unknown) throw new WebmClipError("Malformed header element");
    const bodyStart = pos + h.headerLength;
    const bodyEnd = bodyStart + h.size;
    if (bodyEnd > end) throw new WebmClipError("Malformed header element");
    yield { id: h.id, start: bodyStart, end: bodyEnd };
    pos = bodyEnd;
  }
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function idBytes(id: number): Uint8Array {
  const bytes: number[] = [];
  let v = id;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return Uint8Array.from(bytes);
}

/** A size written in eight bytes, so the header never has to move once written. */
function size8(n: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let v = n;
  for (let i = 7; i >= 1; i--) {
    out[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
}

function sizeVint(n: number): Uint8Array {
  if (n < 0x7f) return Uint8Array.of(0x80 | n);
  if (n < 0x3fff) return Uint8Array.of(0x40 | (n >> 8), n & 0xff);
  return size8(n);
}

function element(id: number, body: Uint8Array): Uint8Array {
  return concat([idBytes(id), sizeVint(body.byteLength), body]);
}

function uintBytes(n: number): Uint8Array {
  const bytes: number[] = [];
  let v = Math.max(0, Math.floor(n));
  do {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  return Uint8Array.from(bytes);
}

function float64(n: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, n);
  return out;
}

const UNKNOWN_SIZE = Uint8Array.of(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);
const APP_NAME = new TextEncoder().encode("FundExecs clip");

/** One frame-carrying element, as read. */
interface Block {
  track: number;
  /** Absolute timecode, in ticks of the recording's TimecodeScale. */
  ticks: number;
  key: boolean;
  /** The whole element: ID, size and body. */
  raw: Uint8Array;
  /** Where the two-byte relative timecode sits inside `raw`. */
  tcAt: number;
}

/** A finished output cluster, timed from the start of the clip. */
export interface ClipCluster {
  bytes: Uint8Array;
  /** Milliseconds from the clip's start to the cluster's first frame. */
  startMs: number;
  /** Milliseconds from the clip's start to its last frame. */
  lastMs: number;
  /** Whether the cluster opens on a video keyframe (always true for audio-only). */
  key: boolean;
}

export interface ClipWindow {
  /** Milliseconds into the recording. */
  startMs: number;
  endMs: number;
}

/**
 * Feed a recording's bytes in; get a clip's clusters out.
 *
 * `push(bytes, { resync })` — `resync` when these bytes do not follow on from
 * the previous push (a skipped or missing part). `end()` flushes what is
 * left. `header()` is the clip's EBML header, Segment, Info and Tracks, to put
 * in front of the first cluster; it can be asked for at any time after the
 * first push and carries the duration once `end()` has run.
 */
export class WebmClipper {
  private readonly window: ClipWindow;
  private buf: Uint8Array = new Uint8Array(0);
  private pos = 0;
  private mode: "header" | "top" | "cluster" | "resync" | "skip" = "header";
  private skipRemaining = 0;

  private ebmlRaw: Uint8Array | null = null;
  private tracksRaw: Uint8Array | null = null;
  private scaleNs = 1_000_000;
  private videoTracks = new Set<number>();
  private sawTracks = false;

  private clusterTicks = 0;
  private clusterKnownEnd: number | null = null;
  private clusterBlocks: Block[] = [];

  private started = false;
  private lead: Block[] = [];
  private leadKey = false;
  private baseTicks = 0;
  private lastTicks = 0;
  private finished = false;
  private needKey = false;

  private out: { ticks: number; key: boolean; blocks: Block[] } | null = null;
  private ready: ClipCluster[] = [];

  constructor(window: ClipWindow) {
    if (!(window.endMs > window.startMs)) throw new WebmClipError("Empty window");
    this.window = window;
  }

  /** True once frames past the window's end have been seen: further input is not needed. */
  get done(): boolean {
    return this.finished;
  }

  /** True once some frame of the clip has been emitted. */
  get hasFrames(): boolean {
    return this.started;
  }

  /** Milliseconds into the recording where the clip's first frame sits. */
  get baseMs(): number {
    return this.ticksToMs(this.baseTicks);
  }

  /** The clip's length so far, from its first frame to its last. */
  get durationMs(): number {
    return this.started ? this.ticksToMs(this.lastTicks - this.baseTicks) : 0;
  }

  get hasVideo(): boolean {
    return this.videoTracks.size > 0;
  }

  push(bytes: Uint8Array, opts: { resync?: boolean } = {}): ClipCluster[] {
    if (this.finished) return this.drain();
    if (opts.resync && this.mode !== "header") {
      this.closeCluster();
      this.buf = new Uint8Array(0);
      this.pos = 0;
      this.mode = "resync";
      // Frames after a gap cannot lean on frames before it. Before the clip
      // has begun, the keyframe held so far is no longer a place to start
      // from; after, video waits for the next keyframe.
      this.lead = [];
      this.leadKey = false;
      if (this.started) this.needKey = true;
    }
    this.append(bytes);
    this.parse();
    return this.drain();
  }

  end(): ClipCluster[] {
    if (this.mode === "header") throw new WebmClipError("The recording has no readable header");
    if (this.mode === "cluster") this.closeCluster();
    this.finished = true;
    this.flushOut();
    return this.drain();
  }

  header(): Uint8Array {
    if (!this.ebmlRaw || !this.tracksRaw) throw new WebmClipError("The recording has no readable header");
    const durationTicks = this.started ? this.lastTicks - this.baseTicks + this.msToTicks(20) : 0;
    const info = element(
      ID.Info,
      concat([
        element(ID.TimecodeScale, uintBytes(this.scaleNs)),
        element(ID.MuxingApp, APP_NAME),
        element(ID.WritingApp, APP_NAME),
        element(ID.Duration, float64(durationTicks)),
      ]),
    );
    return concat([this.ebmlRaw, idBytes(ID.Segment), UNKNOWN_SIZE, info, this.tracksRaw]);
  }

  // ── Input ───────────────────────────────────────────────────────────────

  private append(bytes: Uint8Array) {
    const rest = this.buf.subarray(this.pos);
    const next = new Uint8Array(rest.byteLength + bytes.byteLength);
    next.set(rest, 0);
    next.set(bytes, rest.byteLength);
    if (this.clusterKnownEnd !== null) this.clusterKnownEnd -= this.pos;
    this.buf = next;
    this.pos = 0;
  }

  private parse() {
    for (;;) {
      if (this.finished) return;
      if (this.mode === "header") {
        if (!this.parseHeader()) return;
      } else if (this.mode === "resync") {
        if (!this.findCluster()) return;
      } else if (this.mode === "skip") {
        const take = Math.min(this.skipRemaining, this.buf.length - this.pos);
        this.pos += take;
        this.skipRemaining -= take;
        if (this.skipRemaining > 0) return;
        this.mode = "top";
      } else if (this.mode === "top") {
        if (!this.parseTop()) return;
      } else if (!this.parseClusterChild()) {
        return;
      }
    }
  }

  /** EBML header, Segment, and everything up to the first Cluster. */
  private parseHeader(): boolean {
    let pos = this.pos;
    if (!this.ebmlRaw) {
      const h = readHeader(this.buf, pos);
      if (!h) return false;
      if (h.id !== ID.EBML || h.unknown) throw new WebmClipError("This recording isn't a WebM file");
      const end = pos + h.headerLength + h.size;
      if (end > this.buf.length) return false;
      this.ebmlRaw = this.buf.slice(pos, end);
      pos = end;
      const seg = readHeader(this.buf, pos);
      if (!seg) {
        this.pos = pos;
        return false;
      }
      if (seg.id !== ID.Segment) throw new WebmClipError("This recording isn't a WebM file");
      pos += seg.headerLength;
      this.pos = pos;
    }
    for (;;) {
      const h = readHeader(this.buf, this.pos);
      if (!h) return false;
      if (h.id === ID.Cluster) {
        if (!this.sawTracks) throw new WebmClipError("The recording has no track list");
        this.mode = "top";
        return true;
      }
      if (h.unknown) throw new WebmClipError("Malformed recording header");
      const bodyStart = this.pos + h.headerLength;
      const end = bodyStart + h.size;
      if (end > this.buf.length) return false;
      if (h.id === ID.Info) this.readInfo(bodyStart, end);
      if (h.id === ID.Tracks) {
        this.tracksRaw = this.buf.slice(this.pos, end);
        this.readTracks(bodyStart, end);
      }
      this.pos = end;
    }
  }

  private readInfo(start: number, end: number) {
    for (const c of children(this.buf, start, end)) {
      if (c.id === ID.TimecodeScale) {
        const v = readUint(this.buf, c.start, c.end - c.start);
        if (v > 0) this.scaleNs = v;
      }
    }
  }

  private readTracks(start: number, end: number) {
    this.sawTracks = true;
    for (const entry of children(this.buf, start, end)) {
      if (entry.id !== ID.TrackEntry) continue;
      let number = 0;
      let type = 0;
      for (const c of children(this.buf, entry.start, entry.end)) {
        if (c.id === ID.TrackNumber) number = readUint(this.buf, c.start, c.end - c.start);
        if (c.id === ID.TrackType) type = readUint(this.buf, c.start, c.end - c.start);
      }
      if (type === VIDEO_TRACK && number) this.videoTracks.add(number);
    }
  }

  /**
   * Look for the next Cluster after a break in the byte stream. A match must
   * be followed by a valid size and then the Cluster's Timecode, which is what
   * every muxer writes first — four bytes that merely look like a Cluster ID
   * inside a frame are not followed by that.
   */
  private findCluster(): boolean {
    const b = this.buf;
    for (let i = this.pos; i + 4 <= b.length; i++) {
      if (b[i] !== 0x1f || b[i + 1] !== 0x43 || b[i + 2] !== 0xb6 || b[i + 3] !== 0x75) continue;
      try {
        const size = readVint(b, i + 4);
        if (!size) {
          this.pos = i;
          return false;
        }
        const child = readHeader(b, i + 4 + size.length);
        if (!child) {
          this.pos = i;
          return false;
        }
        if (child.id !== ID.Timecode || child.unknown || child.size < 1 || child.size > 8) continue;
      } catch {
        continue;
      }
      this.pos = i;
      this.mode = "top";
      return true;
    }
    // Keep the last three bytes: a Cluster ID may straddle this push and the next.
    this.pos = Math.max(this.pos, b.length - 3);
    return false;
  }

  private parseTop(): boolean {
    const h = readHeader(this.buf, this.pos);
    if (!h) return false;
    if (h.id === ID.Cluster) {
      const bodyStart = this.pos + h.headerLength;
      this.clusterKnownEnd = h.unknown ? null : bodyStart + h.size;
      this.clusterTicks = 0;
      this.clusterBlocks = [];
      this.pos = bodyStart;
      this.mode = "cluster";
      return true;
    }
    if (h.unknown) {
      // Something after the clusters we cannot step over: look for the next cluster.
      this.pos += h.headerLength;
      this.mode = "resync";
      return true;
    }
    // Cues, Tags, Void and the like: not part of a clip.
    this.pos += h.headerLength;
    this.skipRemaining = h.size;
    this.mode = "skip";
    return true;
  }

  private parseClusterChild(): boolean {
    if (this.clusterKnownEnd !== null && this.pos >= this.clusterKnownEnd) {
      this.closeCluster();
      this.mode = "top";
      return true;
    }
    const h = readHeader(this.buf, this.pos);
    if (!h) return false;
    if (!CLUSTER_CHILDREN.has(h.id)) {
      // An unknown-size cluster ends where the next top-level element begins.
      this.closeCluster();
      this.mode = "top";
      return true;
    }
    if (h.unknown) throw new WebmClipError("Malformed cluster");
    const bodyStart = this.pos + h.headerLength;
    const end = bodyStart + h.size;
    if (end > this.buf.length) return false;
    if (h.id === ID.Timecode) {
      this.clusterTicks = readUint(this.buf, bodyStart, h.size);
    } else if (h.id === ID.SimpleBlock) {
      this.readBlock(this.pos, bodyStart, end, null);
    } else if (h.id === ID.BlockGroup) {
      let block: { start: number; end: number } | null = null;
      let referenced = false;
      for (const c of children(this.buf, bodyStart, end)) {
        if (c.id === ID.Block) block = { start: c.start, end: c.end };
        if (c.id === ID.ReferenceBlock) referenced = true;
      }
      if (block) this.readBlock(this.pos, block.start, end, !referenced, block.end);
    }
    this.pos = end;
    return true;
  }

  /**
   * One block. `elementStart` is where the SimpleBlock or BlockGroup begins
   * and `elementEnd` where it ends; `dataStart` is the block's own body (the
   * Block inside a group). `key` is known for a group, read from the flags for
   * a SimpleBlock.
   */
  private readBlock(elementStart: number, dataStart: number, elementEnd: number, key: boolean | null, dataEnd = elementEnd) {
    const track = readVint(this.buf, dataStart);
    if (!track || dataStart + track.length + 3 > dataEnd) throw new WebmClipError("Malformed block");
    const tcAt = dataStart + track.length;
    const rel = (this.buf[tcAt] << 8) | this.buf[tcAt + 1];
    const signed = rel & 0x8000 ? rel - 0x10000 : rel;
    const flags = this.buf[tcAt + 2];
    this.clusterBlocks.push({
      track: track.value,
      ticks: this.clusterTicks + signed,
      key: key ?? (flags & 0x80) !== 0,
      raw: this.buf.slice(elementStart, elementEnd),
      tcAt: tcAt - elementStart,
    });
  }

  // ── Selection ───────────────────────────────────────────────────────────

  private closeCluster() {
    const blocks = this.clusterBlocks;
    this.clusterBlocks = [];
    this.clusterKnownEnd = null;
    for (const b of blocks) {
      if (this.finished) return;
      this.consider(b);
    }
  }

  private consider(b: Block) {
    const ms = this.ticksToMs(b.ticks);
    if (ms >= this.window.endMs + END_SLACK_MS) {
      this.finished = true;
      this.flushOut();
      return;
    }
    if (ms >= this.window.endMs) return;

    const video = this.videoTracks.has(b.track);
    if (this.started) {
      if (video && this.needKey) {
        if (!b.key) return;
        this.needKey = false;
      }
      if (b.ticks >= this.baseTicks) this.emit(b);
      return;
    }

    if (!this.hasVideo) {
      // Audio alone: every frame stands on its own, so the cut is where asked.
      if (ms >= this.window.startMs) this.begin([b]);
      return;
    }

    if (video && b.key && ms <= this.window.startMs) {
      // The latest keyframe at or before the start: the clip opens here.
      this.lead = [b];
      this.leadKey = true;
      return;
    }
    if (ms < this.window.startMs) {
      if (this.leadKey) this.lead.push(b);
      return;
    }
    // The first frame at or after the start.
    if (this.leadKey) {
      this.lead.push(b);
      this.begin(this.lead);
    } else if (video && b.key) {
      // No keyframe before the start in what was read: open on the next one.
      this.begin([b]);
    }
    // Otherwise a non-key video frame, or audio, before any keyframe: dropped,
    // so picture and sound start together.
  }

  private begin(blocks: Block[]) {
    this.started = true;
    this.baseTicks = blocks[0].ticks;
    this.lead = [];
    for (const b of blocks) if (b.ticks >= this.baseTicks) this.emit(b);
  }

  private emit(b: Block) {
    const rel = b.ticks - this.baseTicks;
    const videoKey = this.videoTracks.has(b.track) && b.key;
    const o = this.out;
    // Relative timecodes are signed sixteen-bit: a frame a little before the
    // cluster's start (audio interleaved with video) is fine, a long way
    // either side is not.
    const startNew =
      !o ||
      Math.abs(rel - o.ticks) > MAX_CLUSTER_SPAN_TICKS ||
      (this.hasVideo ? videoKey : rel - o.ticks >= this.msToTicks(AUDIO_CLUSTER_MS));
    if (startNew) {
      this.flushOut();
      this.out = { ticks: rel, key: this.hasVideo ? videoKey : true, blocks: [] };
    }
    this.out!.blocks.push(b);
    if (b.ticks > this.lastTicks) this.lastTicks = b.ticks;
  }

  private flushOut() {
    const o = this.out;
    this.out = null;
    if (!o || !o.blocks.length) return;
    const parts: Uint8Array[] = [element(ID.Timecode, uintBytes(o.ticks))];
    let last = o.ticks;
    for (const b of o.blocks) {
      const raw = b.raw.slice();
      const rel = b.ticks - this.baseTicks - o.ticks;
      raw[b.tcAt] = (rel >> 8) & 0xff;
      raw[b.tcAt + 1] = rel & 0xff;
      parts.push(raw);
      last = Math.max(last, b.ticks - this.baseTicks);
    }
    const body = concat(parts);
    this.ready.push({
      bytes: concat([idBytes(ID.Cluster), size8(body.byteLength), body]),
      startMs: this.ticksToMs(o.ticks),
      lastMs: this.ticksToMs(last),
      key: o.key,
    });
  }

  private drain(): ClipCluster[] {
    const out = this.ready;
    this.ready = [];
    return out;
  }

  private ticksToMs(ticks: number): number {
    return (ticks * this.scaleNs) / 1_000_000;
  }

  private msToTicks(ms: number): number {
    return Math.round((ms * 1_000_000) / this.scaleNs);
  }
}

/** Whether a recorded type can be cut here. */
export function canClip(mimeType: string | null | undefined): boolean {
  const t = (mimeType || "video/webm").toLowerCase();
  return t.startsWith("video/webm") || t.startsWith("audio/webm");
}

/** Clusters grouped into stored parts of about `targetMs` each, starting on keyframe clusters. */
export class ClipPartPacker {
  private current: ClipCluster[] = [];
  private readonly targetMs: number;

  constructor(targetMs = 5_000) {
    this.targetMs = targetMs;
  }

  /** Add clusters; returns any parts that are now complete. */
  add(clusters: readonly ClipCluster[]): ClipCluster[][] {
    const done: ClipCluster[][] = [];
    for (const c of clusters) {
      const first = this.current[0];
      if (first && c.key && c.startMs - first.startMs >= this.targetMs) {
        done.push(this.current);
        this.current = [];
      }
      this.current.push(c);
    }
    return done;
  }

  /** What is left, as the last part. */
  finish(): ClipCluster[] | null {
    const rest = this.current;
    this.current = [];
    return rest.length ? rest : null;
  }
}

export { concat as concatBytes };
