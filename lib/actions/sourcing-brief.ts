'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';

/* ============================================================================
 * lib/actions/sourcing-brief.ts — write paths for the standing sourcing brief.
 *
 * saveSourcingBrief      — upsert the org's single brief (thesis + active flag).
 * setSourcingBriefActive — pause / resume the standing scout without losing the
 *                          thesis.
 * Both are RLS-scoped via the request client. The brief only seeds Action-Queue
 * proposals on the cron; nothing here executes a run.
 * ========================================================================= */

const MAX_THESIS = 1200;

export type SourcingBriefResult = { ok: true } | { ok: false; error: string };

export async function saveSourcingBrief(input: {
  thesis: string;
  active?: boolean;
}): Promise<SourcingBriefResult> {
  const thesis = input.thesis?.trim();
  if (!thesis) return { ok: false, error: 'Describe the mandate you want scouted.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { error } = await supabase.from('sourcing_briefs').upsert(
    {
      org_id: org.orgId,
      thesis: thesis.slice(0, MAX_THESIS),
      active: input.active ?? true
    },
    { onConflict: 'org_id' }
  );

  if (error) return { ok: false, error: error.message };
  revalidatePath('/source/pipeline');
  return { ok: true };
}

export async function setSourcingBriefActive(active: boolean): Promise<SourcingBriefResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sourcing_briefs')
    .update({ active })
    .eq('org_id', org.orgId)
    .select('id');

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'Set a brief first.' };
  revalidatePath('/source/pipeline');
  return { ok: true };
}
