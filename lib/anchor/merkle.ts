import { createHash } from 'crypto';

/**
 * lib/anchor/merkle.ts — the cryptographic core of trust anchoring (pure, no IO).
 *
 * A trust_event is committed as a salted leaf `sha256(salt || canonical(payload))`.
 * Leaves are folded into a Merkle root; recomputing a leaf and folding its proof
 * to the stored root proves the record is byte-identical to what was anchored —
 * without the root, the salt, or the chain ever holding the confidential payload.
 *
 * Kept pure so it is trivially unit-testable and so the emitter (enqueue),
 * the fold worker (batch), and the verifier all agree on one spelling.
 */

/**
 * Canonical payload schema version. Bump only on a breaking serialization
 * change, and keep older verifiers around — a drift would break old proofs.
 */
export const ANCHOR_PAYLOAD_VERSION = 1;

/**
 * The exact, minimal shape of a trust_event that defines its meaning. This is
 * what gets hashed; it is reconstructed server-side from `trust_events` at
 * verify time and is NEVER stored on-chain or sent to a client unauthenticated.
 */
export interface AnchorPayload {
  /** Schema version (ANCHOR_PAYLOAD_VERSION at write time). */
  v: number;
  trustEventId: string;
  orgId: string;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  action: string;
  /** The event's metadata blob, hashed as-is via canonical serialization. */
  metadata: unknown;
  /** ISO timestamp the ledger row was created. */
  createdAt: string;
}

export interface ProofStep {
  /** The sibling hash (hex) to fold against. */
  hash: string;
  /** Which side the sibling sits on relative to the accumulator. */
  dir: 'left' | 'right';
}

/** Deterministic JSON: object keys sorted recursively so the bytes are stable. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortValue(source[key]);
    return out;
  }
  return value;
}

function sha256Hex(...parts: Buffer[]): string {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
}

function hashPair(leftHex: string, rightHex: string): string {
  return sha256Hex(Buffer.from(leftHex, 'hex'), Buffer.from(rightHex, 'hex'));
}

/** Compute a leaf hash: `sha256(salt || canonical(payload))`, lowercase hex. */
export function computeLeaf(saltHex: string, payload: AnchorPayload): string {
  const salt = Buffer.from(saltHex, 'hex');
  const body = Buffer.from(canonicalize(payload), 'utf8');
  return sha256Hex(salt, body);
}

/**
 * Fold an ordered list of leaf hashes into a Merkle root. A lone node at the
 * end of a level is carried up unchanged (no self-duplication), which keeps
 * proofs unambiguous. Throws on an empty input — there is nothing to anchor.
 */
export function buildMerkleRoot(leaves: string[]): string {
  if (leaves.length === 0) throw new Error('cannot build a Merkle root over zero leaves');
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0];
}

/**
 * Build the inclusion proof for the leaf at `index` within `leaves`. The folding
 * here mirrors buildMerkleRoot exactly (lone nodes carried up, contributing no
 * proof step) so verifyMerkleProof reproduces the same root.
 */
export function buildMerkleProof(leaves: string[], index: number): ProofStep[] {
  if (index < 0 || index >= leaves.length) throw new Error('leaf index out of range');
  const proof: ProofStep[] = [];
  let idx = index;
  let level = [...leaves];
  while (level.length > 1) {
    if (idx % 2 === 0) {
      // Left node: sibling is the right neighbour, if it exists (else carried up).
      if (idx + 1 < level.length) proof.push({ hash: level[idx + 1], dir: 'right' });
    } else {
      proof.push({ hash: level[idx - 1], dir: 'left' });
    }
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
    }
    idx = Math.floor(idx / 2);
    level = next;
  }
  return proof;
}

/** Fold a leaf through its proof and check the result equals the stored root. */
export function verifyMerkleProof(leafHex: string, proof: ProofStep[], rootHex: string): boolean {
  let acc = leafHex.toLowerCase();
  for (const step of proof) {
    const sib = step.hash.toLowerCase();
    acc = step.dir === 'left' ? hashPair(sib, acc) : hashPair(acc, sib);
  }
  return acc === rootHex.toLowerCase();
}
