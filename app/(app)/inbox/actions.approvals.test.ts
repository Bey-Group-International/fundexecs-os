/**
 * Approving inbox messages: edit-then-approve records what was actually sent,
 * a meeting's batch is decided message by message, and an approved message
 * that failed can be retried or discarded.
 */
const requireOrgContext = jest.fn();
const decideApproval = jest.fn();
const deliverApprovedReply = jest.fn();
let rows: Record<string, Record<string, unknown> | null> = {};
let updates: Array<{ table: string; row: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
let inserts: Array<{ table: string; row: Record<string, unknown> }> = [];

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/engine", () => ({ decideApproval: (...a: unknown[]) => decideApproval(...a) }));
jest.mock("@/lib/team-tasks", () => ({ recordOperatorFeedback: async () => {} }));
jest.mock("@/lib/inbox/intelligence", () => ({
  computePriority: () => 0,
  fallbackSummary: () => "",
  draftReply: async () => ({ draft: "", live: false }),
  smartReplies: async () => ({ replies: [], live: false }),
}));
jest.mock("@/lib/inbox/deliver-reply.server", () => {
  const pending = jest.requireActual("@/lib/inbox/pending-action");
  return {
    checkSendingMailbox: async () => ({ ok: true }),
    deliverThreadAction: async () => ({ ok: true }),
    isEmailThread: () => true,
    extractInboxReply: pending.extractInboxReply,
    legacyInboxReply: async () => null,
    deliverApprovedReply: (...a: unknown[]) => deliverApprovedReply(...a),
  };
});
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let update: Record<string, unknown> | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (c: string, v: unknown) => {
          filters.push([c, v]);
          return b;
        },
        update: (row: Record<string, unknown>) => {
          update = row;
          return b;
        },
        insert: (row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
        maybeSingle: async () => ({ data: rows[table] ?? null }),
      };
      b.then = (resolve: (v: unknown) => unknown) => {
        if (update) updates.push({ table, row: update, filters });
        return Promise.resolve({ error: null }).then(resolve);
      };
      return b;
    },
  }),
}));

import {
  approveEditedInboxMessage,
  decideInboxApprovals,
  discardFailedInboxMessage,
  retryInboxMessage,
  scheduleInboxMessage,
  sendScheduledInboxMessageNow,
  unscheduleInboxMessage,
} from "./actions";

const REPLY = { threadId: "t1", action: "send_reply", body: "Original", senderId: "author-1" };

beforeEach(() => {
  jest.clearAllMocks();
  updates = [];
  inserts = [];
  rows = {
    approvals: { task_id: "task-1", decision: "pending" },
    tasks: {
      id: "task-1",
      title: "Reply — Ana",
      description: 'Unified-inbox reply on the gmail thread "IC":\n\nOriginal',
      created_by: "author-1",
      result: { inboxReply: REPLY },
      status: "awaiting_approval",
    },
  };
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1", userId: "approver-1" } });
  decideApproval.mockResolvedValue({ workflowId: "task-1", decision: "approved" });
});

describe("approveEditedInboxMessage", () => {
  it("records the edit as what is sent, then approves it", async () => {
    const r = await approveEditedInboxMessage("appr-1", "  Edited text  ");
    expect(r).toEqual({ ok: true });
    const task = updates.find((u) => u.table === "tasks")!;
    expect(task.row).toMatchObject({
      description: 'Unified-inbox reply on the gmail thread "IC":\n\nEdited text',
      result: { inboxReply: { ...REPLY, body: "Edited text" }, edited: true },
    });
    expect(decideApproval).toHaveBeenCalledWith(expect.anything(), { approvalId: "appr-1", decision: "approved", note: undefined });
  });

  it("refuses an empty edit, and an approval already decided", async () => {
    expect(await approveEditedInboxMessage("appr-1", "   ")).toMatchObject({ ok: false });
    rows.approvals = { task_id: "task-1", decision: "approved" };
    expect(await approveEditedInboxMessage("appr-1", "x")).toMatchObject({ ok: false });
    expect(decideApproval).not.toHaveBeenCalled();
  });
});

describe("decideInboxApprovals", () => {
  it("decides each in turn and reports each outcome", async () => {
    decideApproval
      .mockResolvedValueOnce({ workflowId: "a", decision: "approved" })
      .mockResolvedValueOnce({ workflowId: "b", decision: "approved", error: "Mailbox revoked" });
    const { results } = await decideInboxApprovals(["a1", "a2", "a1"], "approved");
    expect(results).toEqual([
      { approvalId: "a1", ok: true },
      { approvalId: "a2", ok: false, error: "Approved, but it was not sent: Mailbox revoked" },
    ]);
  });
});

describe("retryInboxMessage", () => {
  it("re-sends a failed message as the current user", async () => {
    rows.tasks = { id: "task-1", status: "failed", result: { inboxReply: { ...REPLY, delivered: false } }, assigned_agent: null, hub: "source" };
    deliverApprovedReply.mockResolvedValue({ ok: true });
    expect(await retryInboxMessage("task-1")).toEqual({ ok: true });
    expect(deliverApprovedReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ approverId: "approver-1", taskId: "task-1", reply: expect.objectContaining({ body: "Original" }) }),
    );
  });

  it("says why it still did not go", async () => {
    rows.tasks = { id: "task-1", status: "failed", result: { inboxReply: { ...REPLY, delivered: false } } };
    deliverApprovedReply.mockResolvedValue({ ok: false, error: "No Google account is connected." });
    expect(await retryInboxMessage("task-1")).toEqual({ ok: false, error: "Still not sent: No Google account is connected." });
  });

  it("will not resend something delivered or not failed", async () => {
    rows.tasks = { id: "task-1", status: "completed", result: { inboxReply: { ...REPLY, delivered: true } } };
    expect(await retryInboxMessage("task-1")).toMatchObject({ ok: false });
    expect(deliverApprovedReply).not.toHaveBeenCalled();
  });
});

describe("discardFailedInboxMessage", () => {
  it("cancels only a failed task", async () => {
    expect(await discardFailedInboxMessage("task-1")).toEqual({ ok: true });
    const u = updates.find((x) => x.table === "tasks")!;
    expect(u.row).toEqual({ status: "cancelled" });
    expect(u.filters).toContainEqual(["status", "failed"]);
  });
});

describe("scheduleInboxMessage", () => {
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

  it("records the send time on the task, then approves it", async () => {
    const at = tomorrow();
    decideApproval.mockResolvedValue({ workflowId: "task-1", decision: "approved", scheduledAt: at });
    const r = await scheduleInboxMessage("appr-1", at);
    expect(r).toEqual({ ok: true, scheduledAt: at });
    expect(updates[0].row).toMatchObject({ result: { inboxReply: { ...REPLY, scheduledAt: at } } });
    expect(decideApproval).toHaveBeenCalledWith(expect.anything(), { approvalId: "appr-1", decision: "approved", note: undefined });
  });

  it("refuses a time in the past or too far ahead", async () => {
    expect(await scheduleInboxMessage("appr-1", new Date(Date.now() - 1000).toISOString())).toMatchObject({ ok: false });
    expect(await scheduleInboxMessage("appr-1", new Date(Date.now() + 90 * 86_400_000).toISOString())).toMatchObject({ ok: false });
    expect(await scheduleInboxMessage("appr-1", "not a date")).toMatchObject({ ok: false });
    expect(decideApproval).not.toHaveBeenCalled();
  });

  it("forgets the time when the approval is refused", async () => {
    decideApproval.mockResolvedValue({ workflowId: "task-1", decision: "approved", refused: "You wrote this message." });
    const r = await scheduleInboxMessage("appr-1", tomorrow());
    expect(r).toEqual({ ok: false, error: "You wrote this message." });
    expect(updates[updates.length - 1].row).toEqual({ result: { inboxReply: REPLY } });
  });
});

describe("a scheduled message", () => {
  beforeEach(() => {
    rows.tasks = {
      id: "task-1",
      title: "Reply — Ana",
      status: "pending",
      result: { inboxReply: { ...REPLY, scheduledAt: "2026-10-10T09:00:00.000Z", approvedBy: "boss" } },
      assigned_agent: null,
      hub: "source",
    };
  });

  it("can be sent now, as the person who approved it", async () => {
    deliverApprovedReply.mockResolvedValue({ ok: true });
    expect(await sendScheduledInboxMessageNow("task-1")).toEqual({ ok: true });
    expect(deliverApprovedReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ approverId: "boss", reply: expect.objectContaining({ scheduledAt: null }) }),
    );
  });

  it("can go back to approvals, unsent", async () => {
    expect(await unscheduleInboxMessage("task-1")).toEqual({ ok: true });
    expect(updates[0].row).toMatchObject({
      status: "awaiting_approval",
      result: { inboxReply: { scheduledAt: null, approvedBy: null } },
    });
    expect(inserts.find((i) => i.table === "approvals")?.row).toMatchObject({ task_id: "task-1" });
  });

  it("is left alone once it has gone", async () => {
    rows.tasks = { ...rows.tasks!, status: "completed" };
    expect(await sendScheduledInboxMessageNow("task-1")).toMatchObject({ ok: false });
    expect(await unscheduleInboxMessage("task-1")).toMatchObject({ ok: false });
  });
});

it("reports a refused approval as an error, not as a failed send", async () => {
  decideApproval.mockResolvedValue({ workflowId: "task-1", decision: "approved", refused: "You wrote this message." });
  const { results } = await decideInboxApprovals(["a1"], "approved");
  expect(results).toEqual([{ approvalId: "a1", ok: false, error: "You wrote this message." }]);
});
