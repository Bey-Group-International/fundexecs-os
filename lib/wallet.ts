import { cache } from "react";
import { createServerClient } from "@/lib/supabase/server";
import type { Wallet } from "@/lib/supabase/database.types";

// cache() dedupes per request, matching lib/auth: the app layout, the Wallet
// page, and compoundingProfile() all need this row, and without it a single
// wallet render fired three separate reads of the same record. The public
// React 18 build (used by Jest) doesn't export cache(), so fall back to the
// unwrapped function outside Next's server runtime.
const perRequest: typeof cache =
  typeof cache === "function" ? cache : (fn) => fn;

// The full wallet row — credits plus the active plan/interval and when it began
// (for the top-bar balance, the current-plan badge, rollover, and loyalty
// tenure). null when no wallet row exists yet.
export const getWallet = perRequest(
  async (orgId: string): Promise<Wallet | null> => {
    const supabase = await createServerClient();
    const { data } = await supabase
      .from("wallets")
      .select("*")
      .eq("organization_id", orgId)
      .maybeSingle();
    return (data as Wallet | null) ?? null;
  },
);

// The org's credit balance — 0 when no wallet row exists yet. Deliberately NOT
// cached: this is the read spend guards use (lib/stake lockStake), and those
// must observe debits made earlier in the same request. Render surfaces that
// only display the balance should read getWallet().credits instead, so they
// share its per-request read.
export async function getWalletBalance(orgId: string): Promise<number> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("wallets")
    .select("credits")
    .eq("organization_id", orgId)
    .maybeSingle();
  return data?.credits ?? 0;
}
