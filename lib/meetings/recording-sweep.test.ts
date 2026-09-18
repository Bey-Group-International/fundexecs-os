// The only thing in this product that deletes recordings, and the only thing
// that closes out a recording whose host stopped existing mid-call. Both are
// destructive and neither is ever observed by hand, so both are pinned here.

import { ABANDON_AFTER_MS, runRecordingSweep } from "@/lib/meetings/recording-sweep.server";
import { CHUNK_MS } from "@/lib/meetings/recording-policy";

type Row = Record<string, unknown>;

/**
 * A Supabase stand-in that answers each query in turn.
 *
 * Per-table QUEUES rather than a single row set, because the sweep makes two
 * different reads of `live_meeting_recordings` — what has expired, then what
 * was never stopped — and a harness that answers both with the same rows tests
 * neither pass honestly.
 */
interface Harness {
  queues: Record<string, Row[][]>;
  updates: { table: string; patch: Row; id: unknown }[];
  deletes: { table: string; id: unknown }[];
  removed: string[][];
  removeFails?: boolean;
  /**
   * The bucket, as object names under each prefix. "" is the root, whose
   * entries are meeting folders — which is what the orphan pass reads.
   *
   * Removing actually removes, because the paging loop's correctness depends
   * on the listing getting shorter: a stub that kept answering with a full page
   * would prove nothing about the fix and would hang the loop on the old code.
   */
  objects: Record<string, string[]>;
}

function nextRows(h: Harness, table: string): Row[] {
  return h.queues[table]?.shift() ?? [];
}

function client(h: Harness) {
  const builder = (table: string) => {
    const filters: Row = {};
    let mode: "select" | "update" | "delete" = "select";
    let patch: Row = {};

    const chain: Record<string, unknown> = {
      select: () => chain,
      is: () => chain,
      lte: () => chain,
      order: () => chain,
      eq: (col: string, val: unknown) => { filters[col] = val; return chain; },
      in: () => chain,
      update: (p: Row) => { mode = "update"; patch = p; return chain; },
      delete: () => { mode = "delete"; return chain; },
      limit: () => Promise.resolve({ data: nextRows(h, table) }),
      then: (resolve: (v: { data: Row[] }) => unknown) => {
        if (mode === "update") h.updates.push({ table, patch, id: filters.id });
        if (mode === "delete") h.deletes.push({ table, id: filters.recording_id ?? filters.id });
        const data = mode === "select" ? nextRows(h, table) : [];
        return Promise.resolve(resolve({ data }));
      },
    };
    return chain;
  };

  return {
    from: (table: string) => builder(table),
    storage: {
      from: () => ({
        list: async (prefix: string, opts?: { limit?: number }) => ({
          data: (h.objects[prefix] ?? []).slice(0, opts?.limit ?? 100).map((name) => ({ name })),
          error: null,
        }),
        remove: async (paths: string[]) => {
          if (h.removeFails) return { error: { message: "remove failed" } };
          h.removed.push(paths);
          for (const path of paths) {
            const at = path.lastIndexOf("/");
            const prefix = path.slice(0, at);
            const name = path.slice(at + 1);
            h.objects[prefix] = (h.objects[prefix] ?? []).filter((n) => n !== name);
          }
          return { error: null };
        },
      }),
    },
  } as never;
}

/** `expired` answers the first recordings query, `stale` the second. */
function harness(opts: {
  expired?: Row[];
  stale?: Row[];
  chunks?: Row[];
  /** Meetings that still exist, for the orphan pass. */
  living?: Row[];
  objects?: Record<string, string[]>;
} = {}): Harness {
  return {
    queues: {
      live_meeting_recordings: [opts.expired ?? [], opts.stale ?? []],
      live_meeting_recording_chunks: [opts.chunks ?? []],
      live_meetings: [opts.living ?? []],
    },
    updates: [],
    deletes: [],
    removed: [],
    objects: opts.objects ?? {
      "m1/r1": ["part-000000.webm", "part-000001.webm"],
    },
  };
}

const NOW = new Date("2026-09-15T12:00:00.000Z");

describe("expiry", () => {
  it("deletes the objects and marks the row, keeping the row itself", () => {
    const h = harness({ expired: [{ id: "r1", meeting_id: "m1" }] });
    return runRecordingSweep(client(h), NOW).then((stats) => {
      expect(stats.expired).toBe(1);
      expect(stats.objectsDeleted).toBe(2);
      expect(h.removed[0]).toEqual([
        "m1/r1/part-000000.webm",
        "m1/r1/part-000001.webm",
      ]);
      // The row survives its bytes: that is how a viewer following an old link
      // learns a recording existed and was deleted, not that it never existed.
      const marked = h.updates.find((u) => u.table === "live_meeting_recordings");
      expect(marked?.patch.deleted_at).toBe(NOW.toISOString());
      expect(marked?.patch.size_bytes).toBe(0);
    });
  });

  // Chunk rows pointing at objects that no longer exist would have the playback
  // route stream a file of nothing.
  it("drops the index with the bytes", () => {
    const h = harness({ expired: [{ id: "r1", meeting_id: "m1" }] });
    return runRecordingSweep(client(h), NOW).then(() => {
      expect(h.deletes).toContainEqual({ table: "live_meeting_recording_chunks", id: "r1" });
    });
  });

  it("counts a failed delete as an error rather than claiming success", async () => {
    const h = harness({ expired: [{ id: "r1", meeting_id: "m1" }] });
    h.removeFails = true;
    jest.spyOn(console, "error").mockImplementation(() => {});
    const stats = await runRecordingSweep(client(h), NOW);
    expect(stats.errors).toBe(1);
    expect(stats.expired).toBe(0);
    // Crucially it did NOT mark the row deleted: the bytes are still there and
    // still being paid for, and next hour's sweep must try again.
    expect(h.updates.find((u) => u.patch.deleted_at)).toBeUndefined();
  });
});

describe("abandoned recordings", () => {
  const stale = new Date(NOW.getTime() - ABANDON_AFTER_MS - 1000).toISOString();

  // A host whose tab died mid-call. The parts they DID upload are a real,
  // watchable recording of most of a meeting — the whole reason for uploading
  // during the call rather than at the end of it.
  it("closes a partial recording out as complete, not failed", async () => {
    const h = harness({
      stale: [{ id: "r2", started_at: stale }],
      chunks: [{ size: 900 }, { size: 1100 }],
    });
    const stats = await runRecordingSweep(client(h), NOW);
    expect(stats.abandoned).toBe(1);
    const patch = h.updates.find((u) => u.id === "r2")?.patch;
    expect(patch?.status).toBe("complete");
    // Counted from what actually landed, not from wall-clock time since Record
    // was pressed: a tab that died at minute four did not record six hours.
    expect(patch?.size_bytes).toBe(2000);
    expect(patch?.chunk_count).toBe(2);
    expect(patch?.ended_at).toBe(NOW.toISOString());
  });

  // The defect this closes: the sweep recomputed the size and the part count
  // from the rows and then set no duration at all, so a recording it closed was
  // listed with a size and no length — the panel renders a duration only when
  // there is one.
  it("gives the closed-out recording the length its parts describe", async () => {
    const h = harness({
      stale: [{ id: "r4", started_at: stale }],
      chunks: [
        { idx: 0, size: 900, offset_ms: 0, duration_ms: 5_000 },
        { idx: 1, size: 1100, offset_ms: 5_000, duration_ms: 4_000 },
      ],
    });
    await runRecordingSweep(client(h), NOW);

    expect(h.updates.find((u) => u.id === "r4")?.patch.duration_seconds).toBe(9);
  });

  // Recordings made before parts carried timing still have to come out with a
  // usable length rather than a zero.
  it("falls back to the nominal part length when timing was never captured", async () => {
    const h = harness({
      stale: [{ id: "r5", started_at: stale }],
      chunks: [{ idx: 0, size: 900 }, { idx: 1, size: 1100 }],
    });
    await runRecordingSweep(client(h), NOW);

    const seconds = h.updates.find((u) => u.id === "r5")?.patch.duration_seconds as number;
    expect(seconds).toBe(Math.round((2 * CHUNK_MS) / 1000));
  });

  it("calls a recording with no parts abandoned", async () => {
    const h = harness({ stale: [{ id: "r3", started_at: stale }] });
    await runRecordingSweep(client(h), NOW);
    expect(h.updates.find((u) => u.id === "r3")?.patch.status).toBe("abandoned");
  });

  it("never touches a recording that could still be running", async () => {
    // Bounded well past any real meeting, because closing one out while it is
    // still being made would discard the rest of it.
    expect(ABANDON_AFTER_MS).toBeGreaterThanOrEqual(6 * 60 * 60 * 1000);
  });
});

describe("a quiet hour", () => {
  it("does nothing and says so", async () => {
    const h = harness();
    const stats = await runRecordingSweep(client(h), NOW);
    expect(stats).toEqual({ expired: 0, abandoned: 0, orphaned: 0, objectsDeleted: 0, errors: 0 });
    expect(h.removed).toEqual([]);
  });
});

// ── A recording longer than a thousand parts ────────────────────────────────
//
// `list` answers with at most a page. A part lands every CHUNK_MS — five
// seconds — so a thousand parts is eighty-three minutes, and every recording
// longer than that used to leave its remainder in the bucket while the row was
// marked deleted, its size zeroed and its chunk rows dropped. After that
// nothing in the database pointed at those objects at all.

const PAGE = 1000;
const parts = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => `part-${String(from + i).padStart(6, "0")}.webm`);

describe("a recording bigger than one listing", () => {
  it("deletes every part of a two-hour meeting, not the first thousand", () => {
    // 1440 parts is two hours at CHUNK_MS.
    const total = 1440;
    const h = harness({
      expired: [{ id: "r1", meeting_id: "m1" }],
      objects: { "m1/r1": parts(total) },
    });
    return runRecordingSweep(client(h), NOW).then((stats) => {
      expect(stats.objectsDeleted).toBe(total);
      expect(h.objects["m1/r1"]).toEqual([]);
      expect(stats.errors).toBe(0);
    });
  });

  it("pages rather than asking for everything at once", () => {
    const h = harness({
      expired: [{ id: "r1", meeting_id: "m1" }],
      objects: { "m1/r1": parts(PAGE + 7) },
    });
    return runRecordingSweep(client(h), NOW).then(() => {
      expect(h.removed.map((p) => p.length)).toEqual([PAGE, 7]);
    });
  });

  // The boundary the old code was wrong about in the other direction: exactly
  // a full page looks identical to a page that has more behind it.
  it("checks again after a page that was exactly full", () => {
    const h = harness({
      expired: [{ id: "r1", meeting_id: "m1" }],
      objects: { "m1/r1": parts(PAGE) },
    });
    return runRecordingSweep(client(h), NOW).then((stats) => {
      expect(stats.objectsDeleted).toBe(PAGE);
      expect(stats.expired).toBe(1);
    });
  });

  // Half-deleting is the one outcome worse than not deleting: the row would be
  // marked gone and the index dropped while objects nothing can find remain.
  it("does not mark the row deleted when the objects could not all go", () => {
    const h = harness({
      expired: [{ id: "r1", meeting_id: "m1" }],
      objects: { "m1/r1": parts(10) },
    });
    h.removeFails = true;
    return runRecordingSweep(client(h), NOW).then((stats) => {
      expect(stats.expired).toBe(0);
      expect(stats.errors).toBe(1);
      expect(h.updates.find((u) => u.table === "live_meeting_recordings")).toBeUndefined();
      expect(h.deletes).toEqual([]);
    });
  });
});

// ── The recording that outlived its meeting ─────────────────────────────────
//
// live_meeting_recordings.meeting_id is ON DELETE CASCADE and the chunk rows
// cascade from it, so deleting a meeting removed every row that knew a
// recording existed — and none of the bytes. Nothing was left pointing at
// them, and nobody could read them either: the Storage policy resolves
// attended_live_meeting() through live_meetings, whose row is gone. Deleted,
// told it was done, and kept.

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";

describe("orphaned recordings", () => {
  it("deletes the objects of a meeting that no longer exists", () => {
    const h = harness({
      living: [],
      objects: { "": [M1], [M1]: ["r1"], [`${M1}/r1`]: parts(3) },
    });
    return runRecordingSweep(client(h), NOW).then((stats) => {
      expect(stats.orphaned).toBe(1);
      expect(stats.objectsDeleted).toBe(3);
      expect(h.objects[`${M1}/r1`]).toEqual([]);
    });
  });

  it("leaves a meeting that still exists completely alone", () => {
    const h = harness({
      living: [{ id: M1 }],
      objects: { "": [M1], [M1]: ["r1"], [`${M1}/r1`]: parts(3) },
    });
    return runRecordingSweep(client(h), NOW).then((stats) => {
      expect(stats.orphaned).toBe(0);
      expect(h.removed).toEqual([]);
    });
  });

  it("sorts the living from the dead in one pass", () => {
    const h = harness({
      living: [{ id: M1 }],
      objects: {
        "": [M1, M2],
        [M1]: ["r1"], [`${M1}/r1`]: parts(2),
        [M2]: ["r9"], [`${M2}/r9`]: parts(5),
      },
    });
    return runRecordingSweep(client(h), NOW).then((stats) => {
      expect(stats.orphaned).toBe(1);
      expect(h.objects[`${M1}/r1`]).toHaveLength(2);
      expect(h.objects[`${M2}/r9`]).toEqual([]);
    });
  });

  // Every recording under the meeting, not just the first: Storage has no
  // recursive delete, and a meeting recorded twice has two folders.
  it("takes every recording the meeting made", () => {
    const h = harness({
      living: [],
      objects: {
        "": [M1],
        [M1]: ["r1", "r2"],
        [`${M1}/r1`]: parts(2),
        [`${M1}/r2`]: parts(4),
      },
    });
    return runRecordingSweep(client(h), NOW).then((stats) => {
      expect(stats.objectsDeleted).toBe(6);
      expect(stats.orphaned).toBe(1);
    });
  });

  // A soft-deleted meeting is one the host can still restore, and its recording
  // is still readable through the report. Only a row that is gone outright
  // means nothing can ever reach these bytes again — so the read that decides
  // this deliberately does not filter on deleted_at.
  it("spares a meeting that was only soft-deleted", () => {
    const h = harness({
      living: [{ id: M1, deleted_at: "2026-09-14T00:00:00.000Z" }],
      objects: { "": [M1], [M1]: ["r1"], [`${M1}/r1`]: parts(3) },
    });
    return runRecordingSweep(client(h), NOW).then((stats) => {
      expect(stats.orphaned).toBe(0);
      expect(h.objects[`${M1}/r1`]).toHaveLength(3);
    });
  });

  // A stray object at the bucket root must never be fed to a delete loop on
  // the strength of not being a row in live_meetings.
  it("ignores anything at the root that is not a meeting id", () => {
    const h = harness({
      living: [],
      objects: { "": ["README.txt", ".emptyFolderPlaceholder"] },
    });
    return runRecordingSweep(client(h), NOW).then((stats) => {
      expect(stats.orphaned).toBe(0);
      expect(h.removed).toEqual([]);
    });
  });

  it("survives an empty bucket", () => {
    const h = harness({ living: [], objects: { "": [] } });
    return runRecordingSweep(client(h), NOW).then((stats) => {
      expect(stats.orphaned).toBe(0);
      expect(stats.errors).toBe(0);
    });
  });
});
