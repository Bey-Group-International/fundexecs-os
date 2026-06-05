'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { awardTrustXp } from '@/lib/actions/xp';
import type { Database } from '@/lib/supabase/database.types';

type WarmIntroRow = Database['public']['Tables']['warm_introductions']['Row'];
type WarmIntroInsert = Database['public']['Tables']['warm_introductions']['Insert'];
type InteractionRow = Database['public']['Tables']['interactions']['Row'];
type InteractionInsert = Database['public']['Tables']['interactions']['Insert'];

export type WarmIntroResult = { ok: true; intro: WarmIntroRow } | { ok: false; error: string };

export type InteractionResult =
  | { ok: true; interaction: InteractionRow }
  | { ok: false; error: string };

export interface RequestWarmIntroInput {
  contactId: string;
  rationale?: string | null;
}

/**
 * Request a warm introduction to a contact. Inserts a `warm_introductions`
 * row in 'requested' state. The seed migration uses 'suggested' for AI-
 * surfaced intros; user-initiated requests land in 'requested'.
 */
export async function requestWarmIntro(input: RequestWarmIntroInput): Promise<WarmIntroResult> {
  if (!input.contactId) return { ok: false, error: 'Missing contact.' };
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const insert: WarmIntroInsert = {
    org_id: org.orgId,
    requester_id: org.userId,
    target_contact_id: input.contactId,
    rationale: input.rationale ?? null,
    status: 'requested'
  };
  const { data, error } = await supabase
    .from('warm_introductions')
    .insert(insert)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };
  return { ok: true, intro: data as WarmIntroRow };
}

export type WarmIntroAction = 'request' | 'accept' | 'decline' | 'sent';

/**
 * Respond to a warm introduction. Transitions:
 *   `request`  → status='requested'  (user opted into Earn's suggestion)
 *   `accept`   → status='accepted'   (connector or recipient confirmed; fires concept XP)
 *   `sent`     → status='introduced' (the intro was delivered)
 *   `decline`  → status='declined'   (closed without an XP reward)
 */
export async function respondToWarmIntro(
  introId: string,
  action: WarmIntroAction
): Promise<WarmIntroResult> {
  if (!introId) return { ok: false, error: 'Missing intro id.' };

  const nextStatus =
    action === 'accept'
      ? 'accepted'
      : action === 'sent'
        ? 'introduced'
        : action === 'request'
          ? 'requested'
          : 'declined';
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('warm_introductions')
    .update({ status: nextStatus })
    .eq('id', introId)
    .select('*')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Update failed.' };

  if (action === 'accept') {
    try {
      await awardTrustXp({ layer: 'concept', entityType: 'warm_intro', entityId: introId });
    } catch {
      // best-effort
    }
  }
  return { ok: true, intro: data as WarmIntroRow };
}

export interface LogInteractionInput {
  contactId: string;
  type?: string;
  subject?: string;
  summary?: string;
  occurredAt?: string;
}

/**
 * Log a manual interaction (note, meeting, etc.) with a contact. The
 * existing `touch_relationship` trigger recalculates warmth on insert.
 */
export async function logInteraction(input: LogInteractionInput): Promise<InteractionResult> {
  if (!input.contactId) return { ok: false, error: 'Missing contact.' };
  const subject = input.subject?.trim();
  const summary = input.summary?.trim();
  if (!subject && !summary) {
    return { ok: false, error: 'Provide at least a subject or a note.' };
  }
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const insert: InteractionInsert = {
    org_id: org.orgId,
    user_id: org.userId,
    contact_id: input.contactId,
    type: input.type?.trim() || 'manual_note',
    provider: 'manual',
    direction: 'outbound',
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    subject: subject ?? null,
    summary: summary ?? null
  };
  const { data, error } = await supabase.from('interactions').insert(insert).select('*').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };
  return { ok: true, interaction: data as InteractionRow };
}
