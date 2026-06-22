// lib/stake-dispute.ts
// Stake forfeiture DUE-PROCESS path (see docs/TOKENIZATION_LAYERS.md §9
// "Forfeiture due process" and §4.2 stake-to-list). Today a stake can only be
// returned; bad-faith forfeiture must first pass through an appealable dispute
// before it burns real credits. A dispute is FILED against a still-locked stake
// and moves NO credits — that is the whole point: no burn before due process.
// Resolution is where credits finally move, and it does so by reusing the
// existing resolveStake (lib/stake.ts), so the credit_ledger stays the single
// source of truth for all credit movement — the same contract used by
// lib/credits.ts / lib/reputation.ts.
import { createServiceClient } from "@/lib/supabase/server";
import { resolveStake, type StakeOutcome } from "@/lib/stake";
import type { StakeDispute } from "@/lib/supabase/database.types";

type ServiceClient = ReturnType<typeof createServiceClient>;

// How a dispute is decided. `upheld` = forfeiture confirmed (stake burned);
// `dismissed` = staker cleared (stake returned).
export type DisputeOutcome = "upheld" | "dismissed";

/**
 * PURE decision helper: map a dispute outcome to the stake outcome it triggers,
 * and guard non-`open` disputes (idempotency at the policy level, no DB needed).
 *   upheld   → forfeited  (stake burned, no credit returns)
 *   dismissed → returned  (credits restored)
 * Returns null when the dispute is not actionable (already resolved), so callers
 * never double-move credits. Unit-testable without Supabase.
 */
export function stakeOutcomeForDispute(
  status: StakeDispute["status"],
  outcome: DisputeOutcome,
): StakeOutcome | null {
  if (status !== "open") return null;
  return outcome === "upheld" ? "forfeited" : "returned";
}

export interface OpenDisputeInput {
  stakeId: string;
  orgId: string;
  reason?: string | null;
  openedBy?: string | null;
}

/**
 * File a dispute (status 'open') against a locked stake. Does NOT move credits —
 * due process must run before any burn. Guards that the stake exists and is still
 * 'locked' (you cannot dispute an already-resolved stake). Uses the SERVICE
 * client (trusted, RLS-bypassing write). Returns the inserted dispute row.
 */
export async function openDispute(
  service: ServiceClient,
  { stakeId, orgId, reason, openedBy }: OpenDisputeInput,
): Promise<StakeDispute> {
  const { data: stake } = await service
    .from("stake_positions")
    .select("id, status")
    .eq("id", stakeId)
    .eq("status", "locked")
    .maybeSingle();
  if (!stake) {
    throw new Error("Cannot dispute: no locked stake found for that id");
  }

  const { data, error } = await service
    .from("stake_disputes")
    .insert({
      organization_id: orgId,
      stake_id: stakeId,
      status: "open",
      reason: reason ?? null,
      opened_by: openedBy ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as StakeDispute;
}

/**
 * Resolve an open dispute. IDEMPOTENT: only an 'open' dispute acts, so a
 * double-resolve is a no-op returning the row unchanged. On `upheld` the
 * underlying stake is forfeited (no credits return); on `dismissed` it is
 * returned (credits restored) — both via the existing resolveStake, keeping the
 * credit_ledger authoritative. The dispute is then stamped with its outcome,
 * resolved_at, and an optional resolution note. Returns the updated dispute.
 */
export async function resolveDispute(
  service: ServiceClient,
  disputeId: string,
  outcome: DisputeOutcome,
  note?: string | null,
): Promise<StakeDispute | null> {
  const { data: row } = await service
    .from("stake_disputes")
    .select("*")
    .eq("id", disputeId)
    .maybeSingle();
  if (!row) return null;
  const dispute = row as StakeDispute;

  const stakeOutcome = stakeOutcomeForDispute(dispute.status, outcome);
  // Already resolved (not 'open') — no-op, return the row as-is.
  if (!stakeOutcome) return dispute;

  // Move (or burn) the credits through the existing stake-resolution path so the
  // credit_ledger remains the single source of truth.
  await resolveStake(service, dispute.stake_id, stakeOutcome);

  const { data: updated, error } = await service
    .from("stake_disputes")
    .update({
      status: outcome,
      resolution_note: note ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", disputeId)
    .eq("status", "open")
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return updated as StakeDispute;
}
