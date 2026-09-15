// The endpoint that exists because the client could not write its own words.
//
// `live_meeting_transcripts` is behind an RLS policy keyed on `auth.uid()`, and
// an invite-link guest has no session at all — so every line a guest ever spoke
// was rejected by a policy that cannot fail loudly. These tests are about who
// gets in, and about the one field a caller is not allowed to choose.

let currentUser: { id: string } | null = null;
let tables: Record<string, unknown[]> = {};
let upserted: { rows: unknown[]; options: unknown } | null = null;
let upsertError: unknown = null;

function builder(table: string) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const m of ["select", "eq", "is", "neq", "order", "limit"]) chain[m] = self;
  chain.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null });
  chain.upsert = async (rows: unknown[], options: unknown) => {
    upserted = { rows, options };
    return { error: upsertError };
  };
  return chain;
}

const db = { from: (table: string) => builder(table) };

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
    from: (t: string) => builder(t),
  }),
  createServiceClient: () => db,
  hasSupabaseServiceEnv: () => true,
}));

let allowed = true;
jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ ok: allowed, remaining: 1, resetAt: Date.now() + 60_000 }),
  clientIp: () => "203.0.113.9",
  rateLimitHeaders: () => ({}),
}));

import { NextRequest } from "next/server";
import { POST } from "./route";

const MEETING = "11111111-1111-1111-1111-111111111111";

function request(body: unknown, query = "") {
  return new NextRequest(`https://fundexecs.test/api/meetings/${MEETING}/transcript${query}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = Promise.resolve({ id: MEETING });

function line(over: Record<string, unknown> = {}) {
  return {
    id: "utterance-1",
    speaker: "Alina",
    speaker_id: "sig-1",
    speaker_user_id: null,
    confidence: 1,
    text: "we should hold the close",
    ts: "2026-09-15T10:00:00.000Z",
    overlapped: false,
    ...over,
  };
}

beforeEach(() => {
  currentUser = null;
  tables = {};
  upserted = null;
  upsertError = null;
  allowed = true;
  jest.spyOn(console, "error").mockImplementation(() => {});
});

describe("who may write", () => {
  it("refuses a caller with no session and no guest key", async () => {
    const res = await POST(request({ lines: [line()] }), { params });
    expect(res.status).toBe(401);
    expect(upserted).toBeNull();
  });

  it("refuses a guest key that was never admitted", async () => {
    tables.live_meeting_admissions = [];
    const res = await POST(request({ lines: [line()] }, "?guestKey=nope"), { params });
    expect(res.status).toBe(401);
  });

  // The population whose words were being silently dropped.
  it("accepts a guest the host admitted", async () => {
    tables.live_meeting_admissions = [{ id: "a1" }];
    const res = await POST(request({ lines: [line()] }, "?guestKey=good"), { params });
    expect(res.status).toBe(200);
    expect(upserted?.rows).toHaveLength(1);
  });

  it("accepts the host", async () => {
    currentUser = { id: "host" };
    tables.live_meetings = [{ id: MEETING, host_id: "host", organization_id: null }];
    const res = await POST(request({ lines: [line()] }), { params });
    expect(res.status).toBe(200);
  });

  it("refuses a signed-in stranger with no claim on the meeting", async () => {
    currentUser = { id: "stranger" };
    tables.live_meetings = [{ id: MEETING, host_id: "host", organization_id: null }];
    tables.live_meeting_participants = [];
    const res = await POST(request({ lines: [line()] }), { params });
    expect(res.status).toBe(401);
  });
});

describe("what it accepts", () => {
  beforeEach(() => {
    currentUser = { id: "host" };
    tables.live_meetings = [{ id: MEETING, host_id: "host", organization_id: null }];
  });

  // The one field with real authority: the log and the institutional record use
  // it to tell two people with the same display name apart.
  it("stamps the speaker's account from the session, not the body", async () => {
    await POST(request({ lines: [line({ speaker_user_id: "somebody-else" })] }), { params });
    expect((upserted?.rows as Record<string, unknown>[])[0].speaker_user_id).toBe("host");
  });

  it("gives a guest's line no account at all", async () => {
    currentUser = null;
    tables.live_meeting_admissions = [{ id: "a1" }];
    await POST(request({ lines: [line({ speaker_user_id: "host" })] }, "?guestKey=good"), { params });
    expect((upserted?.rows as Record<string, unknown>[])[0].speaker_user_id).toBeNull();
  });

  // Upserting on the client's own line id is what makes a retry safe.
  it("upserts on id, ignoring what is already stored", async () => {
    await POST(request({ lines: [line()] }), { params });
    expect(upserted?.options).toEqual({ onConflict: "id", ignoreDuplicates: true });
    expect((upserted?.rows as Record<string, unknown>[])[0].id).toBe("utterance-1");
  });

  it("skips lines with no text, no id, or an unreadable timestamp", async () => {
    await POST(request({
      lines: [line({ text: "   " }), line({ id: "" }), line({ ts: "whenever" }), line({ id: "keep" })],
    }), { params });
    expect(upserted?.rows).toHaveLength(1);
    expect((upserted?.rows as Record<string, unknown>[])[0].id).toBe("keep");
  });

  it("clamps confidence into range", async () => {
    await POST(request({ lines: [line({ confidence: 99 })] }), { params });
    expect((upserted?.rows as Record<string, unknown>[])[0].confidence).toBe(1);
  });

  it("writes nothing, and says so, for an empty batch", async () => {
    const res = await POST(request({ lines: [] }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: 0 });
    expect(upserted).toBeNull();
  });

  it("survives a body that is not what it claims to be", async () => {
    const res = await POST(request({ lines: "not an array" }), { params });
    expect(res.status).toBe(200);
    expect(upserted).toBeNull();
  });

  // A 200 here would cost the words: the client retires a line only on success.
  it("reports a failed write as a failure so the client retries", async () => {
    upsertError = { message: "connection reset" };
    const res = await POST(request({ lines: [line()] }), { params });
    expect(res.status).toBe(500);
  });

  it("refuses when rate limited", async () => {
    allowed = false;
    const res = await POST(request({ lines: [line()] }), { params });
    expect(res.status).toBe(429);
  });
});
