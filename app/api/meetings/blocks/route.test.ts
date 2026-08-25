const authMock = jest.fn();
const from = jest.fn();

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: () => ({ from }) }));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";

/** Chainable stub: `single`/`limit` terminate, everything else returns itself. */
function builder(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const k of ["select", "eq", "gt", "gte", "lt", "order", "insert"]) b[k] = () => b;
  b.limit = async () => result;
  b.single = async () => result;
  return b;
}

function post(body: unknown) {
  return new NextRequest("http://localhost/api/meetings/blocks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "u1", role: "owner", email: "u@test" } });
});

describe("GET /api/meetings/blocks", () => {
  it("returns the member's blocks in serialized form", async () => {
    from.mockReturnValue(
      builder({
        data: [
          {
            id: "b1",
            user_id: "u1",
            organization_id: "org1",
            title: "Flight",
            starts_at: "2026-09-01T14:00:00.000Z",
            ends_at: "2026-09-01T18:00:00.000Z",
          },
        ],
      }),
    );
    const res = await GET(new NextRequest("http://localhost/api/meetings/blocks"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.blocks).toEqual([
      { id: "b1", title: "Flight", startsAt: "2026-09-01T14:00:00.000Z", endsAt: "2026-09-01T18:00:00.000Z" },
    ]);
    // The owning user and org are internal — a calendar never needs them.
    expect(JSON.stringify(json)).not.toContain("u1");
  });

  it("refuses an inverted range", async () => {
    from.mockReturnValue(builder({ data: [] }));
    const res = await GET(
      new NextRequest("http://localhost/api/meetings/blocks?from=2026-09-02T00:00:00Z&to=2026-09-01T00:00:00Z"),
    );
    expect(res.status).toBe(422);
  });

  it("refuses a range wide enough to scan all history", async () => {
    from.mockReturnValue(builder({ data: [] }));
    const res = await GET(
      new NextRequest("http://localhost/api/meetings/blocks?from=2000-01-01T00:00:00Z&to=2026-09-01T00:00:00Z"),
    );
    expect(res.status).toBe(422);
  });

  it("requires an org context", async () => {
    authMock.mockResolvedValue({ ok: false, error: "Unauthorized", status: 401 });
    const res = await GET(new NextRequest("http://localhost/api/meetings/blocks"));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/meetings/blocks", () => {
  it("creates a block stamped with the session's user, not the body's", async () => {
    const insert = jest.fn((row: Record<string, unknown>) => { void row; return builder({ data: {
      id: "b1", user_id: "u1", organization_id: "org1", title: "Flight",
      starts_at: "2026-09-01T14:00:00.000Z", ends_at: "2026-09-01T18:00:00.000Z",
    } }); });
    const b = builder({ data: null }) as Record<string, unknown>;
    b.insert = insert;
    from.mockReturnValue(b);

    const res = await POST(post({
      title: "Flight",
      startsAt: "2026-09-01T14:00:00.000Z",
      endsAt: "2026-09-01T18:00:00.000Z",
      userId: "someone-else",
    }));

    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1", organization_id: "org1" }));
    // A caller must not be able to block another member's calendar.
    expect(insert).not.toHaveBeenCalledWith(expect.objectContaining({ user_id: "someone-else" }));
  });

  it("rejects a block that ends before it starts", async () => {
    from.mockReturnValue(builder({ data: null }));
    const res = await POST(post({ startsAt: "2026-09-01T18:00:00.000Z", endsAt: "2026-09-01T14:00:00.000Z" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/end after it starts/);
  });

  it("rejects a body with no times at all", async () => {
    from.mockReturnValue(builder({ data: null }));
    expect((await POST(post({ title: "Busy" }))).status).toBe(422);
  });
});
