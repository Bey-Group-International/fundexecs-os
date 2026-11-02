jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
let ctx: { orgId: string; userId: string } | null = { orgId: "org-1", userId: "u1" };
jest.mock("@/lib/auth", () => ({ getSessionContext: async () => ctx }));

const updates: { patch: Record<string, unknown>; where: [string, unknown][] }[] = [];
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: () => {
      let patch: Record<string, unknown> = {};
      const where: [string, unknown][] = [];
      const q: Record<string, unknown> = {
        update: (p: Record<string, unknown>) => ((patch = p), q),
        eq: (c: string, v: unknown) => (where.push([c, v]), q),
        then: (res: (v: unknown) => unknown) => (updates.push({ patch, where }), res({ error: null })),
      };
      return q;
    },
  }),
}));

import { renameRoom } from "./room-actions";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  updates.length = 0;
  ctx = { orgId: "org-1", userId: "u1" };
});

describe("the welcome note on a room", () => {
  it("saves a trimmed note, for this room in this organisation only", async () => {
    await renameRoom(form({ room_id: "r1", name: "Fund III", welcome_note: "  Start with the memo.  " }));
    expect(updates[0].patch).toEqual({ name: "Fund III", welcome_note: "Start with the memo." });
    expect(updates[0].where).toEqual(
      expect.arrayContaining([["id", "r1"], ["organization_id", "org-1"]]),
    );
  });

  it("clears the note when the field is emptied", async () => {
    await renameRoom(form({ room_id: "r1", name: "Fund III", welcome_note: "   " }));
    expect(updates[0].patch).toHaveProperty("welcome_note", null);
  });

  it("leaves the note alone when the form did not carry the field", async () => {
    await renameRoom(form({ room_id: "r1", name: "Fund III" }));
    expect(updates[0].patch).toEqual({ name: "Fund III" });
  });

  it("keeps a note within the limit the database allows", async () => {
    await renameRoom(form({ room_id: "r1", name: "Fund III", welcome_note: "x".repeat(5000) }));
    expect((updates[0].patch.welcome_note as string).length).toBe(1200);
  });

  it("does nothing without a signed-in organisation", async () => {
    ctx = null;
    await renameRoom(form({ room_id: "r1", name: "Fund III", welcome_note: "hi" }));
    expect(updates).toHaveLength(0);
  });
});
