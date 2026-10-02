jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
let ctx: { orgId: string; role: string } | null = { orgId: "org-1", role: "admin" };
jest.mock("@/lib/auth", () => ({ getSessionContext: async () => ctx }));
let room: { id: string; name: string } | null = { id: "room-1", name: "Fund II" };
const upserts: unknown[] = [];
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: table === "data_rooms" ? room : null }),
        upsert: async (rows: unknown) => {
          upserts.push(rows);
          return { error: null };
        },
      };
      return q;
    },
  }),
}));
const investors = [
  { key: "email:a@x.com", lastSeen: "2026-10-02T09:00:00Z" },
  { key: "visitor:b1", lastSeen: "2026-10-01T09:00:00Z" },
];
jest.mock("@/lib/data-room-engagement.server", () => ({
  loadRoomEngagement: async () => ({ engagement: { investors }, reads: new Map() }),
  readEngagement: async () => [
    { key: "email:a@x.com", signal: "hot", summary: "s", follow_up: "f", source: "earn" },
    { key: "visitor:b1", signal: "cold", summary: "s2", follow_up: "f2", source: "rules" },
  ],
}));

import { refreshEngagementReads } from "./engagement-actions";

beforeEach(() => {
  ctx = { orgId: "org-1", role: "admin" };
  room = { id: "room-1", name: "Fund II" };
  upserts.length = 0;
});

it("stores Earn's read for each investor, stamped with the activity it covered", async () => {
  expect(await refreshEngagementReads("room-1")).toEqual({ ok: true, count: 2 });
  expect(upserts[0]).toEqual([
    expect.objectContaining({ room_id: "room-1", viewer_key: "email:a@x.com", organization_id: "org-1", signal: "hot", source: "earn", activity_through: "2026-10-02T09:00:00Z" }),
    expect.objectContaining({ viewer_key: "visitor:b1", signal: "cold", activity_through: "2026-10-01T09:00:00Z" }),
  ]);
});

it("refuses a view-only member", async () => {
  ctx = { orgId: "org-1", role: "viewer" };
  expect((await refreshEngagementReads("room-1")).ok).toBe(false);
  expect(upserts).toEqual([]);
});

it("refuses a room outside the workspace", async () => {
  room = null;
  expect(await refreshEngagementReads("room-x")).toEqual({ ok: false, error: "That room is not in this workspace." });
});
