'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import type { Json } from '@/lib/supabase/database.types';
import { FORMATION_ITEMS, type FormationKind } from './config';
import { sanitizeFormationData } from './persistence';

/**
 * lib/formation/actions.ts — persistence for the copiloted formation flow.
 *
 * The operator drives this surface directly (no approve-modal middleman), so
 * writes are member-scoped through RLS. "Filing" remains illustrative — no
 * real filing leaves the platform; what persists is the operator's working
 * document and which steps they've completed, so the flow survives reloads
 * and the Build hub can read real progress.
 */

export type FormationActionResult = { ok: true; formed: boolean } | { ok: false; error: string };

const VALID_KINDS = new Set<FormationKind>(FORMATION_ITEMS.map((i) => i.kind));

/** Upsert the working document (the "Save & close" path). Best-effort. */
export async function saveFormationDraft(input: unknown): Promise<FormationActionResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const data = sanitizeFormationData(input) as unknown as Json;
  const { error } = await supabase
    .from('fund_formations')
    .upsert({ org_id: org.orgId, created_by: org.userId, data }, { onConflict: 'org_id' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/build/formation');
  return { ok: true, formed: false };
}

/**
 * Persist the working document and mark one step filed. Idempotent — refiling
 * a step updates `filed_at` rather than duplicating. When the seventh step
 * lands, the formation flips to `formed`.
 */
export async function fileFormationStep(
  kind: FormationKind,
  input: unknown
): Promise<FormationActionResult> {
  if (!VALID_KINDS.has(kind)) return { ok: false, error: 'Unknown formation step.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const data = sanitizeFormationData(input) as unknown as Json;

  const { error: docErr } = await supabase
    .from('fund_formations')
    .upsert({ org_id: org.orgId, created_by: org.userId, data }, { onConflict: 'org_id' });
  if (docErr) return { ok: false, error: docErr.message };

  const { error: stepErr } = await supabase
    .from('formation_steps')
    .upsert(
      { org_id: org.orgId, kind, filed_by: org.userId, filed_at: new Date().toISOString() },
      { onConflict: 'org_id,kind' }
    );
  if (stepErr) return { ok: false, error: stepErr.message };

  // Formed once every step kind is on the record.
  const { count } = await supabase
    .from('formation_steps')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', org.orgId);
  const formed = (count ?? 0) >= FORMATION_ITEMS.length;
  if (formed) {
    await supabase.from('fund_formations').update({ status: 'formed' }).eq('org_id', org.orgId);
  }

  revalidatePath('/build/formation');
  revalidatePath('/build');
  revalidatePath('/command-center');
  return { ok: true, formed };
}
