// The applier's branching, against a stub client.
//
// The pure half is covered in network-automations.test.ts. What is left here
// is the part that can only go wrong once a database is involved: the claim
// that makes a firing idempotent, the difference between how an event and a
// sweep treat a failed condition, and the service-role path that exists
// because the SECURITY DEFINER helpers refuse a caller with no principal.
//
// A stub rather than a mock framework: what matters is which table each action
// wrote to and with what, and a recorded call list says that plainly.

import { runEventAutomations, runScheduledAutomationsForOrg } from "@/lib/network-automations.server";
import type { Automation } from "@/lib/network-automations";

type Call = { table: string; op: string; payload?: unknown };

const RULE = {
  id: "rule-1",
  name: "Chase diligence",
  description: null,
  enabled: true,
  trigger_type: "opportunity_stage_changed",
  trigger_config: {},
  conditions: [],
  actions: [{ type: "create_task", title: "Chase {{name}}", dueInDays: 3 }],
  run_count: 0,
  last_run_at: null,
  last_error: null,
  created_by: "admin-1",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

const DEAL_SNAPSHOT = {
  id: "op-1",
  name: "Meridian",
  stage: "diligence",
  status: "open",
  owner_id: "user-a",
  contact_id: "c-1",
  investor_id: null,
  target_amount: 5_000_000,
  currency: "USD",
  tags: [],
  custom: {},
  updated_at: "2026-09-21T10:00:00.000Z",
};

/**
 * A supabase stand-in.
 *
 * Two details the first version of this stub got wrong, both of which made the
 * tests fail for reasons that had nothing to do with the code:
 *
 *   • `.update()` is CHAINED — `update(...).eq(...).eq(...)` — so it has to
 *     return the builder, not a promise. Returning a promise made every write
 *     throw "eq is not a function" inside the applier's own catch, which then
 *     reported a perfectly good rule as failed.
 *
 *   • A stage-change event asks for THREE rule types (stage_changed, won,
 *     lost). A stub that answers every query with the same rule loads it three
 *     times and fires it three times. The `eq` filters are recorded so the
 *     answer can depend on which trigger was asked for, which is what the real
 *     query does.
 */
function stubClient(opts: {
  rules?: Record<string, unknown>[];
  claimFails?: boolean;
  candidates?: unknown[];
  calls: Call[];
}) {
  const { calls } = opts;
  const rules = opts.rules ?? [];

  function builder(table: string) {
    const state: { op: string; filters: Record<string, unknown> } = { op: "select", filters: {} };

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        state.filters[column] = value;
        return chain;
      },
      in: () => chain,
      order: () => chain,
      insert: (payload: unknown) => {
        state.op = "insert";
        calls.push({ table, op: "insert", payload });
        return chain;
      },
      update: (payload: unknown) => {
        state.op = "update";
        calls.push({ table, op: "update", payload });
        return chain;
      },
      limit: () => resolve(),
      maybeSingle: () => resolve(),
      single: () => resolve(),
      then: (fn: (v: unknown) => unknown) => resolve().then(fn),
    };

    function resolve(): Promise<unknown> {
      if (state.op === "update") {
        // Writes report one affected row; the applier reads `count` to tell a
        // silent RLS refusal from a real write.
        return Promise.resolve({ error: null, count: 1 });
      }
      if (table === "network_automations") {
        // Only the rules whose trigger the caller actually asked for.
        const wanted = state.filters.trigger_type;
        return Promise.resolve({
          data: wanted === undefined ? rules : rules.filter((r) => r.trigger_type === wanted),
          error: null,
        });
      }
      if (table === "network_automation_runs" && state.op === "insert") {
        if (opts.claimFails) return Promise.resolve({ data: null, error: { code: "23505" } });
        return Promise.resolve({ data: { id: "run-1" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }

    return chain;
  }

  return {
    from: (table: string) => builder(table),
    rpc: (name: string, args: unknown) => {
      calls.push({ table: `rpc:${name}`, op: "rpc", payload: args });
      if (name === "network_automation_claim_run") {
        // The member path's claim. The function returns the new run's id, or
        // null when the firing is already claimed — a unique violation is
        // caught inside it rather than surfacing as a PostgREST error, so the
        // "already taken" case is a null result, not a 23505.
        if (opts.claimFails) return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: "run-1", error: null });
      }
      if (name === "network_automation_candidates") {
        // The sweep asks once per scheduled trigger; only the kind the rule
        // watches has candidates, exactly as the SQL function behaves.
        const kind = (args as { kind?: string }).kind;
        const matches = rules.some((r) => r.trigger_type === kind);
        return Promise.resolve({ data: matches ? (opts.candidates ?? []) : [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  } as never;
}

/**
 * A fresh event per call, deliberately not a shared constant.
 *
 * applyAction now writes back to `snapshot.tags` after a successful add_tag —
 * that is what stops a two-tag rule losing its first tag. A module-level event
 * object would therefore carry one test's tags into the next, and the suite
 * would pass or fail depending on the order jest happened to run it in.
 */
function makeEvent() {
  return {
    kind: "opportunity_stage_changed" as const,
    from: "qualified",
    to: "diligence",
    snapshot: { ...DEAL_SNAPSHOT, tags: [] as unknown[], custom: {} },
  };
}

describe("the event path", () => {
  it("claims a run, then creates the task the rule asked for", async () => {
    const calls: Call[] = [];
    const tally = await runEventAutomations(
      { supabase: stubClient({ rules: [RULE], calls }), orgId: "org-1", actorId: "user-b" },
      makeEvent(),
    );

    expect(tally).toEqual({ applied: 1, skipped: 0, failed: 0 });

    // A member claims through the gated function, never by inserting into the
    // run log directly — an open insert policy let anyone forge a history
    // entry or steal a real firing's dedupe key.
    const claim = calls.find((c) => c.table === "rpc:network_automation_claim_run");
    expect(claim?.payload).toMatchObject({
      target_org: "org-1",
      target_automation: "rule-1",
      run_entity_type: "opportunity",
      run_entity_id: "op-1",
      // The row's version, so the same mutation evaluated twice is one firing.
      run_dedupe_key: "opportunity_stage_changed:2026-09-21T10:00:00.000Z",
    });
    expect(calls.some((c) => c.table === "network_automation_runs" && c.op === "insert")).toBe(
      false,
    );

    const task = calls.find((c) => c.table === "network_tasks");
    expect(task?.payload).toMatchObject({
      organization_id: "org-1",
      opportunity_id: "op-1",
      contact_id: "c-1",
      title: "Chase Meridian",
      assignee_id: "user-a",
      // Whoever's edit set the rule off, not the rule's author.
      created_by: "user-b",
    });
  });

  it("does nothing at all when the claim is already taken", async () => {
    const calls: Call[] = [];
    const tally = await runEventAutomations(
      {
        supabase: stubClient({ rules: [RULE], claimFails: true, calls }),
        orgId: "org-1",
        actorId: "user-b",
      },
      makeEvent(),
    );

    // Not "applied and harmless" — the second firing must not write anything.
    expect(tally).toEqual({ applied: 0, skipped: 0, failed: 0 });
    expect(calls.some((c) => c.table === "network_tasks")).toBe(false);
    expect(calls.some((c) => c.table.startsWith("rpc:network_automation_record_run"))).toBe(false);
  });

  it("records a run for a failed condition, so a rule that never matches is visible", async () => {
    const calls: Call[] = [];
    const rule = {
      ...RULE,
      conditions: [{ field: "target_amount", op: "gte", value: 50_000_000 }],
    };
    const tally = await runEventAutomations(
      { supabase: stubClient({ rules: [rule], calls }), orgId: "org-1", actorId: "user-b" },
      makeEvent(),
    );

    expect(tally).toEqual({ applied: 0, skipped: 1, failed: 0 });
    expect(calls.some((c) => c.table === "network_tasks")).toBe(false);
    const finish = calls.find((c) => c.table === "rpc:network_automation_run_finish");
    expect(finish?.payload).toMatchObject({ run_status: "skipped" });
  });

  it("does not fire a rule whose trigger does not match the event", async () => {
    const calls: Call[] = [];
    const rule = { ...RULE, trigger_config: { toStage: "legal" } };
    const tally = await runEventAutomations(
      { supabase: stubClient({ rules: [rule], calls }), orgId: "org-1", actorId: "user-b" },
      makeEvent(),
    );
    expect(tally).toEqual({ applied: 0, skipped: 0, failed: 0 });
    expect(calls.some((c) => c.table === "rpc:network_automation_claim_run")).toBe(false);
  });

  it("swallows a broken rule rather than failing the edit that triggered it", async () => {
    const calls: Call[] = [];
    const exploding = {
      from: () => {
        throw new Error("relation does not exist");
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    } as never;

    // The member's deal move has already committed by the time this runs.
    // Telling them it failed because an admin's rule is broken would be worse
    // than the rule silently not running.
    await expect(
      runEventAutomations({ supabase: exploding, orgId: "org-1", actorId: "user-b" }, makeEvent()),
    ).resolves.toEqual({ applied: 0, skipped: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe("the scheduled path", () => {
  const IDLE_RULE = {
    ...RULE,
    id: "rule-2",
    trigger_type: "opportunity_idle",
    trigger_config: { days: 21 },
    actions: [{ type: "create_task", title: "{{name}} has been quiet {{days}} days" }],
  };

  const CANDIDATE = {
    entity_id: "op-9",
    entity_label: "Quiet deal",
    snapshot: { ...DEAL_SNAPSHOT, id: "op-9", name: "Quiet deal" },
  };

  it("keys the firing on the UTC day and passes the threshold to the template", async () => {
    const calls: Call[] = [];
    const supabase = stubClient({ rules: [IDLE_RULE], candidates: [CANDIDATE], calls });

    const stats = await runScheduledAutomationsForOrg(
      { supabase, orgId: "org-1", actorId: null, serviceRole: true },
      new Date("2026-09-21T09:00:00.000Z"),
    );

    expect(stats.applied).toBeGreaterThan(0);
    // The sweep holds a service-role client and bypasses RLS, so it inserts
    // directly — and claims as `processing`, not `applied`: the row is written
    // before any action runs and must not assert that something happened.
    const claim = calls.find((c) => c.table === "network_automation_runs" && c.op === "insert");
    expect(claim?.payload).toMatchObject({
      entity_id: "op-9",
      dedupe_key: "opportunity_idle:2026-09-21",
      status: "processing",
    });

    const task = calls.find((c) => c.table === "network_tasks");
    expect(task?.payload).toMatchObject({ title: "Quiet deal has been quiet 21 days" });
  });

  it("does NOT consume the day's claim when the conditions do not hold", async () => {
    // This is the whole reason the scheduled path does not record skips. A row
    // that fails the conditions at 09:00 and passes them at 15:00 has to still
    // be able to fire; writing a "skipped" run would take the day's key and
    // the rule would never run for that row again until tomorrow.
    const calls: Call[] = [];
    const picky = {
      ...IDLE_RULE,
      conditions: [{ field: "target_amount", op: "gte", value: 50_000_000 }],
    };
    const stats = await runScheduledAutomationsForOrg(
      {
        supabase: stubClient({ rules: [picky], candidates: [CANDIDATE], calls }),
        orgId: "org-1",
        actorId: null,
        serviceRole: true,
      },
      new Date("2026-09-21T09:00:00.000Z"),
    );

    expect(stats.applied).toBe(0);
    expect(stats.skipped).toBeGreaterThan(0);
    expect(calls.some((c) => c.table === "network_automation_runs")).toBe(false);
  });

  it("closes out a run with a direct write, not the member-gated RPC", async () => {
    // network_automation_run_finish is SECURITY DEFINER and requires the
    // caller to be a member of the org. The sweep's service role is a member
    // of nothing, so the UPDATE would match zero rows and report no error —
    // every run it started would sit at its claimed status forever.
    const calls: Call[] = [];
    await runScheduledAutomationsForOrg(
      {
        supabase: stubClient({ rules: [IDLE_RULE], candidates: [CANDIDATE], calls }),
        orgId: "org-1",
        actorId: null,
        serviceRole: true,
      },
      new Date("2026-09-21T09:00:00.000Z"),
    );

    expect(calls.some((c) => c.table === "rpc:network_automation_run_finish")).toBe(false);
    expect(
      calls.some((c) => c.table === "network_automation_runs" && c.op === "update"),
    ).toBe(true);
    expect(calls.some((c) => c.table === "rpc:network_automation_record_run")).toBe(false);
    expect(calls.some((c) => c.table === "network_automations" && c.op === "update")).toBe(true);
  });

  it("uses the RPC when a member's own client is doing the work", async () => {
    // The positive control for the test above: without it, a change that
    // stopped calling the RPC in BOTH paths would still pass.
    const calls: Call[] = [];
    await runEventAutomations(
      { supabase: stubClient({ rules: [RULE], calls }), orgId: "org-1", actorId: "user-b" },
      makeEvent(),
    );
    expect(calls.some((c) => c.table === "rpc:network_automation_run_finish")).toBe(true);
    expect(calls.some((c) => c.table === "rpc:network_automation_record_run")).toBe(true);
  });
});

describe("regressions", () => {
  it("advances the rule's run count across the candidates of one sweep", () => {
    // The rule is loaded once and fired against many rows. Writing
    // `loaded + 1` every time left a rule that did fifty things reporting that
    // it had done one.
    const calls: Call[] = [];
    const rule = {
      ...RULE,
      id: "rule-3",
      trigger_type: "opportunity_idle",
      trigger_config: { days: 21 },
      run_count: 7,
    };
    const candidates = [
      { entity_id: "op-a", entity_label: "A", snapshot: { ...DEAL_SNAPSHOT, id: "op-a" } },
      { entity_id: "op-b", entity_label: "B", snapshot: { ...DEAL_SNAPSHOT, id: "op-b" } },
      { entity_id: "op-c", entity_label: "C", snapshot: { ...DEAL_SNAPSHOT, id: "op-c" } },
    ];
    return runScheduledAutomationsForOrg(
      {
        supabase: stubClient({ rules: [rule], candidates, calls }),
        orgId: "org-1",
        actorId: null,
        serviceRole: true,
      },
      new Date("2026-09-21T09:00:00.000Z"),
    ).then(() => {
      const counts = calls
        .filter((c) => c.table === "network_automations" && c.op === "update")
        .map((c) => (c.payload as { run_count: number }).run_count);
      expect(counts).toEqual([8, 9, 10]);
    });
  });

  it("accumulates two tags from one rule instead of losing the first", async () => {
    // `existing` comes from the snapshot, so without updating it after a write
    // the second tag's update sends [...existing, "B"] and erases "A" — while
    // the run log reports both actions as successful.
    const calls: Call[] = [];
    const rule = {
      ...RULE,
      actions: [
        { type: "add_tag", tag: "at-risk" },
        { type: "add_tag", tag: "needs-ic" },
      ],
    };
    await runEventAutomations(
      {
        supabase: stubClient({ rules: [rule], calls }),
        orgId: "org-1",
        actorId: "user-b",
      },
      makeEvent(),
    );
    const writes = calls
      .filter((c) => c.table === "network_opportunities" && c.op === "update")
      .map((c) => (c.payload as { tags: string[] }).tags);
    expect(writes).toEqual([["at-risk"], ["at-risk", "needs-ic"]]);
  });
});

describe("mapping guards", () => {
  it("survives a rule row whose jsonb columns are null", async () => {
    const calls: Call[] = [];
    const broken = { ...RULE, conditions: null, actions: null } as unknown as Automation;
    const tally = await runEventAutomations(
      {
        supabase: stubClient({ rules: [broken as unknown as Record<string, unknown>], calls }),
        orgId: "org-1",
        actorId: "user-b",
      },
      makeEvent(),
    );
    // No actions to run, so the firing is recorded and nothing is written.
    expect(tally.failed + tally.applied).toBe(1);
    expect(tally.skipped).toBe(0);
    expect(calls.some((c) => c.table === "network_tasks")).toBe(false);
  });
});
