/**
 * lib/closings/sequence.ts — the Closings room's pure vocabulary.
 *
 * A closing is a strict, ordered sequence: each step must be executed in
 * order (the prototype's "strict step gating"), and the closing flips to
 * `closed` when the last step lands. This module owns the standard step
 * sequence per closing kind (with the prototype's per-step anatomy: owner,
 * party, drives-line, detail, action verb), the display-status ladder
 * (pending → ready → signed/wired), the gating rule, and progress
 * derivation — pure so the server action and the UI can never disagree on
 * what's next.
 */

export type ClosingKind = 'deal' | 'lp_commitment' | 'engagement';

export const CLOSING_KINDS: readonly ClosingKind[] = ['deal', 'lp_commitment', 'engagement'];

export function isClosingKind(k: string): k is ClosingKind {
  return (CLOSING_KINDS as readonly string[]).includes(k);
}

export const CLOSING_KIND_LABEL: Record<ClosingKind, string> = {
  deal: 'Deal close',
  lp_commitment: 'LP commitment',
  engagement: 'Engagement'
};

export interface ClosingStepSpec {
  name: string;
  /** Who prepares the step (the prototype's `who`). */
  who: string;
  /** Which side executes (the prototype's `party`). */
  party: 'GP' | 'LP' | 'Both';
  /** What completing this step drives (the prototype's drives-line). */
  drives: string;
  /** The drawer's detail paragraph. */
  detail: string;
  /** The CTA verb (the prototype's `step.action`). */
  action: string;
  /** Money-movement steps read "Wired" when done; the rest read "Signed". */
  wire?: boolean;
  /**
   * Signature steps can be sent for e-signature (the DocuSign slice). The
   * send is an attestation aid — the operator still executes/attests the step
   * separately; sending an envelope never marks the step done on its own.
   */
  sign?: boolean;
  /** Earn's visible run steps when executing this step. */
  run: string[];
}

/** A step is e-signable when its spec opts in and it isn't a money-movement step. */
export function isSignatureStep(spec: ClosingStepSpec | undefined): boolean {
  return Boolean(spec?.sign) && !spec?.wire;
}

/** The standard execution sequence per closing kind (seq = index + 1). */
export const STEP_SEQUENCE: Record<ClosingKind, readonly ClosingStepSpec[]> = {
  deal: [
    {
      name: 'Signature pack assembled',
      who: 'Earn + GP counsel',
      party: 'GP',
      drives: 'Everything sign-ready in one pack',
      detail:
        'The full execution set — purchase agreement, disclosure schedules and signature pages — assembled and verified against the committed terms.',
      action: 'Assemble pack',
      sign: true,
      run: ['Assemble the signature pack', 'Verify signatories', 'Stage for countersign']
    },
    {
      name: 'Escrow & accounts confirmed',
      who: 'Sterling',
      party: 'Both',
      drives: 'The flow of funds locked before signing',
      detail:
        'Escrow and funding accounts confirmed on both sides so the wire path is locked before anyone signs.',
      action: 'Confirm accounts',
      run: ['Confirm the escrow account', 'Verify the funding account', 'Lock the flow of funds']
    },
    {
      name: 'Closing conditions cleared',
      who: 'Adrian',
      party: 'Both',
      drives: 'No surprises between signature and funding',
      detail:
        'Every condition precedent walked, confirmed or formally waived — the gap where closings die, closed.',
      action: 'Clear conditions',
      run: ['Walk the conditions list', 'Collect the outstanding confirmations', 'Clear or waive']
    },
    {
      name: 'Wire & funding executed',
      who: 'Sterling',
      party: 'GP',
      drives: 'Capital moves under dual control',
      detail:
        'Wire instructions staged and amounts verified against the executed documents. Recording this step attests the wire against your bank — no money moves through FundExecs OS.',
      action: 'Execute funding',
      wire: true,
      run: ['Stage the wire instructions', 'Verify amounts against the docs', 'Release for funding']
    },
    {
      name: 'Closed & recorded',
      who: 'Earn',
      party: 'GP',
      drives: 'The win on your permanent record',
      detail:
        'Receipt confirmed, the close recorded, and the whole sequence logged to your Chain of Trust.',
      action: 'Record the close',
      run: ['Confirm receipt', 'Record the close', 'Log the win to your Chain of Trust']
    }
  ],
  lp_commitment: [
    {
      name: 'Subscription pack sent',
      who: 'Eleanor',
      party: 'GP',
      drives: 'The commitment moving on paper',
      detail:
        'The subscription agreement personalized to the LP and their committed amount, sent for signature.',
      action: 'Send pack',
      sign: true,
      run: [
        'Personalize the subscription pack',
        'Verify the commitment amount',
        'Send for signature'
      ]
    },
    {
      name: 'Accreditation verified',
      who: 'Adrian',
      party: 'LP',
      drives: 'The exemption protected',
      detail:
        'Accreditation evidence collected and verified against your exemption, filed to the record.',
      action: 'Verify accreditation',
      run: ['Collect the accreditation evidence', 'Verify against the exemption', 'File the record']
    },
    {
      name: 'Countersigned',
      who: 'You + counsel',
      party: 'Both',
      drives: 'A binding commitment',
      detail:
        'LP signature confirmed, GP countersign executed, fully executed copies distributed. Signatures are recorded as attestations — executed outside FundExecs OS.',
      action: 'Countersign',
      sign: true,
      run: ['Confirm the LP signature', 'Countersign as GP', 'Distribute executed copies']
    },
    {
      name: 'Capital received',
      who: 'Sterling',
      party: 'LP',
      drives: 'Committed capital in the account',
      detail:
        'Funding instructions issued and the wire tracked to receipt. Recording this step attests receipt against your bank — no money moves through FundExecs OS.',
      action: 'Confirm receipt',
      wire: true,
      run: ['Issue the funding instructions', 'Track the wire', 'Confirm receipt in escrow']
    },
    {
      name: 'Closed & recorded',
      who: 'Earn',
      party: 'GP',
      drives: 'The capital account opened',
      detail:
        'The capital account updated, the commitment recorded, and the close logged to your Chain of Trust.',
      action: 'Record the close',
      run: ['Update the capital account', 'Record the close', 'Log the commitment to your record']
    }
  ],
  engagement: [
    {
      name: 'Engagement letter sent',
      who: 'Earn',
      party: 'GP',
      drives: 'Scope and fees on paper',
      detail: 'The engagement letter drafted with confirmed scope and fees, sent for signature.',
      action: 'Send letter',
      sign: true,
      run: ['Draft the engagement letter', 'Confirm scope and fees', 'Send for signature']
    },
    {
      name: 'Signed & countersigned',
      who: 'You',
      party: 'Both',
      drives: 'A binding engagement',
      detail:
        'Counterparty signature confirmed and countersigned; executed copies distributed. Signatures are recorded as attestations — executed outside FundExecs OS.',
      action: 'Countersign',
      sign: true,
      run: ['Confirm the signature', 'Countersign', 'Distribute executed copies']
    },
    {
      name: 'Kickoff scheduled',
      who: 'Camille',
      party: 'Both',
      drives: 'Momentum from day one',
      detail: 'Kickoff windows proposed, attendees confirmed, the first session booked.',
      action: 'Book kickoff',
      run: ['Propose kickoff windows', 'Confirm attendees', 'Book it']
    },
    {
      name: 'Closed & recorded',
      who: 'Earn',
      party: 'GP',
      drives: 'The win on your record',
      detail: 'The engagement record opened and the win logged to your Chain of Trust.',
      action: 'Record the close',
      run: ['Open the engagement record', 'Record the win', 'Log it to your record']
    }
  ]
};

/* ── the prototype's EX_STEP_TONE display ladder ─────────────────────────── */

export type StepDisplayStatus = 'pending' | 'ready' | 'signed' | 'wired';

export const STEP_DISPLAY: Record<
  StepDisplayStatus,
  { tone: 'neutral' | 'gold' | 'success'; label: string }
> = {
  pending: { tone: 'neutral', label: 'Pending' },
  ready: { tone: 'gold', label: 'Ready' },
  signed: { tone: 'success', label: 'Signed' },
  wired: { tone: 'success', label: 'Wired' }
};

/**
 * Map a step's DB status + gate position to the prototype's display ladder:
 * done steps read Signed (Wired for money-movement steps), the gated next
 * step reads Ready, everything after it Pending.
 */
export function stepDisplayStatus(
  dbStatus: string,
  isNext: boolean,
  wire?: boolean
): StepDisplayStatus {
  if (isStepDone(dbStatus)) return wire ? 'wired' : 'signed';
  return isNext ? 'ready' : 'pending';
}

export interface ClosingStepLike {
  seq: number;
  status: string;
}

export function isStepDone(status: string): boolean {
  return status === 'done';
}

/**
 * The strict gate: the only executable step is the lowest-seq step that is
 * not yet done. Returns its seq, or null when the sequence is complete.
 */
export function nextExecutableSeq(steps: readonly ClosingStepLike[]): number | null {
  const pending = steps.filter((s) => !isStepDone(s.status)).sort((a, b) => a.seq - b.seq);
  return pending.length > 0 ? pending[0].seq : null;
}

export interface ClosingProgress {
  done: number;
  total: number;
  pct: number;
  complete: boolean;
}

export function closingProgress(steps: readonly ClosingStepLike[]): ClosingProgress {
  const total = steps.length;
  const done = steps.filter((s) => isStepDone(s.status)).length;
  return {
    done,
    total,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
    complete: total > 0 && done === total
  };
}
