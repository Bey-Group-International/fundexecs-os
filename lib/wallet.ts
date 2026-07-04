import { createServerClient } from "@/lib/supabase/server";
import type { Wallet } from "@/lib/supabase/database.types";

// The org's credit balance — 0 when no wallet row exists yet. Drives the
// top-bar "Balance" and the Wallet page.
export async function getWalletBalance(orgId: string): Promise<number> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("wallets")
    .select("credits")
    .eq("organization_id", orgId)
    .maybeSingle();
  return data?.credits ?? 0;
}

// The full wallet row — credits plus the active plan/interval and when it began
// (for the current-plan badge, rollover, and loyalty-tenure on the Wallet page).
export async function getWallet(orgId: string): Promise<Wallet | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("wallets")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();
  return (data as Wallet | null) ?? null;
}
