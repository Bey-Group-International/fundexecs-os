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
// row atomically via grant_org_credits. Atomicity means the balance and audit
// record are always in sync — a failure rolls back both. Creates the wallet on
// first grant and clamps at zero, so this is safe for orgs that have never had
// a wallet, including OTHER orgs (referral upline, gift recipients) that an
// RLS-scoped client could not write.
export async function grantCredits(
  service: ServiceClient,
  orgId: string,
  amount: number,
  reason: LedgerReason,
  opts: GrantOpts = {},
): Promise<number> {
  const { data, error } = await service.rpc("grant_org_credits", {
    p_org: orgId,
    p_delta: amount,
    p_reason: reason,
    p_source_org: opts.sourceOrgId ?? null,
    p_level: opts.level ?? null,
    p_note: opts.note ?? null,
  });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

// Recent credit spend (sum of negative 'spend' entries) over the last `days`,
// returned as a positive number. Drives the plan recommender on the Wallet page.
// Uses a DB-side aggregate so only a single scalar is transferred, not N rows.
export async function recentSpend(orgId: string, days = 30): Promise<number> {
  const supabase = createServerClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabase
    .from("credit_ledger")
    .select("amount.sum()")
    .eq("organization_id", orgId)
    .eq("reason", "spend")
    .lt("amount", 0)
    .gte("created_at", since)
    .single();
  const raw = (data as unknown as { sum: number | null } | null)?.sum ?? 0;
  return Math.abs(raw);
}

// Debit `amount` credits from an org for an AI agent step. Honors the
// CREDITS_SPEND_ENABLED env gate: when unset the call is a no-op that logs what
// would have been spent (safe for preview/free-trial). When enabled and the org
// has insufficient credits, returns { ok: false, insufficient: true } — the
// caller should surface this as a step failure so the workflow stops cleanly.
export async function spendCredits(
  orgId: string,
  amount: number,
  agentKey?: string | null,
): Promise<{ ok: boolean; balance?: number; insufficient?: boolean }> {
  if (process.env.CREDITS_SPEND_ENABLED !== "true") {
    return { ok: true };
  }
  const supabase = createServerClient();
  const { data } = await supabase
    .from("wallets")
    .select("credits")
    .eq("organization_id", orgId)
    .maybeSingle();
  const balance = data?.credits ?? 0;
  if (balance < amount) {
    return { ok: false, insufficient: true, balance };
  }
  const service = createServiceClient();
  const newBalance = await grantCredits(service, orgId, -amount, "spend", {
    note: agentKey ? `agent:${agentKey}` : undefined,
  });
  return { ok: true, balance: newBalance };
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
