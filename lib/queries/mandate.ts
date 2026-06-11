import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * The org's Mandate Brief — the row `briefTheTeam` writes during onboarding.
 * One request-cached read shared by the shell layout, the Command Center, and
 * the hub landings, so the chrome and the pages always describe the same
 * mandate without re-querying per surface.
 */
export interface MandateRow {
  principal: string | null;
  firm: string | null;
  investor_group: string;
  investor_role: string | null;
  objective: string | null;
  vehicle: string | null;
  size: string | null;
  sectors: string[];
  stage: string | null;
  geo: string | null;
}

export const getMandate = cache(async (orgId: string): Promise<MandateRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from('mandates')
    .select(
      'principal, firm, investor_group, investor_role, objective, vehicle, size, sectors, stage, geo'
    )
    .eq('org_id', orgId)
    .maybeSingle();
  return (data as MandateRow | null) ?? null;
});
