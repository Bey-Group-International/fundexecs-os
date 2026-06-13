import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { type EarnOutcome, type OutcomeKind, isOutcomeKind } from '@/lib/earn/outcomes';

/* ============================================================================
 * lib/queries/earn-outcomes.ts — the Earn ledger read surface.
 *
 * Read-only over the `earn_outcomes` table (RLS-scoped): one row per approved
 * Earn action, written by the approve loop. `earn_outcomes` is additive and
 * not yet in the generated Supabase types, so we read through a narrow typed
 * escape (same pattern as inbox.ts).
 *
 * The table is empty until the approve loop starts writing to it. Every read
 * fails OPEN to an empty ledger so the `/earn` surface never breaks the shell.
 * ========================================================================= */

export type { EarnOutcome };

export interface EarnLedgerData {
  outcomes: EarnOutcome[];
  /** Count per kind — drives the filter-chip badges. */
  countsByKind: Partial<Record<OutcomeKind, number>>;
  empty: boolean;
}

interface OutcomeRow {
  id: string;
  kind: string;
  specialist_slug: string;
  title: string;
  summary: string | null;
  home_surface: string | null;
  home_href: string | null;
  trust_event_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
}

/** Narrow typed escape over the not-yet-generated `earn_outcomes` table. */
function outcomesReader(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (
          col: string,
          val: string
        ) => {
          order: (
            col: string,
            opts: { ascending: boolean }
          ) => {
            limit: (
              n: number
            ) => Promise<{ data: OutcomeRow[] | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
}

function toOutcome(r: OutcomeRow): EarnOutcome | null {
  if (!isOutcomeKind(r.kind)) return null;
  return {
    id: r.id,
    kind: r.kind,
    specialistSlug: r.specialist_slug,
    title: r.title,
    summary: r.summary,
    homeSurface: r.home_surface,
    homeHref: r.home_href,
    hasTrustProof: !!r.trust_event_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    createdAt: r.created_at
  };
}

/** Load the org's Earn ledger — newest first. Fails open to an empty ledger. */
export async function getEarnLedger(orgId: string): Promise<EarnLedgerData> {
  const supabase = await createClient();

  try {
    const { data, error } = await outcomesReader(supabase)
      .from('earn_outcomes')
      .select(
        'id, kind, specialist_slug, title, summary, home_surface, home_href, trust_event_id, entity_type, entity_id, created_at'
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error || !data) {
      if (error) console.warn('[getEarnLedger] read failed:', error.message);
      return { outcomes: [], countsByKind: {}, empty: true };
    }

    const outcomes = data.map(toOutcome).filter((o): o is EarnOutcome => o !== null);

    const countsByKind: Partial<Record<OutcomeKind, number>> = {};
    for (const o of outcomes) countsByKind[o.kind] = (countsByKind[o.kind] ?? 0) + 1;

    return { outcomes, countsByKind, empty: outcomes.length === 0 };
  } catch (err) {
    console.warn('[getEarnLedger] unexpected error:', err);
    return { outcomes: [], countsByKind: {}, empty: true };
  }
}
