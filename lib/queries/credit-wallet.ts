import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/credit-wallet.ts — the top-nav Credit Wallet (fuel-gauge).
 *
 * AI-agent work (diligence runs, Earn, the 15-agent team) consumes credits.
 * The wallet shows balance + recent consumption + plan, with one-click top-up.
 *
 * Reads the live `credit_wallets` + `credit_transactions` (member-read RLS).
 * Falls back to a clearly-flagged `configured:false` default if no wallet row
 * exists yet, so the top-nav renders cleanly. Credit *consumption* (deducting
 * via `consume_credits` on AI runs) is a separate follow-up; this is read-only.
 * ========================================================================= */

export interface CreditConsumption {
  id: string;
  /** e.g. diligence_run | earn_chat | agent_task | topup | grant */
  reason: string;
  /** Negative = consumption, positive = top-up/grant. */
  delta: number;
  /** ISO timestamp. */
  at: string;
}

export interface CreditWallet {
  balance: number;
  /** Display unit; 'credits' for now. */
  currency: string;
  plan: string;
  recentConsumption: CreditConsumption[];
  /** False until the credit ledger lands on `main` (see SEAM above). */
  configured: boolean;
}

/** Resolve the org's credit wallet for the top-nav fuel-gauge. */
export async function getCreditWallet(orgId: string): Promise<CreditWallet> {
  const fallback: CreditWallet = {
    balance: 0,
    currency: 'credits',
    plan: 'standard',
    recentConsumption: [],
    configured: false
  };

  try {
    const supabase = await createClient();
    const { data: wallet, error } = await supabase
      .from('credit_wallets')
      .select('balance, plan')
      .eq('org_id', orgId)
      .maybeSingle();
    if (error || !wallet) return fallback;

    const { data: txns } = await supabase
      .from('credit_transactions')
      .select('id, reason, delta, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(8);

    return {
      balance: wallet.balance,
      currency: 'credits',
      plan: wallet.plan,
      recentConsumption: (txns ?? []).map((t) => ({
        id: t.id,
        reason: t.reason,
        delta: t.delta,
        at: t.created_at
      })),
      configured: true
    };
  } catch {
    return fallback;
  }
}
