// The only thing in this product that deletes recordings, and the only thing
// that closes out a recording whose host stopped existing mid-call. Both are
// destructive and neither is ever observed by hand, so both are pinned here.

import { ABANDON_AFTER_MS, runRecordingSweep } from "@/lib/meetings/recording-sweep.server";

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
        list: async (prefix: string) => ({
          data: [
            { name: "part-000000.webm" },
            { name: "part-000001.webm" },
          ].map((o) => ({ ...o, prefix })),
          error: null,
        }),
        remove: async (paths: string[]) => {
          if (h.removeFails) return { error: { message: "remove failed" } };
          h.removed.push(paths);
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
} = {}): Harness {
  return {
    queues: {
      live_meeting_recordings: [opts.expired ?? [], opts.stale ?? []],
      live_meeting_recording_chunks: [opts.chunks ?? []],
    },
    updates: [],
    deletes: [],
    removed: [],
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
    expect(stats).toEqual({ expired: 0, abandoned: 0, objectsDeleted: 0, errors: 0 });
    expect(h.removed).toEqual([]);
  });
});
