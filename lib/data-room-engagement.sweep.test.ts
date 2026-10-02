jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/anthropic-client", () => ({ anthropicClient: jest.fn(), LONG_RUN_TIMEOUT_MS: 1 }));

import { refreshActiveRoomReads, refreshRoomReads, MAX_ROOMS_PER_SWEEP } from "./data-room-engagement.server";

type Row = Record<string, unknown>;

/** Enough of the Supabase client for the sweep: filters, ordering, limits and upserts. */
function fakeDb(tables: Record<string, Row[]>, failing: string[] = []) {
  const upserts: Row[] = [];
  const builder = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let upsert: Row[] | null = null;
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), api),
      in: (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), api),
      gt: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) > v)), api),
      not: (c: string) => ((rows = rows.filter((r) => r[c] != null)), api),
      order: () => api,
      limit: () => api,
      upsert: (r: Row[]) => ((upsert = r), api),
      then: (resolve: (v: unknown) => unknown) => {
        if (upsert) {
          upserts.push(...upsert);
          return Promise.resolve({ error: null }).then(resolve);
        }
        if (failing.includes(table)) return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
        return Promise.resolve({ data: rows }).then(resolve);
      },
    };
    return api;
  };
  return { client: { from: builder } as never, upserts };
}

const now = new Date("2026-10-02T13:00:00Z");
const view = (o: Row): Row => ({
  organization_id: "org-1",
  room_id: "room-1",
  share_id: "l1",
  document_id: "ppm",
  kind: "document",
  action: "read",
  viewer_email: "lp@x.com",
  session_id: "b1",
  duration_seconds: 1200,
  created_at: "2026-10-02T09:00:00Z",
  ...o,
});
const base = {
  data_room_shares: [
    { id: "l1", label: "Fund II LPs", organization_id: "org-1", room_id: "room-1" },
    { id: "l2", label: "Co-invest", organization_id: "org-1", room_id: "room-2" },
  ],
  documents: [{ id: "ppm", name: "PPM", organization_id: "org-1" }],
  data_room_engagement_reads: [],
};

it("re-reads each open room with activity in the last day, and only those", async () => {
  const db = fakeDb({
    ...base,
    data_room_views: [view({}), view({ room_id: "room-2", share_id: "l2", created_at: "2026-09-20T09:00:00Z" })],
    data_rooms: [
      { id: "room-1", name: "Fund II", organization_id: "org-1", archived_at: null },
      { id: "room-2", name: "Co-invest", organization_id: "org-1", archived_at: null },
    ],
  });
  expect(await refreshActiveRoomReads(db.client, now)).toEqual({ rooms: 1, reads: 1 });
  expect(db.upserts).toEqual([
    expect.objectContaining({
      room_id: "room-1",
      viewer_key: "email:lp@x.com",
      organization_id: "org-1",
      signal: "hot",
      source: "rules",
      activity_through: "2026-10-02T09:00:00Z",
    }),
  ]);
});

it("skips archived rooms", async () => {
  const db = fakeDb({
    ...base,
    data_room_views: [view({})],
    data_rooms: [{ id: "room-1", name: "Fund II", organization_id: "org-1", archived_at: "2026-10-01T00:00:00Z" }],
  });
  expect(await refreshActiveRoomReads(db.client, now)).toEqual({ rooms: 0, reads: 0 });
});

it("starts no room once its time budget is spent", async () => {
  const db = fakeDb({
    ...base,
    data_room_views: [view({})],
    data_rooms: [{ id: "room-1", name: "Fund II", organization_id: "org-1", archived_at: null }],
  });
  expect(await refreshActiveRoomReads(db.client, now, 0)).toEqual({ rooms: 0, reads: 0 });
});

it("reads only the busiest rooms when more than the cap had activity", async () => {
  const many = Array.from({ length: MAX_ROOMS_PER_SWEEP + 2 }, (_, i) => `room-${i}`);
  const db = fakeDb({
    ...base,
    data_room_shares: many.map((id) => ({ id: `l-${id}`, label: id, organization_id: "org-1", room_id: id })),
    // room-0 is the busiest, room-N the quietest.
    data_room_views: many.flatMap((id, i) =>
      Array.from({ length: many.length - i }, () => view({ room_id: id, share_id: `l-${id}` })),
    ),
    data_rooms: many.map((id) => ({ id, name: id, organization_id: "org-1", archived_at: null })),
  });
  const res = await refreshActiveRoomReads(db.client, now);
  expect(res.rooms).toBe(MAX_ROOMS_PER_SWEEP);
  const read = new Set(db.upserts.map((u) => u.room_id));
  expect(read.has("room-0")).toBe(true);
  expect(read.has(`room-${many.length - 1}`)).toBe(false);
});

it("writes nothing for a room nobody has read", async () => {
  const db = fakeDb({ ...base, data_room_views: [] });
  expect(await refreshRoomReads(db.client, "org-1", { id: "room-1", name: "Fund II" }, now)).toEqual({ ok: true, count: 0 });
  expect(db.upserts).toEqual([]);
});

it("reports a failed activity read instead of passing it off as a quiet day", async () => {
  const db = fakeDb({ ...base, data_room_views: [view({})] }, ["data_room_views"]);
  await expect(refreshActiveRoomReads(db.client, now)).rejects.toThrow("recent data room views: boom");
});

it("reports a failed room lookup", async () => {
  const db = fakeDb({ ...base, data_room_views: [view({})], data_rooms: [] }, ["data_rooms"]);
  await expect(refreshActiveRoomReads(db.client, now)).rejects.toThrow("data rooms: boom");
});
