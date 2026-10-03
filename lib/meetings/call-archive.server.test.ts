/**
 * Reading the call archive: the cursor and range reach the query, the longest
 * recording's id reaches the row, and "more" is claimed only for a full page.
 */
import { loadCallPage, loadCallStats } from "./call-archive.server";
import { LIST_PAGE } from "./session-archive";

type Call = { method: string; args: unknown[] };

/** A builder that records what was asked of it and resolves to `rows`. */
function client(rows: unknown[], error: { message: string } | null = null) {
  const calls: Call[] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit", "lt", "gte"]) {
    q[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return q;
    };
  }
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error });
  return { supabase: { from: () => q } as never, calls };
}

const owner = { userId: "u1", orgId: "o1" };
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  room_code: `room-${id}`,
  title: null,
  created_at: "2026-09-07T14:47:00.000Z",
  recording_consent: null,
  live_meeting_recordings: [
    { id: `${id}-short`, duration_seconds: 8, deleted_at: null },
    { id: `${id}-long`, duration_seconds: 754, deleted_at: null },
  ],
  live_meeting_reports: [{ summary: " A summary. " }],
  ...over,
});

describe("loadCallPage", () => {
  it("maps rows with the longest recording's id and length", async () => {
    const { supabase } = client([row("a")]);
    const page = await loadCallPage(supabase, owner);
    expect(page.calls[0]).toMatchObject({
      id: "a",
      title: "Call",
      durationSeconds: 754,
      recordingId: "a-long",
      summary: "A summary.",
    });
  });

  it("sends the cursor and the range as bounds on created_at", async () => {
    const { supabase, calls } = client([]);
    await loadCallPage(supabase, owner, { before: "2026-09-07T14:47:00.000Z", since: "2026-09-01T00:00:00.000Z" });
    expect(calls).toContainEqual({ method: "lt", args: ["created_at", "2026-09-07T14:47:00.000Z"] });
    expect(calls).toContainEqual({ method: "gte", args: ["created_at", "2026-09-01T00:00:00.000Z"] });
  });

  it("ignores a cursor that is not a time, rather than passing it to the database", async () => {
    const { supabase, calls } = client([]);
    await loadCallPage(supabase, owner, { before: "drop table", since: "" });
    expect(calls.some((c) => c.method === "lt" || c.method === "gte")).toBe(false);
  });

  it("claims more only after a full page, and never for a search", async () => {
    const full = Array.from({ length: LIST_PAGE }, (_, i) => row(`r${i}`));
    expect((await loadCallPage(client(full).supabase, owner)).hasMore).toBe(true);
    expect((await loadCallPage(client(full.slice(1)).supabase, owner)).hasMore).toBe(false);
    expect((await loadCallPage(client(full).supabase, owner, { query: "valuation" })).hasMore).toBe(false);
  });

  it("throws on a database error", async () => {
    await expect(loadCallPage(client([], { message: "boom" }).supabase, owner)).rejects.toThrow("boom");
  });
});

describe("loadCallStats", () => {
  it("counts the window's calls and their longest recordings", async () => {
    const { supabase, calls } = client([row("a"), row("b", { live_meeting_recordings: [] })]);
    const now = new Date("2026-10-03T12:00:00.000Z");
    expect(await loadCallStats(supabase, owner, now)).toEqual({ count: 2, seconds: 754, days: 30 });
    expect(calls).toContainEqual({ method: "gte", args: ["created_at", "2026-09-03T12:00:00.000Z"] });
    expect(calls).toContainEqual({ method: "eq", args: ["host_id", "u1"] });
  });

  it("says nothing on an error", async () => {
    expect(await loadCallStats(client([], { message: "x" }).supabase, owner)).toBeNull();
  });
});
