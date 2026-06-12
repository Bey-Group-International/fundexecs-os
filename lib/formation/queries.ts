import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { FORMATION_ITEMS, type FormationKind } from './config';
import type { FormationStepMeta } from './steps';

/**
 * lib/formation/queries.ts — per-step filing metadata for the flow.
 *
 * `lib/queries/formation.ts` (shared with the Build hub) answers *which*
 * steps are done; this answers *how* each was filed — version, original
 * filing time, last amendment — for the drafted-document review and the
 * checklist's amended badges. Request-cached; degrades to empty on failure.
 */

export type { FormationStepMeta } from './steps';

/** Filing metadata keyed by FORMATION_ITEMS item id. */
export const getFormationStepMeta = cache(
  async (orgId: string): Promise<Record<string, FormationStepMeta>> => {
    const supabase = await createClient();
    const { data: steps } = await supabase
      .from('formation_steps')
      .select('kind, version, filed_at, amended_at')
      .eq('org_id', orgId);

    const byKind = new Map((steps ?? []).map((s) => [s.kind as FormationKind, s]));
    const out: Record<string, FormationStepMeta> = {};
    for (const item of FORMATION_ITEMS) {
      const row = byKind.get(item.kind);
      if (!row) continue;
      out[item.id] = {
        version: row.version,
        filedAt: row.filed_at,
        amendedAt: row.amended_at
      };
    }
    return out;
  }
);
