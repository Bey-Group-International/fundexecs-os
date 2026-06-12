import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/supabase/database.types';
import { getActiveOrg } from '@/lib/queries/org';
import { createClient } from '@/lib/supabase/server';

/**
 * lib/governance/authz.ts — write authorization + the audit trail for the
 * Structure & Governance hub.
 *
 * Adopting a policy or seating a governance body is a privileged act on the
 * institutional spine, so writes are gated to workspace owners and admins
 * (the RLS in 20260612110000 enforces the same — this is the application-side
 * half of defense in depth). Every successful write records an append-only
 * `governance_events` row so the firm and its LPs have an immutable trail.
 */

export type GovWriterRole = 'owner' | 'admin';

export interface GovWriter {
  orgId: string;
  userId: string;
  role: GovWriterRole;
}

export type GovWriterResult = { ok: true; writer: GovWriter } | { ok: false; error: string };

/**
 * Resolve the active org and require the caller be an owner or admin. Returns
 * a calm error (never throws) so server actions can surface it inline.
 */
export async function requireGovernanceWriter(): Promise<GovWriterResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', org.orgId)
    .eq('user_id', org.userId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  const role = data?.role;
  if (role !== 'owner' && role !== 'admin') {
    return {
      ok: false,
      error: 'Only workspace owners and admins can change governance.'
    };
  }
  return { ok: true, writer: { orgId: org.orgId, userId: org.userId, role } };
}

export type GovEventType = 'policy_drafted' | 'policy_adopted' | 'body_member_added';

interface GovEventInput {
  eventType: GovEventType;
  entityType: 'policy' | 'governance_body';
  entityId: string;
  metadata?: Record<string, Json>;
}

/**
 * Append a governance audit event. Best-effort: a failed log never fails the
 * write it accompanies (the mutation already succeeded and the surface should
 * not error on a missing trail), but the failure is logged server-side.
 */
export async function recordGovernanceEvent(
  supabase: SupabaseClient<Database>,
  writer: GovWriter,
  event: GovEventInput
): Promise<void> {
  const { error } = await supabase.from('governance_events').insert({
    org_id: writer.orgId,
    actor_id: writer.userId,
    event_type: event.eventType,
    entity_type: event.entityType,
    entity_id: event.entityId,
    metadata: (event.metadata ?? {}) as unknown as Json
  });
  if (error) {
    console.error('governance_events insert failed', {
      eventType: event.eventType,
      entityId: event.entityId,
      error: error.message
    });
  }
}
