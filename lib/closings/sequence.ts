/**
 * lib/closings/sequence.ts — the Closings room's pure vocabulary.
 *
 * A closing is a strict, ordered sequence: each step must be executed in
 * order (the prototype's "strict step gating"), and the closing flips to
 * `closed` when the last step lands. This module owns the standard step
 * sequence per closing kind, the gating rule, and progress derivation —
 * pure so the server action and the UI can never disagree on what's next.
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
  /** Earn's visible run steps when executing this step. */
  run: string[];
}

/** The standard execution sequence per closing kind (seq = index + 1). */
export const STEP_SEQUENCE: Record<ClosingKind, readonly ClosingStepSpec[]> = {
  deal: [
    {
      name: 'Signature pack assembled',
      run: ['Assemble the signature pack', 'Verify signatories', 'Stage for countersign']
    },
    {
      name: 'Escrow & accounts confirmed',
      run: ['Confirm the escrow account', 'Verify the funding account', 'Lock the flow of funds']
    },
    {
      name: 'Closing conditions cleared',
      run: ['Walk the conditions list', 'Collect the outstanding confirmations', 'Clear or waive']
    },
    {
      name: 'Wire & funding executed',
      run: ['Stage the wire instructions', 'Verify amounts against the docs', 'Release for funding']
    },
    {
      name: 'Closed & recorded',
      run: ['Confirm receipt', 'Record the close', 'Log the win to your Chain of Trust']
    }
  ],
  lp_commitment: [
    {
      name: 'Subscription pack sent',
      run: [
        'Personalize the subscription pack',
        'Verify the commitment amount',
        'Send for signature'
      ]
    },
    {
      name: 'Accreditation verified',
      run: ['Collect the accreditation evidence', 'Verify against the exemption', 'File the record']
    },
    {
      name: 'Countersigned',
      run: ['Confirm the LP signature', 'Countersign as GP', 'Distribute executed copies']
    },
    {
      name: 'Capital received',
      run: ['Issue the funding instructions', 'Track the wire', 'Confirm receipt in escrow']
    },
    {
      name: 'Closed & recorded',
      run: ['Update the capital account', 'Record the close', 'Log the commitment to your record']
    }
  ],
  engagement: [
    {
      name: 'Engagement letter sent',
      run: ['Draft the engagement letter', 'Confirm scope and fees', 'Send for signature']
    },
    {
      name: 'Signed & countersigned',
      run: ['Confirm the signature', 'Countersign', 'Distribute executed copies']
    },
    {
      name: 'Kickoff scheduled',
      run: ['Propose kickoff windows', 'Confirm attendees', 'Book it']
    },
    {
      name: 'Closed & recorded',
      run: ['Open the engagement record', 'Record the win', 'Log it to your record']
    }
  ]
};

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
