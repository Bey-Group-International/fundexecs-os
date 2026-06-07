/**
 * Credit top-up tiers shown in the wallet popover.
 *
 * Kept in a plain module (NOT a `'use server'` file): a Server Actions module
 * may only export async functions, so exporting this constant from
 * `lib/actions/stripe-checkout.ts` threw "A 'use server' file can only export
 * async functions" at runtime and 500'd every server action app-wide.
 */
export const TOPUP_TIERS = [
  { credits: 500, label: '500 credits', priceLabel: '$5', amountCents: 500 },
  { credits: 1_500, label: '1,500 credits', priceLabel: '$12', amountCents: 1_200 },
  { credits: 5_000, label: '5,000 credits', priceLabel: '$35', amountCents: 3_500 }
] as const;

export type TopUpTier = (typeof TOPUP_TIERS)[number]['credits'];
