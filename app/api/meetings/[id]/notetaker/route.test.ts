/** Notetaker settings: everyone in the call reads them; only the host changes them. */
const callerMock = jest.fn();
const updates: unknown[] = [];
let meetingRow: { data: unknown; error: unknown } = { data: null, error: null };
let updateResult: { error: unknown } = { error: null };

jest.mock("@/lib/meetings/meeting-access.server", () => ({ authorizeMeetingCaller: (...a: unknown[]) => callerMock(...a) }));
jest.mock("@/lib/supabase/server", () => {
  const client = {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) q[m] = () => q;
      q.maybeSingle = async () => meetingRow;
      q.update = (row: unknown) => {
        updates.push(row);
        return { eq: async () => updateResult };
      };
      return q;
    },
  };
  return { hasSupabaseServiceEnv: () => true, createServiceClient: () => client, createServerClient: async () => client };
});

import { NextRequest } from "next/server";
import { GET, PATCH } from "./route";

const params = Promise.resolve({ id: "m1" });
const patch = (body: unknown) =>
  new NextRequest("http://localhost/api/meetings/m1/notetaker", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  updates.length = 0;
  updateResult = { error: null };
  callerMock.mockResolvedValue({ ok: true, userId: "host" });
  meetingRow = { data: { id: "m1", title: "Call", host_id: "host", organization_id: "o1", status: "live", started_at: null, notetaker: { paused: false }, live_notes: null }, error: null };
});

it("lets a guest read the settings", async () => {
  callerMock.mockResolvedValue({ ok: true, userId: null });
  const res = await GET(new NextRequest("http://localhost/x?guestKey=g"), { params });
  expect(await res.json()).toEqual({ settings: { paused: false, notesVisibility: "everyone", lang: null }, isHost: false });
});

it("reads defaults before the column exists", async () => {
  meetingRow = { data: null, error: { code: "42703" } };
  const res = await GET(new NextRequest("http://localhost/x"), { params });
  expect((await res.json()).settings.paused).toBe(false);
});

it("lets the host pause and pick a language", async () => {
  const res = await PATCH(patch({ paused: true, lang: "es-ES" }), { params });
  expect(res.status).toBe(200);
  expect(updates).toEqual([{ notetaker: { paused: true, notesVisibility: "everyone", lang: "es-ES" } }]);
});

it("refuses anyone else", async () => {
  callerMock.mockResolvedValue({ ok: true, userId: "someone" });
  expect((await PATCH(patch({ paused: true }), { params })).status).toBe(403);
  expect(updates).toEqual([]);
});

it("refuses a malformed change", async () => {
  expect((await PATCH(patch({ lang: "nope nope" }), { params })).status).toBe(400);
});

it("answers 503 before the column exists", async () => {
  meetingRow = { data: null, error: { code: "42703" } };
  expect((await PATCH(patch({ paused: true }), { params })).status).toBe(503);
});
