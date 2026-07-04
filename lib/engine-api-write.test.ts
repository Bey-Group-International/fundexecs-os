// decideApproval's API-write path: a task parked by POST /api/v1/* must be
// committed on "approved" (and only then), cancelled on any other decision,
// and must NEVER fall through into workflow-plan execution. Also pins the
// idempotency CAS to the real column contract: approvals.decision defaults to
// 'pending' (not null), so the conditional update must match 'pending' — an
// IS NULL match would claim zero rows and silently no-op every real decision.
import { decideApproval } from "@/lib/engine";

interface Call {
  table: string;
  op: string;
  values?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

function makeSupabase(task: Record<string, unknown>) {
  const calls: Call[] = [];

  function builder(table: string) {
    const call: Call = { table, op: "select", filters: [] };
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
      eq: (col: string, v: unknown) => {
        call.filters.push([col, v]);
        return b;
      },
      is: (col: string, v: unknown) => {
        call.filters.push([col, v]);
        return b;
      },
      single: async () => {
        if (call.op === "select") {
          if (table === "approvals") {
            return { data: { id: "appr-1", task_id: "task-1", decision: "pending" }, error: null };
          }
          if (table === "tasks") return { data: task, error: null };
        }
        return { data: { id: `${table}-row-1` }, error: null };
      },
      then: (onFulfilled: (v: unknown) => unknown) => {
        const result =
          call.op === "update" && table === "approvals"
            ? { data: [{ id: "appr-1" }], error: null }
            : { data: [], error: null };
        return Promise.resolve(result).then(onFulfilled);
      },
    };
    return b;
  }

  return { client: { from: (t: string) => builder(t) } as never, calls };
}

const apiWriteTask = {
  id: "task-1",
  hub: "source",
  title: 'API write — create deal "Riverside"',
  result: {
    apiWriteRequest: {
      resource: "deals",
      row: { name: "Riverside" },
      key_id: "key-1",
      mode: "live",
    },
  },
  automation_id: null,
};

const ctx = (supabase: unknown) => ({ supabase, orgId: "org-1", actorId: "user-1" }) as never;

describe("decideApproval on API-write tasks", () => {
  it("approved: commits the parked row and completes the task without running a workflow", async () => {
    const { client, calls } = makeSupabase(apiWriteTask);
    const result = await decideApproval(ctx(client), { approvalId: "appr-1", decision: "approved" });

    expect(result).toEqual({ workflowId: "task-1", decision: "approved" });
    const dealInsert = calls.find((c) => c.table === "deals" && c.op === "insert");
    expect(dealInsert?.values).toEqual(
      expect.objectContaining({ name: "Riverside", organization_id: "org-1" }),
    );
    const taskUpdate = calls.find((c) => c.table === "tasks" && c.op === "update");
    expect(taskUpdate?.values?.status).toBe("completed");
    // Never spilled into the workflow path (no automations row, no step tasks).
    expect(calls.some((c) => c.table === "automations")).toBe(false);
  });

  it("rejected: cancels the task and commits nothing", async () => {
    const { client, calls } = makeSupabase(apiWriteTask);
    const result = await decideApproval(ctx(client), { approvalId: "appr-1", decision: "rejected" });

    expect(result).toEqual({ workflowId: "task-1", decision: "rejected" });
    expect(calls.some((c) => c.table === "deals" && c.op === "insert")).toBe(false);
    const taskUpdate = calls.find((c) => c.table === "tasks" && c.op === "update");
    expect(taskUpdate?.values?.status).toBe("cancelled");
  });

  it("claims the decision against the 'pending' default, not IS NULL", async () => {
    const { client, calls } = makeSupabase(apiWriteTask);
    await decideApproval(ctx(client), { approvalId: "appr-1", decision: "approved" });

    const cas = calls.find((c) => c.table === "approvals" && c.op === "update");
    expect(cas?.filters).toContainEqual(["decision", "pending"]);
    expect(cas?.filters).not.toContainEqual(["decision", null]);
  });
});
