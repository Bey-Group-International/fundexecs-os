// The scheduling page's handle is UNIQUE across the whole table, but its RLS
// policy is `user_id = auth.uid()`. A request-scoped client therefore cannot
// see anyone else's page and reports every handle as free — so the "already
// taken" check has to run service-role, and the unique index has to be handled
// when the race is lost anyway. These cover both halves.

const authMock = jest.fn();
const serverFrom = jest.fn();
const serviceFrom = jest.fn();
const hasServiceEnv = jest.fn(() => true);

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ from: (...a: unknown[]) => serverFrom(...a) }),
  createServiceClient: () => ({ from: (...a: unknown[]) => serviceFrom(...a) }),
  hasSupabaseServiceEnv: () => hasServiceEnv(),
}));

import { NextRequest } from "next/server";
import { PATCH } from "./route";

type Row = Record<string, unknown>;

const PAGE: Row = {
  id: "page-1",
  user_id: "host-1",
  organization_id: "org-1",
  slug: "ada",
  display_name: "Ada",
  headline: null,
  bio: null,
  timezone: "UTC",
  availability: [],
  buffer_minutes: 0,
  min_notice_minutes: 240,
  booking_window_days: 30,
  is_active: true,
};

/** Chainable stub; `rows` is what the table returns, `updateError` fails writes. */
function builderFor(rows: Row[], updateError?: { code: string; message: string }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    is: () => builder,
    gte: () => builder,
    lt: () => builder,
    order: () => builder,
    limit: () => builder,
    insert: () => builder,
    update: () => (updateError ? failing(updateError) : builder),
    delete: () => builder,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
  };
  return builder;
}

function failing(error: { code: string; message: string }) {
  const f: Record<string, unknown> = {
    select: () => f,
    eq: () => f,
    single: async () => ({ data: null, error }),
    maybeSingle: async () => ({ data: null, error }),
  };
  return f;
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/meetings/scheduling", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  hasServiceEnv.mockReturnValue(true);
  authMock.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org-1", userId: "host-1", email: "ada@fund.test", role: "owner" },
  });
});

describe("PATCH /api/meetings/scheduling", () => {
  it("rejects a handle another member already holds, which only the service role can see", async () => {
    // The caller's own client sees only their page (RLS) …
    serverFrom.mockImplementation((table: string) =>
      builderFor(table === "scheduling_pages" ? [PAGE] : []),
    );
    // … while the service-role probe sees the other member's page.
    serviceFrom.mockImplementation(() => builderFor([{ id: "page-other" }]));

    const res = await PATCH(request({ slug: "grace" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already taken/i);
    expect(serviceFrom).toHaveBeenCalledWith("scheduling_pages");
  });

  it("accepts a genuinely free handle", async () => {
    serverFrom.mockImplementation((table: string) =>
      builderFor(table === "scheduling_pages" ? [{ ...PAGE, slug: "grace" }] : []),
    );
    serviceFrom.mockImplementation(() => builderFor([]));

    const res = await PATCH(request({ slug: "grace" }));

    expect(res.status).toBe(200);
    expect((await res.json()).page.slug).toBe("grace");
  });

  it("reports a lost race on the unique index as taken, not as a 500 leaking the constraint", async () => {
    serverFrom.mockImplementation((table: string) =>
      builderFor(
        table === "scheduling_pages" ? [PAGE] : [],
        table === "scheduling_pages"
          ? { code: "23505", message: 'duplicate key value violates unique constraint "scheduling_pages_slug_key"' }
          : undefined,
      ),
    );
    // Probe says free — the row appeared between the check and the write.
    serviceFrom.mockImplementation(() => builderFor([]));

    const res = await PATCH(request({ slug: "grace" }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already taken/i);
    expect(JSON.stringify(body)).not.toMatch(/constraint|duplicate key/i);
  });

  it("rejects a reserved handle before touching the database", async () => {
    serverFrom.mockImplementation(() => builderFor([PAGE]));
    const res = await PATCH(request({ slug: "booking" }));
    expect(res.status).toBe(422);
    expect(serviceFrom).not.toHaveBeenCalled();
  });

  it("rejects availability with an end time before its start", async () => {
    serverFrom.mockImplementation(() => builderFor([PAGE]));
    const res = await PATCH(request({ availability: [{ day: 1, start: "17:00", end: "09:00" }] }));
    expect(res.status).toBe(422);
  });
});
