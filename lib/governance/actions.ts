'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/database.types';
import { requireGovernanceWriter, recordGovernanceEvent } from './authz';
import {
  GOV_BODY_KINDS,
  mergeGovMembers,
  persistableGovMembers,
  policyById,
  sanitizeGovMembers,
  sanitizePolicyDecisions,
  type GovBodyKind
} from './persistence';

/**
 * lib/governance/actions.ts — persistence for the Structure & Governance hub.
 *
 * Governance is the institutional spine, so every write requires an owner or
 * admin (`requireGovernanceWriter`; the RLS in 20260612110000 enforces the
 * same) and records an append-only `governance_events` row. Policies move
 * Draft → Adopt: drafting records the decisions with status 'drafted' (never
 * downgrading an adopted policy), adoption is idempotent. Body rosters are
 * additive — a write unions onto what is stored, so concurrent seats can't
 * clobber each other — and only operator-added members persist.
 */

export type GovernanceActionResult = { ok: true } | { ok: false; error: string };

/** Adopt (or re-adopt) a policy with the operator's decisions. */
export async function adoptGovernancePolicy(
  policyId: string,
  decisions: unknown
): Promise<GovernanceActionResult> {
  const pol = policyById(policyId);
  if (!pol) return { ok: false, error: 'Unknown policy.' };

  const auth = await requireGovernanceWriter();
  if (!auth.ok) return auth;
  const { writer } = auth;

  const supabase = await createClient();
  const decisionsJson = sanitizePolicyDecisions(pol, decisions) as unknown as Json;
  const { error } = await supabase.from('governance_policies').upsert(
    {
      org_id: writer.orgId,
      policy_id: pol.id,
      status: 'adopted',
      adopted_by: writer.userId,
      adopted_at: new Date().toISOString(),
      decisions: decisionsJson
    },
    { onConflict: 'org_id,policy_id' }
  );
  if (error) return { ok: false, error: error.message };

  await recordGovernanceEvent(supabase, writer, {
    eventType: 'policy_adopted',
    entityType: 'policy',
    entityId: pol.id,
    metadata: { decisions: decisionsJson }
  });

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

  const auth = await requireGovernanceWriter();
  if (!auth.ok) return auth;
  const { writer } = auth;

  const supabase = await createClient();
  const decisionsJson = sanitizePolicyDecisions(pol, decisions) as unknown as Json;

  // Atomic, race-safe: a single guarded UPDATE only moves a not-yet-adopted row
  // into 'drafted', so an adoption that lands first is never overwritten. A
  // draft carries no adoption stamp (adopted_by / adopted_at stay null until
  // the policy is actually adopted).
  const { data: updated, error: updateError } = await supabase
    .from('governance_policies')
    .update({
      status: 'drafted',
      adopted_by: null,
      adopted_at: null,
      decisions: decisionsJson
    })
    .eq('org_id', writer.orgId)
    .eq('policy_id', pol.id)
    .neq('status', 'adopted')
    .select('policy_id');
  if (updateError) return { ok: false, error: updateError.message };
  if (updated && updated.length > 0) {
    await recordGovernanceEvent(supabase, writer, {
      eventType: 'policy_drafted',
      entityType: 'policy',
      entityId: pol.id,
      metadata: { decisions: decisionsJson }
    });
    revalidatePath('/build/governance');
    return { ok: true };
  }

  // No non-adopted row was updated: either the policy has no row yet, or it is
  // already adopted. Insert a fresh draft; a unique-violation (23505) means a
  // row already exists (adopted, or created concurrently) — leave it untouched.
  const { error: insertError } = await supabase.from('governance_policies').insert({
    org_id: writer.orgId,
    policy_id: pol.id,
    status: 'drafted',
    adopted_by: null,
    adopted_at: null,
    decisions: decisionsJson
  });
  if (insertError) {
    if (insertError.code === '23505') return { ok: true };
    return { ok: false, error: insertError.message };
  }

  await recordGovernanceEvent(supabase, writer, {
    eventType: 'policy_drafted',
    entityType: 'policy',
    entityId: pol.id,
    metadata: { decisions: decisionsJson }
  });
  revalidatePath('/build/governance');
  return { ok: true };
}

/** Persist one governance body's roster (e.g. after filling a seat). */
export async function saveGovernanceBody(
  kind: GovBodyKind,
  members: unknown
): Promise<GovernanceActionResult> {
  if (!GOV_BODY_KINDS.includes(kind)) return { ok: false, error: 'Unknown governance body.' };

  const auth = await requireGovernanceWriter();
  if (!auth.ok) return auth;
  const { writer } = auth;

  const supabase = await createClient();
  const incoming = persistableGovMembers(members);

  // Additive write: union onto the stored roster so two sessions seating
  // different members at once can't clobber each other.
  const { data: current, error: readError } = await supabase
    .from('governance_bodies')
    .select('members')
    .eq('org_id', writer.orgId)
    .eq('kind', kind)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  const stored = sanitizeGovMembers(current?.members);
  const merged = mergeGovMembers(stored, incoming);
  const seated = incoming.filter((m) => !stored.some((s) => s.id === m.id));

  const { error } = await supabase.from('governance_bodies').upsert(
    {
      org_id: writer.orgId,
      kind,
      updated_by: writer.userId,
      members: merged as unknown as Json
    },
    { onConflict: 'org_id,kind' }
  );
  if (error) return { ok: false, error: error.message };

  for (const m of seated) {
    await recordGovernanceEvent(supabase, writer, {
      eventType: 'body_member_added',
      entityType: 'governance_body',
      entityId: kind,
      metadata: { memberId: m.id, name: m.name ?? null, role: m.role }
    });
  }

  revalidatePath('/build/governance');
  return { ok: true };
}
