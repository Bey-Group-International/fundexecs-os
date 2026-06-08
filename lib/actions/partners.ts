'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import type { Database } from '@/lib/supabase/database.types';

type PartnerIntroInsert = Database['public']['Tables']['partner_intro_requests']['Insert'];

export type PartnerActionResult = { ok: true; id: string } | { ok: false; error: string };

export interface AddServiceProviderInput {
  name: string;
  category?: string;
}

/**
 * Add a capital-stack service provider to the active org. RLS allows any org
 * member to insert (policy: members write service_providers).
 */
export async function addServiceProvider(
  input: AddServiceProviderInput
): Promise<PartnerActionResult> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('service_providers')
    .insert({
      org_id: org.orgId,
      name,
      category: input.category?.trim() || 'general',
      status: 'active'
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Could not add partner.' };
  return { ok: true, id: data.id };
}

export type PartnerType = 'service_provider' | 'capital_provider';
const PARTNER_TYPES: readonly PartnerType[] = ['service_provider', 'capital_provider'];

export interface RequestPartnerIntroInput {
  partnerId: string;
  partnerName: string;
  partnerType: PartnerType;
  rationale?: string;
}

export type RequestPartnerIntroResult =
  | { ok: true; id: string; status: string }
  | { ok: false; error: string };

/**
 * Request an introduction / apply to a partner directory entry. Creates a
 * `partner_intro_requests` row in 'requested' state. Idempotent: if an open
 * request already exists for this (org, requester, partner), returns the
 * existing row rather than duplicating.
 */
export async function requestPartnerIntro(
  input: RequestPartnerIntroInput
): Promise<RequestPartnerIntroResult> {
  if (!input.partnerId) return { ok: false, error: 'Missing partner.' };
  if (!input.partnerName?.trim()) return { ok: false, error: 'Missing partner name.' };
  if (!PARTNER_TYPES.includes(input.partnerType)) {
    return { ok: false, error: 'Invalid partner type.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();

  // Re-usable filter for the open request that uniquely identifies this
  // (org, requester, partner_type, partner) — mirrors the partial unique index.
  const openRequestMatch = (q: ReturnType<typeof openSelect>) =>
    q
      .eq('org_id', org.orgId)
      .eq('requester_id', org.userId)
      .eq('partner_type', input.partnerType)
      .eq('partner_id', input.partnerId)
      .eq('status', 'requested');

  function openSelect() {
    return supabase.from('partner_intro_requests').select('id, status');
  }

  // Pre-check for a friendlier path when a request already exists.
  const { data: existing } = await openRequestMatch(openSelect()).maybeSingle();
  if (existing) {
    return { ok: true, id: existing.id, status: existing.status };
  }

  const insert: PartnerIntroInsert = {
    org_id: org.orgId,
    requester_id: org.userId,
    partner_id: input.partnerId,
    partner_name: input.partnerName.trim(),
    partner_type: input.partnerType,
    rationale: input.rationale?.trim() || null,
    status: 'requested'
  };

  const { data, error } = await supabase
    .from('partner_intro_requests')
    .insert(insert)
    .select('id, status')
    .single();

  // Concurrency: the read-then-insert can race, so a unique-violation (23505)
  // means a sibling request won — return that existing row instead of erroring.
  if (error?.code === '23505') {
    const { data: raced } = await openRequestMatch(openSelect()).maybeSingle();
    if (raced) return { ok: true, id: raced.id, status: raced.status };
  }

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Could not submit request.' };
  }
  return { ok: true, id: data.id, status: data.status };
}
