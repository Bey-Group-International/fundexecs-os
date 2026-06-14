'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getMandate } from '@/lib/queries/mandate';
import { getFundProfile } from '@/lib/queries/fund-profile';
import type { Json } from '@/lib/supabase/database.types';
import { scoreLpFitWithEarn } from '@/lib/ai/lp-fit';
import type { LpFitResult } from '@/lib/capital-formation/lp-fit';

/* ============================================================================
 * lib/actions/lp-fit.ts — score an LP's fit for the raise and persist it.
 *
 * Reads the LP row (capital_providers) + the org's mandate + fund profile,
 * asks Earn (Sloane) for a calibrated 0–100 fit + warmth + rationale, then
 * merges the result into the LP's `criteria` jsonb (the slot `parseLpMeta`
 * already reads `fitScore`/`warmth`/`fitRationale` from). No schema change.
 * ========================================================================= */

export type ScoreLpFitResult = { ok: true; result: LpFitResult } | { ok: false; error: string };

export async function scoreLpFit(lpId: string): Promise<ScoreLpFitResult> {
  if (!lpId?.trim()) return { ok: false, error: 'Missing LP.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data: lp, error } = await supabase
    .from('capital_providers')
    .select('id, name, capital_types, check_size_min, check_size_max, criteria')
    .eq('id', lpId)
    .eq('org_id', org.orgId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!lp) return { ok: false, error: 'LP not found on your map.' };

  const [mandate, profile] = await Promise.all([
    getMandate(org.orgId).catch(() => null),
    getFundProfile(org.orgId).catch(() => null)
  ]);

  const result = await scoreLpFitWithEarn({
    lp: {
      name: lp.name,
      capitalTypes: lp.capital_types ?? [],
      checkSizeMin: lp.check_size_min,
      checkSizeMax: lp.check_size_max,
      description:
        (lp.criteria && typeof lp.criteria === 'object' && !Array.isArray(lp.criteria)
          ? ((lp.criteria as Record<string, unknown>).description as string | undefined)
          : undefined) ?? null
    },
    mandate: mandate
      ? {
          objective: mandate.objective,
          vehicle: mandate.vehicle,
          size: mandate.size,
          sectors: mandate.sectors ?? [],
          stage: mandate.stage,
          geo: mandate.geo
        }
      : null,
    fund: {
      name: profile?.fundName ?? org.orgId,
      thesis: profile?.thesis ?? null,
      strategy: profile?.strategy ?? null,
      targetRaise: profile?.targetRaise ?? null
    }
  });

  // Merge into existing criteria so discovery metadata (description, specialist,
  // first-touch note) survives the score write.
  const existing =
    lp.criteria && typeof lp.criteria === 'object' && !Array.isArray(lp.criteria)
      ? (lp.criteria as Record<string, unknown>)
      : {};
  const nextCriteria = {
    ...existing,
    fitScore: result.fit,
    warmth: result.warmth,
    fitRationale: result.rationale,
    fitScoredAt: new Date().toISOString()
  };

  const { error: writeError } = await supabase
    .from('capital_providers')
    .update({ criteria: nextCriteria as unknown as Json })
    .eq('id', lpId)
    .eq('org_id', org.orgId);

  if (writeError) return { ok: false, error: writeError.message };

  revalidatePath('/source/capital-map');
  revalidatePath('/source/pipeline');
  return { ok: true, result };
}
