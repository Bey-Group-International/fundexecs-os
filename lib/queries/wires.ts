import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * Read side of the Signatures & wires room. RLS-scoped; degrades to empty.
 */
export interface SignatureView {
  id: string;
  document: string;
  signer: string;
  signerRole: string | null;
  drives: string | null;
  amountLabel: string | null;
  status: string;
  signedAt: string | null;
  chasedAt: string | null;
  createdAt: string;
  closingId: string | null;
}

export interface WireView {
  id: string;
  direction: string;
  amount: number;
  currency: string;
  counterparty: string;
  label: string | null;
  drives: string | null;
  reference: string | null;
  status: string;
  settledAt: string | null;
  createdAt: string;
  closingId: string | null;
}

/** An open closing a signature/wire can be tied to. */
export interface ClosingRef {
  id: string;
  counterparty: string | null;
}

export interface WiresData {
  signatures: SignatureView[];
  wires: WireView[];
  openClosings: ClosingRef[];
}

export const getWiresData = cache(async (orgId: string): Promise<WiresData> => {
  const supabase = await createClient();
  const [{ data: signatures }, { data: wires }, { data: closings }] = await Promise.all([
    supabase
      .from('signatures')
      .select(
        'id, document, signer, signer_role, drives, amount_label, status, signed_at, chased_at, created_at, closing_id'
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('wires')
      .select(
        'id, direction, amount, currency, counterparty, label, drives, reference, status, settled_at, created_at, closing_id'
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('closings')
      .select('id, counterparty, status')
      .eq('org_id', orgId)
      .eq('status', 'open')
  ]);

  return {
    signatures: (signatures ?? []).map((s) => ({
      id: s.id,
      document: s.document,
      signer: s.signer,
      signerRole: s.signer_role,
      drives: s.drives,
      amountLabel: s.amount_label,
      status: s.status,
      signedAt: s.signed_at,
      chasedAt: s.chased_at,
      createdAt: s.created_at,
      closingId: s.closing_id
    })),
    wires: (wires ?? []).map((w) => ({
      id: w.id,
      direction: w.direction,
      amount: Number(w.amount),
      currency: w.currency,
      counterparty: w.counterparty,
      label: w.label,
      drives: w.drives,
      reference: w.reference,
      status: w.status,
      settledAt: w.settled_at,
      createdAt: w.created_at,
      closingId: w.closing_id
    })),
    openClosings: (closings ?? []).map((c) => ({ id: c.id, counterparty: c.counterparty }))
  };
});
