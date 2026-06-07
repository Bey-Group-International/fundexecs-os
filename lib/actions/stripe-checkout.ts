'use server';

/* ============================================================================
 * lib/actions/stripe-checkout.ts — Stripe credit top-up checkout action.
 *
 * PLACEHOLDER — Claude's backend replaces this with a real Stripe Checkout
 * Session creation (using `stripe.checkout.sessions.create`). The UI calls
 * this action and redirects to the returned `url` on success.
 *
 * The function signature is the stable contract the UI binds to:
 *   createTopUpCheckout(credits: number) → Promise<TopUpCheckoutResult>
 *
 * Claude's implementation:
 *   1. Validates the credit amount against the allowed tiers.
 *   2. Creates a Stripe Checkout Session with `mode: 'payment'`.
 *   3. Returns the session URL for client-side redirect.
 *   4. On webhook completion, calls `consume_credits` in reverse (top-up).
 * ========================================================================= */

export interface TopUpCheckoutResult {
  ok: boolean;
  /** Stripe Checkout Session URL — redirect the user here on success. */
  url?: string;
  error?: string;
}

/** Credit top-up tiers available in the wallet popover. */
export const TOPUP_TIERS = [
  { credits: 500, label: '500 credits', priceLabel: '$5' },
  { credits: 1_500, label: '1,500 credits', priceLabel: '$12' },
  { credits: 5_000, label: '5,000 credits', priceLabel: '$35' }
] as const;

export type TopUpTier = (typeof TOPUP_TIERS)[number]['credits'];

/**
 * createTopUpCheckout — placeholder that returns a test-mode URL.
 *
 * Claude's backend replaces this body with a real Stripe Checkout Session.
 * The UI renders a "test mode" badge when `NEXT_PUBLIC_STRIPE_TEST_MODE`
 * is set, so the placeholder state is clearly communicated.
 */
export async function createTopUpCheckout(credits: TopUpTier): Promise<TopUpCheckoutResult> {
  // Validate tier
  const validTier = TOPUP_TIERS.find((t) => t.credits === credits);
  if (!validTier) {
    return { ok: false, error: 'Invalid credit tier selected.' };
  }

  // PLACEHOLDER: Return a stub result.
  // Claude's backend replaces this with:
  //   const session = await stripe.checkout.sessions.create({ ... });
  //   return { ok: true, url: session.url };
  return {
    ok: false,
    error:
      "Stripe checkout is not yet configured. Claude's backend will wire this up with a real Checkout Session."
  };
}
