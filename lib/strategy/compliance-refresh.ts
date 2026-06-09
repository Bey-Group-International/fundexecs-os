import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { COMPLIANCE_STALE_DAYS } from '@/lib/strategy/compliance';

/* ============================================================================
 * lib/strategy/compliance-refresh.ts — scheduled maintenance for the standing
 * compliance tier (blueprint Phase 4), run from the intelligence cron.
 *
 * For every active org, calls the SECURITY DEFINER refresh_compliance_tier RPC
 * which (a) ensures the never-empty Adrian-owned lane exists, (b) ages ignored
 * compliance objectives into High priority, and (c) drafts follow-up compliance
 * objectives from recent SEC Form ADV / Form D market signals. Never-block: a
 * per-org failure is counted, not thrown, so one bad org can't stall the cycle.
 * ========================================================================= */

type Admin = ReturnType<typeof createAdminClient>;

/** Distinct org ids that have at least one active member. */
async function activeOrgIds(admin: Admin): Promise<string[]> {
  const { data } = await admin.from('org_members').select('org_id').eq('status', 'active');
  return [...new Set((data ?? []).map((r) => r.org_id))];
}

export interface ComplianceRefreshSummary {
  /** Orgs whose compliance lane was ensured + refreshed. */
  orgs: number;
  /** Objectives created or escalated across all orgs. */
  touched: number;
  /** Orgs where the refresh RPC errored. */
  failed: number;
}

/** Refresh the standing compliance tier for every active org. */
export async function refreshComplianceTiers(): Promise<ComplianceRefreshSummary> {
  const admin = createAdminClient();
  const ids = await activeOrgIds(admin);

  // Call `.rpc` AS A METHOD on the client — detaching it loses its `this`
  // binding and it throws before issuing the request.
  const db = admin as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: number | null; error: { message: string } | null }>;
  };

  let orgs = 0;
  let touched = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const { data, error } = await db.rpc('refresh_compliance_tier', {
        _org: id,
        _stale_days: COMPLIANCE_STALE_DAYS
      });
      if (error) {
        failed++;
        console.warn('[refreshComplianceTiers] refresh_compliance_tier failed:', id, error.message);
      } else {
        orgs++;
        if (typeof data === 'number') touched += data;
      }
    } catch (err) {
      failed++;
      console.warn('[refreshComplianceTiers] refresh_compliance_tier threw:', id, err);
    }
  }
  return { orgs, touched, failed };
}
