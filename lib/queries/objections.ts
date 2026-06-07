import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

/* ============================================================================
 * lib/queries/objections.ts — Objections (capital formation) surface loader.
 *
 * Reads the `objections` table (LP-tied objections + Earn-drafted rebuttals,
 * open/resolved status) joined to the `capital_providers` LP name. Mutations
 * go through the EXISTING `upsert_objection` / `resolve_objection` RPCs via
 * `lib/actions/objections.ts`; this file is read-only and degrades to an empty
 * dataset so the page never throws at render time.
 * ========================================================================= */

type ObjectionRow = Database['public']['Tables']['objections']['Row'];

export type ObjectionStatus = 'open' | 'resolved';

export interface ObjectionItem {
  id: string;
  category: string;
  objection: string;
  rebuttal: string | null;
  status: ObjectionStatus;
  lpId: string | null;
  lpName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectionsData {
  items: ObjectionItem[];
  total: number;
  openCount: number;
  resolvedCount: number;
  /** Resolution rate (0–100) across all logged objections. */
  resolutionPct: number;
  /** Distinct objection categories ranked by frequency, most-common first. */
  categories: Array<{ category: string; count: number }>;
  /** LPs available to attach a new objection to (name-sorted). */
  lps: Array<{ id: string; name: string }>;
  empty: boolean;
}

function normalizeStatus(status: string): ObjectionStatus {
  return status.trim().toLowerCase() === 'resolved' ? 'resolved' : 'open';
}

export async function getObjectionsData(orgId: string): Promise<ObjectionsData> {
  const supabase = await createClient();

  const [objectionsResult, lpsResult] = await Promise.all([
    supabase
      .from('objections')
      .select(
        'id, category, objection, rebuttal, status, lp_id, resolved_at, created_at, updated_at'
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('capital_providers')
      .select('id, name')
      .eq('org_id', orgId)
      .order('name', { ascending: true })
      .limit(500)
  ]);

  const lps = ((lpsResult.data ?? []) as Array<{ id: string; name: string }>).map((l) => ({
    id: l.id,
    name: l.name
  }));
  const lpNameById = new Map(lps.map((l) => [l.id, l.name]));

  const rows = (objectionsResult.data ?? []) as Array<
    Pick<
      ObjectionRow,
      | 'id'
      | 'category'
      | 'objection'
      | 'rebuttal'
      | 'status'
      | 'lp_id'
      | 'resolved_at'
      | 'created_at'
      | 'updated_at'
    >
  >;

  const items: ObjectionItem[] = rows.map((r) => ({
    id: r.id,
    category: r.category,
    objection: r.objection,
    rebuttal: r.rebuttal,
    status: normalizeStatus(r.status),
    lpId: r.lp_id,
    lpName: r.lp_id ? (lpNameById.get(r.lp_id) ?? null) : null,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));

  const openCount = items.filter((i) => i.status === 'open').length;
  const resolvedCount = items.length - openCount;
  const resolutionPct = items.length ? Math.round((resolvedCount / items.length) * 100) : 0;

  const categoryCounts = new Map<string, number>();
  for (const i of items) {
    const key = i.category.trim() || 'Uncategorized';
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
  }
  const categories = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return {
    items,
    total: items.length,
    openCount,
    resolvedCount,
    resolutionPct,
    categories,
    lps,
    empty: items.length === 0
  };
}
