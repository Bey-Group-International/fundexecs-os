const authMock = jest.fn();
const from = jest.fn();
const updateMeetingMock = jest.fn();
const deleteMeetingLocalMock = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireOrgContext: () => authMock(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ from }),
}));

jest.mock("@/lib/meetings/service", () => ({
  updateMeeting: (...args: unknown[]) => updateMeetingMock(...args),
  deleteMeetingLocal: (...args: unknown[]) => deleteMeetingLocalMock(...args),
}));

import { NextRequest } from "next/server";
import { DELETE, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "m1" }) };

function req(body: unknown = {}) {
  return new NextRequest("http://localhost/api/meetings/m1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// A chainable query stub. `maybeSingle` serves the prior-row load; `limit`
// serves the conflict-candidate query — so one builder covers both reads.
function makeBuilder(opts: { maybeSingle?: unknown; limit?: unknown } = {}) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    is: () => b,
    neq: () => b,
    gte: () => b,
    lt: () => b,
    order: () => b,
    maybeSingle: async () => opts.maybeSingle ?? { data: null },
    limit: async () => opts.limit ?? { data: [] },
  };
  return b;
}

const PRIOR_ROW = {
  attendees: [],
  room_code: "abc",
  is_draft: false,
  host_id: "u1",
  scheduled_at: "2026-07-10T10:00:00.000Z",
  duration_minutes: 60,
};
const OVERLAPPING_CANDIDATE = {
  id: "other",
  title: "Board",
  scheduled_at: "2026-07-10T10:00:00.000Z",
  duration_minutes: 60,
  host_id: "u1", // shares the host with the meeting being rescheduled
  attendees: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org1", userId: "u1", role: "owner", email: "u@test" },
  });
  // Default: no prior row and no candidates, so conflict detection is skipped.
  from.mockReturnValue(makeBuilder());
});

describe("/api/meetings/[id]", () => {
  it("patches meeting fields through the service", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    const res = await PATCH(req({
      title: "Updated",
      durationMinutes: 45,
      priority: "high",
      tags: ["LP", "Q3"],
      syncMode: "pending_external",
    }), params);

    expect(res.status).toBe(200);
    expect(updateMeetingMock).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "org1", userId: "u1" },
      "m1",
      expect.objectContaining({
        title: "Updated",
        durationMinutes: 45,
        priority: "high",
        tags: ["LP", "Q3"],
        syncMode: "pending_external",
      }),
    );
  });

  it("returns 409 when a reschedule conflicts with a shared meeting", async () => {
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: PRIOR_ROW }, limit: { data: [OVERLAPPING_CANDIDATE] } }));

    const res = await PATCH(req({ scheduledAt: "2026-07-10T10:15:00.000Z", durationMinutes: 30 }), params);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflicts.map((c: { id: string }) => c.id)).toEqual(["other"]);
    expect(updateMeetingMock).not.toHaveBeenCalled();
  });

  it("saves a conflicting reschedule when allowConflict is set", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    from.mockReturnValue(makeBuilder({ maybeSingle: { data: PRIOR_ROW }, limit: { data: [OVERLAPPING_CANDIDATE] } }));

    const res = await PATCH(req({ scheduledAt: "2026-07-10T10:15:00.000Z", durationMinutes: 30, allowConflict: true }), params);

    expect(res.status).toBe(200);
    expect(updateMeetingMock).toHaveBeenCalled();
  });

  it("does not flag a reschedule that overlaps an unrelated meeting", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    from.mockReturnValue(
      makeBuilder({
        maybeSingle: { data: PRIOR_ROW },
        limit: { data: [{ ...OVERLAPPING_CANDIDATE, host_id: "someone-else", attendees: [{ email: "x@y.z" }] }] },
      }),
    );

    const res = await PATCH(req({ scheduledAt: "2026-07-10T10:15:00.000Z", durationMinutes: 30 }), params);

    expect(res.status).toBe(200);
    expect(updateMeetingMock).toHaveBeenCalled();
  });

  it("deletes meetings locally by default", async () => {
    deleteMeetingLocalMock.mockResolvedValue({ ok: true });
    const res = await DELETE(new NextRequest("http://localhost/api/meetings/m1", { method: "DELETE" }), params);

    expect(res.status).toBe(200);
    expect(deleteMeetingLocalMock).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "org1", userId: "u1" },
      "m1",
    );
  });
});
