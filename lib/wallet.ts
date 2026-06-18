import { createServerClient } from "@/lib/supabase/server";

// The org's credit balance — 0 when no wallet row exists yet. Drives the
// top-bar "Balance" and the Wallet page.
export async function getWalletBalance(orgId: string): Promise<number> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("wallets")
    .select("credits")
    .eq("organization_id", orgId)
    .maybeSingle();
  return data?.credits ?? 0;
}
