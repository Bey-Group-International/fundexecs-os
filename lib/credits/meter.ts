import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  asPlan,
  canUseIntegration,
  costOf,
  nextPlanUp,
  type IntegrationActionByProvider,
  type MeteredAction,
  type PaidIntegration,
  type Plan
} from './costs';

/* ============================================================================
 * lib/credits/meter.ts — the debit seam for AI runs and paid integrations.
 *
 * Wraps the `consume_credits` / `grant_credits` Postgres RPCs, which are
 * SECURITY DEFINER and granted to service_role ONLY — so metering runs through
 * the admin client, never the user-scoped one. Callers debit BEFORE the
 * expensive work; on `insufficient` they surface a calm "out of credits →
 * upgrade" path instead of running.
 *
 * Fail policy: infrastructure failures (no service key, RPC unreachable) FAIL
 * OPEN — metering must never take a chat or run offline over a misconfig. Only
 * a genuine insufficient balance or a plan gate FAILS CLOSED.
 * ========================================================================= */

/** Outcome of a metered debit attempt. */
export type MeterResult =
  | { ok: true; debited: number; balance: number }
  | { ok: false; reason: 'insufficient'; balance: number; plan: Plan; upgradeTo: Plan | null }
  | { ok: false; reason: 'gated'; balance: number; plan: Plan; upgradeTo: Plan | null };

/** Lazily build the admin client; returns null when env is missing (fail-open). */
function adminOrNull() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

/** Read the org's current plan + balance (best-effort; free/0 on any miss). */
async function readWallet(
  orgId: string
): Promise<{ plan: Plan; balance: number; exists: boolean }> {
  const admin = adminOrNull();
  if (!admin) return { plan: 'free', balance: 0, exists: false };
  try {
    const { data } = await admin
      .from('credit_wallets')
      .select('balance, plan')
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) return { plan: 'free', balance: 0, exists: false };
    return { plan: asPlan(data.plan), balance: data.balance ?? 0, exists: true };
  } catch {
    return { plan: 'free', balance: 0, exists: false };
  }
}

/**
 * Debit `action`'s cost from the org's wallet. Returns the new balance on
 * success, or a typed failure the caller can render (insufficient → upgrade).
 * `refId` links the spend to the entity it paid for (deal, run, message).
 */
export async function meterAction(
  orgId: string,
  action: MeteredAction,
  refId?: string
): Promise<MeterResult> {
  const amount = costOf(action);
  // Zero-cost actions never touch the ledger.
  if (amount <= 0) return { ok: true, debited: 0, balance: (await readWallet(orgId)).balance };

  const admin = adminOrNull();
  // No admin client → fail open so a misconfig can't take the product offline.
  if (!admin) return { ok: true, debited: 0, balance: 0 };

  const { data, error } = await admin.rpc('consume_credits', {
    _org_id: orgId,
    _amount: amount,
    _reason: action,
    _ref_id: refId
  });

  if (!error && typeof data === 'number') {
    return { ok: true, debited: amount, balance: data };
  }

  // `consume_credits` raises on insufficient balance — map only a real shortfall
  // to a closed result. Any other RPC error fails OPEN (don't block the run).
  const wallet = await readWallet(orgId);
  const msg = error?.message ?? '';
  if (/insufficient/i.test(msg) || (wallet.exists && wallet.balance < amount)) {
    return {
      ok: false,
      reason: 'insufficient',
      balance: wallet.balance,
      plan: wallet.plan,
      upgradeTo: nextPlanUp(wallet.plan)
    };
  }
  return { ok: true, debited: 0, balance: wallet.balance };
}

/**
 * Gate + meter a paid third-party integration in one call. First checks the
 * plan is allowed to use the provider at all (free plans get none), then debits.
 * The action is type-locked to the provider so the wrong cost can't be charged.
 */
export async function meterIntegration<P extends PaidIntegration>(
  orgId: string,
  provider: P,
  action: IntegrationActionByProvider[P],
  refId?: string
): Promise<MeterResult> {
  const wallet = await readWallet(orgId);
  if (!canUseIntegration(wallet.plan, provider)) {
    return {
      ok: false,
      reason: 'gated',
      balance: wallet.balance,
      plan: wallet.plan,
      upgradeTo: nextPlanUp(wallet.plan)
    };
  }
  return meterAction(orgId, action, refId);
}

/**
 * Claim the org's idempotent monthly free grant (safe to call on any authed
 * request — the SQL no-ops if this month is already granted). Best-effort.
 */
export async function claimMonthlyGrant(orgId: string): Promise<number | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  try {
    const { data, error } = await admin.rpc('claim_monthly_credit_grant', { _org_id: orgId });
    if (error || typeof data !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}
