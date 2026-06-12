'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { nextLpStage, normalizeLpStage, type LpStageKey } from '@/lib/pipeline/lp-stages';

/* ============================================================================
 * lib/pipeline/actions.ts — the Capital Map's approve-loop write path.
 *
 * advanceLpStage is the server-enforced stage gate behind every "with Earn"
 * move on the LP Capital Map: the current stage is read from the row (never
 * trusted from the client), the LP advances exactly one stage along the
 * canonical order, and Committed is terminal. The update is conditioned on
 * the status it read, so a concurrent move can't double-advance.
 * ========================================================================= */

export type AdvanceLpStageResult = { ok: true; to: LpStageKey } | { ok: false; error: string };

export async function advanceLpStage(input: { id: string }): Promise<AdvanceLpStageResult> {
  if (!input?.id) return { ok: false, error: 'Missing LP.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from('capital_providers')
    .select('id, status')
    .eq('id', input.id)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: 'LP not found.' };

  const stage = normalizeLpStage(row.status);
  if (stage === 'passed') return { ok: false, error: 'This LP has passed.' };
  const to = nextLpStage(stage);
  if (!to) return { ok: false, error: 'Already committed.' };

  const { data: updated, error: updateError } = await supabase
    .from('capital_providers')
    .update({ status: to })
    .eq('id', input.id)
    .eq('org_id', org.orgId)
    .eq('status', row.status)
    .select('id');
  if (updateError) return { ok: false, error: updateError.message };
  if (!updated?.length) return { ok: false, error: 'The stage just changed — refresh the map.' };

  return { ok: true, to };
}
