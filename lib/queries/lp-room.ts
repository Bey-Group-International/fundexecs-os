import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

/* ============================================================================
 * lib/queries/lp-room.ts — LP Room distributions + capital-account loader.
 *
 * Reads the `distributions` and `capital_account_entries` tables for the
 * active org via the authed server client (RLS-gated). Returns honest empty
 * states when there is no data — callers fall back to fixture samples only
 * when clearly flagged as sample/empty.
 * ========================================================================= */

type DistributionRow = Database['public']['Tables']['distributions']['Row'];
type CapitalAccountRow = Database['public']['Tables']['capital_account_entries']['Row'];

/* --------------------------------------------------------------------------
 * Distribution
 * --------------------------------------------------------------------------*/

export type DistributionKind =
  | 'return_of_capital'
  | 'profit'
  | 'dividend'
  | 'recallable'
  | 'special'
  | 'other';

export type DistributionStatus = 'pending' | 'paid' | 'cancelled';

export interface Distribution {
  id: string;
  orgId: string;
  lpId: string | null;
  amount: number;
  distributionDate: string;
  kind: DistributionKind;
  status: DistributionStatus;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

/* --------------------------------------------------------------------------
 * Capital account entry
 * --------------------------------------------------------------------------*/

export type CapitalAccountEntryType =
  | 'commitment'
  | 'capital_call'
  | 'distribution'
  | 'nav_adjustment'
  | 'fee'
  | 'other';

export interface CapitalAccountEntry {
  id: string;
  orgId: string;
  lpId: string | null;
  entryDate: string;
  entryType: CapitalAccountEntryType;
  amount: number;
  balanceAfter: number | null;
  memo: string | null;
  createdAt: string;
}

/* --------------------------------------------------------------------------
 * Aggregate summary derived from entries
 * --------------------------------------------------------------------------*/

export interface CapitalAccountSummary {
  /** Total committed (sum of commitment entries) */
  committed: number;
  /** Total called (sum of capital_call entries) */
  called: number;
  /** Total distributed (sum of distribution entries, positive) */
  distributed: number;
  /** Latest balance_after from entries, or null when not set */
  navBalance: number | null;
  /** Balance progression over time (ordered entry balances for sparkline) */
  balanceSeries: number[];
}

/* --------------------------------------------------------------------------
 * Combined LP Room data from the DB
 * --------------------------------------------------------------------------*/

export interface LpRoomDbData {
  distributions: Distribution[];
  capitalAccountEntries: CapitalAccountEntry[];
  capitalAccountSummary: CapitalAccountSummary;
  /** True when both tables returned zero rows for the org */
  empty: boolean;
}

function mapDistribution(row: DistributionRow): Distribution {
  return {
    id: row.id,
    orgId: row.org_id,
    lpId: row.lp_id,
    amount: Number(row.amount),
    distributionDate: row.distribution_date,
    kind: row.kind as DistributionKind,
    status: row.status as DistributionStatus,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCapitalAccountEntry(row: CapitalAccountRow): CapitalAccountEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    lpId: row.lp_id,
    entryDate: row.entry_date,
    entryType: row.entry_type as CapitalAccountEntryType,
    amount: Number(row.amount),
    balanceAfter: row.balance_after !== null ? Number(row.balance_after) : null,
    memo: row.memo,
    createdAt: row.created_at
  };
}

function summariseEntries(entries: CapitalAccountEntry[]): CapitalAccountSummary {
  let committed = 0;
  let called = 0;
  let distributed = 0;

  const balanceSeries: number[] = [];
  let navBalance: number | null = null;

  for (const e of entries) {
    if (e.entryType === 'commitment') committed += e.amount;
    if (e.entryType === 'capital_call') called += Math.abs(e.amount);
    if (e.entryType === 'distribution') distributed += Math.abs(e.amount);
    if (e.balanceAfter !== null) {
      balanceSeries.push(e.balanceAfter);
      navBalance = e.balanceAfter;
    }
  }

  return { committed, called, distributed, navBalance, balanceSeries };
}

/**
 * Load distributions and capital-account entries for `orgId`.
 * Rows are already scoped by RLS (`private.is_org_member`), so the caller
 * needs only to be authenticated.
 */
export async function getLpRoomData(orgId: string): Promise<LpRoomDbData> {
  const supabase = await createClient();

  const [distributionsResult, entriesResult] = await Promise.all([
    supabase
      .from('distributions')
      .select('*')
      .eq('org_id', orgId)
      .order('distribution_date', { ascending: false })
      .limit(200),
    supabase
      .from('capital_account_entries')
      .select('*')
      .eq('org_id', orgId)
      .order('entry_date', { ascending: true })
      .limit(500)
  ]);

  const distributions: Distribution[] = (distributionsResult.data ?? []).map(mapDistribution);
  const capitalAccountEntries: CapitalAccountEntry[] = (entriesResult.data ?? []).map(
    mapCapitalAccountEntry
  );

  const capitalAccountSummary = summariseEntries(capitalAccountEntries);
  const empty = distributions.length === 0 && capitalAccountEntries.length === 0;

  return { distributions, capitalAccountEntries, capitalAccountSummary, empty };
}
