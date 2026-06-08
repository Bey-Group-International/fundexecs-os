'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import type { Json } from '@/lib/supabase/database.types';
import { LP_STAGE_KEYS, type LpStageKey } from '@/lib/pipeline/lp-stages';

/* ============================================================================
 * lib/actions/lp-pipeline.ts — write paths for the LP Pipeline (capital_providers).
 *
 * adoptLp     — bring an AI-discovered LP into the pipeline: directory record
 *               (AI-enriched) + an intro/outreach request + an action-queue task
 *               assigned to the suggested specialist. Steps 2-3 never-block.
 * updateLpStage — quick stage move (Prospect → Contacted → Soft-circle →
 *               Committed → Passed) via the capital_providers status.
 * ========================================================================= */

export interface AdoptLpInput {
  name: string;
  capitalTypes?: string[];
  checkSizeMin?: number | null;
  checkSizeMax?: number | null;
  description?: string;
  fitRationale?: string;
  suggestedSpecialist?: string;
  firstTouchNote?: string;
}

export type AdoptLpResult = { ok: true; id: string } | { ok: false; error: string };

export async function adoptLp(input: AdoptLpInput): Promise<AdoptLpResult> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const specialist = input.suggestedSpecialist?.trim() || 'Capital Connector';
  const meta = {
    description: input.description?.trim() || null,
    fitRationale: input.fitRationale?.trim() || null,
    assignedSpecialist: specialist,
    firstTouchNote: input.firstTouchNote?.trim() || null,
    source: 'ai_lp_discovery',
    adoptedAt: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('capital_providers')
    .insert({
      org_id: org.orgId,
      name,
      status: 'prospect',
      capital_types: input.capitalTypes ?? [],
      check_size_min: input.checkSizeMin ?? null,
      check_size_max: input.checkSizeMax ?? null,
      criteria: meta as unknown as Json
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not add LP.' };
  const lpId = data.id;

  // (2) Track outreach as an intro request — never-block.
  try {
    await supabase.from('partner_intro_requests').insert({
      org_id: org.orgId,
      requester_id: org.userId,
      partner_id: lpId,
      partner_name: name,
      partner_type: 'capital_provider',
      rationale: input.fitRationale?.trim() || null,
      status: 'requested'
    });
  } catch {
    /* never-block: the LP is already saved */
  }

  // (3) Action-queue task assigned to the specialist — never-block.
  try {
    const admin = createAdminClient();
    await admin.from('notifications').insert({
      user_id: org.userId,
      org_id: org.orgId,
      type: 'lp_added',
      payload: {
        category: 'LP Pipeline',
        title: `${name} added to your LP pipeline`,
        body: `Assigned to ${specialist}. Next: send the first-touch note and move to Contacted.`,
        meta: 'Limited partner',
        href: '/pipeline'
      }
    });
  } catch {
    /* never-block */
  }

  return { ok: true, id: lpId };
}

export type UpdateLpStageResult = { ok: true } | { ok: false; error: string };

export async function updateLpStage(input: {
  id: string;
  stage: LpStageKey | 'passed';
}): Promise<UpdateLpStageResult> {
  if (!input.id) return { ok: false, error: 'Missing LP.' };
  if (!(LP_STAGE_KEYS as readonly string[]).includes(input.stage)) {
    return { ok: false, error: 'Invalid stage.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { error } = await supabase
    .from('capital_providers')
    .update({ status: input.stage })
    .eq('id', input.id)
    .eq('org_id', org.orgId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
