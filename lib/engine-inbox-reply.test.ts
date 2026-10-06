// decideApproval on a held inbox reply: approving SENDS it (through
// deliverApprovedReply) and never falls into workflow execution — which used to
// mark it complete without sending anything and save its text as an
// auto-approving automation. Anything else withdraws it.
const deliverApprovedReply = jest.fn();
jest.mock("@/lib/inbox/deliver-reply.server", () => {
  const actual = jest.requireActual("@/lib/inbox/deliver-reply.server");
  return { ...actual, deliverApprovedReply: (...a: unknown[]) => deliverApprovedReply(...a) };
});

import { decideApproval } from "@/lib/engine";

interface Call {
  table: string;
  op: string;
  values?: Record<string, unknown>;
}

const TASK = {
  id: "task-1",
  hub: "source",
  assigned_agent: "investor_relations",
  title: "Reply — Ana Diaz",
  description: "Unified-inbox reply…",
  automation_id: null,
  result: { inboxReply: { threadId: "t1", action: "send_reply", body: "Hi Ana", senderId: "author-1" } },
};

function makeSupabase() {
  const calls: Call[] = [];
  function builder(table: string) {
    const call: Call = { table, op: "select" };
    calls.push(call);
    const b: Record<string, unknown> = {
      select: () => b,
      update: (values: Record<string, unknown>) => {
        call.op = "update";
        call.values = values;
        return b;
      },
      insert: (values: Record<string, unknown>) => {
        call.op = "insert";
        call.values = values;
        return b;
      },
      eq: () => b,
      is: () => b,
      single: async () => {
        if (call.op === "select" && table === "approvals") {
          return { data: { id: "appr-1", task_id: "task-1", decision: "pending" }, error: null };
        }
        if (call.op === "select" && table === "tasks") return { data: TASK, error: null };
        return { data: { id: `${table}-row` }, error: null };
      },
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve(
          call.op === "update" && table === "approvals" ? { data: [{ id: "appr-1" }], error: null } : { data: [], error: null },
        ).then(onFulfilled),
    };
    return b;
  }
  return { client: { from: (t: string) => builder(t) } as never, calls };
}

const ctx = (supabase: unknown) => ({ supabase, orgId: "org-1", actorId: "approver-1" }) as never;

beforeEach(() => jest.clearAllMocks());

it("approved: sends the parked reply from its author's mailbox and runs no workflow", async () => {
  deliverApprovedReply.mockResolvedValue({ ok: true });
  const { client, calls } = makeSupabase();
  const r = await decideApproval(ctx(client), { approvalId: "appr-1", decision: "approved" });
  expect(r).toEqual({ workflowId: "task-1", decision: "approved" });
  expect(deliverApprovedReply).toHaveBeenCalledWith(
    client,
    expect.objectContaining({
      orgId: "org-1",
      approverId: "approver-1",
      taskId: "task-1",
      reply: expect.objectContaining({ threadId: "t1", body: "Hi Ana", senderId: "author-1" }),
    }),
  );
  expect(calls.some((c) => c.table === "automations")).toBe(false);
});

it("approved but undeliverable: reports the reason", async () => {
  deliverApprovedReply.mockResolvedValue({ ok: false, error: "Your Google connection was revoked." });
  const { client } = makeSupabase();
  const r = await decideApproval(ctx(client), { approvalId: "appr-1", decision: "approved" });
  expect(r).toEqual({ workflowId: "task-1", decision: "approved", error: "Your Google connection was revoked." });
});

it.each(["rejected", "regenerate"] as const)("%s: withdraws it without sending", async (decision) => {
  const { client, calls } = makeSupabase();
  await decideApproval(ctx(client), { approvalId: "appr-1", decision });
  expect(deliverApprovedReply).not.toHaveBeenCalled();
  expect(calls.find((c) => c.table === "tasks" && c.op === "update")?.values?.status).toBe("cancelled");
  expect(calls.some((c) => c.table === "automations")).toBe(false);
});
