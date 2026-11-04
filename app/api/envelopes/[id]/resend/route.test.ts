jest.mock("server-only", () => ({}), { virtual: true });

let ctx: { orgId: string | null } | null;
let envelope: { id: string; title: string; status: string; organization_id: string; lp_session_id: string | null } | null;
const events: unknown[] = [];
const invite = jest.fn();
let allowed = true;

jest.mock("@/lib/auth", () => ({ getSessionContext: async () => ctx }));
jest.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ ok: allowed }) }));
jest.mock("@/lib/envelope-invite.server", () => ({ inviteSigners: (...a: unknown[]) => invite(...a) }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (t: string) =>
      t === "envelopes"
        ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: envelope }) }) }) }
        : { insert: async (row: unknown) => (events.push(row), { error: null }) },
  }),
}));

import { POST } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (id = ID) => POST(new Request("http://x/resend", { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  ctx = { orgId: "o1" };
  envelope = { id: ID, title: "NDA", status: "sent", organization_id: "o1", lp_session_id: null };
  events.length = 0;
  allowed = true;
  invite.mockReset();
  invite.mockResolvedValue({ ok: true, signingUrls: [{ recipientId: "r1", name: "Jane", email: "jane@lp.com", url: "u" }] });
});

describe("POST /api/envelopes/[id]/resend", () => {
  it("sends the reminder to whoever has not signed, and records it", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sentTo: ["jane@lp.com"] });
    expect(invite).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ envelopeId: ID, onlyWaiting: true, orgId: "o1" }));
    expect(events).toEqual([{ envelope_id: ID, event_type: "sent", metadata: { resend: true, to: ["jane@lp.com"] } }]);
  });

  it("is closed to the signed-out, another organization's envelope, and a bad id", async () => {
    ctx = null;
    expect((await call()).status).toBe(401);
    ctx = { orgId: "o1" };
    envelope = { ...envelope!, organization_id: "other" };
    expect((await call()).status).toBe(404);
    expect((await call("nope")).status).toBe(404);
    expect(invite).not.toHaveBeenCalled();
  });

  it("only reminds a document that is out for signature", async () => {
    for (const status of ["draft", "completed", "voided"]) {
      envelope = { ...envelope!, status };
      expect((await call()).status).toBe(409);
    }
    envelope = { ...envelope!, status: "partially_signed" };
    expect((await call()).status).toBe(200);
  });

  it("slows a flood of reminders, and says so when everyone has signed", async () => {
    allowed = false;
    expect((await call()).status).toBe(429);
    expect(invite).not.toHaveBeenCalled();
    allowed = true;
    invite.mockResolvedValue({ ok: true, signingUrls: [] });
    const res = await call();
    expect(res.status).toBe(409);
    expect(events).toHaveLength(0);
  });
});
