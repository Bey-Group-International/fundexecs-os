import { drainOutbox, memoryOutbox, outboxKey, savedPartsNotice, totalsAfterRecovery, type OutboxPart } from "./recording-outbox";

function part(idx: number, over: Partial<OutboxPart> = {}): OutboxPart {
  return {
    key: outboxKey("rec1", idx),
    meetingId: "m1",
    recordingId: "rec1",
    idx,
    path: `m1/rec1/part-${idx}.webm`,
    mimeType: "video/webm",
    blob: new Blob(["x".repeat(10)]),
    offsetMs: idx * 5000,
    durationMs: 5000,
    savedAt: idx,
    ...over,
  };
}

function client(opts: { uploadError?: (path: string) => unknown } = {}) {
  const uploads: string[] = [];
  const rows: unknown[] = [];
  const updates: Array<Record<string, unknown>> = [];
  return {
    uploads,
    rows,
    updates,
    c: {
      storage: {
        from: () => ({
          upload: async (path: string) => {
            const error = opts.uploadError?.(path) ?? null;
            if (!error) uploads.push(path);
            return { error };
          },
        }),
      },
      from: (table: string) => ({
        upsert: async (row: unknown) => {
          rows.push(row);
          return { error: null };
        },
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: table === "live_meeting_recordings" ? { size_bytes: 100, chunk_count: 4, duration_seconds: 20 } : null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            updates.push(patch);
            return { error: null };
          },
        }),
      }),
    } as never,
  };
}

it("uploads saved parts in order, clears them, and corrects the recording's totals", async () => {
  const store = memoryOutbox();
  await store.put(part(5));
  await store.put(part(4));
  const sb = client();
  expect(await drainOutbox(sb.c, store)).toEqual({ uploaded: 2, kept: 0, discarded: 0 });
  expect(sb.uploads).toEqual(["m1/rec1/part-4.webm", "m1/rec1/part-5.webm"]);
  expect(await store.all()).toEqual([]);
  expect(sb.updates).toEqual([{ size_bytes: 120, chunk_count: 6, duration_seconds: 30 }]);
});

it("keeps a part that failed for a reason that may pass, and drops one refused for good", async () => {
  const store = memoryOutbox();
  await store.put(part(1));
  await store.put(part(2));
  await store.put(part(3));
  const sb = client({
    uploadError: (path) =>
      path.endsWith("part-1.webm") ? { status: 503 } : path.endsWith("part-2.webm") ? { status: 413 } : path.endsWith("part-3.webm") ? { status: 401 } : null,
  });
  expect(await drainOutbox(sb.c, store)).toEqual({ uploaded: 0, kept: 2, discarded: 1 });
  expect((await store.all()).map((p) => p.idx).sort()).toEqual([1, 3]);
});

it("adds landed parts to a recording's totals", () => {
  expect(totalsAfterRecovery({ size_bytes: null, chunk_count: null, duration_seconds: 12 }, [part(0), part(1)])).toEqual({
    size_bytes: 20,
    chunk_count: 2,
    duration_seconds: 12,
  });
});

it("tells the host how much is waiting", () => {
  expect(savedPartsNotice(0, 5000)).toBeNull();
  expect(savedPartsNotice(3, 5000)).toMatch(/^About 15 seconds .* saved on this device/);
  expect(savedPartsNotice(24, 5000)).toMatch(/^About 2 minutes/);
});
