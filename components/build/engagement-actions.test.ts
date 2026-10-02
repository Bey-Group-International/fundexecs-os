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
const refreshRoomReads = jest.fn(async () => ({ ok: true, count: 2 }));
jest.mock("@/lib/data-room-engagement.server", () => ({
  refreshRoomReads: (...a: unknown[]) => refreshRoomReads(...(a as [])),
}));

import { refreshEngagementReads } from "./engagement-actions";

beforeEach(() => {
  ctx = { orgId: "org-1", role: "admin" };
  room = { id: "room-1", name: "Fund II" };
  upserts.length = 0;
  refreshRoomReads.mockClear();
});

it("asks Earn to read the room, as the signed-in member", async () => {
  expect(await refreshEngagementReads("room-1")).toEqual({ ok: true, count: 2 });
  expect(refreshRoomReads).toHaveBeenCalledWith(expect.anything(), "org-1", { id: "room-1", name: "Fund II" });
});

it("reports a failed save", async () => {
  refreshRoomReads.mockResolvedValueOnce({ ok: false, count: 0 });
  expect(await refreshEngagementReads("room-1")).toEqual({ ok: false, error: "Couldn't save Earn's read. Try again." });
});

it("refuses a view-only member", async () => {
  ctx = { orgId: "org-1", role: "viewer" };
  expect((await refreshEngagementReads("room-1")).ok).toBe(false);
  expect(refreshRoomReads).not.toHaveBeenCalled();
});

it("refuses a room outside the workspace", async () => {
  room = null;
  expect(await refreshEngagementReads("room-x")).toEqual({ ok: false, error: "That room is not in this workspace." });
});
