/**
 * Single source of truth for the in-app routes Earn may auto-navigate to.
 *
 * Kept in its own dependency-free module (NO `server-only`, no SDK imports) so
 * BOTH sides can import the exact same list:
 *   - the server tool schema in `lib/ai/earn.ts` (which IS `server-only`), and
 *   - the client chat surface in `app/ask-earn/EarnChat.tsx`, which validates
 *     model-supplied destinations before pushing a route.
 *
 * Previously each side hand-maintained its own copy; this removes the drift risk
 * where Earn could propose a navigation the client silently blocks (or vice
 * versa). Add a destination here once and both the prompt contract and the
 * client allowlist update together.
 */
export const EARN_NAV_DESTINATIONS = [
  '/command-center',
  '/build',
  '/source',
  '/run',
  '/drive',
  '/pipeline',
  '/capital-stack',
  '/profile',
  '/trust',
  '/materials',
  '/partners',
  '/match-inbox',
  '/diligence',
  '/audit',
  '/integrations',
  '/settings'
] as const;

export type EarnNavDestination = (typeof EARN_NAV_DESTINATIONS)[number];
