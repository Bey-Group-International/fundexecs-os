// Credit movement helpers. Grants go through grantCredits and AI spend goes
// through spend_org_credits so wallet balance and the append-only credit_ledger
// stay in lockstep under concurrent workflow execution.
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

// How far into negative territory an org may go before agent execution is
// blocked. Allows a task that starts near-empty to finish without a mid-run
// paywall — the balance floors at 0 (the RPC clamp), so this is a runway
// check only; actual wallet balance never goes below zero.
export const CREDIT_GRACE_BUFFER = 100;

// Debit `amount` credits from an org for an AI agent step. Honors the
// CREDITS_SPEND_ENABLED env gate: when unset the call is a no-op that logs what
// would have been spent (safe for preview/free-trial). When enabled, the org
// may run up to CREDIT_GRACE_BUFFER credits below the cost before being blocked,
// so a task that starts near-empty can finish. Returns { ok: false,
// insufficient: true } when the buffer is exhausted — the caller surfaces this
// as a step failure so the workflow stops cleanly.
export async function spendCredits(
  orgId: string,
  amount: number,
  agentKey?: string | null,
): Promise<{ ok: boolean; balance?: number; insufficient?: boolean }> {
  if (process.env.CREDITS_SPEND_ENABLED !== "true") {
    return { ok: true };
  }
  const service = createServiceClient();
  const { data, error } = await service.rpc("spend_org_credits", {
    p_org: orgId,
    p_amount: amount,
    p_grace: CREDIT_GRACE_BUFFER,
    p_note: agentKey ? `agent:${agentKey}` : null,
  });
  if (error) throw new Error(error.message);

  const result = data as { ok?: boolean; balance?: number; insufficient?: boolean } | null;
  return {
    ok: result?.ok === true,
    balance: typeof result?.balance === "number" ? result.balance : undefined,
    insufficient: result?.insufficient === true,
  };
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
