// Calls the erasure and retention functions (service role only; see the migration).
// Authorization is the caller's job: an owner/admin of the LP's organization.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ABANDONED_AFTER_DAYS, isEraseOutcome, type EraseOutcome } from "@/lib/lp-retention";

type Client = SupabaseClient<any, any, any>;

export async function eraseLp(client: Client, args: { orgId: string; sessionId: string; actorId: string }): Promise<EraseOutcome | "error"> {
  const { data, error } = await client.rpc("erase_lp_onboarding", { p_org: args.orgId, p_session: args.sessionId, p_actor: args.actorId });
  if (error || !isEraseOutcome(data)) {
    console.error("eraseLp failed", { code: error?.code, message: error?.message });
    return "error";
  }
  return data;
}

export type PurgeAbandonedLpsResult = { count: number; failed: boolean };

/** Deletes never-used links past the retention window. Never throws; says whether it failed, so a broken purge is not mistaken for "nothing to delete". */
export async function purgeAbandonedLps(client: Client, days: number = ABANDONED_AFTER_DAYS): Promise<PurgeAbandonedLpsResult> {
  try {
    const { data, error } = await client.rpc("purge_abandoned_lp_onboarding", { p_days: days });
    if (error) throw new Error(error.message);
    return { count: typeof data === "number" ? data : 0, failed: false };
  } catch (err) {
    console.error("purgeAbandonedLps failed", err);
    return { count: 0, failed: true };
  }
}
