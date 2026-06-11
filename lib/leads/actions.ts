'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { discoverLeads } from '@/lib/ai/lead-discovery';
import { meterAction } from '@/lib/credits/meter';
import { isLeadStage, nextLeadStage, type LeadStageKey } from './engine';

/**
 * lib/leads/actions.ts — the Lead Engine's mutations.
 *
 * Spin-up runs the real lead-discovery generator for a CLOSED acquisition and
 * inserts the sanitized candidates; advancement moves a lead exactly one
 * stage, enforced server-side. Member-scoped through RLS.
 */

export type LeadActionResult = { ok: true; created?: number } | { ok: false; error: string };

/** Spin up (or top up) the lead engine for a closed acquisition. */
export async function spinUpLeadEngine(dealId: string): Promise<LeadActionResult> {
  if (!dealId) return { ok: false, error: 'Missing portfolio company.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data: deal } = await supabase
    .from('deals')
    .select('id, name, stage')
    .eq('id', dealId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (!deal) return { ok: false, error: 'Portfolio company not found.' };
  if (deal.stage !== 'closed') {
    return { ok: false, error: 'The lead engine spins up once the acquisition closes.' };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'AI generation is not configured on this deployment yet.' };
  }

  // Same heavy-LLM metering class as Target Scout; fail-open on infra miss,
  // fail-closed on insufficient balance.
  const meter = await meterAction(org.orgId, 'target_discovery');
  if (!meter.ok && meter.reason === 'insufficient') {
    return { ok: false, error: 'Insufficient credits for lead generation.' };
  }

  const result = await discoverLeads({ portco: deal.name });
  if (!result.configured) {
    return { ok: false, error: 'AI generation is not configured on this deployment yet.' };
  }
  if (result.candidates.length === 0) {
    return { ok: false, error: 'Vivian could not produce candidates — try again.' };
  }

  // Skip names already on this engine so a top-up never duplicates.
  const { data: existing } = await supabase
    .from('leads')
    .select('name')
    .eq('org_id', org.orgId)
    .eq('deal_id', deal.id);
  const taken = new Set((existing ?? []).map((l) => l.name.toLowerCase()));
  const fresh = result.candidates.filter((c) => !taken.has(c.name.toLowerCase()));
  if (fresh.length === 0) {
    return { ok: false, error: 'These candidates are already on the engine.' };
  }

  const { error } = await supabase.from('leads').insert(
    fresh.map((c) => ({
      org_id: org.orgId,
      deal_id: deal.id,
      name: c.name,
      segment: c.segment,
      intent: c.intent,
      est_value: c.estValue,
      signal: c.signal,
      source: 'Vivian · lead engine'
    }))
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/source/leads');
  revalidatePath('/source');
  return { ok: true, created: fresh.length };
}

/** Advance a lead exactly one stage (New → Qualified → Contacted → Meeting). */
export async function advanceLead(input: {
  leadId: string;
  to: string;
}): Promise<LeadActionResult> {
  if (!input.leadId) return { ok: false, error: 'Missing lead.' };
  if (!isLeadStage(input.to)) return { ok: false, error: 'Invalid stage.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data: lead } = await supabase
    .from('leads')
    .select('id, stage')
    .eq('id', input.leadId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (!lead) return { ok: false, error: 'Lead not found.' };

  const expected = nextLeadStage(lead.stage as LeadStageKey);
  if (expected !== input.to) {
    return { ok: false, error: 'Leads advance one stage at a time.' };
  }

  const { error } = await supabase
    .from('leads')
    .update({ stage: input.to })
    .eq('id', lead.id)
    .eq('org_id', org.orgId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/source/leads');
  return { ok: true };
}
