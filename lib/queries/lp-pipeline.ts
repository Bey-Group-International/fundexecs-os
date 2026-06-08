import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  LP_STAGES,
  type LpEntry,
  type LpPipelineData,
  type LpStageColumn,
  type LpStageKey
} from '@/lib/pipeline/lp-stages';

/* ============================================================================
 * lib/queries/lp-pipeline.ts — the LP Pipeline loader.
 *
 * The LP pipeline is a stage board over `capital_providers` (shared with the
 * Partner Marketplace's capital side): an LP's `status` is its pipeline stage.
 * Returns LPs grouped into the canonical stages with AI-enriched metadata, a
 * lightweight progress score, and roll-up totals. Stage constants + view types
 * live in `lib/pipeline/lp-stages` so the client board can import them too.
 * ========================================================================= */

export {
  LP_STAGES,
  LP_STAGE_KEYS,
  type LpStageKey,
  type LpEntry,
  type LpStageColumn,
  type LpPipelineData
} from '@/lib/pipeline/lp-stages';

const STAGE_PROGRESS: Record<LpStageKey, number> = {
  prospect: 25,
  contacted: 50,
  soft_circled: 75,
  committed: 100
};

/** Map a free-form capital_providers.status to a canonical board stage. */
function normalizeStage(status: string): LpStageKey | 'passed' {
  const s = (status || '').toLowerCase();
  if (/(commit|won|closed|funded)/.test(s)) return 'committed';
  if (/(soft|circle)/.test(s)) return 'soft_circled';
  if (/(contact|engage|intro|active|warm|meeting)/.test(s)) return 'contacted';
  if (/(pass|dead|lost|declin|cold)/.test(s)) return 'passed';
  return 'prospect';
}

/** A single representative commitment value for an LP (range midpoint). */
function lpValue(min: number | null, max: number | null): number {
  if (min != null && max != null) return Math.round((min + max) / 2);
  return max ?? min ?? 0;
}

export async function getLpPipeline(orgId: string): Promise<LpPipelineData> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('capital_providers')
    .select('id, name, status, capital_types, check_size_min, check_size_max, criteria, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  const columns: LpStageColumn[] = LP_STAGES.map((s) => ({ key: s.key, label: s.label, lps: [] }));
  const byStage = new Map<LpStageKey, LpEntry[]>(columns.map((c) => [c.key, c.lps]));

  let committedValue = 0;
  let softCircledValue = 0;
  let passedCount = 0;
  let totalLps = 0;

  for (const row of error ? [] : (data ?? [])) {
    const normalized = normalizeStage(row.status);
    if (normalized === 'passed') {
      passedCount += 1;
      continue;
    }
    const meta = (row.criteria as Record<string, unknown> | null) ?? {};
    const min = row.check_size_min;
    const max = row.check_size_max;
    const entry: LpEntry = {
      id: row.id,
      name: row.name,
      stage: normalized,
      capitalTypes: row.capital_types ?? [],
      checkSizeMin: min,
      checkSizeMax: max,
      description: typeof meta.description === 'string' ? meta.description : null,
      fitRationale: typeof meta.fitRationale === 'string' ? meta.fitRationale : null,
      assignedSpecialist:
        typeof meta.assignedSpecialist === 'string' ? meta.assignedSpecialist : null,
      firstTouchNote: typeof meta.firstTouchNote === 'string' ? meta.firstTouchNote : null,
      fit: STAGE_PROGRESS[normalized],
      createdAt: row.created_at
    };
    byStage.get(normalized)!.push(entry);
    totalLps += 1;
    if (normalized === 'committed') committedValue += lpValue(min, max);
    if (normalized === 'soft_circled') softCircledValue += lpValue(min, max);
  }

  return {
    columns,
    totalLps,
    committedValue,
    softCircledValue,
    passedCount,
    empty: totalLps === 0
  };
}
