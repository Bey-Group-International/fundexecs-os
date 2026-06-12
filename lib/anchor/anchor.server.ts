import 'server-only';
import { randomBytes } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAnchorProvider } from './provider';
import { buildMerkleRoot, computeLeaf, type AnchorPayload } from './merkle';

/**
 * lib/anchor/anchor.server.ts — the anchoring IO layer (server-only).
 *
 *  - enqueueAnchor: best-effort, never-block append of one salted leaf when a
 *    trust_event is written (called from the approval path).
 *  - runAnchorBatch: the fold worker (cron) — folds pending leaves into one
 *    Merkle root, hands it to the active provider, and records the batch.
 *
 * Both follow the never-block rule: a failure here must never fail an approval.
 * At worst a leaf stays pending and is folded in the next window.
 */

export interface EnqueueAnchorInput {
  trustEventId: string;
  orgId: string;
  /** The exact payload that is hashed; rebuilt from trust_events at verify time. */
  payload: AnchorPayload;
}

/** Append one salted commitment for a trust_event. Best-effort, idempotent. */
export async function enqueueAnchor(input: EnqueueAnchorInput): Promise<void> {
  try {
    // 32 random bytes of salt block confirmation/brute-force attacks: without
    // it, a party holding a candidate payload still cannot confirm what was
    // anchored. The salt lives server-side only and is never sent to a client.
    const salt = randomBytes(32).toString('hex');
    const leafHash = computeLeaf(salt, input.payload);

    const supabase = await createClient();
    const { error } = await supabase.rpc('enqueue_anchor_leaf', {
      _org_id: input.orgId,
      _trust_event_id: input.trustEventId,
      _leaf_hash: leafHash,
      _salt: salt,
      _payload_version: input.payload.v
    });
    if (error) console.warn('[anchor] enqueue failed:', error.message);
  } catch (err) {
    console.warn('[anchor] enqueue failed:', err);
  }
}

export interface AnchorBatchSummary {
  ok: boolean;
  /** Number of leaves folded into a batch this run (0 when nothing pending). */
  batched: number;
  batchId: string | null;
  provider: string | null;
  error?: string;
}

/** Max leaves folded into a single batch per run — bounds the proof width. */
const MAX_BATCH_LEAVES = 1000;

/**
 * Fold all pending leaves into one anchored batch. Service-role (cron) context.
 * Never-block: returns a summary even on partial failure.
 */
export async function runAnchorBatch(): Promise<AnchorBatchSummary> {
  try {
    const admin = createAdminClient();

    const { data: pending, error: readErr } = await admin
      .from('anchor_leaves')
      .select('id, leaf_hash')
      .is('batch_id', null)
      .order('created_at', { ascending: true })
      .limit(MAX_BATCH_LEAVES);

    if (readErr) return { ok: false, batched: 0, batchId: null, provider: null, error: readErr.message };
    if (!pending || pending.length === 0) {
      return { ok: true, batched: 0, batchId: null, provider: null };
    }

    // The leaf order here defines the proof; commit_anchor_batch stamps each
    // leaf's ordinal so the proof is rebuilt against this exact ordering.
    const leafIds = pending.map((l) => l.id);
    const root = buildMerkleRoot(pending.map((l) => l.leaf_hash));

    const provider = await getAnchorProvider();
    const result = await provider.anchorRoot(root);

    const { data: batchId, error: commitErr } = await admin.rpc('commit_anchor_batch', {
      _merkle_root: root,
      _leaf_ids: leafIds,
      _provider: result.provider,
      _chain_id: result.chainId ?? undefined,
      _tx_hash: result.txHash ?? undefined
    });
    if (commitErr) {
      return { ok: false, batched: 0, batchId: null, provider: result.provider, error: commitErr.message };
    }

    return { ok: true, batched: pending.length, batchId: batchId ?? null, provider: result.provider };
  } catch (err) {
    return {
      ok: false,
      batched: 0,
      batchId: null,
      provider: null,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
