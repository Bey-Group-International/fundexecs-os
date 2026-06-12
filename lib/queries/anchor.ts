import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import {
  buildMerkleProof,
  computeLeaf,
  verifyMerkleProof,
  type AnchorPayload,
  type ProofStep
} from '@/lib/anchor/merkle';

/**
 * lib/queries/anchor.ts — the verify read model (server-only).
 *
 * Builds the proof bundle for one anchored trust_event and self-verifies it.
 * Authorization gates first (only a member of the leaf's org), THEN the admin
 * client reads the salt + leaves — clients never touch these tables directly.
 *
 * Confidentiality holds: the bundle contains the payload and its proof, which
 * are released only to an already-authorized member (or, in a share flow,
 * through the existing RLS-gated share boundary) — never published.
 */

export type AnchorStatus = 'unanchored' | 'pending' | 'anchored';

export interface AnchorProofBundle {
  status: AnchorStatus;
  /** The exact payload that was hashed (rebuilt from trust_events). */
  payload: AnchorPayload | null;
  /** Server-only salt, needed to recompute the leaf. */
  salt: string | null;
  leafHash: string | null;
  /** Inclusion proof from the leaf up to the batch root (empty until anchored). */
  proof: ProofStep[];
  merkleRoot: string | null;
  provider: string | null;
  chainId: string | null;
  txHash: string | null;
  anchoredAt: string | null;
  /**
   * True when the recomputed leaf folds to the stored root AND matches the
   * stored leaf — i.e. the record is byte-identical to what was committed.
   */
  verified: boolean;
}

const UNANCHORED: AnchorProofBundle = {
  status: 'unanchored',
  payload: null,
  salt: null,
  leafHash: null,
  proof: [],
  merkleRoot: null,
  provider: null,
  chainId: null,
  txHash: null,
  anchoredAt: null,
  verified: false
};

/** Build + self-verify the anchoring proof for a trust_event. */
export async function getAnchorProofBundle(trustEventId: string): Promise<AnchorProofBundle> {
  if (!trustEventId) return UNANCHORED;
  const org = await getActiveOrg();
  if (!org) return UNANCHORED;

  const admin = createAdminClient();

  const { data: leaf } = await admin
    .from('anchor_leaves')
    .select('id, org_id, leaf_hash, salt, batch_id, leaf_index, payload_version')
    .eq('trust_event_id', trustEventId)
    .maybeSingle();

  // No leaf, or the caller is not a member of the leaf's org → reveal nothing.
  if (!leaf || leaf.org_id !== org.orgId) return UNANCHORED;

  // Rebuild the canonical payload from the ledger row (never stored in anchors).
  const { data: ev } = await admin
    .from('trust_events')
    .select('id, org_id, actor_id, entity_type, entity_id, action, metadata, created_at')
    .eq('id', trustEventId)
    .maybeSingle();
  if (!ev) return UNANCHORED;

  const payload: AnchorPayload = {
    v: leaf.payload_version,
    trustEventId: ev.id,
    orgId: ev.org_id,
    actorId: ev.actor_id,
    entityType: ev.entity_type,
    entityId: ev.entity_id,
    action: ev.action,
    metadata: ev.metadata,
    createdAt: ev.created_at
  };
  const recomputedLeaf = computeLeaf(leaf.salt, payload);
  const leafConsistent = recomputedLeaf === leaf.leaf_hash;

  // Enqueued but not yet folded into a batch.
  if (!leaf.batch_id) {
    return {
      ...UNANCHORED,
      status: 'pending',
      payload,
      salt: leaf.salt,
      leafHash: leaf.leaf_hash,
      verified: false
    };
  }

  const { data: batch } = await admin
    .from('anchor_batches')
    .select('merkle_root, provider, chain_id, tx_hash, anchored_at')
    .eq('id', leaf.batch_id)
    .maybeSingle();

  const { data: siblings } = await admin
    .from('anchor_leaves')
    .select('leaf_hash, leaf_index')
    .eq('batch_id', leaf.batch_id)
    .order('leaf_index', { ascending: true });

  if (!batch || !siblings || leaf.leaf_index === null) {
    return {
      ...UNANCHORED,
      status: 'pending',
      payload,
      salt: leaf.salt,
      leafHash: leaf.leaf_hash,
      verified: false
    };
  }

  const orderedLeaves = siblings.map((s) => s.leaf_hash);
  const proof = buildMerkleProof(orderedLeaves, leaf.leaf_index);
  const rootMatches = verifyMerkleProof(leaf.leaf_hash, proof, batch.merkle_root);

  return {
    status: 'anchored',
    payload,
    salt: leaf.salt,
    leafHash: leaf.leaf_hash,
    proof,
    merkleRoot: batch.merkle_root,
    provider: batch.provider,
    chainId: batch.chain_id,
    txHash: batch.tx_hash,
    anchoredAt: batch.anchored_at,
    verified: leafConsistent && rootMatches
  };
}
