import { createAdminClient } from '@/lib/supabase/admin';

/**
 * "Proof + momentum" numbers for the invite-arrival surfaces — how many members
 * are already inside, the seat the invitee is about to take, and the credits
 * waiting in their wallet on day one. Service-role counts (the claim page is
 * pre-auth); only aggregate numbers, never PII. Best-effort: any miss returns
 * null and the arrival strip is simply hidden.
 */

/** Seed credits every new org's wallet starts with (see the release data sweep). */
export const STARTING_CREDITS = 500;

export interface BetaMomentum {
  /** Members already in the private beta. */
  memberCount: number;
  /** The seat the arriving invitee would take (memberCount + 1). */
  seatNumber: number;
  /** Earn credits waiting in their wallet on arrival. */
  startingCredits: number;
}

export async function getBetaMomentum(): Promise<BetaMomentum | null> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true });
    if (error) throw error;

    const memberCount = typeof count === 'number' && count >= 0 ? count : 0;
    return {
      memberCount,
      seatNumber: memberCount + 1,
      startingCredits: STARTING_CREDITS
    };
  } catch (error) {
    console.error('[beta-momentum] failed to resolve', error);
    return null;
  }
}
