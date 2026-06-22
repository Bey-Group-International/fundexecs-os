// lib/stake.ts
// Phase 3 of the tokenization model (see docs/TOKENIZATION_LAYERS.md §4.2): the
// Governance layer's stake-to-list. Listing in the marketplace escrows a
// REFUNDABLE credit stake; honest completion returns it, bad-faith conduct
// forfeits it. A stake is just a credit movement with a hold: locking debits the
// wallet via grantCredits (reason 'stake_lock') and records a stake_positions
// row; resolving returns or burns it with the matching reverse ledger entry. So
// the credit_ledger stays the single source of truth for all credit movement,
// exactly the contract used by lib/credits.ts and lib/reputation.ts.
//
// The required-stake math is pure (trivially unit-testable); the DB-touching
// lock/resolve helpers defer to grantCredits for the actual credit movement.
import { createServiceClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits";
import { getWalletBalance } from "@/lib/wallet";
import type { CompoundingProfile } from "@/lib/compounding";
import type { StakePosition } from "@/lib/supabase/database.types";

type ServiceClient = ReturnType<typeof createServiceClient>;

// Base credit stake required to list, before the reputation discount. Tunable —
// a sensible default; reputable orgs post a fraction of this (see
// requiredListingStake). Denominated in credits so stake stays in one currency
// with the rest of the value model (TOKENIZATION_LAYERS.md §9 "Stake denomination").
export const BASE_LISTING_STAKE = 250;

/**
 * The credit stake an org must lock to list, scaled down by its reputation.
 * PURE. Reputable orgs (requiredStakeMultiplier < 1) post less — the governance
 * layer's own compounding: trust earns cheaper access to trust-gated actions.
 * Never negative; rounded to a whole credit.
 */
export function requiredListingStake(profile: CompoundingProfile): number {
  return Math.max(0, Math.round(BASE_LISTING_STAKE * profile.requiredStakeMultiplier));
}

export interface LockStakeInput {
  orgId: string;
  purpose: StakePosition["purpose"];
  refId: string;
  amount: number;
}

/**
 * Lock a refundable stake: debit the wallet (credit_ledger reason 'stake_lock')
 * and insert a 'locked' stake_positions row. Uses the SERVICE client because
 * credit/stake writes need the service role (RLS-bypassing trusted work).
 * Guard: if the org's balance < amount, throws and does NOT debit or insert, so
 * a listing can never be backed by credits the org doesn't have. Returns the
 * inserted StakePosition.
 */
export async function lockStake(
  service: ServiceClient,
  { orgId, purpose, refId, amount }: LockStakeInput,
): Promise<StakePosition> {
  if (amount <= 0) throw new Error("Stake amount must be positive");

  const balance = await getWalletBalance(orgId);
  if (balance < amount) {
    throw new Error(
      `Insufficient credits to stake: need ${amount}, have ${balance}`,
    );
  }

  const note = `Stake lock for ${purpose} ${refId}`;
  await grantCredits(service, orgId, -amount, "stake_lock", { note });

  const { data, error } = await service
    .from("stake_positions")
    .insert({
      organization_id: orgId,
      purpose,
      ref_id: refId,
      amount,
      status: "locked",
      note,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as StakePosition;
}

export type StakeOutcome = "returned" | "forfeited";

/**
 * Resolve a stake by id. IDEMPOTENT: only acts on a row still 'locked', so a
 * double-resolve (or a resolve after forfeiture) is a no-op returning null. On
 * 'returned' the amount is credited back (reason 'stake_release'); on 'forfeited'
 * no credit returns. Either way the row is stamped with the new status +
 * resolved_at. Returns the updated row, or null when there was no locked stake.
 */
export async function resolveStake(
  service: ServiceClient,
  stakeId: string,
  outcome: StakeOutcome,
): Promise<StakePosition | null> {
  const { data: row } = await service
    .from("stake_positions")
    .select("*")
    .eq("id", stakeId)
    .eq("status", "locked")
    .maybeSingle();
  if (!row) return null;
  const stake = row as StakePosition;

  if (outcome === "returned") {
    await grantCredits(service, stake.organization_id, stake.amount, "stake_release", {
      note: `Stake released for ${stake.purpose} ${stake.ref_id ?? stakeId}`,
    });
  }

  const { data: updated, error } = await service
    .from("stake_positions")
    .update({ status: outcome, resolved_at: new Date().toISOString() })
    .eq("id", stakeId)
    .eq("status", "locked")
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return updated as StakePosition;
}

/**
 * Convenience: find the locked listing stake for a listing and resolve it. A
 * no-op (returns null) when the listing has no locked stake — e.g. it was
 * created with a zero required stake, or already resolved.
 */
export async function resolveListingStake(
  service: ServiceClient,
  listingId: string,
  outcome: StakeOutcome,
): Promise<StakePosition | null> {
  const { data: row } = await service
    .from("stake_positions")
    .select("id")
    .eq("ref_id", listingId)
    .eq("purpose", "listing")
    .eq("status", "locked")
    .maybeSingle();
  if (!row) return null;
  return resolveStake(service, row.id, outcome);
}

/**
 * Bad-faith forfeiture through DUE PROCESS (TOKENIZATION_LAYERS.md §9). Rather
 * than instantly burning a stake, this FILES an appealable dispute against the
 * locked listing stake — no credit moves until an admin resolves it (upheld →
 * forfeited, dismissed → returned, via resolveDispute). Imported lazily to keep
 * lib/stake.ts free of a circular dependency on lib/stake-dispute.ts (which
 * imports resolveStake from here). Returns the opened dispute, or null when the
 * listing has no locked stake to dispute.
 */
export async function forfeitListingStakeViaDispute(
  service: ServiceClient,
  listingId: string,
  { orgId, reason, openedBy }: { orgId: string; reason?: string | null; openedBy?: string | null },
) {
  const { data: row } = await service
    .from("stake_positions")
    .select("id")
    .eq("ref_id", listingId)
    .eq("purpose", "listing")
    .eq("status", "locked")
    .maybeSingle();
  if (!row) return null;

  const { openDispute } = await import("@/lib/stake-dispute");
  return openDispute(service, { stakeId: row.id, orgId, reason, openedBy });
}
