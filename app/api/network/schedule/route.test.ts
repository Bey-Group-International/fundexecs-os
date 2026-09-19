// The schedule window is the calendar's only input, and every way of getting it
// wrong returns a perfectly well-formed list of the wrong days. That is the
// failure mode worth testing: not a crash, but a confident answer to a question
// nobody asked.

const requireOrgContext = jest.fn();
const rpc = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireOrgContext: () => requireOrgContext(),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({ rpc: (...args: unknown[]) => rpc(...(args as [])) }),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const ORG = "00000000-0000-0000-0000-0000000000aa";

function req(query: string) {
  return new NextRequest(`https://example.test/api/network/schedule${query}`);
}

/** The arguments the route handed the RPC on the most recent call. */
function lastRange(): { range_start: string; range_end: string } {
  return rpc.mock.calls.at(-1)![1] as { range_start: string; range_end: string };
}

beforeEach(() => {
  requireOrgContext.mockReset();
  rpc.mockReset();
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: ORG } });
  rpc.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/network/schedule", () => {
  it("refuses a window with only one bound rather than quietly substituting a month", async () => {
    for (const q of ["?start=2026-09-01", "?end=2026-09-30"]) {
      const res = await GET(req(q));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: "start and end must be given together.",
      });
    }
    // The important half of the assertion: it did not fall through and query.
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still falls back to the month grid when neither bound is given", async () => {
    const res = await GET(req("?month=2026-09"));
    expect(res.status).toBe(200);
    // September 2026 begins on a Tuesday, so a Monday-first grid opens on
    // 31 August and runs 42 days to 11 October.
    expect(lastRange()).toMatchObject({
      range_start: "2026-08-31",
      range_end: "2026-10-11",
    });
  });

  it("honours an explicit window when both bounds are given", async () => {
    const res = await GET(req("?start=2026-09-07&end=2026-09-13"));
    expect(res.status).toBe(200);
    expect(lastRange()).toMatchObject({
      range_start: "2026-09-07",
      range_end: "2026-09-13",
    });
  });

  it("rejects a day that does not exist instead of rolling it into the next month", async () => {
    const res = await GET(req("?start=2026-02-30&end=2026-03-05"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "start and end must be real dates." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a malformed day", async () => {
    const res = await GET(req("?start=September&end=2026-03-05"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "start and end must be YYYY-MM-DD." });
  });

  it("rejects an inverted window", async () => {
    const res = await GET(req("?start=2026-09-30&end=2026-09-01"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "end cannot precede start." });
  });

  it("caps the window so one request cannot ask for a decade", async () => {
    const res = await GET(req("?start=2026-01-01&end=2030-01-01"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "A schedule window cannot exceed 400 days.",
    });
  });

  it("allows a window exactly at the cap", async () => {
    // 2026-01-01 + 400 days.
    const res = await GET(req("?start=2026-01-01&end=2027-02-05"));
    expect(res.status).toBe(200);
  });

  it("answers 401 without querying when there is no session", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const res = await GET(req("?month=2026-09"));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a failed read rather than an empty calendar", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(req("?month=2026-09"));
    expect(res.status).toBe(500);
    // An empty month and an unreachable one must not look the same.
    await expect(res.json()).resolves.toEqual({ error: "Failed to load the schedule" });
  });
});
