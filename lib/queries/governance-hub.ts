import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { GovMember, PolicyValue } from '@/lib/governance/config';
import {
  policyById,
  sanitizeGovMembers,
  sanitizePolicyDecisions,
  type GovBodyKind
} from '@/lib/governance/persistence';

/**
 * The org's persisted Structure & Governance state: adopted policies (with
 * the operator's decisions) and any body rosters that have been edited.
 * Request-cached; degrades to the fresh zero state on failure. Named
 * `governance-hub` to stay clear of the existing strategy-side governance
 * queries (`governance_plans` / `governance_objectives`).
 */
export interface GovernanceHubState {
  /** policy id → sanitized decisions, for every adopted policy. */
  adopted: Record<string, Record<string, PolicyValue>>;
  /** body kind → persisted roster (absent = the config's starting roster). */
  bodies: Partial<Record<GovBodyKind, GovMember[]>>;
}

export const getGovernanceHubState = cache(async (orgId: string): Promise<GovernanceHubState> => {
  const supabase = await createClient();
  const [{ data: policies }, { data: bodies }] = await Promise.all([
    supabase.from('governance_policies').select('policy_id, decisions').eq('org_id', orgId),
    supabase.from('governance_bodies').select('kind, members').eq('org_id', orgId)
  ]);

  const adopted: GovernanceHubState['adopted'] = {};
  for (const row of policies ?? []) {
    const pol = policyById(row.policy_id);
    if (pol) adopted[pol.id] = sanitizePolicyDecisions(pol, row.decisions);
  }

  const rosters: GovernanceHubState['bodies'] = {};
  for (const row of bodies ?? []) {
    rosters[row.kind as GovBodyKind] = sanitizeGovMembers(row.members);
  }

  return { adopted, bodies: rosters };
});
