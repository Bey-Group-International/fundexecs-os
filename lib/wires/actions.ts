'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import {
  canChaseSignature,
  canSignatureTransition,
  canClearWire,
  initialWireStatus,
  isWireDirection
} from './vocabulary';

/**
 * lib/wires/actions.ts — the Signatures & wires room's mutations.
 *
 * Operator-driven through the approve loop; member-scoped through RLS
 * (20260611280000). Gates are enforced server-side: a signature only
 * moves forward (awaiting → partial → signed | declined) and a wire
 * clears exactly once by direction (staged → cleared on release,
 * expected → cleared on confirm).
 *
 * Honesty contracts: signatures are attestations — the document is
 * executed outside FundExecs OS — and wires are record-keeping; no money
 * moves through here. Completing either logs a real row to the Chain of
 * Trust (Proof of Execution).
 */

export type WiresActionResult = { ok: true; id: string } | { ok: false; error: string };

const MAX_TEXT = 200;

function clean(value: string | null | undefined, max = MAX_TEXT): string {
  return (value ?? '').trim().slice(0, max);
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * "Log to Chain of Trust" — the literal step at the end of every run
 * payload. One real Proof of Execution record per completed signature or
 * cleared wire, idempotent on (entity_type, entity_id). Best-effort like
 * the diligence pattern: the ledger row is the source of truth.
 */
async function logToChainOfTrust(
  supabase: Supabase,
  orgId: string,
  entityType: 'signature' | 'wire',
  entityId: string
): Promise<void> {
  const { data: existing } = await supabase
    .from('chain_of_trust_records')
    .select('id')
    .eq('org_id', orgId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();
  if (existing) return;
  await supabase.from('chain_of_trust_records').insert({
    org_id: orgId,
    entity_type: entityType,
    entity_id: entityId,
    current_layer: 'Proof of Execution',
    completion_percentage: 100,
    status: 'active'
  });
}

/**
 * Resolve a client-supplied closing id to one this org actually owns and
 * that is still open — otherwise null. Stops a forged payload from
 * attaching a signature/wire to another org's closing or a closed one;
 * RLS scopes the row, but `closing_id` is a free FK the client controls.
 */
async function resolveOpenClosingId(
  supabase: Supabase,
  orgId: string,
  closingId: string | null | undefined
): Promise<string | null> {
  if (!closingId) return null;
  const { data } = await supabase
    .from('closings')
    .select('id')
    .eq('id', closingId)
    .eq('org_id', orgId)
    .eq('status', 'open')
    .maybeSingle();
  return data ? data.id : null;
}

function refreshWires() {
  revalidatePath('/execute/wires');
  revalidatePath('/execute');
}

/**
 * Send a document out for signature (optionally tied to an open closing).
 *
 * E-sign hook point: when the DocuSign slice lands, this is where the
 * envelope gets created and sent. Today this records that the document
 * went out — the sending itself happens outside FundExecs OS.
 */
export async function sendSignature(input: {
  document: string;
  signer: string;
  signerRole?: string | null;
  drives?: string | null;
  amountLabel?: string | null;
  closingId?: string | null;
}): Promise<WiresActionResult> {
  const document = clean(input.document);
  const signer = clean(input.signer);
  if (!document) return { ok: false, error: 'Name the document.' };
  if (!signer) return { ok: false, error: 'Name the signer.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const closingId = await resolveOpenClosingId(supabase, org.orgId, input.closingId);
  const { data, error } = await supabase
    .from('signatures')
    .insert({
      org_id: org.orgId,
      closing_id: closingId,
      document,
      signer,
      signer_role: clean(input.signerRole) || null,
      drives: clean(input.drives) || null,
      amount_label: clean(input.amountLabel, 40) || null,
      status: 'out_for_signature'
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not send it out.' };

  refreshWires();
  return { ok: true, id: data.id };
}

/**
 * Record where a signature stands — partial progress, signed, or declined.
 * Marking signed records the operator's attestation that the document was
 * executed outside FundExecs OS, and logs it to the Chain of Trust.
 */
export async function resolveSignature(input: {
  signatureId: string;
  outcome: 'partial' | 'signed' | 'declined';
}): Promise<WiresActionResult> {
  if (!input.signatureId) return { ok: false, error: 'Missing signature.' };
  if (!['partial', 'signed', 'declined'].includes(input.outcome)) {
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
  if (!canSignatureTransition(sig.status, input.outcome)) {
    return { ok: false, error: `Cannot move this signature from "${sig.status}".` };
  }

  const { data: updated, error } = await supabase
    .from('signatures')
    .update({
      status: input.outcome,
      signed_at: input.outcome === 'signed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', sig.id)
    .eq('org_id', org.orgId)
    // Concurrency guard: only move from the stage we just read.
    .eq('status', sig.status)
    .select('id');
  if (error) return { ok: false, error: error.message };
  // 0 rows means the status changed under us — a no-error miss, not success.
  if (!updated || updated.length !== 1) {
    return { ok: false, error: 'This signature just changed — refresh and try again.' };
  }

  if (input.outcome === 'signed') {
    await logToChainOfTrust(supabase, org.orgId, 'signature', sig.id);
  }

  refreshWires();
  return { ok: true, id: sig.id };
}

/**
 * Chase a partially signed document — records the reminder on the ledger.
 * The reminder itself goes out through the operator's own channels until
 * the e-sign rail connects (DocuSign hook point: send the envelope
 * reminder here).
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
    return { ok: false, error: 'Only partially signed documents get chased.' };
  }

  const { data: updated, error } = await supabase
    .from('signatures')
    .update({ chased_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', sig.id)
    .eq('org_id', org.orgId)
    // Concurrency guard: only chase while it's still partial.
    .eq('status', sig.status)
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!updated || updated.length !== 1) {
    return { ok: false, error: 'This signature just changed — refresh and try again.' };
  }

  refreshWires();
  return { ok: true, id: sig.id };
}

/**
 * Stage a wire on the ledger (optionally tied to an open closing).
 * Outbound wires open as staged, inbound as expected. This RECORDS the
 * wire — no money moves through FundExecs OS; banking integration
 * upgrades this later.
 */
export async function stageWire(input: {
  direction: string;
  amount: number;
  counterparty: string;
  label?: string | null;
  drives?: string | null;
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
  const closingId = await resolveOpenClosingId(supabase, org.orgId, input.closingId);
  const { data, error } = await supabase
    .from('wires')
    .insert({
      org_id: org.orgId,
      closing_id: closingId,
      direction: input.direction,
      amount: input.amount,
      counterparty,
      label: clean(input.label) || null,
      drives: clean(input.drives) || null,
      reference: clean(input.reference) || null,
      status: initialWireStatus(input.direction)
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not stage the wire.' };

  refreshWires();
  return { ok: true, id: data.id };
}

/**
 * Clear a wire exactly once — release a staged outbound or confirm an
 * expected inbound. The operator attests it against their bank; the
 * cleared row logs to the Chain of Trust.
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
  if (!canClearWire(wire.status)) {
    return {
      ok: false,
      error:
        wire.status === 'cleared'
          ? 'This wire has already cleared.'
          : `Cannot clear from "${wire.status}".`
    };
  }

  const { data: updated, error } = await supabase
    .from('wires')
    .update({
      status: 'cleared',
      settled_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', wire.id)
    .eq('org_id', org.orgId)
    // Concurrency guard: only clear from the stage we just read.
    .eq('status', wire.status)
    .select('id');
  if (error) return { ok: false, error: error.message };
  // 0 rows means another request already cleared it — don't double-log.
  if (!updated || updated.length !== 1) {
    return { ok: false, error: 'This wire just changed — refresh and try again.' };
  }

  await logToChainOfTrust(supabase, org.orgId, 'wire', wire.id);

  refreshWires();
  return { ok: true, id: wire.id };
}
