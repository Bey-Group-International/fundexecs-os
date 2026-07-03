// Idempotency coverage for decideApproval: a second decision on an
// already-decided approval must NOT re-execute the workflow. The guard is a
// compare-and-set that only proceeds when it flips a still-null decision; when
// the conditional update claims zero rows, the function returns early and never
// touches the `tasks` table (where executeWorkflow would load the workflow).

import { decideApproval } from "@/lib/engine";

type Approval = { id: string; task_id: string; decision: string | null };

function makeSupabase(approval: Approval, opts: { updateClaimsRow: boolean }) {
  const touchedTables: string[] = [];

  function builder(table: string) {
    touchedTables.push(table);
    let op: "select" | "update" = "select";

    const b: Record<string, unknown> = {
      select: () => b,
      update: () => {
        op = "update";
        return b;
      },
      insert: () => b,
      eq: () => b,
      is: () => b,
      single: async () => ({ data: approval, error: null }),
      then: (onFulfilled: (v: unknown) => unknown) => {
        const result =
          op === "update"
            ? { data: opts.updateClaimsRow ? [{ id: approval.id }] : [], error: null }
            : { data: approval, error: null };
        return Promise.resolve(result).then(onFulfilled);
      },
    };
    return b;
  }

  return { client: { from: (t: string) => builder(t) }, touchedTables };
}

const ctx = (supabase: unknown) => ({ supabase, orgId: "org-1", actorId: "user-1" }) as never;

describe("decideApproval idempotency", () => {
  it("no-ops when the approval was already decided (conditional update claims 0 rows)", async () => {
    const approval: Approval = { id: "appr-1", task_id: "wf-1", decision: "approved" };
    const { client, touchedTables } = makeSupabase(approval, { updateClaimsRow: false });

    const result = await decideApproval(ctx(client), { approvalId: "appr-1", decision: "approved" });

    expect(result).toEqual({ workflowId: "wf-1", decision: "approved", alreadyDecided: true });
    // Never advanced to loading/executing the workflow.
    expect(touchedTables).not.toContain("tasks");
  });

  it("throws a clean error when the approval does not exist", async () => {
    const { client } = makeSupabase({ id: "", task_id: "", decision: null }, { updateClaimsRow: false });
    // Force the initial select to return no row.
    const noRowClient = {
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      }),
    };
    void client;

    await expect(
      decideApproval(ctx(noRowClient), { approvalId: "missing", decision: "approved" }),
    ).rejects.toThrow("Approval not found");
  });
});
