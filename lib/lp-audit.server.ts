// lib/lp-audit.server.ts
// Writes the audit events the app records itself (see lib/lp-audit.ts). The audit
// log's table privileges let only the service role insert, so this takes a
// service client.
//
// An audit write is never allowed to stop what it describes: any failure is
// logged and the action carries on. (The triggers that cover the rest of the
// log cannot be skipped by a code path; these are the events no trigger sees.)
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditRow, sessionsToLogViews, VIEW_DEDUPE_MS, type AuditEvent } from "@/lib/lp-audit";

type Client = SupabaseClient<any, any, any>;

/** True if the event was recorded. Never throws. */
export async function recordAudit(client: Client, event: AuditEvent): Promise<boolean> {
  try {
    const row = auditRow(event);
    if (!row) {
      console.error("[lp-audit] refused an event it may not write", { action: event.action });
      return false;
    }
    const { error } = await client.from("onboarding_audit_log").insert(row);
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.error("[lp-audit] could not record", { action: event.action }, err);
    return false;
  }
}

/**
 * Records that an owner or admin was shown these LPs' details (SOC 2 gap G-2: reads
 * used to leave no trace). One entry per person, LP and hour, so a page that
 * refreshes does not write a row each time. Never throws; returns how many were written.
 */
export async function recordReviewViews(
  client: Client,
  opts: { orgId: string; actorId: string; sessionIds: readonly string[]; now?: number },
): Promise<number> {
  try {
    if (opts.sessionIds.length === 0) return 0;
    const since = new Date((opts.now ?? Date.now()) - VIEW_DEDUPE_MS).toISOString();
    const { data, error } = await client
      .from("onboarding_audit_log")
      .select("session_id")
      .eq("organization_id", opts.orgId)
      .eq("action", "data.viewed")
      .eq("actor_id", opts.actorId)
      .gte("created_at", since)
      .in("session_id", [...opts.sessionIds]);
    if (error) throw new Error(error.message);
    const todo = sessionsToLogViews(opts.sessionIds, ((data ?? []) as Array<{ session_id: string }>).map((r) => r.session_id));
    if (todo.length === 0) return 0;
    const rows = todo
      .map((sessionId) => auditRow({ orgId: opts.orgId, sessionId, action: "data.viewed", actorKind: "user", actorId: opts.actorId }))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const { error: insertError } = await client.from("onboarding_audit_log").insert(rows);
    if (insertError) throw new Error(insertError.message);
    return rows.length;
  } catch (err) {
    console.error("[lp-audit] could not record views", err);
    return 0;
  }
}
