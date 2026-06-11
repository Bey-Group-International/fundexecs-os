import 'server-only';

/* ============================================================================
 * lib/credits/costs.ts — the metering policy for AI runs and paid integrations.
 *
 * Every AI run and every paid third-party integration call costs credits. This
 * module is the single source of truth for (a) how much each metered action
 * costs and (b) what each plan unlocks. The actual debit happens through the
 * existing `consume_credits` Postgres RPC (see `lib/credits/meter.ts`); this
 * file only decides the numbers and the gates.
 *
 * Policy intent (per product): the FREE plan is deliberately thin — a small
 * monthly grant and no paid third-party integrations — so value (and cost)
 * unlocks as managers move to paid plans or top up credits. Owned compute
 * (chat, scoring, deck review over our own RAG) stays cheap; vendor calls that
 * cost us real money (Apollo, Granola, Docusign, Carta) cost more and are
 * plan-gated.
 * ========================================================================= */

/** Billing plans, cheapest → richest. `standard` is the historical default. */
export type Plan = 'free' | 'standard' | 'pro' | 'institutional';

export const PLANS: readonly Plan[] = ['free', 'standard', 'pro', 'institutional'] as const;

/** Coerce an unknown wallet `plan` string to a known plan (defaults to free). */
export function asPlan(plan: string | null | undefined): Plan {
  return (PLANS as readonly string[]).includes(plan ?? '') ? (plan as Plan) : 'free';
}

/* --------------------------------------------------------------------------
 * 1. Metered actions — the credit cost of each AI run / paid integration call.
 *    `reason` strings double as the `credit_transactions.reason` audit label.
 * ------------------------------------------------------------------------ */

/** Every metered action in the product. Add new runs here, not inline. */
export type MeteredAction =
  // Owned compute (our infra) — cheap.
  | 'earn_chat'
  | 'lp_fit_score'
  | 'deck_review'
  | 'objection_handler'
  | 'outreach_generate'
  // Heavier owned compute (multi-agent / long context).
  | 'diligence_run'
  | 'lp_discovery'
  | 'target_discovery'
  | 'workflow_step'
  // Paid third-party integrations (real vendor cost) — plan-gated below.
  | 'apollo_enrich'
  | 'meeting_copilot'
  | 'docusign_envelope'
  | 'carta_sync';

/** Credit cost per metered action. Tune freely — this is the only knob. */
export const ACTION_COST: Record<MeteredAction, number> = {
  earn_chat: 1,
  lp_fit_score: 2,
  objection_handler: 2,
  outreach_generate: 3,
  deck_review: 5,
  lp_discovery: 8,
  target_discovery: 8,
  workflow_step: 2,
  diligence_run: 25,
  apollo_enrich: 5,
  meeting_copilot: 10,
  docusign_envelope: 8,
  carta_sync: 6
};

/** Credit cost for an action (0 if somehow unknown — never block on a typo). */
export function costOf(action: MeteredAction): number {
  return ACTION_COST[action] ?? 0;
}

/* --------------------------------------------------------------------------
 * 2. Paid integrations — which providers each plan may use at all.
 *    Free gets none; everything paid is metered by credits on top of access.
 * ------------------------------------------------------------------------ */

/** Third-party providers that cost real money and are gated by plan. */
export type PaidIntegration = 'apollo' | 'granola' | 'docusign' | 'carta';

export const PAID_INTEGRATIONS: readonly PaidIntegration[] = [
  'apollo',
  'granola',
  'docusign',
  'carta'
] as const;

/** Which paid integrations each plan unlocks (credits still apply on use). */
const INTEGRATION_ACCESS: Record<Plan, readonly PaidIntegration[]> = {
  free: [],
  standard: ['apollo', 'granola'],
  pro: ['apollo', 'granola', 'docusign', 'carta'],
  institutional: ['apollo', 'granola', 'docusign', 'carta']
};

/** True when `plan` may use `provider` at all (before any credit check). */
export function canUseIntegration(plan: Plan, provider: PaidIntegration): boolean {
  return INTEGRATION_ACCESS[plan].includes(provider);
}

/** Canonical provider → metered-action map. Single source of truth for both the
 *  runtime debit (sync route) and the compile-time type-lock in `meter.ts`. */
export const PAID_INTEGRATION_ACTION = {
  apollo: 'apollo_enrich',
  granola: 'meeting_copilot',
  docusign: 'docusign_envelope',
  carta: 'carta_sync'
} as const satisfies Record<PaidIntegration, MeteredAction>;

/** Maps each paid integration to the action that represents its per-call cost. */
export type IntegrationActionByProvider = typeof PAID_INTEGRATION_ACTION;

/** Narrow a provider id string to a known paid integration, or null. */
export function asPaidIntegration(id: string): PaidIntegration | null {
  return (PAID_INTEGRATIONS as readonly string[]).includes(id) ? (id as PaidIntegration) : null;
}

/* --------------------------------------------------------------------------
 * 3. Monthly free grant — the credits each plan is topped up to per month.
 *    Claimed idempotently per calendar month via `claim_monthly_credit_grant`.
 * ------------------------------------------------------------------------ */

/** Credits granted at the start of each calendar month, per plan. */
export const MONTHLY_GRANT: Record<Plan, number> = {
  free: 50,
  standard: 500,
  pro: 2500,
  institutional: 15000
};

/** The next plan up from `plan` (for "out of credits → upgrade" prompts). */
export function nextPlanUp(plan: Plan): Plan | null {
  const i = PLANS.indexOf(plan);
  return i >= 0 && i < PLANS.length - 1 ? PLANS[i + 1] : null;
}
