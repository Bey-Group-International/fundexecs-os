'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { recordLoopClose } from '@/lib/actions/loop';
import {
  STEP_SEQUENCE,
  isClosingKind,
  isStepDone,
  nextExecutableSeq,
  type ClosingKind
} from './sequence';

/**
 * lib/closings/actions.ts — the Closings room's mutations.
 *
 * Operator-driven through the approve loop; member-scoped through RLS (write
 * policies added by 20260611240000). The step gate is enforced server-side:
 * only the lowest pending step can execute, and completing the final step
 * closes the closing and feeds the flywheel (`recordLoopClose`), so a real
 * close strengthens the readiness record exactly like the rest of the loop.
 */

export type ClosingActionResult =
  | { ok: true; closingId: string; closed?: boolean }
  | { ok: false; error: string };

const MAX_NAME = 200;

/** Open a closing for a committed counterparty, seeding its step sequence. */
export async function openClosing(input: {
  kind: string;
  counterparty: string;
  amount?: number | null;
}): Promise<ClosingActionResult> {
  if (!isClosingKind(input.kind)) return { ok: false, error: 'Unknown closing kind.' };
  const counterparty = (input.counterparty ?? '').trim().slice(0, MAX_NAME);
  if (!counterparty) return { ok: false, error: 'Missing counterparty.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const amount =
    typeof input.amount === 'number' && Number.isFinite(input.amount) && input.amount > 0
      ? input.amount
      : null;

  const { data: closing, error } = await supabase
    .from('closings')
    .insert({ org_id: org.orgId, kind: input.kind, counterparty, amount, status: 'open' })
    .select('id')
    .single();
  if (error || !closing)
    return { ok: false, error: error?.message ?? 'Could not open the closing.' };

  const sequence = STEP_SEQUENCE[input.kind as ClosingKind];
  const { error: stepsErr } = await supabase.from('closing_steps').insert(
    sequence.map((s, i) => ({
      org_id: org.orgId,
      closing_id: closing.id,
      seq: i + 1,
      name: s.name,
      status: 'pending'
    }))
  );
  if (stepsErr) return { ok: false, error: stepsErr.message };

  revalidatePath('/execute/closings');
  revalidatePath('/execute');
  return { ok: true, closingId: closing.id };
}

/** Execute one step (strictly in order). Closes the closing on the last step. */
export async function executeClosingStep(input: {
  closingId: string;
  seq: number;
}): Promise<ClosingActionResult> {
  if (!input.closingId) return { ok: false, error: 'Missing closing.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const [{ data: closing }, { data: steps }] = await Promise.all([
    supabase
      .from('closings')
      .select('id, kind, counterparty, amount, status')
      .eq('id', input.closingId)
      .eq('org_id', org.orgId)
      .maybeSingle(),
    supabase
      .from('closing_steps')
      .select('id, seq, status')
      .eq('closing_id', input.closingId)
      .eq('org_id', org.orgId)
      .order('seq', { ascending: true })
  ]);
  if (!closing) return { ok: false, error: 'Closing not found.' };
  if (closing.status !== 'open') return { ok: false, error: 'This closing is already closed.' };

  const gate = nextExecutableSeq(steps ?? []);
  if (gate == null) return { ok: false, error: 'All steps are already executed.' };
  if (gate !== input.seq) {
    return { ok: false, error: 'Steps execute in order — an earlier step is still pending.' };
  }

  const step = (steps ?? []).find((s) => s.seq === input.seq);
  if (!step || isStepDone(step.status)) return { ok: false, error: 'Step not executable.' };

  const { error: updErr } = await supabase
    .from('closing_steps')
    .update({ status: 'done' })
    .eq('id', step.id)
    .eq('org_id', org.orgId);
  if (updErr) return { ok: false, error: updErr.message };

  const remaining = (steps ?? []).filter((s) => s.seq !== input.seq && !isStepDone(s.status));
  let closed = false;
  if (remaining.length === 0) {
    const { error: closeErr } = await supabase
      .from('closings')
      .update({ status: 'closed' })
      .eq('id', closing.id)
      .eq('org_id', org.orgId);
    if (!closeErr) {
      closed = true;
      // Chain of Trust: the close is a real record (idempotent) — the run
      // choreography's "Log to Chain of Trust" step, made literal.
      const { data: existingTrust } = await supabase
        .from('chain_of_trust_records')
        .select('id')
        .eq('org_id', org.orgId)
        .eq('entity_type', 'closing')
        .eq('entity_id', closing.id)
        .maybeSingle();
      if (!existingTrust) {
        await supabase.from('chain_of_trust_records').insert({
          org_id: org.orgId,
          entity_type: 'closing',
          entity_id: closing.id,
          current_layer: 'Proof of Execution',
          completion_percentage: 100,
          status: 'active'
        });
      }
      // Feed the flywheel: a completed closing is proof of execution. Deal
      // closes credit the deal lane; LP commitments / engagements credit
      // capital. Idempotent (keyed on the closing id) + best-effort.
      try {
        await recordLoopClose({
          source: closing.kind === 'deal' ? 'deal_closed' : 'capital_closed',
          entityType: closing.kind === 'deal' ? 'deal' : 'capital_commitment',
          entityId: closing.id,
          metadata: { counterparty: closing.counterparty, amount: closing.amount }
        });
      } catch {
        // Never block the close on the flywheel write.
      }
    }
  }

  revalidatePath('/execute/closings');
  revalidatePath('/execute');
  revalidatePath('/command-center');
  return { ok: true, closingId: closing.id, closed };
}
