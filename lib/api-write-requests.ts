// Writes-as-approvals for the /api/v1 surface (audit P2 — API-surface design:
// "scoped writes that respect the Tier model — API writes create `approvals`
// rows instead of executing").
//
// A POST from an integrator never mutates the book directly. It parses into a
// whitelisted row, then parks as the same task + approval pair every other
// gated action in the OS uses — visible in the operator's existing approval
// surfaces. Approving executes exactly the parked insert under the deciding
// operator's RLS session; any other decision cancels it. The operator is never
// bypassed, and a leaked write-scoped key can propose rows but commit nothing.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type ApiWriteResource = "deals" | "investors";

/** The parked write, persisted verbatim on the approval task's `result`. */
export interface ApiWriteRequest {
  resource: ApiWriteResource;
  row: Record<string, string | number>;
  key_id: string;
  mode: string;
}

// Enum values mirror the DB types (deal_stage / investor_type in 0001_init.sql).
const DEAL_STAGES = [
  "sourced", "screening", "diligence", "underwriting", "ic_review",
  "closing", "owned", "exited", "passed", "dead",
] as const;
const INVESTOR_TYPES = [
  "lp", "family_office", "institution", "fund_of_funds", "lender",
  "bank", "co_gp", "other",
] as const;

type FieldSpec =
  | { kind: "string"; max?: number }
  | { kind: "number" }
  | { kind: "date" }
  | { kind: "enum"; values: readonly string[] };

interface ResourceSpec {
  /** Human noun for summaries: "deal", "investor". */
  noun: string;
  /** Where the approval surfaces (tasks.hub / tasks.assigned_agent). */
  hub: Database["public"]["Enums"]["hub"];
  agent: Database["public"]["Enums"]["agent_key"];
  fields: Record<string, FieldSpec>;
}

// The writable surface per resource — a strict whitelist. Anything not named
// here (fund_id, lead_principal, thesis_fit…) is rejected, not dropped: a
// typo'd field name failing loudly beats an integrator silently losing data.
const RESOURCES: Record<ApiWriteResource, ResourceSpec> = {
  deals: {
    noun: "deal",
    hub: "source",
    agent: "associate",
    fields: {
      name: { kind: "string", max: 200 },
      stage: { kind: "enum", values: DEAL_STAGES },
      asset_class: { kind: "string", max: 120 },
      geography: { kind: "string", max: 120 },
      target_amount: { kind: "number" },
      expected_close: { kind: "date" },
      source: { kind: "string", max: 200 },
      notes: { kind: "string", max: 4000 },
    },
  },
  investors: {
    noun: "investor",
    hub: "source",
    agent: "investor_relations",
    fields: {
      name: { kind: "string", max: 200 },
      investor_type: { kind: "enum", values: INVESTOR_TYPES },
      contact_name: { kind: "string", max: 200 },
      contact_email: { kind: "string", max: 320 },
      jurisdiction: { kind: "string", max: 120 },
      aum: { kind: "number" },
      typical_check_min: { kind: "number" },
      typical_check_max: { kind: "number" },
      pipeline_stage: { kind: "string", max: 60 },
      notes: { kind: "string", max: 4000 },
    },
  },
};

export type ParseResult =
  | { ok: true; row: Record<string, string | number> }
  | { ok: false; error: string };

/**
 * Validate an integrator-supplied body into an insertable row. `name` is
 * required on every resource; everything else is optional but must be in the
 * whitelist and well-typed. Never touches the database.
 */
export function parseApiWrite(resource: ApiWriteResource, body: unknown): ParseResult {
  const spec = RESOURCES[resource];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const row: Record<string, string | number> = {};
  for (const [key, raw] of Object.entries(body as Record<string, unknown>)) {
    const field = spec.fields[key];
    if (!field) return { ok: false, error: `Unknown field: ${key}` };
    if (raw === null || raw === undefined) continue;

    switch (field.kind) {
      case "string": {
        if (typeof raw !== "string" || !raw.trim()) {
          return { ok: false, error: `Field ${key} must be a non-empty string` };
        }
        if (field.max && raw.length > field.max) {
          return { ok: false, error: `Field ${key} exceeds ${field.max} characters` };
        }
        row[key] = raw.trim();
        break;
      }
      case "number": {
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
          return { ok: false, error: `Field ${key} must be a non-negative number` };
        }
        row[key] = raw;
        break;
      }
      case "date": {
        if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
          return { ok: false, error: `Field ${key} must be a YYYY-MM-DD date` };
        }
        row[key] = raw;
        break;
      }
      case "enum": {
        if (typeof raw !== "string" || !field.values.includes(raw)) {
          return { ok: false, error: `Field ${key} must be one of: ${field.values.join(", ")}` };
        }
        row[key] = raw;
        break;
      }
    }
  }

  if (typeof row.name !== "string") {
    return { ok: false, error: "Field name is required" };
  }
  return { ok: true, row };
}

export type QueueResult =
  | { ok: true; taskId: string; approvalId: string }
  | { ok: false; error: string };

/**
 * Park a validated write as the standard task + approval pair. The full row is
 * persisted on the task so the decision path replays it verbatim. The pair is
 * atomic from the caller's view: if the approval insert fails, the task is
 * deleted rather than left as an orphaned awaiting_approval row.
 */
export async function createApiWriteApproval(
  supabase: Client,
  args: { orgId: string; keyId: string; mode: string; resource: ApiWriteResource; row: Record<string, string | number> },
): Promise<QueueResult> {
  const spec = RESOURCES[args.resource];
  const request: ApiWriteRequest = {
    resource: args.resource,
    row: args.row,
    key_id: args.keyId,
    mode: args.mode,
  };

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .insert({
      organization_id: args.orgId,
      title: `API write — create ${spec.noun} "${args.row.name}"`,
      description: `An integration (API key ${args.keyId.slice(0, 8)}…, ${args.mode} mode) proposed creating this ${spec.noun}. Approving commits the row exactly as proposed; rejecting discards it.`,
      hub: spec.hub,
      assigned_agent: spec.agent,
      status: "awaiting_approval",
      progress: 0,
      requires_approval: true,
      result: { apiWriteRequest: request } as unknown as Json,
      created_by: null,
    })
    .select("id")
    .single();
  if (taskError || !task) {
    return { ok: false, error: "Could not queue the write for approval" };
  }

  const { data: approval, error: approvalError } = await supabase
    .from("approvals")
    .insert({
      organization_id: args.orgId,
      task_id: task.id,
      summary: `API write — create ${spec.noun} "${args.row.name}" (${args.mode} key)`,
    })
    .select("id")
    .single();
  if (approvalError || !approval) {
    await supabase.from("tasks").delete().eq("id", task.id);
    return { ok: false, error: "Could not queue the write for approval" };
  }

  return { ok: true, taskId: task.id, approvalId: approval.id };
}

/** Pull a parked API write off a task's result payload; null for every other task. */
export function extractApiWriteRequest(result: Json | null | undefined): ApiWriteRequest | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return null;
  const candidate = (result as Record<string, unknown>).apiWriteRequest;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return null;
  const req = candidate as Record<string, unknown>;
  if (req.resource !== "deals" && req.resource !== "investors") return null;
  if (typeof req.row !== "object" || req.row === null || Array.isArray(req.row)) return null;
  return {
    resource: req.resource,
    row: req.row as Record<string, string | number>,
    key_id: typeof req.key_id === "string" ? req.key_id : "",
    mode: typeof req.mode === "string" ? req.mode : "live",
  };
}

export type ExecuteResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Commit an approved API write. Runs under the DECIDING OPERATOR'S client (RLS
 * enforced under their session), not the API key's service context — the human
 * decision is what carries the write authority. The row is re-parsed on the
 * way in, so a payload tampered with while parked still can't smuggle fields
 * past the whitelist.
 */
export async function executeApiWrite(
  supabase: Client,
  orgId: string,
  request: ApiWriteRequest,
): Promise<ExecuteResult> {
  const parsed = parseApiWrite(request.resource, request.row);
  if (!parsed.ok) return { ok: false, error: `Parked write no longer valid: ${parsed.error}` };

  const { data, error } = await supabase
    .from(request.resource)
    .insert({ ...parsed.row, organization_id: orgId } as never)
    .select("id")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? `Could not create the ${RESOURCES[request.resource].noun}` };
  }
  return { ok: true, id: (data as { id: string }).id };
}
