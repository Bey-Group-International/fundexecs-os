import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { computeLpConcentration, type LpConcentration } from '@/lib/intelligence/lp-concentration';

/* ============================================================================
 * lib/queries/lp-concentration.ts — concentration of the committed LP base.
 *
 * Reads the existing `capital_commitments` + `capital_providers` tables
 * (RLS-scoped via the server client; no new schema), keeps committed-stage
 * commitments, and runs them through the pure concentration scorer. Fail-soft
 * to a safe zero state.
 * ========================================================================= */

const COMMITTED_RE = /(commit|won|closed|funded)/;

const EMPTY: LpConcentration = {
  totalCommitted: 0,
  lpCount: 0,
  ranked: [],
  topLp: null,
  top3Share: 0,
  hhi: 0,
  band: 'Diversified',
  headline: 'No committed LPs yet'
};

export async function getLpConcentration(orgId: string): Promise<LpConcentration> {
  try {
    const supabase = await createClient();
    const [{ data: commitments }, { data: providers }] = await Promise.all([
      supabase.from('capital_commitments').select('lp_id, amount, stage').eq('org_id', orgId),
      supabase.from('capital_providers').select('id, name').eq('org_id', orgId)
    ]);

    const nameById = new Map((providers ?? []).map((p) => [p.id, p.name]));

    const rows = (commitments ?? [])
      .filter((c) => c.lp_id && COMMITTED_RE.test((c.stage || '').toLowerCase()))
      .map((c) => ({
        lpId: c.lp_id as string,
        lpName: nameById.get(c.lp_id as string) ?? 'LP on record',
        amount: c.amount != null ? Number(c.amount) : null
      }));

    return computeLpConcentration(rows);
  } catch {
    return EMPTY;
  }
}
