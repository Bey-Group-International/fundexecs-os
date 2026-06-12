'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import {
  canChaseSignature,
  canMarkSignaturePartial,
  canResolveSignature,
  isWireDirection,
  nextWireStatus,
  stagedWireStatus
} from './vocabulary';

/**
 * lib/wires/actions.ts — the Signatures & wires room's mutations.
 *
 * Operator-driven through the approve loop; member-scoped through RLS
 * (20260611280000). Gates are enforced server-side: a signature resolves
 * exactly once (awaiting/partial → signed/declined), and a wire clears in
 * exactly one transition (staged → cleared on release, expected → cleared
 * on confirm) — the prototype's choreography, made law here.
 *
 * Honesty contracts (EXECUTE_TABS_PLAYBOOK): everything here is
 * record-keeping + attestation. Marking signed records that the document
 * was executed outside FundExecs OS; clearing a wire records that money
 * moved at the bank — none moves through this system. Terminal events log
 * a real Proof of Execution row to the Chain of Trust ledger.
 */

export type WiresActionResult =
  | {
      ok: true;
      id: string;
      /** Whether the Chain of Trust record actually landed (signed/cleared acts only). */
      trustLogged?: boolean;
    }
  | { ok: false; error: string };

const MAX_TEXT = 200;

function clean(value: string | null | undefined, max = MAX_TEXT): string {
  return (value ?? '').trim().slice(0, max);
}

/**
 * "Log to Chain of Trust" — the prototype's final run step, made real.
 * One idempotent Proof of Execution record per completed entity (the same
 * house pattern as diligence-finding resolutions). Never blocks the
 * attestation itself, but reports whether the record actually landed so
 * callers can hedge their copy instead of overclaiming.
 */
async function logExecutionProof(
  supabase: SupabaseClient<Database>,
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
    // the attestation already landed; only the proof record failed
    return false;
  }
}

/**
 * Resolve a client-provided closing id to one this org actually owns and
 * that is still open — never trust the raw id into an insert.
 */
async function resolveOpenClosingId(
  supabase: SupabaseClient<Database>,
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

function refreshWires() {
  revalidatePath('/execute/wires');
  revalidatePath('/execute/chain-of-trust');
  revalidatePath('/execute');
}

/**
 * Send a document out for signature (optionally tied to an open closing).
 *
 * E-SIGN HOOK POINT: when the DocuSign slice lands, this is where the
 * envelope gets created and sent; the row's status keeps tracking the
 * envelope's lifecycle. Until then the document moves outside FundExecs OS
 * and this records that it went out.
 */
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

  refreshWires();
  return { ok: true, id: data.id };
}

/**
 * Record a signature's resolution — signed or declined, exactly once.
 * Signed is an attestation that the document was executed outside
 * FundExecs OS; it logs a Proof of Execution record to the Chain of Trust.
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
    // Compare-and-set: resolve only from the state we just read; zero
    // matched rows means another operator just resolved it.
    .eq('status', sig.status)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!resolved) {
    return { ok: false, error: 'This signature just changed — refresh and try again.' };
  }

  let trustLogged: boolean | undefined;
  if (input.outcome === 'signed') {
    trustLogged = await logExecutionProof(supabase, org.orgId, 'signature', sig.id);
  }

  refreshWires();
  return { ok: true, id: sig.id, trustLogged };
}

/** Record that some signers are in but not all — awaiting → partial. */
export async function markSignaturePartial(input: {
  signatureId: string;
}): Promise<WiresActionResult> {
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
  if (!canMarkSignaturePartial(sig.status)) {
    return { ok: false, error: 'Only an awaiting document can turn partial.' };
  }

  const { data: marked, error } = await supabase
    .from('signatures')
    .update({ status: 'partial', updated_at: new Date().toISOString() })
    .eq('id', sig.id)
    .eq('org_id', org.orgId)
    // Compare-and-set: never demote a document that just resolved.
    .eq('status', sig.status)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!marked) {
    return { ok: false, error: 'This signature just changed — refresh and try again.' };
  }

  refreshWires();
  return { ok: true, id: sig.id };
}

/**
 * Chase the outstanding countersigners on a partial document. Records the
 * chase on the ledger (`chased_at`); the reminder itself travels outside
 * FundExecs OS until e-sign is connected (see the hook point above).
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
  if (!canChaseSignature(sig.status)) {
    return { ok: false, error: 'Only a partial document gets chased.' };
  }

  const { data: chased, error } = await supabase
    .from('signatures')
    .update({ chased_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', sig.id)
    .eq('org_id', org.orgId)
    // Compare-and-set: never stamp a chase on a document that just resolved.
    .eq('status', sig.status)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!chased) {
    return { ok: false, error: 'This signature just changed — refresh and try again.' };
  }

  refreshWires();
  return { ok: true, id: sig.id };
}

/**
 * Stage a wire on the ledger (optionally tied to an open closing).
 * Outbound wires stage as `staged` (awaiting release); inbound as
 * `expected` (awaiting confirmation of receipt). This RECORDS the wire —
 * no money moves through FundExecs OS.
 */
export async function stageWire(input: {
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
      status: stagedWireStatus(input.direction)
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not stage the wire.' };

  refreshWires();
  return { ok: true, id: data.id };
}

/**
 * Clear a wire — release (staged → cleared) or confirm receipt
 * (expected → cleared), exactly one transition, server-enforced. The
 * operator attests against their bank; clearing records it and logs a
 * Proof of Execution row to the Chain of Trust.
 */
export async function clearWire(input: { wireId: string }): Promise<WiresActionResult> {
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
        wire.status === 'cleared'
          ? 'This wire is already cleared.'
          : `Cannot clear from "${wire.status}".`
    };
  }

  const { data: cleared, error } = await supabase
    .from('wires')
    .update({
      status: next,
      settled_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', wire.id)
    .eq('org_id', org.orgId)
    // Compare-and-set: only clear from the status we just read; zero
    // matched rows means another operator just cleared it — don't re-run
    // the side effects and claim success.
    .eq('status', wire.status)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!cleared) return { ok: false, error: 'This wire just changed — refresh and try again.' };

  const trustLogged = await logExecutionProof(supabase, org.orgId, 'wire', wire.id);

  refreshWires();
  return { ok: true, id: wire.id, trustLogged };
}
