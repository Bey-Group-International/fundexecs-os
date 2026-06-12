'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { canResolveSignature, isWireDirection, nextWireStatus } from './vocabulary';

/**
 * lib/wires/actions.ts — the Signatures & wires room's mutations.
 *
 * Operator-driven through the approve loop; member-scoped through RLS
 * (20260611280000). Gates are enforced server-side: a signature resolves
 * exactly once, and a wire advances strictly one stage at a time
 * (instructed → sent → settled) — the same one-stage discipline as every
 * other hub interior.
 */

export type WiresActionResult =
  | {
      ok: true;
      id: string;
      /** Whether the Chain of Trust record actually landed (signed/settled acts only). */
      trustLogged?: boolean;
    }
  | { ok: false; error: string };

const MAX_TEXT = 200;

function clean(value: string | null | undefined, max = MAX_TEXT): string {
  return (value ?? '').trim().slice(0, max);
}

/**
 * Resolve a client-provided closing id to one this org actually owns and
 * that is still open — never trust the raw id into an insert.
 */
async function resolveOpenClosingId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  closingId: string | null | undefined
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  if (!closingId) return { ok: true, id: null };
  const { data, error } = await supabase
    .from('closings')
    .select('id')
    .eq('id', closingId)
    .eq('org_id', orgId)
    .eq('status', 'open')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'That closing is not open in this workspace.' };
  return { ok: true, id: data.id };
}

/** Send a document out for signature (optionally tied to an open closing). */
export async function sendSignature(input: {
  document: string;
  signer: string;
  closingId?: string | null;
}): Promise<WiresActionResult> {
  const document = clean(input.document);
  const signer = clean(input.signer);
  if (!document) return { ok: false, error: 'Name the document.' };
  if (!signer) return { ok: false, error: 'Name the signer.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const closing = await resolveOpenClosingId(supabase, org.orgId, input.closingId);
  if (!closing.ok) return closing;
  const { data, error } = await supabase
    .from('signatures')
    .insert({
      org_id: org.orgId,
      closing_id: closing.id,
      document,
      signer,
      status: 'out_for_signature'
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not send it out.' };

  revalidatePath('/execute/wires');
  revalidatePath('/execute');
  return { ok: true, id: data.id };
}

/**
 * Record a signature's resolution — signed or declined, exactly once.
 *
 * Marking signed records the operator's ATTESTATION: the document was
 * executed outside FundExecs OS. E-sign hook point: when the DocuSign
 * slice lands, the envelope-completed webhook calls this same resolution
 * path with the envelope id in tow — the vocabulary and the gate don't
 * change, only who reports the outcome.
 */
export async function resolveSignature(input: {
  signatureId: string;
  outcome: 'signed' | 'declined';
}): Promise<WiresActionResult> {
  if (!input.signatureId) return { ok: false, error: 'Missing signature.' };
  if (input.outcome !== 'signed' && input.outcome !== 'declined') {
    return { ok: false, error: 'Unknown outcome.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data: sig } = await supabase
    .from('signatures')
    .select('id, status')
    .eq('id', input.signatureId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (!sig) return { ok: false, error: 'Signature not found.' };
  if (!canResolveSignature(sig.status)) {
    return { ok: false, error: 'This signature is already resolved.' };
  }

  const { data: resolved, error } = await supabase
    .from('signatures')
    .update({
      status: input.outcome,
      signed_at: input.outcome === 'signed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', sig.id)
    .eq('org_id', org.orgId)
    // Compare-and-set: a signature resolves exactly once, even under
    // concurrent operators — zero matched rows means it just resolved.
    .eq('status', sig.status)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!resolved) {
    return { ok: false, error: 'This signature just changed — refresh and try again.' };
  }

  let trustLogged: boolean | undefined;
  if (input.outcome === 'signed') {
    // Chain of Trust: the attestation is a real record (idempotent) — the
    // run choreography's "Log to Chain of Trust" step, made literal. The
    // result rides along so the UI never claims a log that didn't happen.
    trustLogged = await logExecutionRecord(supabase, org.orgId, 'signature', sig.id);
  }

  revalidatePath('/execute/wires');
  revalidatePath('/execute');
  return { ok: true, id: sig.id, trustLogged };
}

/**
 * Chase an outstanding signature — records that the reminder went out
 * (chased_at). Chasing never resolves the request; the outcome lands
 * separately through resolveSignature.
 */
export async function chaseSignature(input: { signatureId: string }): Promise<WiresActionResult> {
  if (!input.signatureId) return { ok: false, error: 'Missing signature.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data: sig } = await supabase
    .from('signatures')
    .select('id, status')
    .eq('id', input.signatureId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (!sig) return { ok: false, error: 'Signature not found.' };
  if (!canResolveSignature(sig.status)) {
    return { ok: false, error: 'This signature is already resolved — nothing to chase.' };
  }

  const { data: chased, error } = await supabase
    .from('signatures')
    .update({ chased_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', sig.id)
    .eq('org_id', org.orgId)
    // Compare-and-set: never stamp a chase on a request that just resolved.
    .eq('status', sig.status)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!chased) {
    return { ok: false, error: 'This signature just changed — refresh and try again.' };
  }

  revalidatePath('/execute/wires');
  revalidatePath('/execute');
  return { ok: true, id: sig.id };
}

/** Stage a wire instruction (optionally tied to an open closing). */
export async function instructWire(input: {
  direction: string;
  amount: number;
  counterparty: string;
  reference?: string | null;
  closingId?: string | null;
}): Promise<WiresActionResult> {
  if (!isWireDirection(input.direction)) return { ok: false, error: 'Unknown direction.' };
  const counterparty = clean(input.counterparty);
  if (!counterparty) return { ok: false, error: 'Name the counterparty.' };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: 'Enter a positive amount.' };
  }

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const closing = await resolveOpenClosingId(supabase, org.orgId, input.closingId);
  if (!closing.ok) return closing;
  const { data, error } = await supabase
    .from('wires')
    .insert({
      org_id: org.orgId,
      closing_id: closing.id,
      direction: input.direction,
      amount: input.amount,
      counterparty,
      reference: clean(input.reference) || null,
      status: 'instructed'
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not stage the wire.' };

  revalidatePath('/execute/wires');
  revalidatePath('/execute');
  return { ok: true, id: data.id };
}

/** Advance a wire exactly one stage (instructed → sent → settled). */
export async function advanceWire(input: { wireId: string }): Promise<WiresActionResult> {
  if (!input.wireId) return { ok: false, error: 'Missing wire.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const { data: wire } = await supabase
    .from('wires')
    .select('id, status')
    .eq('id', input.wireId)
    .eq('org_id', org.orgId)
    .maybeSingle();
  if (!wire) return { ok: false, error: 'Wire not found.' };

  const next = nextWireStatus(wire.status);
  if (!next) {
    return {
      ok: false,
      error:
        wire.status === 'settled'
          ? 'This wire is already settled.'
          : `Cannot advance from "${wire.status}".`
    };
  }

  const { data: advanced, error } = await supabase
    .from('wires')
    .update({
      status: next,
      settled_at: next === 'settled' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', wire.id)
    .eq('org_id', org.orgId)
    // Compare-and-set: only advance from the stage we just read; zero
    // matched rows means another actor advanced it first.
    .eq('status', wire.status)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!advanced) return { ok: false, error: 'This wire just changed — refresh and try again.' };

  let trustLogged: boolean | undefined;
  if (next === 'settled') {
    // Chain of Trust: a settled wire is a real record (idempotent) — the
    // dual-control choreography's "Log to Chain of Trust" step, made literal.
    trustLogged = await logExecutionRecord(supabase, org.orgId, 'wire', wire.id);
  }

  revalidatePath('/execute/wires');
  revalidatePath('/execute');
  return { ok: true, id: wire.id, trustLogged };
}

/**
 * The Closings tab's pattern: completing an execution act inserts an
 * idempotent `chain_of_trust_records` row at Proof of Execution. Never
 * blocks the act it records, but reports whether the record actually
 * landed so callers can hedge their copy instead of overclaiming.
 */
async function logExecutionRecord(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  entityType: 'signature' | 'wire',
  entityId: string
): Promise<boolean> {
  try {
    const { data: existing, error: readErr } = await supabase
      .from('chain_of_trust_records')
      .select('id')
      .eq('org_id', orgId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .maybeSingle();
    if (existing) return true;
    if (readErr) return false;
    const { error: insertErr } = await supabase.from('chain_of_trust_records').insert({
      org_id: orgId,
      entity_type: entityType,
      entity_id: entityId,
      current_layer: 'Proof of Execution',
      completion_percentage: 100,
      status: 'active'
    });
    return !insertErr;
  } catch {
    // The act itself already persisted; only the proof record failed.
    return false;
  }
}
