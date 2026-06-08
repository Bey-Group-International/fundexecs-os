/**
 * Custom credit packs for the "Plan & credits" surface and the wallet popover.
 *
 * Plain constant module (NOT `'use server'`): imported by client UI and the
 * Stripe checkout server action alike, so it must avoid server-only imports.
 *
 * Operators pick a dollar amount; credits are granted at a flat conversion
 * rate. Today: 100 credits per $1 (a $20 pack → 2,000 credits).
 */

export const CREDITS_PER_DOLLAR = 100;

/** Selectable custom top-up amounts, in whole US dollars. */
export const CUSTOM_CREDIT_DOLLARS = [20, 40, 60, 100, 200, 400] as const;

export type CreditPackDollars = (typeof CUSTOM_CREDIT_DOLLARS)[number];

/** True when `dollars` is one of the offered pack amounts. */
export function isValidCreditPack(dollars: number): dollars is CreditPackDollars {
  return (CUSTOM_CREDIT_DOLLARS as readonly number[]).includes(dollars);
}

/** Credits granted for a dollar amount at the current conversion rate. */
export function creditsForDollars(dollars: number): number {
  return Math.round(dollars * CREDITS_PER_DOLLAR);
}
