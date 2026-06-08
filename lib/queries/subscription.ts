import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getPlan, type BillingInterval, type PlanId } from '@/lib/billing/plans';

/* ============================================================================
 * lib/queries/subscription.ts — the org's current plan/seat/status.
 *
 * Reads the live `org_subscriptions` row (member-read RLS). When no row exists
 * the org is on the implicit free plan, so this returns a clearly-flagged
 * `configured:false` default (mirrors the credit-wallet fallback) and the
 * "Plan & credits" UI renders cleanly on deployments without billing wired.
 * ========================================================================= */

export interface OrgSubscription {
  plan: PlanId;
  interval: BillingInterval;
  seats: number;
  status: string;
  creditsPerPeriod: number;
  cancelAtPeriodEnd: boolean;
  /** ISO timestamp the current paid period ends / renews. */
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  /** False when no subscription row exists (implicit free plan). */
  configured: boolean;
}

const FREE_DEFAULT: OrgSubscription = {
  plan: 'free',
  interval: 'month',
  seats: 1,
  status: 'active',
  creditsPerPeriod: 0,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  stripeCustomerId: null,
  configured: false
};

/** Resolve the org's current subscription, or the free-plan default. */
export async function getOrgSubscription(orgId: string): Promise<OrgSubscription> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('org_subscriptions')
      .select(
        'plan, billing_interval, seats, status, credits_per_period, cancel_at_period_end, current_period_end, stripe_customer_id'
      )
      .eq('org_id', orgId)
      .maybeSingle();
    if (error || !data) return FREE_DEFAULT;

    return {
      plan: (getPlan(data.plan)?.id ?? 'free') as PlanId,
      interval: data.billing_interval === 'year' ? 'year' : 'month',
      seats: data.seats ?? 1,
      status: data.status ?? 'active',
      creditsPerPeriod: data.credits_per_period ?? 0,
      cancelAtPeriodEnd: data.cancel_at_period_end ?? false,
      currentPeriodEnd: data.current_period_end ?? null,
      stripeCustomerId: data.stripe_customer_id ?? null,
      configured: true
    };
  } catch {
    return FREE_DEFAULT;
  }
}
