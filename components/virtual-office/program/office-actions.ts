"use server";

// Server actions for the AI Execution Floor's best-effort persistence.
//
// These back the OfficePersistenceSink registered by the React layer: they
// mirror routed workflows and the append-only audit trail into the org-scoped
// office_workflows / office_audit_log tables (migration
// 20260707130000_office_program.sql). Every action is server-authorized —
// getSessionContext resolves the TRUSTED org + membership role, mutations
// require a writer role, and RLS enforces the same boundary at the database.
//
// All writes are best-effort by contract: on any failure they return
// { ok: false } instead of throwing, so the floor degrades gracefully to its
// in-memory behavior and /virtual-office never breaks.

import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import {
  auditEventToRow,
  workflowToRow,
  type AuditEvent,
  type OfficeWorkflow,
  type OfficeWorkflowRow,
} from "./officeProgram";
import type { MemberRole } from "@/lib/supabase/database.types";

export type OfficeActionResult = { ok: boolean; error?: string };

const WRITER_ROLES: ReadonlyArray<MemberRole> = ["owner", "admin", "member"];

function isWriter(role: MemberRole | null): boolean {
  return role !== null && WRITER_ROLES.includes(role);
}

// office_workflows / office_audit_log aren't in the generated Database types
// yet (regenerate once the migration is applied), so the strongly-typed from()
// overloads reject the names. A narrow loose facade keeps these best-effort
// reads/writes compiling without weakening types elsewhere — same approach the
// repo uses for other not-yet-generated tables/RPCs.
type LooseResult = { data: unknown[] | null; error: { message: string } | null };
type LooseTable = {
  upsert: (rows: unknown, opts?: { onConflict?: string }) => Promise<{ error: { message: string } | null }>;
  insert: (rows: unknown) => Promise<{ error: { message: string } | null }>;
  select: (cols: string) => {
    eq: (col: string, val: string) => {
      order: (col: string, opts: { ascending: boolean }) => {
        limit: (n: number) => Promise<LooseResult>;
      };
    };
  };
};
type LooseFrom = (table: string) => LooseTable;

/**
 * Persist a workflow snapshot (created → archived) for the caller's org.
 * Upsert on (organization_id, workflow_key) so the same workflow updates in
 * place. Requires a writer role; RLS is the backstop.
 */
export async function persistOfficeWorkflow(
  wf: OfficeWorkflow,
  outcome: "complete" | "rejected" | null,
): Promise<OfficeActionResult> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { ok: false, error: "No active organization" };
    if (!isWriter(ctx.role)) return { ok: false, error: "Not authorized to write office workflows" };

    const supabase = await createServerClient();
    const from = supabase.from.bind(supabase) as unknown as LooseFrom;
    const row = { ...workflowToRow(ctx.orgId, wf, outcome), created_by: ctx.userId };
    const { error } = await from("office_workflows").upsert(row, {
      onConflict: "organization_id,workflow_key",
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "persist failed" };
  }
}

/**
 * Append audit events for the caller's org into the append-only log. Idempotent
 * on (organization_id, event_key) — a retried flush upserts the same rows.
 * Requires a writer role; RLS is the backstop.
 */
export async function appendOfficeAuditEvents(events: AuditEvent[]): Promise<OfficeActionResult> {
  try {
    if (events.length === 0) return { ok: true };
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return { ok: false, error: "No active organization" };
    if (!isWriter(ctx.role)) return { ok: false, error: "Not authorized to write office audit" };

    const supabase = await createServerClient();
    const from = supabase.from.bind(supabase) as unknown as LooseFrom;
    const rows = events.map((ev) => ({ ...auditEventToRow(ctx.orgId!, ev), recorded_by: ctx.userId }));
    const { error } = await from("office_audit_log").upsert(rows, {
      onConflict: "organization_id,event_key",
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "append failed" };
  }
}

/**
 * Read the caller's recent office workflows (best-effort). Returns an empty
 * list on any failure so callers can hydrate optimistically without risk.
 */
export async function loadOfficeWorkflows(limit = 20): Promise<OfficeWorkflowRow[]> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return [];
    const supabase = await createServerClient();
    const from = supabase.from.bind(supabase) as unknown as LooseFrom;
    const { data, error } = await from("office_workflows")
      .select(
        "organization_id, workflow_key, title, command_text, intent, mode, stage, risk_tier, progress, active_rooms, assignment_count, outcome, completed_at",
      )
      .eq("organization_id", ctx.orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as OfficeWorkflowRow[];
  } catch {
    return [];
  }
}
