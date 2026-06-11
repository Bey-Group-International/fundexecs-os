'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { recordLoopClose } from '@/lib/actions/loop';
import { CALL_RESOLVED_STATUS, isCallKind, isLpResolved, type CallKind } from './vocabulary';

/**
 * lib/capital-calls/actions.ts — the Capital calls room's mutations.
 *
 * Operator-driven through the approve loop; member-scoped through RLS
 * (member writes added by 20260611280000). Issuing a call notifies the
 * committed LP roster; each line resolves individually; the call settles
 * only when every line has resolved — and a settled capital call feeds
 * the flywheel like every other real close.
 */

export type CapitalCallActionResult =
  | { ok: true; callId: string; settled?: boolean }
  | { ok: false; error: string };

const MAX_LABEL = 200;

/** The committed-LP statuses a call draws against (Capital Map vocabulary). */
const COMMITTED_RE = /(commit|won|closed|funded)/;

/** Issue a capital call or distribution against the committed LP roster. */
export async function issueCapitalCall(input: {
  kind: string;
  label: string;
  total?: number | null;
  pct?: number | null;
  dueAt?: string | null;
}): Promise<CapitalCallActionResult> {
  if (!isCallKind(input.kind)) return { ok: false, error: 'Unknown kind.' };
  const label = (input.label ?? '').trim().slice(0, MAX_LABEL);
  if (!label) return { ok: false, error: 'Name the call.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();

  // The roster comes from the Capital Map — committed LPs only. No roster,
  // no call: nothing is issued against thin air.
  const { data: lps } = await supabase
    .from('capital_providers')
    .select('id, name, status')
    .eq('org_id', org.orgId);
  const committed = (lps ?? []).filter((lp) => COMMITTED_RE.test((lp.status || '').toLowerCase()));
  if (committed.length === 0) {
    return {
      ok: false,
      error: 'No committed LPs on your Capital Map yet — commitments come first.'
    };
  }

  const total =
    typeof input.total === 'number' && Number.isFinite(input.total) && input.total > 0
      ? input.total
      : null;
  const pct =
    typeof input.pct === 'number' && Number.isFinite(input.pct) && input.pct > 0 && input.pct <= 100
      ? input.pct
      : null;
  const dueAt = input.dueAt && !Number.isNaN(Date.parse(input.dueAt)) ? input.dueAt : null;

  const { data: call, error } = await supabase
    .from('capital_calls')
    .insert({
      org_id: org.orgId,
      kind: input.kind,
      label,
      total,
      pct,
      due_at: dueAt,
      status: 'issued'
    })
    .select('id')
    .single();
  if (error || !call) return { ok: false, error: error?.message ?? 'Could not issue the call.' };

  const { error: linesErr } = await supabase.from('call_lp_status').insert(
    committed.map((lp) => ({
      org_id: org.orgId,
      call_id: call.id,
      lp_ref: lp.name,
      status: 'notified'
    }))
  );
  if (linesErr) return { ok: false, error: linesErr.message };

  revalidatePath('/execute/capital');
  revalidatePath('/execute');
  return { ok: true, callId: call.id };
}

/** Resolve one LP line (funded / paid). Settles the call when all resolve. */
export async function resolveCallLp(input: {
  callId: string;
  lineId: string;
}): Promise<CapitalCallActionResult> {
  if (!input.callId || !input.lineId) return { ok: false, error: 'Missing line.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const [{ data: call }, { data: lines }] = await Promise.all([
    supabase
      .from('capital_calls')
      .select('id, kind, label, total, status')
      .eq('id', input.callId)
      .eq('org_id', org.orgId)
      .maybeSingle(),
    supabase
      .from('call_lp_status')
      .select('id, lp_ref, status')
      .eq('call_id', input.callId)
      .eq('org_id', org.orgId)
  ]);
  if (!call) return { ok: false, error: 'Call not found.' };
  if (call.status === 'settled') return { ok: false, error: 'This call is already settled.' };
  if (!isCallKind(call.kind)) return { ok: false, error: 'Unknown call kind.' };
  const kind = call.kind as CallKind;

  const line = (lines ?? []).find((l) => l.id === input.lineId);
  if (!line) return { ok: false, error: 'LP line not found.' };
  if (isLpResolved(kind, line.status)) {
    return { ok: false, error: `${line.lp_ref} is already resolved.` };
  }

  const resolvedStatus = CALL_RESOLVED_STATUS[kind];
  const { error: updErr } = await supabase
    .from('call_lp_status')
    .update({ status: resolvedStatus, updated_at: new Date().toISOString() })
    .eq('id', line.id)
    .eq('org_id', org.orgId);
  if (updErr) return { ok: false, error: updErr.message };

  const remaining = (lines ?? []).filter(
    (l) => l.id !== input.lineId && !isLpResolved(kind, l.status)
  );
  let settled = false;
  if (remaining.length === 0) {
    const { error: settleErr } = await supabase
      .from('capital_calls')
      .update({ status: 'settled', updated_at: new Date().toISOString() })
      .eq('id', call.id)
      .eq('org_id', org.orgId);
    if (!settleErr) {
      settled = true;
      if (kind === 'call') {
        // A fully funded call is capital actually in — feed the flywheel.
        // Idempotent (keyed on the call id) + best-effort.
        try {
          await recordLoopClose({
            source: 'capital_closed',
            entityType: 'capital_commitment',
            entityId: call.id,
            metadata: { label: call.label, total: call.total }
          });
        } catch {
          // Never block the settle on the flywheel write.
        }
      }
    }
  }

  revalidatePath('/execute/capital');
  revalidatePath('/execute');
  revalidatePath('/command-center');
  return { ok: true, callId: call.id, settled };
}
