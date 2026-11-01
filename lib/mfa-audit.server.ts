// Writes MFA audit events with the service role (the log has no insert policy for
// users). An audit failure never stops the action it describes; it is logged.
import "server-only";
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { mfaAuditRow, type MfaAuditEvent } from "@/lib/mfa-audit";

/** True if recorded. Never throws. */
export async function recordMfaAudit(event: MfaAuditEvent): Promise<boolean> {
  try {
    const row = mfaAuditRow(event);
    if (!row) return false;
    if (!hasSupabaseServiceEnv()) return false;
    const { error } = await (createServiceClient() as any).from("security_audit_log").insert(row);
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.error("[mfa-audit] could not record", { action: event.action }, err);
    return false;
  }
}

/** Times (ms) of this user's recent failed recovery attempts, for the lockout rule. */
export async function recentRecoveryFailures(userId: string, sinceMs: number): Promise<number[]> {
  try {
    const { data } = await (createServiceClient() as any)
      .from("security_audit_log")
      .select("created_at")
      .eq("user_id", userId)
      .eq("action", "mfa.recovery_failed")
      .gte("created_at", new Date(sinceMs).toISOString());
    return ((data ?? []) as { created_at: string }[]).map((r) => Date.parse(r.created_at));
  } catch {
    return [];
  }
}
