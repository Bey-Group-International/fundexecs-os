// Credit movement helpers. Every grant or debit goes through grantCredits so
// the wallet balance and the append-only credit_ledger stay in lockstep — the
// ledger is what the Gift Earn dashboard and the wallet history read back.
import { createServiceClient, createServerClient } from "@/lib/supabase/server";
import type { LedgerReason } from "@/lib/referrals";
import type { CreditLedgerEntry } from "@/lib/supabase/database.types";

type ServiceClient = ReturnType<typeof createServiceClient>;

export interface GrantOpts {
  /** The org that triggered this movement (e.g. the referred org). */
  sourceOrgId?: string | null;
  /** Downline depth for referral overrides. */
  level?: number | null;
  note?: string | null;
}

// Credit (amount > 0) or debit (amount < 0) an org's wallet AND append a ledger
// row, in the trusted server context. Returns the new balance. The atomic RPC
// creates the wallet on first grant and clamps at zero, so this is safe to call
// for an org that has never had a wallet — including OTHER orgs (referral
// upline, gift recipients), which a request-scoped RLS client could not write.
export async function grantCredits(
  service: ServiceClient,
  orgId: string,
  amount: number,
  reason: LedgerReason,
  opts: GrantOpts = {},
): Promise<number> {
  const { data, error } = await service.rpc("increment_org_credits", {
    p_org: orgId,
    p_delta: amount,
  });
  if (error) throw new Error(error.message);
  await service.from("credit_ledger").insert({
    organization_id: orgId,
    amount,
    reason,
    source_organization_id: opts.sourceOrgId ?? null,
    level: opts.level ?? null,
    note: opts.note ?? null,
  });
  return data ?? 0;
}

// Recent credit spend (sum of negative 'spend' entries) over the last `days`,
// returned as a positive number. Drives the plan recommender on the Wallet page.
export async function recentSpend(orgId: string, days = 30): Promise<number> {
  const supabase = createServerClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabase
    .from("credit_ledger")
    .select("amount")
    .eq("organization_id", orgId)
    .eq("reason", "spend")
    .gte("created_at", since);
  const total = (data ?? []).reduce((sum, r) => sum + Math.min(0, r.amount), 0);
  return Math.abs(total);
}

// The most recent ledger entries for an org, newest first.
export async function getLedger(orgId: string, limit = 25): Promise<CreditLedgerEntry[]> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("credit_ledger")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as CreditLedgerEntry[];
}
