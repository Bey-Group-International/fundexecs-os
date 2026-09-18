/**
 * A meeting's chat, stored and served.
 *
 * The properties that matter: a GUEST can take part (they have no session, so
 * no RLS policy can let them in — which is why this route exists), the author
 * is stamped from the session rather than the body, and a retried post says
 * the message once.
 */
const authorizeMeetingCaller = jest.fn();
const from = jest.fn();
const checkRateLimit = jest.fn();

jest.mock("@/lib/meetings/meeting-access.server", () => ({
  authorizeMeetingCaller: (...a: unknown[]) => authorizeMeetingCaller(...a),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from: (t: string) => from(t) }),
  createServiceClient: () => ({ from: (t: string) => from(t) }),
  hasSupabaseServiceEnv: () => true,
}));
jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
  clientIp: () => "1.2.3.4",
  rateLimitHeaders: () => ({}),
}));

import { GET, POST } from "./route";

const params = { params: Promise.resolve({ id: "m1" }) };

const post = (body: unknown) =>
  new Request("http://localhost/api/meetings/m1/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;

const get = () => new Request("http://localhost/api/meetings/m1/chat") as never;

/** What the route wrote, and what it read. */
const writes: Record<string, unknown>[] = [];

function wire({ rows = [] as unknown[], error = null as null | { message: string } } = {}) {
  from.mockImplementation(() => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: async () => ({ data: rows, error }),
      upsert: async (row: Record<string, unknown>) => {
        writes.push(row);
        return { error };
      },
    };
    return b;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  writes.length = 0;
  checkRateLimit.mockReturnValue({ ok: true, remaining: 10, resetAt: 0, retryAfter: 0 });
  authorizeMeetingCaller.mockResolvedValue({ ok: true, userId: "user-1" });
});

describe("permission", () => {
  it("refuses somebody who is not in this meeting", async () => {
    authorizeMeetingCaller.mockResolvedValue({ ok: false, userId: null });
    wire();
    expect((await POST(post({ id: "c1", text: "hi" }), params)).status).toBe(401);
    expect((await GET(get(), params)).status).toBe(401);
    expect(writes).toHaveLength(0);
  });

  // The whole reason this route exists: a guest has no session, so no RLS
  // policy could ever let them write.
  it("lets an admitted guest take part", async () => {
    authorizeMeetingCaller.mockResolvedValue({ ok: true, userId: null });
    wire();
    expect((await POST(post({ id: "c1", text: "hi", displayName: "Sam" }), params)).status).toBe(200);
    expect(writes[0]).toMatchObject({ author_id: null, author_name: "Sam" });
  });

  it("refuses a flood", async () => {
    checkRateLimit.mockReturnValue({ ok: false, remaining: 0, resetAt: 0, retryAfter: 30 });
    wire();
    expect((await POST(post({ id: "c1", text: "hi" }), params)).status).toBe(429);
    expect(writes).toHaveLength(0);
  });
});

describe("what it stores", () => {
  it("stamps the author from the session, not the body", async () => {
    wire();
    await POST(post({ id: "c1", text: "hi", displayName: "Ana", author_id: "somebody-else" }), params);
    expect(writes[0]).toMatchObject({ author_id: "user-1", author_name: "Ana" });
  });

  it("uses the server's clock, so one bad client cannot reorder the conversation", async () => {
    wire();
    await POST(post({ id: "c1", text: "hi", ts: 0 }), params);
    expect(typeof writes[0].ts).toBe("string");
    expect(isNaN(Date.parse(writes[0].ts as string))).toBe(false);
  });

  it("cleans and bounds what it is given", async () => {
    wire();
    await POST(post({ id: "c1", text: `  hello\u0000  ` }), params);
    expect(writes[0].body).toBe("hello");
  });

  it("refuses a message with nothing to say", async () => {
    wire();
    expect((await POST(post({ id: "c1", text: "   " }), params)).status).toBe(422);
    expect((await POST(post({ text: "hi" }), params)).status).toBe(422);
    expect(writes).toHaveLength(0);
  });

  it("names an unnamed sender rather than storing an empty label", async () => {
    wire();
    await POST(post({ id: "c1", text: "hi" }), params);
    expect(writes[0].author_name).toBe("Guest");
  });

  // A post that timed out is retried with the same id. That has to be safe.
  it("upserts on the sender's own id", async () => {
    wire();
    await POST(post({ id: "c1", text: "hi" }), params);
    expect(writes[0].id).toBe("c1");
  });

  it("reports a failed write so the sender can retry", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    wire({ error: { message: "denied" } });
    expect((await POST(post({ id: "c1", text: "hi" }), params)).status).toBe(500);
    spy.mockRestore();
  });
});

describe("the conversation so far", () => {
  it("hands back the history a latecomer missed", async () => {
    wire({
      rows: [
        { id: "c1", author_id: "u1", author_name: "Ana", body: "hello", ts: "2026-09-18T10:00:00.000Z" },
      ],
    });
    const body = await (await GET(get(), params)).json();
    expect(body.messages).toEqual([
      {
        id: "c1",
        from: "u1",
        displayName: "Ana",
        text: "hello",
        ts: Date.parse("2026-09-18T10:00:00.000Z"),
      },
    ]);
  });

  it("gives a guest's message a stable sender, since they have no account", async () => {
    wire({ rows: [{ id: "c9", author_id: null, author_name: "Sam", body: "hi", ts: "2026-09-18T10:00:00.000Z" }] });
    const body = await (await GET(get(), params)).json();
    expect(body.messages[0].from).toBe("c9");
  });

  // Losing the history costs a latecomer the conversation so far, not their
  // ability to take part in the rest of it.
  it("answers with an empty chat rather than an error when history cannot be read", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    wire({ rows: [], error: { message: "down" } });
    const res = await GET(get(), params);
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
