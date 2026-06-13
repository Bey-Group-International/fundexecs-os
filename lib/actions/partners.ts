'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import type { Database, Json } from '@/lib/supabase/database.types';
import { emitTaskletsAiEvent } from '@/lib/integrations/tasklets-ai';

type PartnerIntroInsert = Database['public']['Tables']['partner_intro_requests']['Insert'];

export type PartnerActionResult = { ok: true; id: string } | { ok: false; error: string };

export interface AddServiceProviderInput {
  name: string;
  category?: string;
  /** 'active' = already engaged; 'prospect' = on the bench as Suggested. */
  status?: 'active' | 'prospect';
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
      status: input.status ?? 'active'
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'Could not add partner.' };
  return { ok: true, id: data.id };
}

export type EngagePartnerResult =
  | { ok: true; id: string; status: string }
  | { ok: false; error: string };

/**
 * "Engage" on the Partner Network bench: advance the requester's open intro
 * request for a service provider exactly one step (requested | accepted →
 * introduced). The WHERE clause is the server-side stage gate — without an
 * open request (or with one already introduced/declined) nothing matches and
 * the advance is refused, so a provider can never skip Suggested → Engaged.
 */
export async function engagePartner(input: { partnerId: string }): Promise<EngagePartnerResult> {
  if (!input.partnerId) return { ok: false, error: 'Missing partner.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();

  // Pick exactly one open request (requested | accepted) to advance — never a
  // blanket update, so a single Engage approval can't promote several rows.
  const { data: open, error: readError } = await supabase
    .from('partner_intro_requests')
    .select('id')
    .eq('org_id', org.orgId)
    .eq('requester_id', org.userId)
    .eq('partner_type', 'service_provider')
    .eq('partner_id', input.partnerId)
    .in('status', ['requested', 'accepted'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!open) {
    return { ok: false, error: 'No open intro request to engage — request the intro first.' };
  }

  // Advance that one row, re-checking the open status to lose cleanly to a
  // concurrent advance rather than double-introducing.
  const { data, error } = await supabase
    .from('partner_intro_requests')
    .update({ status: 'introduced' })
    .eq('id', open.id)
    .in('status', ['requested', 'accepted'])
    .select('id, status');

  if (error) return { ok: false, error: error.message };
  const row = data?.[0];
  if (!row) {
    return { ok: false, error: 'No open intro request to engage — request the intro first.' };
  }
  return { ok: true, id: row.id, status: row.status };
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

  // The open request for this (org, requester, partner_type, partner).
  // 'requested' and 'accepted' are the single OPEN state — reuse either rather
  // than minting a second open row beside an accepted one (which would let one
  // Engage approval advance multiple records).
  const openRequestMatch = (q: ReturnType<typeof openSelect>) =>
    q
      .eq('org_id', org.orgId)
      .eq('requester_id', org.userId)
      .eq('partner_type', input.partnerType)
      .eq('partner_id', input.partnerId)
      .in('status', ['requested', 'accepted'])
      .order('created_at', { ascending: true })
      .limit(1);

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

  // Module 6: fire Tasklets.ai to start 48h follow-up watch on new intro requests.
  // Tasklets.ai monitors for no-response and triggers HL reminder sequence.
  void emitTaskletsAiEvent({
    type: 'partner_intro_submitted',
    occurredAt: new Date().toISOString(),
    data: {
      introRequestId: data.id,
      partnerId: input.partnerId,
      partnerName: input.partnerName.trim(),
      partnerType: input.partnerType,
      orgId: org.orgId,
      requesterId: org.userId,
      rationale: input.rationale?.trim() ?? null
    }
  });

  return { ok: true, id: data.id, status: data.status };
}

/* ---------------------------------------------------------------------------
 * adoptProvider — "bring a provider into the system through their ops".
 *
 * One call that (1) creates the directory record (service or capital) with the
 * AI-enriched fields, (2) opens a partner_intro_request so outreach is tracked,
 * and (3) drops an action-queue task (notification) assigned to the suggested
 * specialist. Steps 2-3 never-block: the record is already saved.
 * ------------------------------------------------------------------------- */

export interface AdoptProviderInput {
  kind: 'service' | 'capital';
  name: string;
  category?: string | null;
  capitalTypes?: string[];
  checkSizeMin?: number | null;
  checkSizeMax?: number | null;
  capabilities?: string[];
  description?: string;
  fitRationale?: string;
  suggestedSpecialist?: string;
}

export type AdoptProviderResult =
  | { ok: true; id: string; partnerType: PartnerType }
  | { ok: false; error: string };

export async function adoptProvider(input: AdoptProviderInput): Promise<AdoptProviderResult> {
  const name = input.name?.trim();
  if (!name) return { ok: false, error: 'Name is required.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const specialist = input.suggestedSpecialist?.trim() || 'Deal Sourcer';
  const meta = {
    description: input.description?.trim() || null,
    fitRationale: input.fitRationale?.trim() || null,
    assignedSpecialist: specialist,
    source: 'ai_discovery',
    adoptedAt: new Date().toISOString()
  };

  let partnerId: string;
  let partnerType: PartnerType;

  if (input.kind === 'capital') {
    partnerType = 'capital_provider';
    const { data, error } = await supabase
      .from('capital_providers')
      .insert({
        org_id: org.orgId,
        name,
        status: 'prospect',
        capital_types: input.capitalTypes ?? [],
        check_size_min: input.checkSizeMin ?? null,
        check_size_max: input.checkSizeMax ?? null,
        criteria: meta as unknown as Json
      })
      .select('id')
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? 'Could not add provider.' };
    partnerId = data.id;
  } else {
    partnerType = 'service_provider';
    // Capability tags are stored as object keys; AI meta lives under `_meta`
    // (the card filters underscore-prefixed keys out of the tag chips).
    const capabilities: Record<string, unknown> = {};
    for (const tag of input.capabilities ?? []) {
      const k = tag.trim();
      if (k) capabilities[k] = true;
    }
    capabilities._meta = meta;
    const { data, error } = await supabase
      .from('service_providers')
      .insert({
        org_id: org.orgId,
        name,
        category: input.category?.trim() || 'general',
        status: 'prospect',
        capabilities: capabilities as unknown as Json
      })
      .select('id')
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? 'Could not add provider.' };
    partnerId = data.id;
  }

  // (2) Track outreach as an intro request — never-block.
  try {
    await supabase.from('partner_intro_requests').insert({
      org_id: org.orgId,
      requester_id: org.userId,
      partner_id: partnerId,
      partner_name: name,
      partner_type: partnerType,
      rationale: input.fitRationale?.trim() || null,
      status: 'requested'
    });
  } catch {
    /* never-block: the record is already saved */
  }

  // (3) Action-queue task assigned to the specialist — never-block.
  try {
    const admin = createAdminClient();
    await admin.from('notifications').insert({
      user_id: org.userId,
      org_id: org.orgId,
      type: 'partner_added',
      payload: {
        category: 'Partner Marketplace',
        title: `${name} added to your directory`,
        body: `Assigned to ${specialist}. Next: confirm the intro request and kick off outreach.`,
        meta: partnerType === 'capital_provider' ? 'Capital provider' : 'Service provider',
        href: '/partners'
      }
    });
  } catch {
    /* never-block */
  }

  return { ok: true, id: partnerId, partnerType };
}
