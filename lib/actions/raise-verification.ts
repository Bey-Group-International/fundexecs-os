'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getAuthUser } from '@/lib/queries/auth';

/* ============================================================================
 * lib/actions/raise-verification.ts — owner/admin accreditation review.
 *
 * Sets the accredited-verification decision on a raise_interests row. Runs
 * under the authed server client, so the RLS policy ("owners update raise
 * interests" → private.is_org_admin) gates it to org owners/admins. Scoped by
 * org_id as defense-in-depth.
 * ========================================================================= */

export type VerificationDecision = 'verified' | 'rejected' | 'pending';
export type VerificationResult = { ok: true } | { ok: false; error: string };

const NOTE_MAX = 1000;

export async function setReservationVerification(
  interestId: string,
  decision: VerificationDecision,
  note?: string | null
): Promise<VerificationResult> {
  if (!interestId) return { ok: false, error: 'Missing reservation.' };
  if (decision !== 'verified' && decision !== 'rejected' && decision !== 'pending') {
    return { ok: false, error: 'Invalid decision.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const reviewerNote =
    typeof note === 'string' && note.trim() ? note.trim().slice(0, NOTE_MAX) : null;
  const user = await getAuthUser();
  const terminal = decision === 'verified' || decision === 'rejected';

  const supabase = await createClient();
  // Return the affected row so a 0-row update (wrong id, cross-org, or blocked by
  // RLS) surfaces as a failure rather than a false success.
  const { data, error } = await supabase
    .from('raise_interests')
    .update({
      verification_status: decision,
      reviewer_note: reviewerNote,
      verified_at: terminal ? new Date().toISOString() : null,
      verified_by: terminal ? (user?.id ?? null) : null
    })
    .eq('id', interestId)
    .eq('org_id', org.orgId)
    .select('id')
    .maybeSingle();

  if (error || !data) return { ok: false, error: 'Could not save the verification decision.' };
  revalidatePath('/capital-stack/reservations');
  return { ok: true };
}
