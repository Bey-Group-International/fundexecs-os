import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { LeadStageKey } from '@/lib/leads/engine';

/**
 * Read side of the Lead Engine: one engine per closed acquisition, with its
 * leads. RLS-scoped; degrades to empty on failure.
 */
export interface LeadView {
  id: string;
  name: string;
  segment: string | null;
  intent: number | null;
  stage: LeadStageKey;
  estValue: number | null;
  signal: string | null;
  /** ISO timestamp of the last touch on the row (updated_at). */
  lastActivity: string | null;
}

export interface LeadEngineView {
  dealId: string;
  portco: string;
  leads: LeadView[];
}

export interface LeadEngineData {
  engines: LeadEngineView[];
  /** Whether the org has any closed acquisition at all. */
  hasClosedDeals: boolean;
}

export const getLeadEngines = cache(async (orgId: string): Promise<LeadEngineData> => {
  const supabase = await createClient();
  const [{ data: deals }, { data: leads }] = await Promise.all([
    supabase
      .from('deals')
      .select('id, name, stage')
      .eq('org_id', orgId)
      .eq('stage', 'closed')
      .order('created_at', { ascending: false }),
    supabase
      .from('leads')
      .select('id, deal_id, name, segment, intent, stage, est_value, signal, updated_at')
      .eq('org_id', orgId)
      .order('intent', { ascending: false, nullsFirst: false })
  ]);

  const byDeal = new Map<string, LeadView[]>();
  for (const l of leads ?? []) {
    const key = l.deal_id ?? '';
    if (!byDeal.has(key)) byDeal.set(key, []);
    byDeal.get(key)!.push({
      id: l.id,
      name: l.name,
      segment: l.segment,
      intent: l.intent,
      stage: l.stage as LeadStageKey,
      estValue: l.est_value,
      signal: l.signal,
      lastActivity: l.updated_at
    });
  }

  const engines: LeadEngineView[] = (deals ?? []).map((d) => ({
    dealId: d.id,
    portco: d.name,
    leads: byDeal.get(d.id) ?? []
  }));

  return { engines, hasClosedDeals: engines.length > 0 };
});
