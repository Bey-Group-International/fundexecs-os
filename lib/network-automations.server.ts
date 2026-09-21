// Running the rules: the half that touches the database.
//
// lib/network-automations.ts decides WHAT should happen. This applies it, and
// keeps three promises the pure half cannot:
//
//   1. A firing happens once. The run row is CLAIMED before any action runs,
//      and the unique index on (automation_id, entity_id, dedupe_key) is what
//      refuses the second attempt. A client retry, two overlapping sweeps, or
//      an event evaluated twice all lose the insert and do nothing.
//
//   2. An automation never breaks the edit that triggered it. Every call here
//      is wrapped: a rule with a bad action, a failed insert, or a table that
//      is not there yet produces a logged run and a warning, never a 500 on
//      the member's PATCH. Someone moving a deal should not be told their move
//      failed because a rule an admin wrote last month is broken.
//
//   3. Actions do not cascade. A rule that moves a stage does NOT re-enter the
//      evaluator, because applyAction writes through the supabase client
//      directly rather than through the routes that evaluate triggers. Two
//      rules that each move the other's stage would otherwise run until one of
//      them hit a rate limit. One pass, always.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  automationDedupeKey,
  conditionsHold,
  isScheduledTrigger,
  mapAutomation,
  planActions,
  triggerMatches,
  TRIGGER_ENTITY,
  type Automation,
  type PlannedAction,
  type ScheduledTrigger,
  type Snapshot,
  type TriggerEvent,
  type TriggerType,
} from "@/lib/network-automations";

const AUTOMATION_SELECT =
  "id, name, description, enabled, trigger_type, trigger_config, conditions, actions, " +
  "run_count, last_run_at, last_error, created_by, created_at, updated_at";

/** No org gets to run an unbounded number of rules on one edit. Ten rules on a
 *  single trigger is already far past what a firm configures on purpose, and
 *  the cap keeps a misconfigured workspace from turning every deal move into
 *  fifty writes. */
const MAX_RULES_PER_TRIGGER = 10;

/** How many rows one scheduled rule may act on in a single sweep. The sweep is
 *  hourly, so a large backlog drains over the following hours rather than
 *  trying to raise a thousand tasks in one request. */
export const MAX_SWEEP_ROWS_PER_RULE = 50;

export type EngineContext = {
  supabase: SupabaseClient;
  orgId: string;
  /** The member whose action triggered this, or null for the scheduled sweep.
   *  Used as the actor on anything the rule writes, so the timeline reads
   *  "logged when Dana moved the deal" rather than coming from nowhere. */
  actorId: string | null;
  /** True when this is the cron sweep holding a service-role client.
   *
   *  It changes how two writes are made, and getting it wrong is silent: the
   *  helper functions below are SECURITY DEFINER and gated on the caller being
   *  a member of the org, which the service role is not — auth.uid() is null
   *  for it, so current_principal_org_ids() is empty and the UPDATE would
   *  match zero rows without erroring. Every run the sweep started would sit
   *  at its claimed status forever. The service client bypasses RLS anyway, so
   *  it writes the tables directly instead. */
  serviceRole?: boolean;
};

type ActionResult = { action: string; ok: boolean; detail?: string };

/** Rules of one trigger type for one org, enabled only. Never throws. */
async function loadRules(
  ctx: EngineContext,
  triggerType: TriggerType,
): Promise<Automation[]> {
  const { data, error } = await ctx.supabase
    .from("network_automations")
    .select(AUTOMATION_SELECT)
    .eq("organization_id", ctx.orgId)
    .eq("trigger_type", triggerType)
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .limit(MAX_RULES_PER_TRIGGER);

  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapAutomation);
}

/**
 * Claim a firing. Returns the run id, or null when this exact firing has
 * already been claimed.
 *
 * The insert IS the lock. A select-then-insert would let two sweeps both see
 * "not yet run" and both proceed; here the second insert violates the unique
 * index and comes back as a duplicate, which is the answer we want.
 */
async function claimRun(
  ctx: EngineContext,
  automation: Automation,
  entityId: string,
  entityLabel: string | null,
  dedupeKey: string,
): Promise<string | null> {
  const entityType = TRIGGER_ENTITY[automation.triggerType];

  if (ctx.serviceRole) {
    // The sweep bypasses RLS, so it inserts directly. It has no principal, so
    // claimed_by stays null: this run was made for the organization, not for
    // any member.
    const { data, error } = await ctx.supabase
      .from("network_automation_runs")
      .insert({
        organization_id: ctx.orgId,
        automation_id: automation.id,
        entity_type: entityType,
        entity_id: entityId,
        entity_label: entityLabel,
        status: "processing",
        dedupe_key: dedupeKey,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      // 23505 — the unique index refused it, so somebody else already has this
      // firing. That is a successful outcome, not a failure.
      if ((error as { code?: string }).code === "23505") return null;
      throw error;
    }
    return data ? String((data as { id: unknown }).id) : null;
  }

  // Members have no insert policy on the run log — an open one let anyone forge
  // a history entry, or take a real firing's dedupe key and make the genuine
  // run lose the index and silently do nothing. The function decides what the
  // row may say, stamps claimed_by from auth.uid(), and returns null when the
  // firing is already claimed.
  const { data, error } = await ctx.supabase.rpc("network_automation_claim_run", {
    target_org: ctx.orgId,
    target_automation: automation.id,
    run_entity_type: entityType,
    run_entity_id: entityId,
    run_entity_label: entityLabel,
    run_dedupe_key: dedupeKey,
  });

  if (error) throw error;
  return data ? String(data) : null;
}

async function finishRun(
  ctx: EngineContext,
  runId: string,
  status: "applied" | "skipped" | "failed",
  results: ActionResult[],
  error: string | null,
): Promise<void> {
  if (ctx.serviceRole) {
    const { error: updateError } = await ctx.supabase
      .from("network_automation_runs")
      .update({ status, results, error })
      .eq("organization_id", ctx.orgId)
      .eq("id", runId);
    if (updateError) console.warn("[network-automations] could not close out run", runId, updateError);
    return;
  }
  const { error: rpcError } = await ctx.supabase.rpc("network_automation_run_finish", {
    target_org: ctx.orgId,
    target_run: runId,
    run_status: status,
    run_results: results,
    run_error: error,
  });
  if (rpcError) console.warn("[network-automations] could not close out run", runId, rpcError);
}

async function recordFiring(
  ctx: EngineContext,
  automation: Automation,
  error: string | null,
): Promise<void> {
  if (ctx.serviceRole) {
    // run_count is read-then-written here rather than incremented in SQL,
    // because the service role cannot use the member-gated RPC below.
    //
    // The rule is loaded ONCE and then fired against many candidate rows, so
    // the in-memory count has to advance with each write. Without that, fifty
    // applied rows each wrote `loaded + 1` and the counter finished the sweep
    // one higher than it started — a rule doing fifty things a night reporting
    // that it had done one.
    //
    // A concurrent member edit firing the same rule can still cost one
    // increment. That is a wrong number on a display field, not lost work.
    const { error: updateError } = await ctx.supabase
      .from("network_automations")
      .update({
        run_count: automation.runCount + 1,
        last_run_at: new Date().toISOString(),
        last_error: error,
      })
      .eq("organization_id", ctx.orgId)
      .eq("id", automation.id);
    if (updateError) {
      console.warn("[network-automations] could not count the run", automation.id, updateError);
      return;
    }
    automation.runCount += 1;
    return;
  }
  const { error: rpcError } = await ctx.supabase.rpc("network_automation_record_run", {
    target_org: ctx.orgId,
    target_automation: automation.id,
    ran_at: new Date().toISOString(),
    run_error: error,
  });
  if (rpcError) {
    console.warn("[network-automations] could not count the run", automation.id, rpcError);
  }
}

/**
 * Apply one planned action. Returns its outcome rather than throwing, so a
 * rule with three actions where the second fails still runs the third and the
 * run log shows exactly which one broke.
 */
async function applyAction(
  ctx: EngineContext,
  action: PlannedAction,
  entity: { type: "opportunity" | "contact" | "task"; id: string; snapshot: Snapshot },
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "create_task": {
        const { error } = await ctx.supabase.from("network_tasks").insert({
          organization_id: ctx.orgId,
          // A task raised about a deal links to the deal AND to its
          // counterparty, so it shows on the record page as well as the queue.
          opportunity_id: entity.type === "opportunity" ? entity.id : null,
          contact_id:
            entity.type === "contact"
              ? entity.id
              : (entity.snapshot.contact_id as string | null) ?? null,
          investor_id: (entity.snapshot.investor_id as string | null) ?? null,
          title: action.title,
          notes: action.notes,
          assignee_id: action.assigneeId,
          created_by: ctx.actorId,
          due_at: action.dueAt,
          priority: action.priority,
          status: "open",
        });
        if (error) throw error;
        return { action: "create_task", ok: true, detail: action.title };
      }

      case "log_activity": {
        const contactId =
          entity.type === "contact"
            ? entity.id
            : ((entity.snapshot.contact_id as string | null) ?? null);
        const investorId = (entity.snapshot.investor_id as string | null) ?? null;
        // network_activities requires a contact or an investor. A deal with
        // neither cannot exist, but a task's snapshot may carry neither, and
        // inserting would fail the check constraint with a confusing error.
        if (!contactId && !investorId) {
          return {
            action: "log_activity",
            ok: false,
            detail: "Nothing to attach the entry to.",
          };
        }
        const { error } = await ctx.supabase.from("network_activities").insert({
          organization_id: ctx.orgId,
          contact_id: contactId,
          investor_id: investorId,
          opportunity_id: entity.type === "opportunity" ? entity.id : null,
          actor_id: ctx.actorId,
          activity_type: action.activityType,
          subject: action.subject,
          body: action.body,
          // System entries are not editable by hand, which is right: this is
          // the record of what a rule did, not somebody's note.
          is_system: true,
          metadata: { automation: true },
        });
        if (error) throw error;
        return { action: "log_activity", ok: true, detail: action.subject };
      }

      case "set_stage": {
        // Only contacts. Moving a DEAL's stage from a rule is deliberately not
        // supported: network_opportunities ties stage to status, closed_at and
        // probability through check constraints, and the route that maintains
        // those invariants is buildOpportunityPatch. A rule writing the column
        // directly would either violate the constraint or quietly produce a
        // won deal with no close date.
        if (entity.type !== "contact") {
          return {
            action: "set_stage",
            ok: false,
            detail: "A rule can move a contact's stage, not a deal's.",
          };
        }
        const { error, count } = await ctx.supabase
          .from("network_contacts")
          .update({ stage: action.stage }, { count: "exact" })
          .eq("organization_id", ctx.orgId)
          .eq("id", entity.id);
        if (error) throw error;
        if (!count) return { action: "set_stage", ok: false, detail: "The row could not be updated." };
        return { action: "set_stage", ok: true, detail: action.stage };
      }

      case "set_owner": {
        // Each object names its owner differently, and picking the table by
        // "contact or not" would have sent a task's id to
        // network_opportunities — matching nothing, erroring on nothing, and
        // reporting success for an assignment that never happened.
        const [table, column] =
          entity.type === "contact"
            ? (["network_contacts", "relationship_owner"] as const)
            : entity.type === "task"
              ? (["network_tasks", "assignee_id"] as const)
              : (["network_opportunities", "owner_id"] as const);
        const { error, count } = await ctx.supabase
          .from(table)
          .update({ [column]: action.ownerId }, { count: "exact" })
          .eq("organization_id", ctx.orgId)
          .eq("id", entity.id);
        if (error) throw error;
        // RLS refusing the write comes back as zero rows rather than an error,
        // and a run log that says "reassigned" when nothing moved is worse
        // than one that says it could not.
        if (!count) return { action: "set_owner", ok: false, detail: "The row could not be updated." };
        return { action: "set_owner", ok: true };
      }

      case "set_field": {
        if (entity.type === "task") {
          return { action: "set_field", ok: false, detail: "Tasks have no custom columns." };
        }
        const rpc =
          entity.type === "contact"
            ? "network_contact_merge_custom"
            : "network_opportunity_merge_custom";
        const target = entity.type === "contact" ? "target_contact" : "target_opportunity";
        // Through the merge RPC rather than a read-modify-write, so setting one
        // column does not erase a concurrent edit to another on the same row.
        const { error } = await ctx.supabase.rpc(rpc, {
          target_org: ctx.orgId,
          [target]: entity.id,
          patch: { [action.key]: action.value },
          remove_keys: [],
        });
        if (error) throw error;
        return { action: "set_field", ok: true, detail: action.key };
      }

      case "add_tag": {
        if (entity.type === "task") {
          return { action: "add_tag", ok: false, detail: "Tasks are not tagged." };
        }
        const table = entity.type === "contact" ? "network_contacts" : "network_opportunities";
        // planActions already dropped the action when the tag is present, so
        // this is the current list plus one. Re-reading the row first would be
        // a read-modify-write on an array; the snapshot is from the same
        // request, which is close enough for a tag and cannot lose a value
        // that was there when the rule was evaluated.
        const existing = Array.isArray(entity.snapshot.tags)
          ? (entity.snapshot.tags as unknown[]).map(String)
          : [];
        const { error, count } = await ctx.supabase
          .from(table)
          .update({ tags: [...existing, action.tag] }, { count: "exact" })
          .eq("organization_id", ctx.orgId)
          .eq("id", entity.id);
        if (error) throw error;
        if (!count) return { action: "add_tag", ok: false, detail: "The row could not be updated." };
        // Keep the snapshot in step. planActions plans both tags of a two-tag
        // rule because neither is in the snapshot; without this the second
        // write sends [...existing, "B"] and erases the "A" the first one just
        // added, while the run log reports both as successful.
        (entity.snapshot as Record<string, unknown>).tags = [...existing, action.tag];
        return { action: "add_tag", ok: true, detail: action.tag };
      }

      default:
        return { action: "unknown", ok: false, detail: "Unknown action." };
    }
  } catch (err) {
    return {
      action: action.type,
      ok: false,
      detail: err instanceof Error ? err.message : "failed",
    };
  }
}

/**
 * Run one rule against one row.
 *
 * `recordSkips` decides what a failed condition costs. On the event path it is
 * true: the mutation happened once, the rule considered it once, and a run row
 * saying "skipped" is how an admin tells "my rule is not matching" from "my
 * rule is not running". On the scheduled path it is false, and this is not a
 * preference — the claim and the skip share one key, so recording a skip would
 * consume the day's claim. A deal that fails the conditions at 09:00 and
 * passes them at 15:00 would never fire, and the run log would show a skip as
 * the reason with no way to see that the row later qualified.
 */
async function runRule(
  ctx: EngineContext,
  automation: Automation,
  entityId: string,
  entityLabel: string | null,
  snapshot: Snapshot,
  dedupeKey: string,
  extras: Record<string, unknown>,
  recordSkips: boolean,
): Promise<"applied" | "skipped" | "duplicate" | "failed"> {
  const entityType = TRIGGER_ENTITY[automation.triggerType];

  const holds = conditionsHold(automation.conditions, snapshot);
  if (!holds && !recordSkips) return "skipped";

  const runId = await claimRun(ctx, automation, entityId, entityLabel, dedupeKey);
  if (!runId) return "duplicate";

  if (!holds) {
    await finishRun(ctx, runId, "skipped", [], null);
    return "skipped";
  }

  const { planned, skipped } = planActions(automation.actions, {
    snapshot,
    ruleAuthorId: automation.createdBy,
    now: new Date(),
    extras,
  });

  const results: ActionResult[] = skipped.map((s) => ({
    action: s.action,
    ok: false,
    detail: s.reason,
  }));

  for (const action of planned) {
    results.push(await applyAction(ctx, action, { type: entityType, id: entityId, snapshot }));
  }

  const failures = results.filter((r) => !r.ok);
  const status = results.length > 0 && failures.length === results.length ? "failed" : "applied";
  const errorText = failures.length > 0 ? failures.map((f) => f.detail ?? f.action).join("; ") : null;

  await finishRun(ctx, runId, status, results, errorText);
  await recordFiring(ctx, automation, errorText);

  return status === "failed" ? "failed" : "applied";
}

// ── The event path ───────────────────────────────────────────────────────────

/**
 * Evaluate the rules that watch an event, immediately after the write that
 * caused it.
 *
 * Never throws. The caller has already committed the member's edit; an
 * automation problem is logged and reported in the run log, and the edit still
 * answers 200. That is a deliberate trade: a rule silently not running is
 * recoverable, telling a member their deal move failed is not.
 *
 * Returns a small summary so a route can include it in its response if it
 * wants to tell the UI that something else happened.
 */
export async function runEventAutomations(
  ctx: EngineContext,
  event: TriggerEvent,
): Promise<{ applied: number; skipped: number; failed: number }> {
  const tally = { applied: 0, skipped: 0, failed: 0 };

  try {
    // Which rule types could possibly match this event. Asking for exactly
    // these keeps a deal edit from reading every rule in the workspace.
    const triggerTypes: TriggerType[] =
      event.kind === "opportunity_created"
        ? ["opportunity_created"]
        : event.kind === "opportunity_stage_changed"
          ? ["opportunity_stage_changed", "opportunity_won", "opportunity_lost"]
          : event.kind === "contact_stage_changed"
            ? ["contact_stage_changed"]
            : ["task_completed"];

    const rules = (await Promise.all(triggerTypes.map((t) => loadRules(ctx, t)))).flat();
    if (rules.length === 0) return tally;

    const entityId = String(event.snapshot.id ?? "");
    if (!entityId) return tally;
    const entityLabel =
      typeof event.snapshot.name === "string" ? event.snapshot.name.slice(0, 200) : null;

    for (const rule of rules) {
      if (!triggerMatches(rule, event)) continue;

      // The row's version is the firing's identity: one mutation fires a rule
      // once however many times this is evaluated, and the next genuine edit
      // carries a new version and fires again.
      const version =
        typeof event.snapshot.updated_at === "string" ? event.snapshot.updated_at : null;
      const key = automationDedupeKey(rule.triggerType, { version });

      const extras =
        event.kind === "opportunity_stage_changed" || event.kind === "contact_stage_changed"
          ? { from: event.from, to: event.to }
          : {};

      const outcome = await runRule(
        ctx,
        rule,
        entityId,
        entityLabel,
        event.snapshot,
        key,
        extras,
        true,
      );
      if (outcome === "applied") tally.applied += 1;
      else if (outcome === "skipped") tally.skipped += 1;
      else if (outcome === "failed") tally.failed += 1;
    }
  } catch (err) {
    // Including "the table does not exist yet" — a deploy where the app is
    // ahead of the migration should degrade to no automations, not to a
    // workspace where nobody can move a deal.
    console.warn("[network-automations] event evaluation failed", err);
  }

  return tally;
}

// ── The scheduled path ───────────────────────────────────────────────────────

export type SweepStats = {
  orgs: number;
  rules: number;
  applied: number;
  skipped: number;
  duplicates: number;
  failed: number;
};

/**
 * Run one org's scheduled rules.
 *
 * Candidates come from network_automation_candidates(), which answers all
 * three time-based questions in one query per rule and compares days as plain
 * UTC dates — the same arithmetic the dashboard tiles use, so "quiet for 21
 * days" means the same thing in both places.
 *
 * The dedupe key is the UTC day, so a rule raises at most one follow-up per
 * row per day however often the sweep runs. That is the behaviour a firm
 * wants: "keep telling me while this is true" once a day, not once ever.
 */
export async function runScheduledAutomationsForOrg(
  ctx: EngineContext,
  now: Date = new Date(),
): Promise<SweepStats> {
  const stats: SweepStats = { orgs: 1, rules: 0, applied: 0, skipped: 0, duplicates: 0, failed: 0 };

  const scheduled: ScheduledTrigger[] = [
    "opportunity_idle",
    "contact_going_cold",
    "close_date_approaching",
  ];

  for (const trigger of scheduled) {
    let rules: Automation[];
    try {
      rules = await loadRules(ctx, trigger);
    } catch (err) {
      console.warn("[network-automations] sweep could not read rules", trigger, err);
      continue;
    }

    for (const rule of rules) {
      stats.rules += 1;
      const days =
        typeof rule.triggerConfig.days === "number" && rule.triggerConfig.days > 0
          ? rule.triggerConfig.days
          : null;
      if (!days) {
        console.warn("[network-automations] rule has no day threshold", rule.id);
        continue;
      }

      let candidates: { entity_id: string; entity_label: string | null; snapshot: Snapshot }[];
      try {
        const { data, error } = await ctx.supabase.rpc("network_automation_candidates", {
          target_org: ctx.orgId,
          kind: trigger,
          threshold_days: days,
        });
        if (error) throw error;
        candidates = (data ?? []) as typeof candidates;
      } catch (err) {
        console.warn("[network-automations] candidate query failed", rule.id, err);
        continue;
      }

      for (const candidate of candidates.slice(0, MAX_SWEEP_ROWS_PER_RULE)) {
        const key = automationDedupeKey(trigger, { now });
        let outcome: Awaited<ReturnType<typeof runRule>>;
        try {
          outcome = await runRule(
            ctx,
            rule,
            candidate.entity_id,
            candidate.entity_label,
            candidate.snapshot ?? {},
            key,
            { days },
            false,
          );
        } catch (err) {
          console.warn("[network-automations] rule failed", rule.id, candidate.entity_id, err);
          stats.failed += 1;
          continue;
        }
        if (outcome === "applied") stats.applied += 1;
        else if (outcome === "skipped") stats.skipped += 1;
        else if (outcome === "duplicate") stats.duplicates += 1;
        else stats.failed += 1;
      }
    }
  }

  return stats;
}

/**
 * Which orgs have any scheduled rule at all.
 *
 * The sweep runs as the service role across every tenant, so it has to start
 * from the rules rather than from the org list: a firm with no automations
 * should cost the sweep nothing.
 */
export async function findOrgsWithScheduledRules(
  supabase: SupabaseClient,
  limit = 100,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("network_automations")
    .select("organization_id")
    .eq("enabled", true)
    .in("trigger_type", ["opportunity_idle", "contact_going_cold", "close_date_approaching"])
    .limit(limit * 20);

  if (error) throw error;
  const seen = new Set<string>();
  for (const row of (data ?? []) as { organization_id: string }[]) {
    seen.add(row.organization_id);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/** Every org's scheduled rules, for the hourly cron. Never throws. */
export async function runScheduledAutomationsAllOrgs(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<SweepStats> {
  const total: SweepStats = { orgs: 0, rules: 0, applied: 0, skipped: 0, duplicates: 0, failed: 0 };
  try {
    const orgs = await findOrgsWithScheduledRules(supabase);
    for (const orgId of orgs) {
      try {
        const stats = await runScheduledAutomationsForOrg(
          // actorId null: the sweep acts for the organization, not for a
          // member. Anything it writes shows as system-authored, which is
          // honest — nobody pressed a button.
          { supabase, orgId, actorId: null, serviceRole: true },
          now,
        );
        total.orgs += 1;
        total.rules += stats.rules;
        total.applied += stats.applied;
        total.skipped += stats.skipped;
        total.duplicates += stats.duplicates;
        total.failed += stats.failed;
      } catch (err) {
        console.warn("[network-automations] org sweep failed", orgId, err);
      }
    }
  } catch (err) {
    console.warn("[network-automations] sweep failed", err);
  }
  return total;
}

/** Re-exported so routes import one module. */
export { isScheduledTrigger };
