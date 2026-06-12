/**
 * lib/wires/vocabulary.ts — the Signatures & wires room's pure vocabulary.
 *
 * Signatures are attestations on a tracking ledger (awaiting → partial →
 * signed/declined); wires are record-keeping + attestation on an
 * instruction ledger with the prototype's statuses — outbound wires sit
 * `staged` until released, inbound wires sit `expected` until receipt is
 * confirmed, and each clears in exactly one transition. Pure so the
 * server actions and the UI can never disagree on what advances next.
 * No money moves through FundExecs OS — e-sign/banking rails attach
 * later without changing the vocabulary.
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

/** A signature resolves exactly once: awaiting/partial → signed | declined. */
export function canResolveSignature(status: string): boolean {
  return status === 'out_for_signature' || status === 'partial';
}

/** Partial is reachable only from awaiting — some signers in, not all. */
export function canMarkSignaturePartial(status: string): boolean {
  return status === 'out_for_signature';
}

/** Chase targets partial documents — the outstanding countersigners. */
export function canChaseSignature(status: string): boolean {
  return status === 'partial';
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

/** The status a freshly staged wire starts in, by direction. */
export function stagedWireStatus(direction: WireDirection): WireStatus {
  return direction === 'out' ? 'staged' : 'expected';
}

/**
 * The only legal next status — staged → cleared (release), expected →
 * cleared (confirm) — or null when terminal/unknown.
 */
export function nextWireStatus(status: string): WireStatus | null {
  return status === 'staged' || status === 'expected' ? 'cleared' : null;
}

/** The operator's verb that clears a wire from this status, or null. */
export function clearWireVerb(status: string): 'release' | 'confirm' | null {
  if (status === 'staged') return 'release';
  if (status === 'expected') return 'confirm';
  return null;
}

/**
 * The direction-aware model only allows certain pairs: outbound wires are
 * staged or cleared, inbound wires expected or cleared. Mirrors the DB
 * check constraint so totals never count an impossible row — an outbound
 * wire marked 'expected' passes the separate status/direction guards but
 * is not a real state.
 */
export function isValidWirePair(direction: string, status: string): boolean {
  if (direction === 'out') return status === 'staged' || status === 'cleared';
  if (direction === 'in') return status === 'expected' || status === 'cleared';
  return false;
}

export interface WireLike {
  direction: string;
  amount: number;
  status: string;
}

export interface WireTotals {
  /** Cleared incoming minus cleared outgoing — what's actually accounted. */
  accounted: number;
  clearedIn: number;
  clearedOut: number;
  /** Sum still moving (staged or expected), both directions. */
  inFlight: number;
  /** Count of outbound wires sitting staged, awaiting release. */
  outboundStaged: number;
  /** Sum of every outbound wire on the ledger, any status. */
  outboundTotal: number;
  /** Sum of inbound wires still expected. */
  inboundExpected: number;
}

/** Derive ledger totals — cleared wires account, nothing is presumed. */
export function wireTotals(wires: readonly WireLike[]): WireTotals {
  const totals: WireTotals = {
    accounted: 0,
    clearedIn: 0,
    clearedOut: 0,
    inFlight: 0,
    outboundStaged: 0,
    outboundTotal: 0,
    inboundExpected: 0
  };
  for (const w of wires) {
    if (!Number.isFinite(w.amount) || w.amount <= 0) continue;
    if (!isValidWirePair(w.direction, w.status)) continue;
    if (w.direction === 'out') totals.outboundTotal += w.amount;
    if (w.status === 'cleared') {
      if (w.direction === 'in') totals.clearedIn += w.amount;
      else totals.clearedOut += w.amount;
    } else {
      totals.inFlight += w.amount;
      if (w.status === 'staged' && w.direction === 'out') totals.outboundStaged += 1;
      if (w.status === 'expected' && w.direction === 'in') totals.inboundExpected += w.amount;
    }
  }
  totals.accounted = totals.clearedIn - totals.clearedOut;
  return totals;
}
