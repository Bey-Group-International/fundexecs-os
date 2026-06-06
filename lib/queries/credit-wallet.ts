import 'server-only';

/* ============================================================================
 * lib/queries/credit-wallet.ts — the top-nav Credit Wallet (fuel-gauge).
 *
 * AI-agent work (diligence runs, Earn, the 15-agent team) consumes credits.
 * The wallet shows balance + recent consumption + plan, with one-click top-up.
 *
 * SEAM: the `credit_wallets` / `credit_transactions` tables + `consume_credits`
 * RPC land via Codex (see docs/agents/CODEX_WAVE2_DATA.md). They are NOT on
 * `main` yet, so this loader returns a typed, clearly-flagged `configured:false`
 * default — the top-nav wallet renders a clean unconfigured state without
 * erroring. Once the tables land, replace the body with the real reads and set
 * `configured: true`; the `CreditWallet` shape is the contract and won't change.
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
export async function getCreditWallet(_orgId: string): Promise<CreditWallet> {
  // SEAM: read `credit_wallets` + recent `credit_transactions` once they exist.
  return {
    balance: 0,
    currency: 'credits',
    plan: 'standard',
    recentConsumption: [],
    configured: false
  };
}
