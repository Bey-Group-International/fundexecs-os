// Who is in a room, for the pre-join screen: a head-count for anyone with the
// link, names only for a signed-in member of the meeting's organisation.
let tables: Record<string, unknown[]> = {};
let user: { id: string } | null = null;

function client() {
  return {
    from: (name: string) => {
      let rows = [...(tables[name] ?? [])] as Array<Record<string, unknown>>;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return b;
      };
      b.is = (col: string, val: unknown) => {
        rows = rows.filter((r) => (r[col] ?? null) === val);
        return b;
      };
      b.limit = () => b;
      b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
      return b;
    },
    auth: { getUser: async () => ({ data: { user } }) },
  };
}

jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => client(),
  createServerClient: async () => client(),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const get = (code = "abc-defg-hij") =>
  GET(new NextRequest(`http://localhost/api/meetings/public/${code}/presence`, { headers: { "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}` } }), {
    params: Promise.resolve({ roomCode: code }),
  });

const recent = new Date(Date.now() - 5 * 60_000).toISOString();

beforeEach(() => {
  user = null;
  tables = {
    live_meetings: [{ id: "m1", room_code: "abc-defg-hij", host_id: "host", organization_id: "org", status: "active", deleted_at: null }],
    live_meeting_participants: [
      { meeting_id: "m1", display_name: "Ana", joined_at: recent, left_at: null, user_id: "host", guest_key: null },
      { meeting_id: "m1", display_name: "Bo", joined_at: recent, left_at: null, user_id: null, guest_key: "g1" },
    ],
    organization_members: [{ organization_id: "org", principal_id: "member" }],
  };
});

it("tells anyone with the link how many are in and whether the host is, without names", async () => {
  const body = await (await get()).json();
  expect(body).toMatchObject({ count: 2, hostPresent: true, names: [], ended: false });
  expect(typeof body.startedAt).toBe("string");
});

it("adds names for a member of the meeting's organisation", async () => {
  user = { id: "member" };
  expect((await (await get()).json()).names).toEqual(["Ana", "Bo"]);
});

it("keeps names from a signed-in outsider", async () => {
  user = { id: "stranger" };
  expect((await (await get()).json()).names).toEqual([]);
});

it("404s an unknown room", async () => {
  expect((await get("nope-nope")).status).toBe(404);
});
