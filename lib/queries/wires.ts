import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { wireTotals, type WireTotals } from '@/lib/wires/vocabulary';

/**
 * Read side of the Signatures & wires room. RLS-scoped; degrades to empty.
 */
export interface SignatureView {
  id: string;
  document: string;
  signer: string;
  status: string;
  signedAt: string | null;
  createdAt: string;
  closingId: string | null;
}

export interface WireView {
  id: string;
  direction: string;
  amount: number;
  currency: string;
  counterparty: string;
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
  totals: WireTotals;
  openClosings: ClosingRef[];
}

export const getWiresData = cache(async (orgId: string): Promise<WiresData> => {
  const supabase = await createClient();
  const [{ data: signatures }, { data: wires }, { data: closings }] = await Promise.all([
    supabase
      .from('signatures')
      .select('id, document, signer, status, signed_at, created_at, closing_id')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('wires')
      .select(
        'id, direction, amount, currency, counterparty, reference, status, settled_at, created_at, closing_id'
      )
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('closings')
      .select('id, counterparty, status')
      .eq('org_id', orgId)
      .eq('status', 'open')
  ]);

  const wireViews: WireView[] = (wires ?? []).map((w) => ({
    id: w.id,
    direction: w.direction,
    amount: Number(w.amount),
    currency: w.currency,
    counterparty: w.counterparty,
    reference: w.reference,
    status: w.status,
    settledAt: w.settled_at,
    createdAt: w.created_at,
    closingId: w.closing_id
  }));

  return {
    signatures: (signatures ?? []).map((s) => ({
      id: s.id,
      document: s.document,
      signer: s.signer,
      status: s.status,
      signedAt: s.signed_at,
      createdAt: s.created_at,
      closingId: s.closing_id
    })),
    wires: wireViews,
    totals: wireTotals(wireViews),
    openClosings: (closings ?? []).map((c) => ({ id: c.id, counterparty: c.counterparty }))
  };
});
