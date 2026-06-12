'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/lib/access.server';
import { getAuthUser } from '@/lib/queries/auth';
import { getActiveOrg } from '@/lib/queries/org';
import type { Json } from '@/lib/supabase/database.types';

export type AccessDecision = 'approved' | 'rejected' | 'pending';
export type AccessResult = { ok: true } | { ok: false; error: string };

const DECISIONS = new Set<AccessDecision>(['approved', 'rejected', 'pending']);

/**
 * Append a row to `admin_actions` recording an access decision (best-effort;
 * never blocks the decision). Scoped to the acting admin's own org so the audit
 * trail has an owner; the target is the applicant's auth user.
 */
async function writeAccessAudit(
  actorId: string,
  decision: AccessDecision,
  targetUserId: string
): Promise<void> {
  try {
    const org = await getActiveOrg().catch(() => null);
    if (!org) return;
    const admin = createAdminClient();
    await admin.from('admin_actions').insert({
      org_id: org.orgId,
      admin_user_id: actorId,
      action_type: `access_${decision}`,
      target_type: 'member_access',
      target_id: targetUserId,
      metadata: { decision } as Json
    });
  } catch {
    // Audit is best-effort — never block the primary decision.
  }
}

/**
 * Decide a member's beta access — the enforced gate the middleware reads. Flips
 * `member_profiles.access_status` and stamps who decided + when. Platform-admin
 * (Bey Group) only, via the service-role client so it can write across users;
 * the gate runs first so no one else can reach the write. `revalidatePath`
 * refreshes the Applications inbox; the member's own next request re-checks the
 * gate (no fast-path cookie is set while they're un-approved), so approval
 * takes effect immediately.
 */
export async function setMemberAccess(
  userId: string,
  decision: AccessDecision
): Promise<AccessResult> {
  if (!userId) return { ok: false, error: 'Missing member id.' };
  if (!DECISIONS.has(decision)) return { ok: false, error: 'Invalid decision.' };
  if (!(await requirePlatformAdmin())) {
    return { ok: false, error: 'Only the Bey Group team can decide beta access.' };
  }

  const actor = await getAuthUser();
  if (!actor) return { ok: false, error: 'Not signed in.' };

  const admin = createAdminClient();
  const { error } = await admin
    .from('member_profiles')
    .update({
      access_status: decision,
      // A reset to 'pending' clears the decision stamp so the row reads as
      // genuinely undecided again.
      access_decided_at: decision === 'pending' ? null : new Date().toISOString(),
      access_decided_by: decision === 'pending' ? null : actor.id
    })
    .eq('user_id', userId);
  if (error) return { ok: false, error: error.message };

  await writeAccessAudit(actor.id, decision, userId);

  revalidatePath('/admin');
  return { ok: true };
}
