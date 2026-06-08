'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { recordLoopClose } from '@/lib/actions/loop';

/* ============================================================================
 * lib/actions/capital.ts — capital-commitment state transitions.
 *
 * Wave-1/2 seeded `capital_commitments` via matching RPCs but never exposed a
 * close path. `closeCommitment` is the first write surface: it marks a
 * commitment 'closed' and fires the Drive → Build flywheel (deployed capital is
 * proof of work). RLS-scoped to the active org; the flywheel write is
 * best-effort and never blocks the close.
 * ========================================================================= */

export type CloseCommitmentResult = { ok: true } | { ok: false; error: string };

/**
 * Mark a capital commitment 'closed' and close the loop. Idempotent at the
 * flywheel layer (a second close credits nothing). Scoped to the active org so
 * a member can only close their own commitments.
 */
export async function closeCommitment(commitmentId: string): Promise<CloseCommitmentResult> {
  if (!commitmentId) return { ok: false, error: 'Missing commitment id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('capital_commitments')
    .update({ stage: 'closed' })
    .eq('id', commitmentId)
    .eq('org_id', org.orgId)
    .select('id, amount')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Close failed.' };

  try {
    await recordLoopClose({
      source: 'capital_closed',
      entityType: 'capital_commitment',
      entityId: commitmentId,
      metadata: { amount: (data as { amount: number }).amount }
    });
  } catch {
    // Never block the close on the flywheel write.
  }

  revalidatePath('/capital-stack');
  revalidatePath('/', 'layout');
  return { ok: true };
}
