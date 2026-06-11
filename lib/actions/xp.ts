'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import type { TrustLayerKey as TrustLayer } from '@/lib/queries/trust';

export interface AwardTrustXpInput {
  /** Which Chain-of-Trust layer the completion advances (sets the reward). */
  layer: TrustLayer;
  /** Coarse entity kind, e.g. 'objective' | 'task' | 'member'. */
  entityType: string;
  /** The completed entity's id (any string; stored as a ref). */
  entityId: string;
}

/**
 * Award Earn XP for a Chain-of-Trust completion. The reward amount is fixed
 * server-side per layer inside the `award_trust_xp` SQL function, which is
 * idempotent per (user, entity) and checks org membership — so this is safe to
 * call directly from client components. Returns the user's new XP total, or
 * `null` when not signed in / not a member / on error.
 */
export async function awardTrustXp(input: AwardTrustXpInput): Promise<number | null> {
  const org = await getActiveOrg();
  if (!org) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('award_trust_xp', {
    _org: org.orgId,
    _layer: input.layer,
    _entity_type: input.entityType,
    _entity_id: input.entityId
  });

  if (error) return null;
  return data ?? null;
}
