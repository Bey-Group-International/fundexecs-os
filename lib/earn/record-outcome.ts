import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { OUTCOME_KINDS, type OutcomeKind } from '@/lib/earn/outcomes';
import type { Json } from '@/lib/supabase/database.types';

/* ============================================================================
 * lib/earn/record-outcome — the single approve-loop chokepoint.
 *
 * Every approved move across the firm lands here: Earn's confirm cards
 * (lib/actions/earn-actions.ts) and the tasklet queue (lib/tasklets/actions.ts)
 * both call this one recorder so "draft → approve → provable record" has
 * exactly one implementation. One approval fans out to (1) the Chain-of-Trust
 * audit row (`trust_events`) and (2) the `earn_outcomes` ledger, which carries
 * that audit row's id as its provenance link.
 *
 * Best-effort: a record write must never undo or block the action the operator
 * already approved. Returns the trust_events id (or null) so callers can link
 * the originating row back to its proof.
 * ========================================================================= */

export interface RecordOutcomeParams {
  orgId: string;
  actorId: string;
  entityType: string;
  entityId: string | null;
  /** trust_events.action — the audit verb. */
  action: string;
  /** earn_outcomes.kind — drives the ledger's row + chip. */
  kind: OutcomeKind;
  title: string;
  summary?: string | null;
  /** Where the outcome fanned out to. */
  homeSurface?: string | null;
  homeHref?: string | null;
  metadata: Record<string, unknown>;
}

export async function recordApprovedOutcome(params: RecordOutcomeParams): Promise<string | null> {
  try {
    const supabase = await createClient();

    // The Chain-of-Trust audit row first, so the ledger can link to it.
    const { data: trustRow } = await supabase
      .from('trust_events')
      .insert({
        org_id: params.orgId,
        actor_id: params.actorId,
        entity_type: params.entityType,
        entity_id: params.entityId,
        action: params.action,
        metadata: params.metadata as unknown as Json
      })
      .select('id')
      .single();

    // The compounding ledger row, carrying its provenance. `earn_outcomes` is
    // additive and not yet in the generated types — narrow typed escape insert.
    const ledger = supabase as unknown as {
      from: (table: string) => {
        insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
      };
    };
    await ledger.from('earn_outcomes').insert({
      org_id: params.orgId,
      actor_id: params.actorId,
      kind: params.kind,
      specialist_slug: OUTCOME_KINDS[params.kind].specialistSlug,
      title: params.title,
      summary: params.summary ?? null,
      home_surface: params.homeSurface ?? null,
      home_href: params.homeHref ?? null,
      trust_event_id: trustRow?.id ?? null,
      entity_type: params.entityType,
      entity_id: params.entityId,
      metadata: params.metadata
    });

    return trustRow?.id ?? null;
  } catch {
    // Best-effort — never block the approved action on its record rows.
    return null;
  }
}
