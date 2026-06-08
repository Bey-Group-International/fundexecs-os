'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { startChainOfTrust } from '@/lib/actions/trust';
import {
  LOOP_SOURCE_LAYER,
  PROOF_LAYER_LABEL,
  applyLoopContribution,
  type LoopCloseSource
} from '@/lib/loop-close';

/* ============================================================================
 * lib/actions/loop.ts — "close the loop" (Drive → Build flywheel).
 *
 * When a deal closes, a diligence run completes, or capital closes, this writes
 * the proof back into the operator's member Chain-of-Trust record so readiness
 * rises automatically (readiness is derived on read from proof-layer
 * completion — see lib/lifecycle.ts). The visible payoff lands on the next load
 * via the Command Center ReadinessGauge and the rail's momentum spine.
 *
 * Idempotent by construction: the append-only `trust_events` table is the
 * ledger. One credit per (entity, loop) — closing the same deal twice can never
 * double-count. Every step degrades gracefully; a failure here must never block
 * the parent close action.
 * ========================================================================= */

/** Stable action name on the trust_events ledger — also the idempotency key. */
const LOOP_ACTION = 'loop_closed';

export interface RecordLoopCloseInput {
  source: LoopCloseSource;
  entityType: 'deal' | 'diligence_run' | 'capital_commitment';
  entityId: string;
  /** Extra context for the ledger row (conviction, amount, name, …). */
  metadata?: Record<string, unknown>;
}

export type RecordLoopCloseResult = { ok: true; credited: boolean } | { ok: false; error: string };

/**
 * Record one execution-event close. Advances the member's relevant proof layer
 * (bounded, derivable via `applyLoopContribution`), keeps the chain record's
 * overall completion coherent, and ledgers a `loop_closed` trust event. Returns
 * `credited: false` when the event was already counted (idempotent replay) or
 * the layer is already evidence-approved at 100.
 */
export async function recordLoopClose(input: RecordLoopCloseInput): Promise<RecordLoopCloseResult> {
  if (!input.entityId) return { ok: false, error: 'Missing entity id.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();

  // Fast-path dedupe: skip the work when this entity was already credited.
  // The real guarantee is the partial unique index on trust_events
  // (org_id, entity_id) WHERE action = 'loop_closed' — see the migration — which
  // makes the marker insert below the atomic gate against concurrent closes.
  const { data: existing } = await supabase
    .from('trust_events')
    .select('id')
    .eq('org_id', org.orgId)
    .eq('action', LOOP_ACTION)
    .eq('entity_id', input.entityId)
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: true, credited: false };

  const layerKey = LOOP_SOURCE_LAYER[input.source];
  const layerLabel = PROOF_LAYER_LABEL[layerKey];

  // Claim the credit FIRST by inserting the idempotency marker. A unique
  // violation means a concurrent/prior close already won — bail without
  // crediting. Any other error means nothing was written, so it's safe to
  // surface and retry (no partial credit).
  const { error: markerErr } = await supabase.from('trust_events').insert({
    org_id: org.orgId,
    actor_id: org.userId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: LOOP_ACTION,
    metadata: {
      source: input.source,
      layer: layerKey,
      ...(input.metadata ?? {})
    }
  });
  if (markerErr) {
    // 23505 = unique_violation: a concurrent/prior close already claimed it.
    if (markerErr.code === '23505') {
      return { ok: true, credited: false };
    }
    return { ok: false, error: markerErr.message };
  }

  // Marker won — now apply the proof credit. Ordering this after the marker
  // means a failure here can only ever *under*-credit (the close didn't
  // strengthen the record), never double-credit; that's the safe direction and
  // is recoverable. Idempotency is already locked in by the marker above.
  let credited = false;

  // Resolve (and ensure) the member-profile chain record — the one readiness
  // reads. Without a manager user id there's no record to strengthen.
  const profile = await getFundProfile(org.orgId).catch(() => null);
  const managerUserId = profile?.managerUserId ?? null;

  if (managerUserId) {
    const { data: chain } = await supabase
      .from('chain_of_trust_records')
      .select('id')
      .eq('org_id', org.orgId)
      .eq('entity_type', 'member_profile')
      .eq('entity_id', managerUserId)
      .maybeSingle();

    let chainId = (chain as { id: string } | null)?.id ?? null;
    if (!chainId) {
      const started = await startChainOfTrust({
        subjectEntityType: 'member_profile',
        subjectEntityId: managerUserId,
        title: profile?.fundName ? `${profile.fundName} — record` : 'Member record'
      });
      if (started.ok) chainId = started.recordId;
    }

    if (chainId) {
      const { data: layer } = await supabase
        .from('proof_layers')
        .select('id, completion_percentage, human_approval_status')
        .eq('chain_record_id', chainId)
        .eq('layer_name', layerLabel)
        .maybeSingle();
      const layerRow = layer as {
        id: string;
        completion_percentage: number;
        human_approval_status: string;
      } | null;

      // Don't touch an evidence-approved layer — human-verified proof outranks
      // auto-credited execution proof.
      if (layerRow && layerRow.human_approval_status !== 'approved') {
        const nextCompletion = applyLoopContribution(
          Number(layerRow.completion_percentage ?? 0),
          input.source
        );
        const { error: layerErr } = await supabase
          .from('proof_layers')
          .update({
            completion_percentage: nextCompletion,
            // Mark the layer underway once real execution starts feeding it.
            human_approval_status:
              layerRow.human_approval_status === 'pending'
                ? 'in_progress'
                : layerRow.human_approval_status
          })
          .eq('id', layerRow.id);
        // Only claim credit if the proof bump actually landed. On failure the
        // marker is already written, so the close stays recorded but uncredited
        // (an honest under-credit) — `credited: false` tells the caller the
        // truth rather than a false positive.
        credited = !layerErr;

        // Keep the chain record's headline completion coherent: the mean of its
        // four layers after the bump. Cosmetic, so failures here are tolerated.
        if (credited) {
          const { data: allLayers } = await supabase
            .from('proof_layers')
            .select('completion_percentage')
            .eq('chain_record_id', chainId);
          const rows = (allLayers ?? []) as Array<{ completion_percentage: number }>;
          if (rows.length > 0) {
            const avg = Math.round(
              rows.reduce((sum, l) => sum + Number(l.completion_percentage ?? 0), 0) / rows.length
            );
            await supabase
              .from('chain_of_trust_records')
              .update({ completion_percentage: avg })
              .eq('id', chainId);
          }
        }
      }
    }
  }

  revalidatePath('/', 'layout');
  return { ok: true, credited };
}
