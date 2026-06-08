/**
 * Plan ladder for the "Plan & credits" surface.
 *
 * Plain constant module (NOT `'use server'`): imported by the settings UI
 * (client), the Stripe checkout server action, and the webhook — so it must
 * stay free of server-only imports.
 *
 * Pricing is USD per seat / month. Annual billing is charged at the
 * `annualMonthlyCents` rate × 12 (≈ 50% off the monthly rate, matching the
 * Emerging $10/mo → $5/mo annual anchor). Edit these constants to retune.
 */

export type PlanId = 'free' | 'emerging' | 'growth' | 'fund' | 'institution';
export type PlanGroup = 'individual' | 'team';
export type BillingInterval = 'month' | 'year';

export interface PlanDef {
  id: PlanId;
  name: string;
  group: PlanGroup;
  /** One-line positioning shown under the plan name. */
  tagline: string;
  /** Monthly price (USD cents) when billed monthly. `null` = custom / contact sales. */
  monthlyCents: number | null;
  /** Effective monthly price (USD cents) when billed annually. `null` = custom. */
  annualMonthlyCents: number | null;
  /** Recurring credits granted each billing period. `null` = custom. */
  creditsPerMonth: number | null;
  /** Priced per seat — checkout quantity scales with seat count. */
  seatBased: boolean;
  /** Feature bullets shown on the plan card. */
  features: string[];
  /** Visual accent token. */
  tone: 'neutral' | 'azure' | 'gold';
  /** Marks the recommended plan within its group. */
  popular?: boolean;
  /** 'free' has no checkout; 'contact' routes to sales; 'paid' opens Stripe. */
  kind: 'free' | 'paid' | 'contact';
}

export const PLANS: readonly PlanDef[] = [
  {
    id: 'free',
    name: 'Free',
    group: 'individual',
    tagline: 'Meet Earn, your AI Chief Operating Officer.',
    monthlyCents: 0,
    annualMonthlyCents: 0,
    creditsPerMonth: 0,
    seatBased: false,
    features: [
      'Core Earn COO chat',
      '1 workspace',
      '500 starter credits',
      'Pay-as-you-go credit top-ups'
    ],
    tone: 'neutral',
    kind: 'free'
  },
  {
    id: 'emerging',
    name: 'Emerging',
    group: 'individual',
    tagline: 'For the operator building their first track record.',
    monthlyCents: 1_000,
    annualMonthlyCents: 500,
    creditsPerMonth: 1_000,
    seatBased: false,
    features: [
      'Everything in Free',
      '1,000 credits / month',
      'Full brain library',
      'Proof-of-Truth profile + Trust Center'
    ],
    tone: 'azure',
    kind: 'paid'
  },
  {
    id: 'growth',
    name: 'Growth',
    group: 'individual',
    tagline: 'For the manager actively raising and matching capital.',
    monthlyCents: 2_500,
    annualMonthlyCents: 1_250,
    creditsPerMonth: 3_000,
    seatBased: false,
    features: [
      'Everything in Emerging',
      '3,000 credits / month',
      'Priority Earn responses',
      'AI diligence committee runs',
      'LP match inbox'
    ],
    tone: 'azure',
    popular: true,
    kind: 'paid'
  },
  {
    id: 'fund',
    name: 'Fund',
    group: 'team',
    tagline: 'For the fund running deals as a team.',
    monthlyCents: 5_000,
    annualMonthlyCents: 2_500,
    creditsPerMonth: 10_000,
    seatBased: true,
    features: [
      'Everything in Growth',
      '10,000 credits / month, pooled',
      'Per-seat team workspace',
      'Chain of Trust on every deal',
      'Admin controls + audit log'
    ],
    tone: 'gold',
    popular: true,
    kind: 'paid'
  },
  {
    id: 'institution',
    name: 'Institution',
    group: 'team',
    tagline: 'For platforms and allocators operating at scale.',
    monthlyCents: null,
    annualMonthlyCents: null,
    creditsPerMonth: null,
    seatBased: true,
    features: [
      'Everything in Fund',
      'Custom credit allotment',
      'SSO / SAML + dedicated brains',
      'Advanced audit + data residency',
      'SLA + dedicated success manager'
    ],
    tone: 'gold',
    kind: 'contact'
  }
] as const;

/** Look up a plan by id. */
export function getPlan(id: string | null | undefined): PlanDef | undefined {
  return PLANS.find((p) => p.id === id);
}

/** Plans in a group, in ladder order. */
export function plansForGroup(group: PlanGroup): PlanDef[] {
  return PLANS.filter((p) => p.group === group);
}

/** Display name for a plan id (falls back to the raw value). */
export function planName(id: string | null | undefined): string {
  return getPlan(id)?.name ?? (id ? id[0].toUpperCase() + id.slice(1) : 'Free');
}

/** Per-seat price (USD cents) for the given billing interval. `null` = custom. */
export function unitPriceCents(plan: PlanDef, interval: BillingInterval): number | null {
  if (plan.kind !== 'paid') return plan.monthlyCents;
  return interval === 'year' ? (plan.annualMonthlyCents ?? 0) * 12 : (plan.monthlyCents ?? 0);
}

/** Format USD cents as a price string ($5 or $12.50). */
export function formatUsd(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
