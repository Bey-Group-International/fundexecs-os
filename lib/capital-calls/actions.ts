'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { recordLoopClose } from '@/lib/actions/loop';
import {
  CALL_RESOLVED_STATUS,
  isCallKind,
  isCallOverdue,
  isLpResolved,
  proRataShares,
  type CallKind
} from './vocabulary';

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
  // no call: nothing is issued against thin air. Commitment amounts ride
  // along so each LP line can carry its pro-rata share, fixed at issue time.
  // Fail closed: a read error must abort issuance, never degrade into wrong
  // shares or a false "no committed LPs".
  const [{ data: lps, error: lpsErr }, { data: commitments, error: commitmentsErr }] =
    await Promise.all([
      supabase.from('capital_providers').select('id, name, status').eq('org_id', org.orgId),
      supabase.from('capital_commitments').select('lp_id, amount, stage').eq('org_id', org.orgId)
    ]);
  if (lpsErr || commitmentsErr) {
    return {
      ok: false,
      error: lpsErr?.message ?? commitmentsErr?.message ?? 'Could not load the committed roster.'
    };
  }
  const committed = (lps ?? []).filter((lp) => COMMITTED_RE.test((lp.status || '').toLowerCase()));
  if (committed.length === 0) {
    return {
      ok: false,
      error: 'No committed LPs on your Capital Map yet — commitments come first.'
    };
  }

  const weightByLp = new Map<string, number>();
  for (const c of commitments ?? []) {
    if (!c.lp_id || !COMMITTED_RE.test((c.stage || '').toLowerCase())) continue;
    const amt = Number(c.amount);
    if (Number.isFinite(amt) && amt > 0) {
      weightByLp.set(c.lp_id, (weightByLp.get(c.lp_id) ?? 0) + amt);
    }
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

  const shares = proRataShares(
    total,
    committed.map((lp) => weightByLp.get(lp.id) ?? null)
  );
  const { error: linesErr } = await supabase.from('call_lp_status').insert(
    committed.map((lp, i) => ({
      org_id: org.orgId,
      call_id: call.id,
      lp_ref: lp.name,
      status: 'notified',
      amount: shares[i]
    }))
  );
  if (linesErr) {
    // No lines, no call: compensate so an issued call never exists without
    // its funnel (Supabase has no client-side transaction to lean on).
    await supabase.from('capital_calls').delete().eq('id', call.id).eq('org_id', org.orgId);
    return { ok: false, error: linesErr.message };
  }

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

  // Re-read after the update so two operators resolving the last lines
  // concurrently can't both see "one still open" and leave the call
  // unsettled forever.
  const { data: currentLines, error: recheckErr } = await supabase
    .from('call_lp_status')
    .select('id, status')
    .eq('call_id', input.callId)
    .eq('org_id', org.orgId);
  if (recheckErr) return { ok: false, error: recheckErr.message };

  const remaining = (currentLines ?? []).filter((l) => !isLpResolved(kind, l.status));
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

/**
 * Chase an overdue LP line — records that the reminder went out (chased_at).
 * Honesty contract: chasing never resolves the line; the money is marked in
 * only when the operator confirms receipt against their bank (resolveCallLp).
 * Overdue is server-derived from the call's due date, never trusted from
 * the client.
 */
export async function chaseCallLp(input: {
  callId: string;
  lineId: string;
}): Promise<CapitalCallActionResult> {
  if (!input.callId || !input.lineId) return { ok: false, error: 'Missing line.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const [{ data: call }, { data: line }] = await Promise.all([
    supabase
      .from('capital_calls')
      .select('id, kind, due_at, status')
      .eq('id', input.callId)
      .eq('org_id', org.orgId)
      .maybeSingle(),
    supabase
      .from('call_lp_status')
      .select('id, lp_ref, status')
      .eq('id', input.lineId)
      .eq('call_id', input.callId)
      .eq('org_id', org.orgId)
      .maybeSingle()
  ]);
  if (!call) return { ok: false, error: 'Call not found.' };
  if (call.status === 'settled') return { ok: false, error: 'This call is already settled.' };
  if (!isCallKind(call.kind)) return { ok: false, error: 'Unknown call kind.' };
  if (!line) return { ok: false, error: 'LP line not found.' };
  if (isLpResolved(call.kind, line.status)) {
    return { ok: false, error: `${line.lp_ref} is already resolved.` };
  }
  if (!isCallOverdue(call.due_at, new Date())) {
    return { ok: false, error: 'This line is not overdue yet — nothing to chase.' };
  }

  const { error: updErr } = await supabase
    .from('call_lp_status')
    .update({ chased_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', line.id)
    .eq('org_id', org.orgId);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath('/execute/capital');
  revalidatePath('/execute');
  return { ok: true, callId: call.id };
}
