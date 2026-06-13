import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

export interface MarketPulse {
  period: string | null;
  totalCapitalUsd: number | null;
  dealCount: number | null;
  startupCount: number | null;
  topVerticals: string[];
  fetchedAt: string | null;
}

/** Fetch the latest BotMemo market-pulse signal, or null if none yet ingested. */
export async function getMarketPulse(): Promise<MarketPulse | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('market_signals')
    .select('normalized, occurred_at')
    .eq('source', 'botmemo')
    .eq('kind', 'market-pulse')
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const n = (data.normalized ?? {}) as Record<string, unknown>;
  return {
    period: (n.period as string | null) ?? null,
    totalCapitalUsd: (n.total_capital_usd as number | null) ?? null,
    dealCount: (n.deal_count as number | null) ?? null,
    startupCount: (n.startup_count as number | null) ?? null,
    topVerticals: (n.top_verticals as string[] | null) ?? [],
    fetchedAt: data.occurred_at ?? null,
  };
}

type DealRow = Database['public']['Tables']['deals']['Row'];
type RelationshipRow = Database['public']['Tables']['relationships']['Row'];
type ContactRow = Database['public']['Tables']['contacts']['Row'];

export interface CommandCenterData {
  activeDealsCount: number;
  capitalInMotion: number;
  capitalDealCount: number;
  hotRelationshipsCount: number;
  warmRelationshipsThisWeek: number;
  recentDeals: DealRow[];
  topWarmConnections: Array<{
    id: string;
    name: string;
    company: string | null;
    strength: number;
    status: string;
  }>;
}

const EMPTY: CommandCenterData = {
  activeDealsCount: 0,
  capitalInMotion: 0,
  capitalDealCount: 0,
  hotRelationshipsCount: 0,
  warmRelationshipsThisWeek: 0,
  recentDeals: [],
  topWarmConnections: []
};

/**
 * Fetch KPI counts, recent deals and top warm relationships for the given
 * org. All queries respect RLS via the server client. Any query error
 * degrades to an empty value so the page never throws at render time.
 */
export async function getCommandCenterData(orgId: string): Promise<CommandCenterData> {
  const supabase = await createClient();

  const [dealsRes, hotRes, weekWarmRes, recentRes, relRes] = await Promise.all([
    // Active deals (count + amounts) — used for KPIs.
    supabase.from('deals').select('amount, status').eq('org_id', orgId).neq('status', 'closed'),
    // Hot relationships count.
    supabase
      .from('relationships')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'hot'),
    // Warm relationships touched in the last 7 days.
    supabase
      .from('relationships')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('status', 'warm')
      .gte('last_interaction_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
    // Most recent deals for the deal-flow table.
    supabase
      .from('deals')
      .select('*')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(5),
    // Top warm relationships joined with contacts.
    supabase
      .from('relationships')
      .select('id, strength, status, contact:contacts(id, full_name, company)')
      .eq('org_id', orgId)
      .order('strength', { ascending: false })
      .limit(3)
  ]);

  const activeDeals = (dealsRes.data ?? []) as Pick<DealRow, 'amount' | 'status'>[];
  const capitalInMotion = activeDeals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  type RelWithContact = Pick<RelationshipRow, 'id' | 'strength' | 'status'> & {
    contact: Pick<ContactRow, 'id' | 'full_name' | 'company'> | null;
  };
  const topWarm = ((relRes.data ?? []) as RelWithContact[]).map((r) => ({
    id: r.id,
    name: r.contact?.full_name ?? 'Unknown contact',
    company: r.contact?.company ?? null,
    strength: r.strength,
    status: r.status
  }));

  return {
    ...EMPTY,
    activeDealsCount: activeDeals.length,
    capitalInMotion,
    capitalDealCount: activeDeals.filter((d) => (d.amount ?? 0) > 0).length,
    hotRelationshipsCount: hotRes.count ?? 0,
    warmRelationshipsThisWeek: weekWarmRes.count ?? 0,
    recentDeals: (recentRes.data ?? []) as DealRow[],
    topWarmConnections: topWarm
  };
}
