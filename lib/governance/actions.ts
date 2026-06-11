'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import type { Json } from '@/lib/supabase/database.types';
import {
  GOV_BODY_KINDS,
  policyById,
  sanitizeGovMembers,
  sanitizePolicyDecisions,
  type GovBodyKind
} from './persistence';

/**
 * lib/governance/actions.ts — persistence for the Structure & Governance hub.
 *
 * The operator drives this surface directly; writes are member-scoped through
 * RLS. Adopting a policy is idempotent (re-adoption updates the decisions);
 * body rosters upsert per kind.
 */

export type GovernanceActionResult = { ok: true } | { ok: false; error: string };

/** Adopt (or re-adopt) a policy with the operator's decisions. */
export async function adoptGovernancePolicy(
  policyId: string,
  decisions: unknown
): Promise<GovernanceActionResult> {
  const pol = policyById(policyId);
  if (!pol) return { ok: false, error: 'Unknown policy.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { error } = await supabase.from('governance_policies').upsert(
    {
      org_id: org.orgId,
      policy_id: pol.id,
      adopted_by: org.userId,
      adopted_at: new Date().toISOString(),
      decisions: sanitizePolicyDecisions(pol, decisions) as unknown as Json
    },
    { onConflict: 'org_id,policy_id' }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/build/governance');
  revalidatePath('/build');
  return { ok: true };
}

/** Persist one governance body's roster (e.g. after filling a seat). */
export async function saveGovernanceBody(
  kind: GovBodyKind,
  members: unknown
): Promise<GovernanceActionResult> {
  if (!GOV_BODY_KINDS.includes(kind)) return { ok: false, error: 'Unknown governance body.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { error } = await supabase.from('governance_bodies').upsert(
    {
      org_id: org.orgId,
      kind,
      updated_by: org.userId,
      members: sanitizeGovMembers(members) as unknown as Json
    },
    { onConflict: 'org_id,kind' }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/build/governance');
  return { ok: true };
}
