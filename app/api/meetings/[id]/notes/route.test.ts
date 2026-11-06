/** Your own notes: saved per person, never anyone else's. */
const callerMock = jest.fn();
const upserts: unknown[] = [];
let upsertResult: { error: unknown } = { error: null };

jest.mock("@/lib/meetings/meeting-access.server", () => ({ authorizeMeetingCaller: (...a: unknown[]) => callerMock(...a) }));
jest.mock("@/lib/supabase/server", () => {
  const client = {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: { body: "mine", updated_at: "t" }, error: null });
      q.upsert = async (row: unknown) => {
        upserts.push(row);
        return upsertResult;
      };
      return q;
    },
  };
  return { hasSupabaseServiceEnv: () => true, createServiceClient: () => client, createServerClient: async () => client };
});

import { NextRequest } from "next/server";
import { GET, PUT } from "./route";

const params = Promise.resolve({ id: "m1" });
const put = (body: unknown) =>
  new NextRequest("http://localhost/api/meetings/m1/notes", { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  upserts.length = 0;
  upsertResult = { error: null };
  callerMock.mockResolvedValue({ ok: true, userId: "u1" });
});

it("reads and saves the caller's notes", async () => {
  expect(await (await GET(new NextRequest("http://localhost/x"), { params })).json()).toMatchObject({ body: "mine" });
  const res = await PUT(put({ body: "Follow up\r\nwith Ana" }), { params });
  expect(res.status).toBe(200);
  expect(upserts[0]).toMatchObject({ meeting_id: "m1", user_id: "u1", body: "Follow up\nwith Ana" });
});

it("refuses a guest and a non-text body", async () => {
  expect((await PUT(put({ body: 5 }), { params })).status).toBe(400);
  callerMock.mockResolvedValue({ ok: true, userId: null });
  expect((await PUT(put({ body: "x" }), { params })).status).toBe(401);
});

it("answers 503 before the table exists", async () => {
  upsertResult = { error: { code: "42P01" } };
  expect((await PUT(put({ body: "x" }), { params })).status).toBe(503);
});
