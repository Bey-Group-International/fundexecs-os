import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { FORMATION_ITEMS, type FormationData, type FormationKind } from '@/lib/formation/config';
import { sanitizeFormationData } from '@/lib/formation/persistence';

/**
 * The org's persisted formation state — the working FormationData document
 * plus which of the seven steps have been filed. Request-cached so the Build
 * hub and the flow page share one read. Degrades to the fresh-start zero
 * state on any failure rather than throwing.
 */
export interface FormationState {
  data: FormationData;
  /** Item ids (per FORMATION_ITEMS) whose step has been filed. */
  completedIds: string[];
  formed: boolean;
}

export const getFormationState = cache(async (orgId: string): Promise<FormationState> => {
  const supabase = await createClient();
  const [{ data: formation }, { data: steps }] = await Promise.all([
    supabase.from('fund_formations').select('data, status').eq('org_id', orgId).maybeSingle(),
    supabase.from('formation_steps').select('kind').eq('org_id', orgId)
  ]);

  const kinds = new Set((steps ?? []).map((s) => s.kind));
  const completedIds = FORMATION_ITEMS.filter((i) => kinds.has(i.kind as FormationKind)).map(
    (i) => i.id
  );

  return {
    data: sanitizeFormationData(formation?.data),
    completedIds,
    formed: formation?.status === 'formed' || completedIds.length >= FORMATION_ITEMS.length
  };
});
