/**
 * Cutting a clip end to end against an in-memory table set and bucket: the
 * recording's parts in, the clip's own parts out, and nothing outside the
 * window in them.
 */
import { WebmClipper, concatBytes } from "./webm-clip";

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const objects = new Map<string, Uint8Array>();
let failUpload = false;

jest.mock("@/lib/meetings/recording-parts", () => ({
  readAllRecordingParts: async (_c: unknown, recordingId: string) =>
    (tables.live_meeting_recording_chunks ?? []).filter((r) => r.recording_id === recordingId),
}));

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let op: { kind: "select" } | { kind: "update"; patch: Row } | { kind: "delete" } | { kind: "insert"; rows: Row[] } = { kind: "select" };
  let returning = false;
  const rows = () => (tables[table] ??= []);
  const matched = () => rows().filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (op.kind === "insert") {
      rows().push(...op.rows.map((r) => ({ ...r })));
      return { data: op.rows, error: null };
    }
    if (op.kind === "update") {
      const hit = matched();
      for (const r of hit) Object.assign(r, (op as { patch: Row }).patch);
      return { data: returning ? hit : null, error: null };
    }
    if (op.kind === "delete") {
      tables[table] = rows().filter((r) => !filters.every((f) => f(r)));
      return { data: null, error: null };
    }
    return { data: matched(), error: null };
  };
  const q: any = {
    select: () => {
      if (op.kind !== "select") returning = true;
      return q;
    },
    update: (patch: Row) => ((op = { kind: "update", patch }), q),
    delete: () => ((op = { kind: "delete" }), q),
    insert: (r: Row | Row[]) => ((op = { kind: "insert", rows: Array.isArray(r) ? r : [r] }), q),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
    in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
    lt: (c: string, v: any) => (filters.push((r) => (r[c] ?? 0) < v), q),
    gt: (c: string, v: any) => (filters.push((r) => r[c] > v), q),
    or: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve(run()),
  };
  return q;
}

const service = {
  from: (t: string) => query(t),
  storage: {
    from: () => ({
      upload: async (path: string, bytes: Uint8Array) => {
        if (failUpload) return { error: { message: "bucket says no" } };
        objects.set(path, bytes);
        return { error: null };
      },
      download: async (path: string) => {
        const b = objects.get(path);
        return b ? { data: new Blob([b as BlobPart]), error: null } : { data: null, error: { message: "missing" } };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) objects.delete(p);
        return { error: null };
      },
    }),
  },
} as never;

import { buildClip, clipPartPath, partsToRead, purgeClip, runClipSweep } from "./recording-clip.server";

// ── A recording, as MediaRecorder would leave it: one stream cut into parts ──

function el(id: number[], body: number[]): number[] {
  const n = body.length;
  return [...id, 0x01, 0, 0, 0, (n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, ...body];
}
function stream(durationMs: number): Uint8Array {
  const out = [
    ...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], [0x77, 0x65, 0x62, 0x6d])),
    0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ...el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40])),
    ...el([0x16, 0x54, 0xae, 0x6b], [...el([0xae], [...el([0xd7], [1]), ...el([0x83], [1])]), ...el([0xae], [...el([0xd7], [2]), ...el([0x83], [2])])]),
  ];
  for (let c = 0; c < durationMs; c += 2000) {
    const body = [...el([0xe7], [(c >> 8) & 0xff, c & 0xff])];
    for (let ms = c; ms < c + 2000; ms += 20) {
      const rel = ms - c;
      const track = ms % 40 === 0 ? 1 : 2;
      const key = track === 2 || ms === c;
      body.push(...el([0xa3], [0x80 | track, (rel >> 8) & 0xff, rel & 0xff, key ? 0x80 : 0, (ms >> 8) & 0xff, ms & 0xff]));
    }
    out.push(0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...body);
  }
  return Uint8Array.from(out);
}

/** Every frame's original time, read from the payloads in a clip. */
function originalTimes(file: Uint8Array): number[] {
  const c = new WebmClipper({ startMs: 0, endMs: 1e9 });
  const clusters = [...c.push(file), ...c.end()];
  const times: number[] = [];
  for (const cl of clusters) {
    const b = cl.bytes;
    // Payload bytes are the last two of each block; find SimpleBlocks by ID.
    for (let i = 12; i + 14 < b.length; i++) {
      if (b[i] === 0xa3 && b[i + 1] === 0x01) {
        const size = b[i + 8];
        const body = i + 9;
        times.push((b[body + size - 2] << 8) | b[body + size - 1]);
        i = body + size - 1;
      }
    }
  }
  return times;
}

const NOW = new Date("2026-11-06T12:00:00Z");

beforeAll(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

function seed(opts: { mime?: string; start?: number; end?: number } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  objects.clear();
  failUpload = false;
  const bytes = stream(40_000);
  const n = 8;
  const step = Math.ceil(bytes.length / n);
  tables.live_meeting_recording_chunks = [];
  for (let i = 0; i < n; i++) {
    const path = `m1/r1/part-00000${i}.webm`;
    objects.set(path, bytes.slice(i * step, (i + 1) * step));
    tables.live_meeting_recording_chunks.push({ recording_id: "r1", idx: i, path, size: Math.min(step, bytes.length - i * step), offset_ms: i * 5000, duration_ms: 5000 });
  }
  tables.live_meeting_recordings = [{ id: "r1", mime_type: opts.mime ?? "video/webm;codecs=vp8,opus", deleted_at: null }];
  tables.recording_shares = [
    {
      id: "s1",
      meeting_id: "m1",
      recording_id: "r1",
      start_ms: opts.start ?? 21_000,
      end_ms: opts.end ?? 27_000,
      expires_at: "2026-11-13T00:00:00Z",
      revoked_at: null,
      purged_at: null,
      clip_status: "pending",
      clip_attempts: 0,
      clip_started_at: null,
      created_at: "2026-11-06T11:00:00Z",
    },
  ];
  tables.recording_share_parts = [];
}

describe("buildClip", () => {
  it("cuts the window into the clip's own parts", async () => {
    seed();
    const res = await buildClip(service, "s1", { now: NOW });
    expect(res).toMatchObject({ ok: true });
    const share = tables.recording_shares[0];
    expect(share).toMatchObject({ clip_status: "ready", clip_offset_ms: 20_000, clip_error: null });
    expect(share.clip_duration_ms).toBeGreaterThan(6_900);

    const parts = tables.recording_share_parts.sort((a, b) => a.idx - b.idx);
    expect(parts.length).toBeGreaterThan(0);
    expect(parts[0]).toMatchObject({ idx: 0, offset_ms: 0, path: clipPartPath("m1", "r1", "s1", 0) });
    const file = concatBytes(parts.map((p) => objects.get(p.path)!));
    const times = originalTimes(file);
    // From the keyframe before 21s to just before 27s; nothing else of the meeting.
    expect(Math.min(...times)).toBe(20_000);
    expect(Math.max(...times)).toBeLessThan(27_000);
    expect(times.every((t) => t >= 20_000 && t < 27_000)).toBe(true);
  });

  it("leaves a recording it cannot cut as failed, with the reason", async () => {
    seed({ mime: "video/mp4" });
    const res = await buildClip(service, "s1", { now: NOW });
    expect(res).toMatchObject({ ok: false });
    expect(tables.recording_shares[0].clip_status).toBe("failed");
    expect(tables.recording_shares[0].clip_error).toMatch(/WebM/);
  });

  it("cleans up what it uploaded when storing fails", async () => {
    seed();
    failUpload = true;
    const before = objects.size;
    const res = await buildClip(service, "s1", { now: NOW });
    expect(res.ok).toBe(false);
    expect(objects.size).toBe(before);
    expect(tables.recording_share_parts).toEqual([]);
    expect(tables.recording_shares[0].clip_status).toBe("failed");
  });

  it("does nothing for a link that is revoked, expired or already cut", async () => {
    seed();
    tables.recording_shares[0].revoked_at = "2026-11-06T11:30:00Z";
    expect(await buildClip(service, "s1", { now: NOW })).toMatchObject({ ok: false, skipped: true });
    seed();
    tables.recording_shares[0].clip_status = "ready";
    expect(await buildClip(service, "s1", { now: NOW })).toMatchObject({ ok: false, skipped: true });
    seed();
    expect(await buildClip(service, "s1", { now: new Date("2026-12-01T00:00:00Z") })).toMatchObject({ skipped: true });
  });

  it("takes over a cut that died while processing", async () => {
    seed();
    Object.assign(tables.recording_shares[0], { clip_status: "processing", clip_started_at: "2026-11-06T11:00:00Z", clip_attempts: 1 });
    expect(await buildClip(service, "s1", { now: NOW })).toMatchObject({ ok: true });
    expect(tables.recording_shares[0].clip_attempts).toBe(2);
  });
});

describe("purgeClip and the sweep", () => {
  it("deletes a clip's media and rows", async () => {
    seed();
    await buildClip(service, "s1", { now: NOW });
    const paths = tables.recording_share_parts.map((p) => p.path);
    expect(paths.every((p) => objects.has(p))).toBe(true);
    expect(await purgeClip(service, "s1", NOW)).toBe(paths.length);
    expect(paths.some((p) => objects.has(p))).toBe(false);
    expect(tables.recording_share_parts).toEqual([]);
    expect(tables.recording_shares[0].purged_at).toBe(NOW.toISOString());
    // The recording itself is untouched.
    expect(objects.has("m1/r1/part-000000.webm")).toBe(true);
  });

  it("cuts clips still waiting", async () => {
    seed();
    const stats = await runClipSweep(service, NOW);
    expect(stats.cut).toBe(1);
    expect(tables.recording_shares[0].clip_status).toBe("ready");
  });
});

describe("partsToRead", () => {
  const parts = Array.from({ length: 20 }, (_, i) => ({ idx: i, start: i * 10, end: i * 10 + 10, offsetMs: i * 5000, durationMs: 5000 }));
  it("reads the header part and a lookback before the window", () => {
    expect(partsToRead(parts, 60_000, 65_000).map((p) => p.idx)).toEqual([0, 6, 7, 8, 9, 10, 11, 12, 13]);
  });
});
