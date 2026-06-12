import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/queries/org';
import {
  buildMerkleProof,
  buildMerkleRoot,
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

export interface OrgAnchorVerification {
  /** All leaves for the org (anchored + still pending a fold). */
  total: number;
  anchored: number;
  pending: number;
  /** Anchored leaves whose payload recomputes AND whose batch root re-folds. */
  verified: number;
  /** Anchored leaves that failed either check — must be zero. */
  tampered: number;
  /** True when nothing anchored has been tampered with. */
  ok: boolean;
}

/**
 * Re-verify every anchored record for an org, end to end: recompute each leaf
 * from its `trust_events` payload (catches payload tampering) and re-fold each
 * referenced batch's Merkle root over ALL its leaves (catches leaf/root
 * tampering). Server-only aggregate — returns counts only, never another org's
 * data, even though root re-folding reads sibling leaf hashes (opaque) globally.
 */
export async function getOrgAnchorVerification(orgId: string): Promise<OrgAnchorVerification> {
  const admin = createAdminClient();

  const { data: leavesRaw } = await admin
    .from('anchor_leaves')
    .select('id, trust_event_id, leaf_hash, salt, batch_id, payload_version')
    .eq('org_id', orgId);
  const leaves = leavesRaw ?? [];
  const total = leaves.length;
  const anchoredLeaves = leaves.filter((l) => l.batch_id);
  const pending = total - anchoredLeaves.length;

  if (anchoredLeaves.length === 0) {
    return { total, anchored: 0, pending, verified: 0, tampered: 0, ok: true };
  }

  // Rebuild payloads from the ledger rows the leaves commit to.
  const eventIds = anchoredLeaves.map((l) => l.trust_event_id);
  const { data: evsRaw } = await admin
    .from('trust_events')
    .select('id, org_id, actor_id, entity_type, entity_id, action, metadata, created_at')
    .in('id', eventIds);
  const evById = new Map((evsRaw ?? []).map((e) => [e.id, e]));

  // Re-fold each referenced batch's root over all of its leaves (cross-org:
  // a batch folds every org's pending leaves into one root).
  const batchIds = Array.from(new Set(anchoredLeaves.map((l) => l.batch_id as string)));
  const { data: batchesRaw } = await admin
    .from('anchor_batches')
    .select('id, merkle_root')
    .in('id', batchIds);
  const rootById = new Map((batchesRaw ?? []).map((b) => [b.id, b.merkle_root]));

  const { data: batchLeavesRaw } = await admin
    .from('anchor_leaves')
    .select('batch_id, leaf_hash, leaf_index')
    .in('batch_id', batchIds)
    .order('leaf_index', { ascending: true });
  const leavesByBatch = new Map<string, string[]>();
  for (const bl of batchLeavesRaw ?? []) {
    if (!bl.batch_id) continue;
    const arr = leavesByBatch.get(bl.batch_id) ?? [];
    arr.push(bl.leaf_hash);
    leavesByBatch.set(bl.batch_id, arr);
  }
  const batchRootOk = new Map<string, boolean>();
  for (const id of batchIds) {
    const ls = leavesByBatch.get(id) ?? [];
    const storedRoot = rootById.get(id);
    batchRootOk.set(id, !!storedRoot && ls.length > 0 && buildMerkleRoot(ls) === storedRoot);
  }

  let verified = 0;
  for (const l of anchoredLeaves) {
    const ev = evById.get(l.trust_event_id);
    if (!ev) continue;
    const payload: AnchorPayload = {
      v: l.payload_version,
      trustEventId: ev.id,
      orgId: ev.org_id,
      actorId: ev.actor_id,
      entityType: ev.entity_type,
      entityId: ev.entity_id,
      action: ev.action,
      metadata: ev.metadata,
      createdAt: ev.created_at
    };
    const payloadOk = computeLeaf(l.salt, payload) === l.leaf_hash;
    if (payloadOk && batchRootOk.get(l.batch_id as string)) verified += 1;
  }

  const tampered = anchoredLeaves.length - verified;
  return {
    total,
    anchored: anchoredLeaves.length,
    pending,
    verified,
    tampered,
    ok: tampered === 0
  };
}
