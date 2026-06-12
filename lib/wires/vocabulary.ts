/**
 * lib/wires/vocabulary.ts — the Signatures & wires room's pure vocabulary.
 *
 * Signatures are attestations on a tracking ledger (awaiting → partial →
 * signed | declined); wires are a direction-aware instruction ledger:
 * outbound wires stage and release (staged → cleared), inbound wires are
 * expected and confirmed (expected → cleared). Pure so the server actions
 * and the UI can never disagree on what a row may do next. This is a
 * record of instructions and attestations the operator approves —
 * e-sign/banking rails attach later without changing the vocabulary.
 */

/* ── Signatures ───────────────────────────────────────────────────────── */

export type SignatureStatus = 'out_for_signature' | 'partial' | 'signed' | 'declined';

export const SIGNATURE_STATUSES: readonly SignatureStatus[] = [
  'out_for_signature',
  'partial',
  'signed',
  'declined'
];

export function isSignatureStatus(s: string): s is SignatureStatus {
  return (SIGNATURE_STATUSES as readonly string[]).includes(s);
}

export const SIGNATURE_STATUS_LABEL: Record<SignatureStatus, string> = {
  out_for_signature: 'Awaiting',
  partial: 'Partial',
  signed: 'Signed',
  declined: 'Declined'
};

/**
 * The only legal moves on the signature ledger: an awaiting document may
 * record partial progress or resolve; a partial document may only resolve.
 * Signed and declined are terminal.
 */
export function canSignatureTransition(from: string, to: string): boolean {
  if (from === 'out_for_signature') {
    return to === 'partial' || to === 'signed' || to === 'declined';
  }
  if (from === 'partial') return to === 'signed' || to === 'declined';
  return false;
}

/** A signature still in motion — awaiting or partial — can resolve. */
export function canResolveSignature(status: string): boolean {
  return status === 'out_for_signature' || status === 'partial';
}

/** Only partially signed documents get chased. */
export function canChaseSignature(status: string): boolean {
  return status === 'partial';
}

export interface SignatureLike {
  status: string;
}

export interface SignatureSummary {
  total: number;
  signed: number;
  /** Still in motion — awaiting or partial. */
  awaiting: number;
}

export function signatureSummary(sigs: readonly SignatureLike[]): SignatureSummary {
  let signed = 0;
  let awaiting = 0;
  for (const s of sigs) {
    if (s.status === 'signed') signed += 1;
    else if (canResolveSignature(s.status)) awaiting += 1;
  }
  return { total: sigs.length, signed, awaiting };
}

/* ── Wires ────────────────────────────────────────────────────────────── */

export type WireDirection = 'in' | 'out';

export function isWireDirection(d: string): d is WireDirection {
  return d === 'in' || d === 'out';
}

export const WIRE_DIRECTION_LABEL: Record<WireDirection, string> = {
  in: 'Inbound',
  out: 'Outbound'
};

export type WireStatus = 'staged' | 'expected' | 'cleared';

export const WIRE_STATUSES: readonly WireStatus[] = ['staged', 'expected', 'cleared'];

export function isWireStatus(s: string): s is WireStatus {
  return (WIRE_STATUSES as readonly string[]).includes(s);
}

export const WIRE_STATUS_LABEL: Record<WireStatus, string> = {
  staged: 'Staged',
  expected: 'Expected',
  cleared: 'Cleared'
};

/** A new wire's opening stage is set by its direction. */
export function initialWireStatus(direction: WireDirection): WireStatus {
  return direction === 'out' ? 'staged' : 'expected';
}

/**
 * A wire clears exactly once: staged (released) or expected (confirmed)
 * → cleared. Cleared is terminal.
 */
export function canClearWire(status: string): boolean {
  return status === 'staged' || status === 'expected';
}

/** The operator verb that clears a wire — Release outbound, Confirm inbound. */
export function wireClearVerb(direction: WireDirection): 'Release' | 'Confirm' {
  return direction === 'out' ? 'Release' : 'Confirm';
}

export interface WireLike {
  direction: string;
  amount: number;
  status: string;
}

export interface WireSummary {
  /** Outbound wires staged for release. */
  outStagedCount: number;
  /** Every outbound dollar on the ledger, staged or cleared. */
  outTotal: number;
  /** Inbound dollars still expected. */
  inExpected: number;
  clearedIn: number;
  clearedOut: number;
}

/** Derive the board's summary — only well-formed rows count. */
export function wireSummary(wires: readonly WireLike[]): WireSummary {
  let outStagedCount = 0;
  let outTotal = 0;
  let inExpected = 0;
  let clearedIn = 0;
  let clearedOut = 0;
  for (const w of wires) {
    if (!Number.isFinite(w.amount) || w.amount <= 0) continue;
    if (!isWireStatus(w.status) || !isWireDirection(w.direction)) continue;
    if (w.direction === 'out') {
      outTotal += w.amount;
      if (w.status === 'staged') outStagedCount += 1;
      if (w.status === 'cleared') clearedOut += w.amount;
    } else {
      if (w.status === 'expected') inExpected += w.amount;
      if (w.status === 'cleared') clearedIn += w.amount;
    }
  }
  return { outStagedCount, outTotal, inExpected, clearedIn, clearedOut };
}
