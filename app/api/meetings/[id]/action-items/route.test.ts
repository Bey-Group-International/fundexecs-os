/**
 * Ticking off an action item from the report. The host or the person it is
 * assigned to; the task must belong to this meeting.
 */
const requireOrgContext = jest.fn();
const updateTeamTaskStatus = jest.fn();
const rows: { meeting: unknown; task: unknown } = { meeting: null, task: null };

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/team-tasks", () => ({
  updateTeamTaskStatus: (...a: unknown[]) => updateTeamTaskStatus(...a),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        is: () => b,
        maybeSingle: async () => ({ data: table === "live_meetings" ? rows.meeting : rows.task }),
      };
      return b;
    },
  }),
}));

import { PATCH } from "./route";

const params = { params: Promise.resolve({ id: "m1" }) };
const patch = (body: unknown) =>
  new Request("http://localhost/api/meetings/m1/action-items", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  rows.meeting = { id: "m1", host_id: "host-1" };
  rows.task = { id: "t1", organization_id: "org1", assigned_to: "u-sarah", meeting_id: "m1" };
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "host-1" } });
  updateTeamTaskStatus.mockResolvedValue({ ok: true });
});

it("completes the task when the host ticks it", async () => {
  const res = await PATCH(patch({ taskId: "t1", done: true }), params);
  expect(res.status).toBe(200);
  expect(updateTeamTaskStatus.mock.calls[0][1]).toEqual({ organizationId: "org1", taskId: "t1", status: "completed" });
});

it("reopens it when unticked", async () => {
  await PATCH(patch({ taskId: "t1", done: false }), params);
  expect(updateTeamTaskStatus.mock.calls[0][1]).toMatchObject({ status: "pending" });
});

it("lets the person it is assigned to tick it", async () => {
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "u-sarah" } });
  expect((await PATCH(patch({ taskId: "t1", done: true }), params)).status).toBe(200);
});

it("refuses anyone else", async () => {
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org1", userId: "someone" } });
  expect((await PATCH(patch({ taskId: "t1", done: true }), params)).status).toBe(403);
  expect(updateTeamTaskStatus).not.toHaveBeenCalled();
});

it("404s a task that is not this meeting's", async () => {
  rows.task = null;
  expect((await PATCH(patch({ taskId: "t9", done: true }), params)).status).toBe(404);
});

it("400s a malformed request", async () => {
  expect((await PATCH(patch({ taskId: "t1" }), params)).status).toBe(400);
});
