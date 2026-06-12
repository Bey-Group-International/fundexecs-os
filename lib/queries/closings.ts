import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { closingProgress, type ClosingProgress } from '@/lib/closings/sequence';

/**
 * Read side of the Closings room. RLS-scoped; degrades to empty on failure.
 */
/** A live e-signature envelope sent for a signature step (DocuSign slice). */
export interface StepSignatureView {
  envelopeId: string;
  status: string;
  signerName: string | null;
  signerEmail: string | null;
}

export interface ClosingStepView {
  id: string;
  seq: number;
  name: string;
  status: string;
  /** Present once a signature envelope has been sent for this step. */
  signature?: StepSignatureView;
}

export interface ClosingView {
  id: string;
  kind: string;
  counterparty: string | null;
  amount: number | null;
  status: string;
  createdAt: string;
  steps: ClosingStepView[];
  progress: ClosingProgress;
}

/** A committed pipeline entity a closing can be opened from. */
export interface ClosingCandidate {
  id: string;
  name: string;
  kind: 'deal' | 'lp_commitment';
  amount: number | null;
}

export interface ClosingsData {
  closings: ClosingView[];
  candidates: ClosingCandidate[];
}

export const getClosingsData = cache(async (orgId: string): Promise<ClosingsData> => {
  const supabase = await createClient();
  const [
    { data: closings },
    { data: steps },
    { data: signatures },
    { data: deals },
    { data: lps }
  ] = await Promise.all([
    supabase
      .from('closings')
      .select('id, kind, counterparty, amount, status, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('closing_steps')
      .select('id, closing_id, seq, name, status')
      .eq('org_id', orgId)
      .order('seq', { ascending: true }),
    supabase
      .from('closing_step_signatures')
      .select('step_id, envelope_id, status, signer_name, signer_email')
      .eq('org_id', orgId),
    supabase
      .from('deals')
      .select('id, name, amount, stage')
      .eq('org_id', orgId)
      .eq('stage', 'committed'),
    supabase
      .from('capital_providers')
      .select('id, name, status, check_size_min, check_size_max')
      .eq('org_id', orgId)
  ]);

  const sigByStep = new Map<string, StepSignatureView>();
  for (const sig of signatures ?? []) {
    sigByStep.set(sig.step_id, {
      envelopeId: sig.envelope_id,
      status: sig.status,
      signerName: sig.signer_name,
      signerEmail: sig.signer_email
    });
  }

  const stepsByClosing = new Map<string, ClosingStepView[]>();
  for (const s of steps ?? []) {
    if (!stepsByClosing.has(s.closing_id)) stepsByClosing.set(s.closing_id, []);
    stepsByClosing.get(s.closing_id)!.push({
      id: s.id,
      seq: s.seq,
      name: s.name,
      status: s.status,
      signature: sigByStep.get(s.id)
    });
  }

  const views: ClosingView[] = (closings ?? []).map((c) => {
    const closingSteps = stepsByClosing.get(c.id) ?? [];
    return {
      id: c.id,
      kind: c.kind,
      counterparty: c.counterparty,
      amount: c.amount,
      status: c.status,
      createdAt: c.created_at,
      steps: closingSteps,
      progress: closingProgress(closingSteps)
    };
  });

  // Candidates: committed deals + committed LPs that don't already have an
  // open closing under the same counterparty name.
  const taken = new Set(views.map((v) => `${v.kind}:${v.counterparty ?? ''}`));
  const candidates: ClosingCandidate[] = [];
  for (const d of deals ?? []) {
    if (!taken.has(`deal:${d.name}`)) {
      candidates.push({ id: d.id, name: d.name, kind: 'deal', amount: d.amount });
    }
  }
  for (const lp of lps ?? []) {
    if (!/(commit|won|closed|funded)/.test((lp.status || '').toLowerCase())) continue;
    if (taken.has(`lp_commitment:${lp.name}`)) continue;
    const amount =
      lp.check_size_min != null && lp.check_size_max != null
        ? Math.round((lp.check_size_min + lp.check_size_max) / 2)
        : (lp.check_size_max ?? lp.check_size_min ?? null);
    candidates.push({ id: lp.id, name: lp.name, kind: 'lp_commitment', amount });
  }

  return { closings: views, candidates };
});
