import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

/* ============================================================================
 * lib/queries/cap-table.ts — Cap Table surface loader.
 *
 * Reads `cap_table_entries` for the active org via the authed server client
 * (RLS-gated via private.is_org_member). Returns an honest empty state when
 * there are no rows. Throws on Supabase errors rather than masking failures.
 * ========================================================================= */

type CapTableRow = Database['public']['Tables']['cap_table_entries']['Row'];

/* --------------------------------------------------------------------------
 * Public types
 * --------------------------------------------------------------------------*/

export interface CapTableEntry {
  id: string;
  orgId: string;
  holderName: string;
  holderType: string;
  securityType: string;
  units: number;
  amountInvested: number | null;
  ownershipPct: number | null;
  asOfDate: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CapTableSummary {
  /** Sum of all units across entries */
  totalUnits: number;
  /** Sum of all amount_invested values (entries with a value set) */
  totalInvested: number;
  /**
   * Fully-diluted ownership breakdown by holder_type.
   * Denominator is sum of ownership_pct when all entries carry a value;
   * otherwise falls back to proportional units share.
   */
  ownershipByType: Record<string, number>;
}

export interface CapTableData {
  entries: CapTableEntry[];
  summary: CapTableSummary;
  /** True when the org has no rows yet. */
  empty: boolean;
}

/* --------------------------------------------------------------------------
 * Mapping
 * --------------------------------------------------------------------------*/

function mapEntry(row: CapTableRow): CapTableEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    holderName: row.holder_name,
    holderType: row.holder_type,
    securityType: row.security_type,
    units: Number(row.units),
    amountInvested: row.amount_invested !== null ? Number(row.amount_invested) : null,
    ownershipPct: row.ownership_pct !== null ? Number(row.ownership_pct) : null,
    asOfDate: row.as_of_date,
    memo: row.memo,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/* --------------------------------------------------------------------------
 * Summary derivation
 * --------------------------------------------------------------------------*/

function buildSummary(entries: CapTableEntry[]): CapTableSummary {
  const totalUnits = entries.reduce((sum, e) => sum + e.units, 0);
  const totalInvested = entries.reduce((sum, e) => sum + (e.amountInvested ?? 0), 0);

  // If every entry carries an explicit ownership_pct, sum by holder_type using
  // those values. Otherwise fall back to proportional units.
  const allHavePct = entries.length > 0 && entries.every((e) => e.ownershipPct !== null);

  const ownershipByType: Record<string, number> = {};

  if (allHavePct) {
    for (const entry of entries) {
      const t = entry.holderType;
      ownershipByType[t] = (ownershipByType[t] ?? 0) + (entry.ownershipPct as number);
    }
  } else if (totalUnits > 0) {
    for (const entry of entries) {
      const t = entry.holderType;
      const share = (entry.units / totalUnits) * 100;
      ownershipByType[t] = (ownershipByType[t] ?? 0) + share;
    }
  }

  return { totalUnits, totalInvested, ownershipByType };
}

/* --------------------------------------------------------------------------
 * Loader
 * --------------------------------------------------------------------------*/

/**
 * Load cap-table entries for `orgId`.
 *
 * RLS (`private.is_org_member`) scopes the result to members of the org.
 * Throws on query errors rather than silently returning empty data.
 */
export async function getCapTableData(orgId: string): Promise<CapTableData> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('cap_table_entries')
    .select('*')
    .eq('org_id', orgId)
    .order('holder_type', { ascending: true })
    .order('holder_name', { ascending: true });

  if (error) {
    throw new Error(`Failed to load cap table entries: ${error.message}`);
  }

  const entries: CapTableEntry[] = (data ?? []).map(mapEntry);
  const summary = buildSummary(entries);
  const empty = entries.length === 0;

  return { entries, summary, empty };
}
