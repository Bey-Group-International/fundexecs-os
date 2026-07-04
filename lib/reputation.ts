// lib/reputation.ts
// Phase 1 of the tokenization model (see docs/TOKENIZATION_LAYERS.md): durable,
// earned standing. Promotes the Phase 0 in-code reputation PROXY to a stored
// ledger. Every movement goes through grantReputation so the score row and the
// append-only reputation_ledger stay in lockstep — the same contract credits use
// (lib/credits.ts). Standing is earned from VERIFIED events only and is never
// transferable or purchasable; that is the institutional credibility guarantee.
import { createServiceClient, createServerClient } from "@/lib/supabase/server";
import { tierForScore, type ReputationTier } from "@/lib/compounding";
import type { ReputationLedgerEntry } from "@/lib/supabase/database.types";

type ServiceClient = ReturnType<typeof createServiceClient>;

// Why standing moved. Keep in lockstep with the reputation_ledger.reason values
// referenced in migration 0048.
export type ReputationReason =
  | "close_verified" // a deal reached a verified close (the keystone event)
  | "diligence_cleared" // a diligence item was cleared/waived
  | "listing_honored" // a marketplace listing completed in good faith
  | "vouch_received" // a principal-tier org vouched for this one
  | "artifact_verified" // an operator approval verified a workflow's grounded artifact
  | "bad_faith_penalty"; // misrepresentation / ghosting a matched counterparty

// Points each earnable event is worth. Aligned with the Phase 0 proxy constants
// (a closed deal = 25) so the stored score and the proxy live on one scale and
// the transition is seamless. Penalties are applied as explicit negative deltas.
// Keep this map in lockstep with the ReputationReason union above (every reason
// except bad_faith_penalty must have a point value).
export const REPUTATION_POINTS: Record<Exclude<ReputationReason, "bad_faith_penalty">, number> = {
  close_verified: 25,
  diligence_cleared: 3,
  listing_honored: 8,
  vouch_received: 10,
  artifact_verified: 2,
};

export interface GrantReputationOpts {
  /** The deal/listing/attestation that earned (or cost) the standing. */
  sourceType?: string | null;
  sourceId?: string | null;
  note?: string | null;
}

export interface ReputationState {
  score: number;
  tier: ReputationTier;
}

/**
 * Move an org's reputation by `delta` (positive = earned, negative = penalty) AND
 * append a ledger row, in the trusted server context. The atomic RPC creates the
 * score row on first grant and clamps at zero; the derived tier is written back so
 * SQL consumers see a consistent band. Returns the new {score, tier}.
 */
export async function grantReputation(
  service: ServiceClient,
  orgId: string,
  delta: number,
  reason: ReputationReason,
  opts: GrantReputationOpts = {},
): Promise<ReputationState> {
  const { data: score, error } = await service.rpc("increment_org_reputation", {
    p_org: orgId,
    p_delta: delta,
  });
  if (error) throw new Error(error.message);

  const newScore = score ?? 0;
  const tier = tierForScore(newScore);

  // Keep the derived tier column current, then record the movement. The score
  // already moved atomically in the RPC above, so surface failures here instead
  // of silently desyncing the tier column or the append-only ledger.
  const { error: tierErr } = await service
    .from("reputation_scores")
    .update({ tier })
    .eq("organization_id", orgId);
  if (tierErr) throw new Error(`reputation tier update failed: ${tierErr.message}`);

  const { error: ledgerErr } = await service.from("reputation_ledger").insert({
    organization_id: orgId,
    delta,
    reason,
    source_type: opts.sourceType ?? null,
    source_id: opts.sourceId ?? null,
    note: opts.note ?? null,
  });
  if (ledgerErr) throw new Error(`reputation ledger insert failed: ${ledgerErr.message}`);

  return { score: newScore, tier };
}

/**
 * The org's stored standing, or null when it has never earned any (the caller
 * then falls back to the Phase 0 proxy). Read in the request context.
 */
export async function getReputation(orgId: string): Promise<ReputationState | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("reputation_scores")
    .select("score, tier")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!data) return null;
  return { score: data.score, tier: tierForScore(data.score) };
}

/** Recent reputation movements for an org, newest first — the "why" behind a tier. */
export async function getReputationLedger(
  orgId: string,
  limit = 25,
): Promise<ReputationLedgerEntry[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("reputation_ledger")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ReputationLedgerEntry[];
}
