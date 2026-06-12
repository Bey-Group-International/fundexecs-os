'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import type { Json } from '@/lib/supabase/database.types';
import {
  GOV_BODY_KINDS,
  persistableGovMembers,
  policyById,
  sanitizePolicyDecisions,
  type GovBodyKind
} from './persistence';

/**
 * lib/governance/actions.ts — persistence for the Structure & Governance hub.
 *
 * The operator drives this surface directly; writes are member-scoped through
 * RLS. Policies move Draft → Adopt: drafting records the decisions with
 * status 'drafted' (never downgrading an adopted policy), adoption is
 * idempotent (re-adoption updates the decisions). Body rosters upsert per
 * kind, and only operator-confirmed members are ever written.
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
      status: 'adopted',
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

/**
 * Record a drafted (not yet adopted) policy so the Draft → Adopt stage
 * survives reload. Never touches a policy that is already adopted — adoption
 * is only granted (or refreshed) through `adoptGovernancePolicy`.
 */
export async function draftGovernancePolicy(
  policyId: string,
  decisions: unknown
): Promise<GovernanceActionResult> {
  const pol = policyById(policyId);
  if (!pol) return { ok: false, error: 'Unknown policy.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from('governance_policies')
    .select('status')
    .eq('org_id', org.orgId)
    .eq('policy_id', pol.id)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (existing?.status === 'adopted') return { ok: true };

  const { error } = await supabase.from('governance_policies').upsert(
    {
      org_id: org.orgId,
      policy_id: pol.id,
      status: 'drafted',
      adopted_by: org.userId,
      adopted_at: new Date().toISOString(),
      decisions: sanitizePolicyDecisions(pol, decisions) as unknown as Json
    },
    { onConflict: 'org_id,policy_id' }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/build/governance');
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
      members: persistableGovMembers(members) as unknown as Json
    },
    { onConflict: 'org_id,kind' }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/build/governance');
  return { ok: true };
}
