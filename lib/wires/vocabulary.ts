/**
 * lib/wires/vocabulary.ts — the Signatures & wires room's pure vocabulary.
 *
 * Signatures are a tracking ledger (out → signed/declined); wires are a
 * strictly staged instruction ledger (instructed → sent → settled, one
 * stage at a time). Pure so the server actions and the UI can never
 * disagree on what advances next. This is a record of instructions and
 * confirmations the operator approves — e-sign/banking rails attach
 * later without changing the vocabulary.
 */

/* ── Signatures ───────────────────────────────────────────────────────── */

export type SignatureStatus = 'out_for_signature' | 'signed' | 'declined';

export const SIGNATURE_STATUSES: readonly SignatureStatus[] = [
  'out_for_signature',
  'signed',
  'declined'
];

export function isSignatureStatus(s: string): s is SignatureStatus {
  return (SIGNATURE_STATUSES as readonly string[]).includes(s);
}

export const SIGNATURE_STATUS_LABEL: Record<SignatureStatus, string> = {
  out_for_signature: 'Out for signature',
  signed: 'Signed',
  declined: 'Declined'
};

/** A signature resolves exactly once: out → signed | declined. */
export function canResolveSignature(status: string): boolean {
  return status === 'out_for_signature';
}

/* ── Wires ────────────────────────────────────────────────────────────── */

export type WireDirection = 'in' | 'out';

export function isWireDirection(d: string): d is WireDirection {
  return d === 'in' || d === 'out';
}

export const WIRE_DIRECTION_LABEL: Record<WireDirection, string> = {
  in: 'Incoming',
  out: 'Outgoing'
};

export type WireStatus = 'instructed' | 'sent' | 'settled';

/** The strict stage order — a wire advances one stage at a time. */
export const WIRE_SEQUENCE: readonly WireStatus[] = ['instructed', 'sent', 'settled'];

export function isWireStatus(s: string): s is WireStatus {
  return (WIRE_SEQUENCE as readonly string[]).includes(s);
}

export const WIRE_STATUS_LABEL: Record<WireStatus, string> = {
  instructed: 'Instructed',
  sent: 'Sent',
  settled: 'Settled'
};

/** The only legal next stage for a wire, or null when terminal/unknown. */
export function nextWireStatus(status: string): WireStatus | null {
  const i = (WIRE_SEQUENCE as readonly string[]).indexOf(status);
  if (i < 0 || i === WIRE_SEQUENCE.length - 1) return null;
  return WIRE_SEQUENCE[i + 1];
}

export interface WireLike {
  direction: string;
  amount: number;
  status: string;
}

export interface WireTotals {
  /** Settled incoming minus settled outgoing — what's actually accounted. */
  accounted: number;
  settledIn: number;
  settledOut: number;
  /** Sum still moving (instructed or sent), both directions. */
  inFlight: number;
}

/** Derive ledger totals from settled wires only — nothing is presumed. */
export function wireTotals(wires: readonly WireLike[]): WireTotals {
  let settledIn = 0;
  let settledOut = 0;
  let inFlight = 0;
  for (const w of wires) {
    if (!Number.isFinite(w.amount) || w.amount <= 0) continue;
    if (w.status === 'settled') {
      if (w.direction === 'in') settledIn += w.amount;
      else if (w.direction === 'out') settledOut += w.amount;
    } else if (isWireStatus(w.status)) {
      inFlight += w.amount;
    }
  }
  return { accounted: settledIn - settledOut, settledIn, settledOut, inFlight };
}
