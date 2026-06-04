import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

type DealRow = Database['public']['Tables']['deals']['Row'];

export interface PipelineDeal {
  id: string;
  name: string;
  stage: string;
  status: string;
  amount: number | null;
}

export interface PipelineStage {
  key: string;
  label: string;
  deals: PipelineDeal[];
}

export interface PipelineData {
  stages: PipelineStage[];
  totalDeals: number;
  pipelineValue: number;
  softCircled: number;
  committed: number;
  conversionPct: number;
}

/**
 * The canonical formation stages, in order. Deals whose `stage` does not
 * match one of these is bucketed under the closest label by lowercase key.
 */
const STAGE_ORDER: Array<{ key: string; label: string }> = [
  { key: 'visitor', label: 'Visitor' },
  { key: 'prospect', label: 'Prospect' },
  { key: 'qualified', label: 'Qualified' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'diligence', label: 'Diligence' },
  { key: 'soft-circle', label: 'Soft circle' },
  { key: 'committed', label: 'Committed' },
  { key: 'closed', label: 'Closed' }
];

const EMPTY: PipelineData = {
  stages: STAGE_ORDER.map((s) => ({ ...s, deals: [] })),
  totalDeals: 0,
  pipelineValue: 0,
  softCircled: 0,
  committed: 0,
  conversionPct: 0
};

function normalizeStageKey(stage: string): string {
  return stage
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

/**
 * Fetch the org's deals grouped by formation stage plus summary stats.
 * RLS-scoped via the server client; any query error degrades to an empty
 * board so the page never throws at render time.
 */
export async function getPipelineData(orgId: string): Promise<PipelineData> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('deals')
    .select('id, name, stage, status, amount')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false });

  if (error || !data) return EMPTY;

  const deals = data as Pick<DealRow, 'id' | 'name' | 'stage' | 'status' | 'amount'>[];

  const buckets = new Map<string, PipelineDeal[]>(STAGE_ORDER.map((s) => [s.key, []]));
  for (const d of deals) {
    const key = normalizeStageKey(d.stage);
    const list = buckets.get(key);
    const entry: PipelineDeal = {
      id: d.id,
      name: d.name,
      stage: d.stage,
      status: d.status,
      amount: d.amount
    };
    if (list) list.push(entry);
    else buckets.get('prospect')!.push(entry);
  }

  const stages: PipelineStage[] = STAGE_ORDER.map((s) => ({
    key: s.key,
    label: s.label,
    deals: buckets.get(s.key) ?? []
  }));

  const sumStage = (key: string) =>
    (buckets.get(key) ?? []).reduce((sum, d) => sum + (d.amount ?? 0), 0);

  const pipelineValue = deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
  const softCircled = sumStage('soft-circle');
  const committed = sumStage('committed') + sumStage('closed');
  const committedCount =
    (buckets.get('committed') ?? []).length + (buckets.get('closed') ?? []).length;
  const conversionPct = deals.length ? Math.round((committedCount / deals.length) * 100) : 0;

  return {
    stages,
    totalDeals: deals.length,
    pipelineValue,
    softCircled,
    committed,
    conversionPct
  };
}
