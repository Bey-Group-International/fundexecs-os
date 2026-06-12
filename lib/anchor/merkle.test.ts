import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANCHOR_PAYLOAD_VERSION,
  buildMerkleProof,
  buildMerkleRoot,
  canonicalize,
  computeLeaf,
  verifyMerkleProof,
  type AnchorPayload
} from './merkle';

/* ----------------------------------------------------------------------------
 * Trust-anchoring Merkle core regression suite.
 *
 * Locks the cryptographic guarantees the whole feature rests on: canonical
 * serialization is order-independent, salting changes the leaf, and every leaf
 * in a batch (including odd/carried-up positions) produces a proof that folds
 * back to the stored root — while a tampered payload or wrong salt does not.
 * Pure: no DB, no network.
 * --------------------------------------------------------------------------*/

function samplePayload(over: Partial<AnchorPayload> = {}): AnchorPayload {
  return {
    v: ANCHOR_PAYLOAD_VERSION,
    trustEventId: '11111111-1111-1111-1111-111111111111',
    orgId: '22222222-2222-2222-2222-222222222222',
    actorId: '33333333-3333-3333-3333-333333333333',
    entityType: 'evidence',
    entityId: '44444444-4444-4444-4444-444444444444',
    action: 'evidence_approved',
    metadata: { layer_advanced: true, rejection_reason: null },
    createdAt: '2026-06-12T00:00:00.000Z',
    ...over
  };
}

const SALT = 'a'.repeat(64);

test('canonicalize is key-order independent', () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
  assert.equal(canonicalize({ x: { c: 1, a: 2 } }), canonicalize({ x: { a: 2, c: 1 } }));
});

test('computeLeaf is deterministic and salt-sensitive', () => {
  const p = samplePayload();
  assert.equal(computeLeaf(SALT, p), computeLeaf(SALT, p));
  assert.notEqual(computeLeaf(SALT, p), computeLeaf('b'.repeat(64), p));
});

test('any payload change changes the leaf', () => {
  const base = computeLeaf(SALT, samplePayload());
  assert.notEqual(base, computeLeaf(SALT, samplePayload({ action: 'evidence_rejected' })));
  assert.notEqual(base, computeLeaf(SALT, samplePayload({ metadata: { layer_advanced: false } })));
});

test('every leaf in a batch verifies against the root, for batches of size 1..9', () => {
  for (let n = 1; n <= 9; n++) {
    const leaves = Array.from({ length: n }, (_, i) =>
      computeLeaf(SALT, samplePayload({ trustEventId: `event-${i}` }))
    );
    const root = buildMerkleRoot(leaves);
    for (let i = 0; i < n; i++) {
      const proof = buildMerkleProof(leaves, i);
      assert.equal(verifyMerkleProof(leaves[i], proof, root), true, `n=${n} i=${i} should verify`);
    }
  }
});

test('a tampered leaf does not verify against the original root', () => {
  const leaves = Array.from({ length: 5 }, (_, i) =>
    computeLeaf(SALT, samplePayload({ trustEventId: `event-${i}` }))
  );
  const root = buildMerkleRoot(leaves);
  const proof = buildMerkleProof(leaves, 2);
  const forged = computeLeaf(SALT, samplePayload({ trustEventId: 'event-2', action: 'tampered' }));
  assert.equal(verifyMerkleProof(forged, proof, root), false);
});

test('buildMerkleRoot rejects an empty batch', () => {
  assert.throws(() => buildMerkleRoot([]));
});
