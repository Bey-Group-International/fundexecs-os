import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { asPlan, lowBalanceThreshold, MONTHLY_GRANT, type Plan } from './costs';

/* ============================================================================
 * lib/credits/wallet-summary.ts — the derived "where am I on usage?" snapshot.
 *
 * Builds on the raw `getCreditWallet` reader (balance + recent ledger) by
 * layering the policy from costs.ts: the plan's monthly grant, this calendar
 * month's spend, and the low-balance threshold. This is what the top-nav wallet
 * chip and the /settings/wallet headline read — a single, RLS-scoped query plus
 * one usage roll-up. Read-only; the debit/grant seam lives in meter.ts.
 *
 * Falls back to a clearly-flagged `configured:false` free-plan default when no
 * wallet row exists yet, so every surface renders cleanly pre-billing.
 * ========================================================================= */

export interface WalletSummary {
  balance: number;
  plan: Plan;
  /** Credits the plan is topped up to at the start of each calendar month. */
  monthlyGrant: number;
  /** Credits spent (sum of debits) so far this calendar month. */
  usedThisMonth: number;
  /** Balance at/below which we warn (see `lowBalanceThreshold`). */
  lowThreshold: number;
  /** True when balance ≤ lowThreshold — "you can't run the big thing." */
  isLow: boolean;
  /** True when balance ≤ 0 — Earn / team functions are gated. */
  isEmpty: boolean;
  /** False when no wallet row exists yet (chip renders a neutral stub). */
  configured: boolean;
}

/** Start of the current UTC calendar month, as an ISO timestamp. */
function startOfUtcMonthISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function freeDefault(): WalletSummary {
  const plan: Plan = 'free';
  return {
    balance: 0,
    plan,
    monthlyGrant: MONTHLY_GRANT[plan],
    usedThisMonth: 0,
    lowThreshold: lowBalanceThreshold(plan),
    isLow: false,
    isEmpty: false,
    configured: false
  };
}

/** Resolve the org's wallet summary for the chip + wallet-page headline. */
export async function getWalletSummary(orgId: string): Promise<WalletSummary> {
  try {
    const supabase = await createClient();
    const { data: wallet, error } = await supabase
      .from('credit_wallets')
      .select('balance, plan')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error || !wallet) return freeDefault();

    const plan = asPlan(wallet.plan);
    const balance = wallet.balance ?? 0;

    // Roll up this month's debits (delta < 0) for the usage headline.
    const { data: debits } = await supabase
      .from('credit_transactions')
      .select('delta')
      .eq('org_id', orgId)
      .lt('delta', 0)
      .gte('created_at', startOfUtcMonthISO());
    const usedThisMonth = (debits ?? []).reduce((sum, t) => sum + Math.abs(t.delta ?? 0), 0);

    const lowThreshold = lowBalanceThreshold(plan);
    return {
      balance,
      plan,
      monthlyGrant: MONTHLY_GRANT[plan],
      usedThisMonth,
      lowThreshold,
      isLow: balance <= lowThreshold,
      isEmpty: balance <= 0,
      configured: true
    };
  } catch {
    return freeDefault();
  }
}
