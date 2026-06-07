import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

/* ============================================================================
 * lib/queries/capital-stack.ts — Capital Stack surface loader.
 *
 * Reads the `capital_stack_summary` RPC (stage + lp_type breakdown, gap-to-
 * target, totals) and the `capital_commitments` table (individual rows for the
 * commitments table). Falls back gracefully when the RPC returns no data.
 * ========================================================================= */

export interface CapitalStackSummary {
  orgId: string;
  currency: string;
  targetTotal: number;
  committedTotal: number;
  softCircleTotal: number;
  activeTotal: number;
  closedTotal: number;
  withdrawnTotal: number;
  gapToTarget: number;
  /** JSON object: { [stage: string]: number } */
  stageTotals: Record<string, number>;
  /** JSON object: { [lp_type: string]: number } */
  lpTypeTotals: Record<string, number>;
}

export interface CapitalCommitment {
  id: string;
  stage: string;
  lpType: string | null;
  amount: number;
  currency: string;
  expectedClose: string | null;
  tranche: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CapitalStackData {
  summary: CapitalStackSummary | null;
  commitments: CapitalCommitment[];
  empty: boolean;
}

type RpcRow = Database['public']['Functions']['capital_stack_summary']['Returns'][number];

function safeRecord(v: unknown): Record<string, number> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, number>;
  }
  return {};
}

export async function getCapitalStackData(orgId: string): Promise<CapitalStackData> {
  const supabase = await createClient();

  const [rpcResult, commitmentsResult] = await Promise.all([
    supabase.rpc('capital_stack_summary', { _org_id: orgId }),
    supabase
      .from('capital_commitments')
      .select('id, stage, lp_type, amount, currency, expected_close, tranche, notes, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100)
  ]);

  const row: RpcRow | null = Array.isArray(rpcResult.data)
    ? (rpcResult.data[0] ?? null)
    : (rpcResult.data ?? null);

  const summary: CapitalStackSummary | null = row
    ? {
        orgId: row.org_id,
        currency: row.currency ?? 'USD',
        targetTotal: Number(row.target_total ?? 0),
        committedTotal: Number(row.committed_total ?? 0),
        softCircleTotal: Number(row.soft_circle_total ?? 0),
        activeTotal: Number(row.active_total ?? 0),
        closedTotal: Number(row.closed_total ?? 0),
        withdrawnTotal: Number(row.withdrawn_total ?? 0),
        gapToTarget: Number(row.gap_to_target ?? 0),
        stageTotals: safeRecord(row.stage_totals),
        lpTypeTotals: safeRecord(row.lp_type_totals)
      }
    : null;

  const commitments: CapitalCommitment[] = (
    (commitmentsResult.data ?? []) as Array<{
      id: string;
      stage: string;
      lp_type: string | null;
      amount: number;
      currency: string;
      expected_close: string | null;
      tranche: string | null;
      notes: string | null;
      created_at: string;
    }>
  ).map((c) => ({
    id: c.id,
    stage: c.stage,
    lpType: c.lp_type,
    amount: c.amount,
    currency: c.currency ?? 'USD',
    expectedClose: c.expected_close,
    tranche: c.tranche,
    notes: c.notes,
    createdAt: c.created_at
  }));

  const empty = !summary && commitments.length === 0;
  return { summary, commitments, empty };
}
