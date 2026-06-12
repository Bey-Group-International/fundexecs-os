import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { GovMember, PolicyValue } from '@/lib/governance/config';
import {
  persistableGovMembers,
  policyById,
  sanitizePolicyDecisions,
  sanitizePolicyStatus,
  type GovBodyKind
} from '@/lib/governance/persistence';

/**
 * The org's persisted Structure & Governance state: policies by stage
 * (drafted vs adopted, with the operator's decisions) and any body rosters
 * that have been edited. Request-cached; degrades to the fresh zero state on
 * failure. Named `governance-hub` to stay clear of the existing
 * strategy-side governance queries (`governance_plans` /
 * `governance_objectives`).
 */
export interface GovernanceHubState {
  /** policy id → sanitized decisions, for every ADOPTED (active) policy. */
  adopted: Record<string, Record<string, PolicyValue>>;
  /** policy id → sanitized decisions, for drafted-but-not-adopted policies. */
  drafts: Record<string, Record<string, PolicyValue>>;
  /**
   * body kind → persisted roster of confirmed members (absent = nothing
   * saved yet). Placeholder rows never round-trip.
   */
  bodies: Partial<Record<GovBodyKind, GovMember[]>>;
}

export const getGovernanceHubState = cache(async (orgId: string): Promise<GovernanceHubState> => {
  const supabase = await createClient();
  const [{ data: policies }, { data: bodies }] = await Promise.all([
    supabase.from('governance_policies').select('policy_id, decisions, status').eq('org_id', orgId),
    supabase.from('governance_bodies').select('kind, members').eq('org_id', orgId)
  ]);

  const adopted: GovernanceHubState['adopted'] = {};
  const drafts: GovernanceHubState['drafts'] = {};
  for (const row of policies ?? []) {
    const pol = policyById(row.policy_id);
    if (!pol) continue;
    const target = sanitizePolicyStatus(row.status) === 'adopted' ? adopted : drafts;
    target[pol.id] = sanitizePolicyDecisions(pol, row.decisions);
  }

  const rosters: GovernanceHubState['bodies'] = {};
  for (const row of bodies ?? []) {
    rosters[row.kind as GovBodyKind] = persistableGovMembers(row.members);
  }

  return { adopted, drafts, bodies: rosters };
});
