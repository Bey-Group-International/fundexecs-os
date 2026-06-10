/**
 * lib/landing/access-request.ts
 * -----------------------------
 * Shared types + constants for the landing page's "Request access" flow.
 *
 * Lives outside `lib/actions/access-request.ts` because `'use server'` modules
 * may only export async functions — the form (client) and the action (server)
 * both import these from here.
 */

/** Coarse raise/AUM qualification bands. Values match the DB check constraint. */
export const RAISING_RANGES = [
  { value: 'lt_25m', label: '< $25M' },
  { value: '25_100m', label: '$25–100M' },
  { value: '100_500m', label: '$100–500M' },
  { value: 'gt_500m', label: '$500M+' },
  { value: 'undisclosed', label: 'Prefer not to say' }
] as const;

export type RaisingRange = (typeof RAISING_RANGES)[number]['value'];

export interface AccessRequestInput {
  email: string;
  fullName: string;
  firm: string;
  roleTitle: string;
  raisingRange: string;
  /** Optional invite or referral code. */
  referralCode?: string | null;
  /** Where on the page the flow was opened ('landing-hero', 'landing-nav', …). */
  source?: string;
}

export type AccessRequestResult = { ok: true } | { ok: false; error: string };
