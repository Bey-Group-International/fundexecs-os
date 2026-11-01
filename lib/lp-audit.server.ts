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
import { auditRow, type AuditEvent } from "@/lib/lp-audit";

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
