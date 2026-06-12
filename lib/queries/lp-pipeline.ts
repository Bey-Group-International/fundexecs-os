import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseLpMeta } from '@/lib/pipeline/lp-meta';
import {
  LP_STAGES,
  lpValue,
  normalizeLpStage,
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
 * Returns LPs grouped into the canonical stages with AI-enriched metadata
 * (parsed honestly — a missing fit score stays null) and roll-up totals.
 * Stage constants + view types live in `lib/pipeline/lp-stages` so the client
 * board can import them too.
 * ========================================================================= */

export {
  LP_STAGES,
  LP_STAGE_KEYS,
  type LpStageKey,
  type LpEntry,
  type LpStageColumn,
  type LpPipelineData
} from '@/lib/pipeline/lp-stages';

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
    const normalized = normalizeLpStage(row.status);
    if (normalized === 'passed') {
      passedCount += 1;
      continue;
    }
    const meta = parseLpMeta(row.criteria);
    const min = row.check_size_min;
    const max = row.check_size_max;
    const entry: LpEntry = {
      id: row.id,
      name: row.name,
      stage: normalized,
      capitalTypes: row.capital_types ?? [],
      checkSizeMin: min,
      checkSizeMax: max,
      description: meta.description,
      fitRationale: meta.fitRationale,
      assignedSpecialist: meta.assignedSpecialist,
      firstTouchNote: meta.firstTouchNote,
      fit: meta.fit,
      warmth: meta.warmth,
      source: meta.source,
      lastTouch: meta.lastTouch,
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
