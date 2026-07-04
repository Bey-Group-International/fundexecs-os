// Writes-as-approvals coverage (audit P2 — API-surface design). The contract:
// a POSTed body is validated against a strict whitelist, parks as a task +
// approval pair without touching the target table, and only an approval
// decision commits the row — re-validated on the way in, so a payload
// tampered with while parked still can't smuggle fields past the whitelist.
import {
  createApiWriteApproval,
  executeApiWrite,
  extractApiWriteRequest,
  parseApiWrite,
  type ApiWriteRequest,
} from "./api-write-requests";

describe("parseApiWrite", () => {
  it("accepts a full valid deal and trims strings", () => {
    const parsed = parseApiWrite("deals", {
      name: "  Riverside Industrial ",
      stage: "sourced",
      asset_class: "real_estate",
      geography: "US-TX",
      target_amount: 25_000_000,
      expected_close: "2026-12-31",
      source: "broker",
      notes: "Off-market intro",
    });
    expect(parsed).toEqual({
      ok: true,
      row: expect.objectContaining({ name: "Riverside Industrial", stage: "sourced" }),
    });
  });

  it("accepts a valid investor", () => {
    const parsed = parseApiWrite("investors", {
      name: "Meridian Family Office",
      investor_type: "family_office",
      contact_email: "ops@meridian.test",
      typical_check_min: 1_000_000,
      typical_check_max: 5_000_000,
    });
    expect(parsed.ok).toBe(true);
  });

  it("requires name", () => {
    expect(parseApiWrite("deals", { stage: "sourced" })).toEqual({
      ok: false,
      error: "Field name is required",
    });
  });

  it("rejects unknown fields loudly instead of dropping them", () => {
    // fund_id and lead_principal are real columns but deliberately NOT writable
    // over the API — linking to other records is the operator's call.
    const parsed = parseApiWrite("deals", { name: "X", fund_id: "f-1" });
    expect(parsed).toEqual({ ok: false, error: "Unknown field: fund_id" });
  });

  it("rejects bad enums, negative numbers, malformed dates, and non-objects", () => {
    expect(parseApiWrite("deals", { name: "X", stage: "wishful" }).ok).toBe(false);
    expect(parseApiWrite("deals", { name: "X", target_amount: -5 }).ok).toBe(false);
    expect(parseApiWrite("deals", { name: "X", expected_close: "soon" }).ok).toBe(false);
    expect(parseApiWrite("investors", { name: "X", investor_type: "whale" }).ok).toBe(false);
    expect(parseApiWrite("deals", "just a string").ok).toBe(false);
    expect(parseApiWrite("deals", [{ name: "X" }]).ok).toBe(false);
  });
});

// Minimal thenable query builder: records inserts/deletes per table and lets a
// test fail a chosen table's insert.
function makeSupabase(opts: { failInsertOn?: string } = {}) {
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const deletes: string[] = [];

  function builder(table: string) {
    let failed = false;
    const b: Record<string, unknown> = {
      insert: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        failed = opts.failInsertOn === table;
        return b;
      },
      delete: () => {
        deletes.push(table);
        return b;
      },
      select: () => b,
      eq: () => b,
      single: async () =>
        failed
          ? { data: null, error: { message: "boom" } }
          : { data: { id: `${table}-id-1` }, error: null },
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled),
    };
    return b;
  }

  return { client: { from: (t: string) => builder(t) } as never, inserts, deletes };
}

const queueArgs = {
  orgId: "org-1",
  keyId: "key-12345678",
  mode: "live",
  resource: "deals" as const,
  row: { name: "Riverside Industrial" },
};

describe("createApiWriteApproval", () => {
  it("parks the write as an awaiting_approval task + pending approval pair", async () => {
    const { client, inserts } = makeSupabase();
    const queued = await createApiWriteApproval(client, queueArgs);

    expect(queued).toEqual({ ok: true, taskId: "tasks-id-1", approvalId: "approvals-id-1" });
    const task = inserts.find((i) => i.table === "tasks")!.values;
    expect(task.status).toBe("awaiting_approval");
    expect(task.requires_approval).toBe(true);
    expect(task.result).toEqual({
      apiWriteRequest: {
        resource: "deals",
        row: { name: "Riverside Industrial" },
        key_id: "key-12345678",
        mode: "live",
      },
    });
    const approval = inserts.find((i) => i.table === "approvals")!.values;
    expect(approval.task_id).toBe("tasks-id-1");
    // Nothing touched the target table.
    expect(inserts.some((i) => i.table === "deals")).toBe(false);
  });

  it("deletes the task when the approval insert fails (no orphaned gate)", async () => {
    const { client, deletes } = makeSupabase({ failInsertOn: "approvals" });
    const queued = await createApiWriteApproval(client, queueArgs);
    expect(queued.ok).toBe(false);
    expect(deletes).toContain("tasks");
  });
});

describe("extractApiWriteRequest", () => {
  it("round-trips the parked payload and ignores every other task result", () => {
    const request: ApiWriteRequest = {
      resource: "investors",
      row: { name: "Meridian" },
      key_id: "key-1",
      mode: "test",
    };
    expect(extractApiWriteRequest({ apiWriteRequest: request } as never)).toEqual(request);
    expect(extractApiWriteRequest(null)).toBeNull();
    expect(extractApiWriteRequest({ finClosedPeriodPost: {} } as never)).toBeNull();
    expect(extractApiWriteRequest({ apiWriteRequest: { resource: "ledgers", row: {} } } as never)).toBeNull();
  });
});

describe("executeApiWrite", () => {
  it("commits the parked row scoped to the org", async () => {
    const { client, inserts } = makeSupabase();
    const result = await executeApiWrite(client, "org-1", {
      resource: "deals",
      row: { name: "Riverside Industrial", stage: "sourced" },
      key_id: "key-1",
      mode: "live",
    });
    expect(result).toEqual({ ok: true, id: "deals-id-1" });
    expect(inserts[0]).toEqual({
      table: "deals",
      values: expect.objectContaining({ name: "Riverside Industrial", organization_id: "org-1" }),
    });
  });

  it("re-validates the parked payload — a tampered row cannot smuggle fields", async () => {
    const { client, inserts } = makeSupabase();
    const result = await executeApiWrite(client, "org-1", {
      resource: "deals",
      row: { name: "X", fund_id: "someone-elses-fund" } as never,
      key_id: "key-1",
      mode: "live",
    });
    expect(result.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("surfaces the database error instead of claiming success", async () => {
    const { client } = makeSupabase({ failInsertOn: "investors" });
    const result = await executeApiWrite(client, "org-1", {
      resource: "investors",
      row: { name: "Meridian" },
      key_id: "key-1",
      mode: "live",
    });
    expect(result).toEqual({ ok: false, error: "boom" });
  });
});
