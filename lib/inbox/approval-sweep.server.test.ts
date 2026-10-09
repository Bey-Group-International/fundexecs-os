const createTeamTask = jest.fn(async (..._a: unknown[]) => ({ id: "tt" }));
const deliverApprovedReply = jest.fn();
jest.mock("@/lib/team-tasks", () => ({ createTeamTask: (...a: unknown[]) => createTeamTask(...a) }));
jest.mock("@/lib/inbox/deliver-reply.server", () => ({ deliverApprovedReply: (...a: unknown[]) => deliverApprovedReply(...a) }));

import { pickApprovers, reminderDue, runInboxApprovalSweep } from "./approval-sweep.server";

const NOW = new Date("2026-10-09T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("reminderDue", () => {
  it("reminds at 4 hours, escalates at a day, each once", () => {
    expect(reminderDue(hoursAgo(2), {}, NOW)).toBeNull();
    expect(reminderDue(hoursAgo(5), {}, NOW)).toBe("remind");
    expect(reminderDue(hoursAgo(5), { remindedAt: "x" }, NOW)).toBeNull();
    expect(reminderDue(hoursAgo(25), { remindedAt: "x" }, NOW)).toBe("escalate");
    expect(reminderDue(hoursAgo(25), {}, NOW)).toBe("escalate");
    expect(reminderDue(hoursAgo(25), { escalatedAt: "x" }, NOW)).toBeNull();
  });
});

describe("pickApprovers", () => {
  const members = [
    { principal_id: "author", role: "owner" },
    { principal_id: "admin", role: "admin" },
    { principal_id: "m1", role: "member" },
    { principal_id: "boss", role: "owner" },
    { principal_id: "v", role: "viewer" },
  ];
  it("never the author or a viewer; owners and admins first", () => {
    expect(pickApprovers(members, "author", "remind")).toEqual(["admin", "boss", "m1"]);
  });
  it("escalates to owners only", () => {
    expect(pickApprovers(members, "author", "escalate")).toEqual(["boss"]);
  });
});

describe("runInboxApprovalSweep", () => {
  type Write = { table: string; row: Record<string, unknown> };
  function client(data: Record<string, unknown[]>) {
    const writes: Write[] = [];
    return {
      writes,
      c: {
        from: (table: string) => {
          const b: Record<string, unknown> = {};
          for (const m of ["select", "eq", "lte", "order", "limit", "in", "not"]) b[m] = () => b;
          b.update = (row: Record<string, unknown>) => {
            writes.push({ table, row });
            return b;
          };
          b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: data[table] ?? [], error: null }).then(resolve);
          return b;
        },
      } as never,
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it("reminds the approvers of a message waiting 5 hours, and records it", async () => {
    const { c, writes } = client({
      approvals: [{ task_id: "task-1", organization_id: "org", created_at: hoursAgo(5) }],
      tasks: [
        {
          id: "task-1",
          title: "Reply — Ana",
          status: "awaiting_approval",
          organization_id: "org",
          result: { inboxReply: { threadId: "t1", action: "send_reply", body: "Hi", senderId: "author" } },
        },
      ],
      organization_members: [
        { principal_id: "author", role: "member" },
        { principal_id: "boss", role: "owner" },
      ],
    });
    const stats = await runInboxApprovalSweep(c, NOW);
    expect(stats).toMatchObject({ reminded: 1, escalated: 0 });
    expect(createTeamTask).toHaveBeenCalledTimes(1);
    expect(createTeamTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assignedTo: "boss", title: "Approval waiting: Reply — Ana", priority: "normal", sourceTaskId: "task-1" }),
    );
    expect((writes.find((w) => w.table === "tasks")!.row.result as { approvalReminders: { remindedAt: string } }).approvalReminders.remindedAt).toBe(
      NOW.toISOString(),
    );
  });

  it("sends an approved message whose scheduled time has come", async () => {
    deliverApprovedReply.mockResolvedValue({ ok: true });
    const { c } = client({
      tasks: [
        {
          id: "task-2",
          organization_id: "org",
          hub: "source",
          assigned_agent: null,
          result: { inboxReply: { threadId: "t1", action: "send_reply", body: "Hi", senderId: "author", approvedBy: "boss", scheduledAt: hoursAgo(1) } },
        },
      ],
    });
    const stats = await runInboxApprovalSweep(c, NOW);
    expect(stats.sent).toBe(1);
    expect(deliverApprovedReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: "org", approverId: "boss", taskId: "task-2", reply: expect.objectContaining({ scheduledAt: null }) }),
    );
  });
});
