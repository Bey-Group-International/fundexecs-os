/**
 * lib/execute-closings/config.ts — Execute · Closings config (pure).
 *
 * Ported from the onboarding prototype's `execute.jsx` closings layer: the
 * signature room where a deal, fund close, or LP subscription is driven through
 * an ordered set of execution steps (sign → escrow → conditions → wire →
 * record) to a signed, funded close logged to the Chain of Trust. Each step is
 * approved one at a time; clearing one arms the next. Illustrative (client-side,
 * no execution writes) until a closings schema lands. Pure (no React, no IO) so
 * it unit-tests cleanly.
 */

import type { BadgeTone } from '@/components/ui';

/** An execution step's status. `signed`/`wired` are both terminal ("done"). */
export type EXStepStatus = 'pending' | 'ready' | 'signed' | 'wired';

/** One ordered step in a closing. */
export interface EXStep {
  id: string;
  name: string;
  who: string;
  party: string;
  status: EXStepStatus;
  drives: string;
  detail: string;
  action: string;
}

/** A closing = an ordered set of execution steps for one engagement. */
export interface EXClosing {
  name: string;
  sub: string;
  kind: string;
  amount: string;
  counterparty: string;
  steps: EXStep[];
}

export const EX_CLOSINGS: Record<string, EXClosing> = {
  helios: {
    name: 'Helios Robotics',
    sub: 'Acquisition · $18M',
    kind: 'Deal close',
    amount: '$18.0M',
    counterparty: 'Helios Robotics, Inc.',
    steps: [
      {
        id: 'spa',
        name: 'Sign the SPA',
        who: 'You + counterparty',
        party: 'GP',
        status: 'ready',
        drives: 'The binding purchase agreement',
        detail: 'The final Share Purchase Agreement is ready for signature from both sides.',
        action: 'Sign now'
      },
      {
        id: 'escrow',
        name: 'Fund the escrow',
        who: 'Standish Escrow',
        party: 'Escrow',
        status: 'pending',
        drives: 'Holds the purchase price',
        detail: '10% deposit into escrow on signing, releasing on close conditions.',
        action: 'Authorize escrow'
      },
      {
        id: 'cp',
        name: 'Satisfy conditions precedent',
        who: 'Adrian',
        party: 'Counsel',
        status: 'pending',
        drives: 'Required before the wire',
        detail: 'Consents, regulatory approvals and the CP checklist must be confirmed.',
        action: 'Confirm CPs'
      },
      {
        id: 'wire',
        name: 'Wire the purchase price',
        who: 'First Republic',
        party: 'Bank',
        status: 'pending',
        drives: 'Moves the money',
        detail: '$16.2M from the capital-call account plus $1.8M escrow release.',
        action: 'Approve the wire'
      },
      {
        id: 'record',
        name: 'Record & log to Chain of Trust',
        who: 'Earn',
        party: 'System',
        status: 'pending',
        drives: 'Immutable proof of close',
        detail: 'Final docs, signatures and wire confirmations recorded across the 4-layer proof.',
        action: 'Finalize close'
      }
    ]
  },
  firstclose: {
    name: 'Fund I first close',
    sub: 'Capital · $150M target',
    kind: 'Fund close',
    amount: '$150M',
    counterparty: '8 anchor LPs',
    steps: [
      {
        id: 'lpa',
        name: 'Execute the LPA',
        who: 'You + GP counsel',
        party: 'GP',
        status: 'ready',
        drives: 'The fund’s governing agreement',
        detail: 'The Limited Partnership Agreement is final and ready for execution.',
        action: 'Execute LPA'
      },
      {
        id: 'subs',
        name: 'Countersign subscriptions',
        who: 'Eleanor',
        party: 'IR',
        status: 'pending',
        drives: 'Admits the 8 anchor LPs',
        detail:
          'Eight anchor subscription agreements are signed by LPs and awaiting GP countersignature.',
        action: 'Countersign 8'
      },
      {
        id: 'kyc',
        name: 'Final KYC / AML clearance',
        who: 'Adrian',
        party: 'Counsel',
        status: 'pending',
        drives: 'Required before accepting capital',
        detail: 'All eight anchors must clear KYC/AML before admission.',
        action: 'Clear all 8'
      },
      {
        id: 'call',
        name: 'Issue first capital call',
        who: 'Eleanor',
        party: 'IR',
        status: 'pending',
        drives: 'Draws the committed capital',
        detail: '25% initial draw across the anchor LPs to fund the first investments.',
        action: 'Issue the call'
      },
      {
        id: 'record',
        name: 'Record the close',
        who: 'Earn',
        party: 'System',
        status: 'pending',
        drives: 'Triggers the management fee',
        detail: 'First close recorded; management fee clock starts; LP records updated.',
        action: 'Finalize close'
      }
    ]
  },
  granite: {
    name: 'Granite Endowment subscription',
    sub: 'New LP · $10M',
    kind: 'LP close',
    amount: '$10.0M',
    counterparty: 'Granite Endowment',
    steps: [
      {
        id: 'sub',
        name: 'Countersign the subscription',
        who: 'Eleanor',
        party: 'IR',
        status: 'ready',
        drives: 'Admits Granite to the fund',
        detail:
          'Granite returned a signed subscription agreement for $10M; GP countersignature pending.',
        action: 'Countersign'
      },
      {
        id: 'accred',
        name: 'Verify accreditation',
        who: 'Adrian',
        party: 'Counsel',
        status: 'pending',
        drives: 'Regulatory requirement',
        detail: 'Confirm accredited / qualified-purchaser status and source of funds.',
        action: 'Verify status'
      },
      {
        id: 'wire',
        name: 'Receive the wire',
        who: 'First Republic',
        party: 'Bank',
        status: 'pending',
        drives: 'Capital in the door',
        detail: '$10M expected to the capital-call account within 10 business days.',
        action: 'Confirm receipt'
      },
      {
        id: 'admit',
        name: 'Admit to the fund & record',
        who: 'Earn',
        party: 'System',
        status: 'pending',
        drives: 'Updates the cap table',
        detail: 'Granite admitted as a Limited Partner; cap table and Chain of Trust updated.',
        action: 'Admit & record'
      }
    ]
  }
};

export interface EXCloseMeta {
  id: string;
  label: string;
  sub: string;
  /** lucide-ish icon name (resolved by the view). */
  icon: string;
}

export const EX_CLOSE_META: readonly EXCloseMeta[] = [
  { id: 'helios', label: 'Helios close', sub: 'Deal · $18M', icon: 'building-2' },
  { id: 'firstclose', label: 'Fund I first close', sub: 'Capital · $150M', icon: 'landmark' },
  { id: 'granite', label: 'Granite subscription', sub: 'New LP · $10M', icon: 'user-plus' }
];

export interface EXStepStatusMeta {
  tone: BadgeTone;
  label: string;
  /** lucide-ish icon name (resolved by the view). */
  icon: string;
}

/** A terminal step (executed): both `signed` and `wired` count as done. */
export function isStepDone(status: EXStepStatus): boolean {
  return status === 'signed' || status === 'wired';
}

/** Status → badge tone, label and icon for a step. */
export function stepStatusMeta(status: EXStepStatus): EXStepStatusMeta {
  if (isStepDone(status)) return { tone: 'success', label: 'Done', icon: 'check-circle-2' };
  if (status === 'ready') return { tone: 'gold', label: 'Ready', icon: 'pen-line' };
  return { tone: 'neutral', label: 'Waiting', icon: 'circle-dashed' };
}

/** A fresh, mutable copy of a closing's steps (so the flow can execute them). */
export function closingStepsCopy(closing: EXClosing): EXStep[] {
  return closing.steps.map((s) => ({ ...s }));
}

/** The first not-yet-executed step's index, or -1 when the closing is done. */
export function nextStepIndex(steps: readonly EXStep[]): number {
  return steps.findIndex((s) => !isStepDone(s.status));
}

export interface ClosingProgress {
  done: number;
  total: number;
  pct: number;
  closed: boolean;
}

/** Roll up a closing's progress: executed steps over total. */
export function closingProgress(steps: readonly EXStep[]): ClosingProgress {
  const total = steps.length;
  const done = steps.filter((s) => isStepDone(s.status)).length;
  return {
    done,
    total,
    pct: total > 0 ? Math.round((done / total) * 100) : 0,
    closed: total > 0 && done === total
  };
}

/**
 * Pure transform: execute one step. The target moves to its terminal state
 * (a wire step → `wired`, otherwise `signed`) and the next pending step is
 * armed to `ready` — mirroring the prototype's sequential close.
 */
export function executeStep(steps: readonly EXStep[], stepId: string): EXStep[] {
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) return steps.map((s) => ({ ...s }));
  return steps.map((s, i) => {
    if (s.id === stepId) return { ...s, status: s.id === 'wire' ? 'wired' : 'signed' };
    if (i === idx + 1 && s.status === 'pending') return { ...s, status: 'ready' };
    return { ...s };
  });
}

/** The (illustrative) steps shown while Earn executes a closing step. */
export function stepRunSteps(step: EXStep): string[] {
  return [
    'Pull the execution package',
    step.action,
    'Capture signatures / confirmations',
    'Log to Chain of Trust'
  ];
}
