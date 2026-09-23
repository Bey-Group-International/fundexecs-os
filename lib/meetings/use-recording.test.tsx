// The recording lifecycle, around the seam where one recording ends and the
// next begins.
//
// Both defects these cover were the same mistake: state that outlived the
// recording it described. Neither is reachable without interleaving two
// recordings, which is why neither was noticed — so that interleaving is
// exactly what these tests do.

import { act, renderHook } from "@testing-library/react";

type Handlers = {
  onChunk: (blob: Blob, index: number, timing: { offsetMs: number; durationMs: number }) => void;
  onStopped: (reason: "stopped" | "error", error?: unknown) => void;
};

/** The live capture source, captured so a test can drive it. */
let composer: { handlers: Handlers; start: jest.Mock; stop: jest.Mock } | null = null;

/**
 * A stand-in for whatever is capturing.
 *
 * Built here rather than mocked out of the composer module, because the hook
 * no longer names a composer: it takes a source, and what these tests exercise
 * is everything that happens to the parts AFTER one hands them over.
 */
function fakeSource(handlers: Handlers) {
  const made = { handlers, start: jest.fn(), stop: jest.fn(), mimeType: "video/webm" };
  composer = made;
  return made;
}

import { useRecording } from "@/lib/meetings/use-recording";

interface Update { table: string; id: string; patch: Record<string, unknown> }

/** A Supabase stand-in that records what was written and can be made to fail. */
function fakeClient() {
  const updates: Update[] = [];
  let nextId = 0;
  let insertFails = false;
  /** Resolvers for uploads held open, so a test can decide when a part lands. */
  const held: Array<() => void> = [];
  let holdUploads = false;
  /** Uploads refused outright — a 4xx, which upload-retry gives up on. */
  let refuseUploads = false;

  const client = {
    from(table: string) {
      return {
        insert() {
          return {
            select() {
              return {
                single: async () =>
                  insertFails
                    ? { data: null, error: new Error("insert refused") }
                    : { data: { id: `r${++nextId}` }, error: null },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async (_col: string, id: string) => {
              updates.push({ table, id, patch });
              return { error: null };
            },
          };
        },
        upsert: async () => ({ error: null }),
      };
    },
    storage: {
      from() {
        return {
          upload: async () => {
            if (holdUploads) await new Promise<void>((resolve) => held.push(resolve));
            if (refuseUploads) return { error: Object.assign(new Error("refused"), { status: 403 }) };
            return { error: null };
          },
        };
      },
    },
  };

  return {
    client,
    updates,
    failNextInsert: () => { insertFails = true; },
    holdUploads: () => { holdUploads = true; },
    refuseUploads: () => { refuseUploads = true; },
    releaseUploads: () => { holdUploads = false; held.splice(0).forEach((r) => r()); },
  };
}

function setup(sb: ReturnType<typeof fakeClient>) {
  return renderHook(() =>
    useRecording({
      supabase: sb.client as unknown as Parameters<typeof useRecording>[0]["supabase"],
      meetingId: "m1",
      hostName: "Host",
      createSource: (handlers) => fakeSource(handlers as Handlers),
      announce: () => {},
    }),
  );
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  composer = null;
  // The failed-start test provokes a real error path on purpose; its console
  // line is the code working, not the test complaining.
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

describe("a start that fails after a recording has already been made", () => {
  // The defect: the recording id was a ref that outlived the recording, so a
  // start failing before it could create its own row called finalize("failed")
  // on the PREVIOUS, finished recording — rewriting a good file to a failure,
  // with an ended_at of now and a duration counted from hours earlier.
  it("leaves the finished recording alone", async () => {
    const sb = fakeClient();
    const { result } = setup(sb);

    await act(async () => { await result.current.start(); });
    act(() => { composer!.handlers.onStopped("stopped"); });
    await flush();

    expect(sb.updates.filter((u) => u.id === "r1" && u.patch.status === "complete")).toHaveLength(1);

    sb.failNextInsert();
    await act(async () => { await result.current.start(); });
    await flush();

    expect(sb.updates.filter((u) => u.patch.status === "failed")).toHaveLength(0);
    expect(sb.updates.filter((u) => u.id === "r1").at(-1)?.patch.status).toBe("complete");
  });
});

describe("recording again while the previous one is still closing", () => {
  // The defect: the counters were refs that `start` zeroed, and finalize read
  // them AFTER awaiting the upload queue — so a second recording begun during
  // that wait blanked the first one's byte and part counts.
  it("closes the first recording with its own counts, not the second's", async () => {
    const sb = fakeClient();
    const { result } = setup(sb);

    await act(async () => { await result.current.start(); });

    // One part that lands immediately, then one held open — so the counters
    // have real values before the second recording starts, which is the only
    // ordering that tells the two implementations apart.
    act(() => { composer!.handlers.onChunk(new Blob(["a".repeat(100)]), 0, { offsetMs: 0, durationMs: 5000 }); });
    await flush();

    sb.holdUploads();
    act(() => { composer!.handlers.onChunk(new Blob(["b".repeat(200)]), 1, { offsetMs: 5000, durationMs: 5000 }); });
    await flush();

    // Stop: finalize is now waiting on that held part.
    act(() => { composer!.handlers.onStopped("stopped"); });
    await flush();
    // Not closed yet — the only write so far is the mime type correction.
    expect(sb.updates.filter((u) => u.id === "r1" && u.patch.status)).toHaveLength(0);

    // The host records again while the first is still closing.
    sb.releaseUploads();
    await act(async () => { await result.current.start(); });
    await flush();

    const closed = sb.updates.find((u) => u.id === "r1" && u.patch.status === "complete");
    expect(closed?.patch.chunk_count).toBe(2);
    expect(closed?.patch.size_bytes).toBe(300);
  });
});

describe("how long the recording says it is", () => {
  // The defect: duration_seconds came from the wall clock since Record was
  // pressed, while the sweep and the player's scrubber both read it off the
  // parts. They agree only when nothing was lost — and this path counts what
  // was lost, so it always knew better.
  it("measures the parts, not the clock", async () => {
    const sb = fakeClient();
    const { result } = setup(sb);

    await act(async () => { await result.current.start(); });
    act(() => { composer!.handlers.onChunk(new Blob(["a"]), 0, { offsetMs: 0, durationMs: 5000 }); });
    await flush();
    act(() => { composer!.handlers.onChunk(new Blob(["b"]), 1, { offsetMs: 5000, durationMs: 5000 }); });
    await flush();

    act(() => { composer!.handlers.onStopped("stopped"); });
    await flush();

    // Ten seconds of parts. The wall clock in a test is zero, which is exactly
    // what the previous implementation would have written.
    const closed = sb.updates.find((u) => u.id === "r1" && u.patch.status === "complete");
    expect(closed?.patch.duration_seconds).toBe(10);
  });

  // The case the two measurements actually differ on in production: a part
  // that could not be stored after every retry is five seconds of meeting that
  // is not in the file, and the clock counts it anyway.
  it("does not count a part that never made it", async () => {
    const sb = fakeClient();
    const { result } = setup(sb);

    await act(async () => { await result.current.start(); });
    act(() => { composer!.handlers.onChunk(new Blob(["a"]), 0, { offsetMs: 0, durationMs: 5000 }); });
    await flush();

    sb.refuseUploads();
    act(() => { composer!.handlers.onChunk(new Blob(["b"]), 1, { offsetMs: 5000, durationMs: 5000 }); });
    await flush();

    act(() => { composer!.handlers.onStopped("stopped"); });
    await flush();

    const closed = sb.updates.find((u) => u.id === "r1" && u.patch.status === "complete");
    expect(closed?.patch.duration_seconds).toBe(5);
    expect(closed?.patch.chunk_count).toBe(1);
  });

  it("is zero for a recording that stored nothing", async () => {
    const sb = fakeClient();
    const { result } = setup(sb);

    await act(async () => { await result.current.start(); });
    act(() => { composer!.handlers.onStopped("stopped"); });
    await flush();

    const closed = sb.updates.find((u) => u.id === "r1" && u.patch.status === "complete");
    expect(closed?.patch.duration_seconds).toBe(0);
  });
});

describe("a recording that errors", () => {
  // MediaRecorder fires onstop AFTER onerror. A source that hands up "error"
  // without marking itself stopped therefore hands up "stopped" a moment
  // later, and the hook finalizes the same recording twice — failed, then
  // complete. The second one is the one that sticks, so a recording that broke
  // is filed as good and the error banner is replaced by a clean idle state.
  it("is finalized once, as failed, even if a stop follows the error", async () => {
    const sb = fakeClient();
    const view = setup(sb);
    await act(async () => { await view.result.current.start(); });

    act(() => { composer!.handlers.onStopped("error", new Error("encoder died")); });
    // Exactly what a real MediaRecorder does next.
    act(() => { composer!.handlers.onStopped("stopped"); });
    await flush();
    await flush();

    const closes = sb.updates.filter((u) => u.table === "live_meeting_recordings" && "status" in u.patch);
    expect(closes).toHaveLength(1);
    expect(closes[0].patch.status).toBe("failed");
    expect(view.result.current.state).toBe("failed");
    expect(view.result.current.error).toBeTruthy();
  });
});
