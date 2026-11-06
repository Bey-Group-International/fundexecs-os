/**
 * Pinning a chat message: the host only, and only one of this meeting's messages.
 */
const member = jest.fn();
const updates: Array<Record<string, unknown>> = [];
let messageFound = true;

jest.mock("@/lib/meetings/meeting-access.server", () => ({
  authorizeMeetingMember: () => member(),
}));
jest.mock("@/lib/supabase/server", () => {
  const client = () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: table === "live_meeting_chat" && messageFound ? { id: "c1" } : null });
      b.update = (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: async () => ({ error: null }) };
      };
      return b;
    },
  });
  return { hasSupabaseServiceEnv: () => true, createServiceClient: client, createServerClient: async () => client() };
});

import { NextRequest } from "next/server";
import { POST } from "./route";

const params = { params: Promise.resolve({ id: "m1" }) };
const req = (body: unknown) =>
  new NextRequest("http://localhost/api/meetings/m1/chat/pin", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  updates.length = 0;
  messageFound = true;
  member.mockResolvedValue({ ok: true, userId: "host", orgId: "o1", isHost: true });
});

it("pins one of the meeting's messages for the host", async () => {
  const res = await POST(req({ messageId: "c1" }), params);
  expect(res.status).toBe(200);
  expect(updates).toEqual([{ pinned_chat_message_id: "c1" }]);
});

it("clears the pin with null", async () => {
  await POST(req({ messageId: null }), params);
  expect(updates).toEqual([{ pinned_chat_message_id: null }]);
});

it("refuses anybody but the host", async () => {
  member.mockResolvedValue({ ok: true, userId: "u2", orgId: "o1", isHost: false });
  expect((await POST(req({ messageId: "c1" }), params)).status).toBe(403);
  expect(updates).toEqual([]);
});

it("refuses a message that is not this meeting's", async () => {
  messageFound = false;
  expect((await POST(req({ messageId: "elsewhere" }), params)).status).toBe(404);
  expect(updates).toEqual([]);
});

it("refuses a body that says nothing", async () => {
  expect((await POST(req({}), params)).status).toBe(422);
});
