/**
 * Shared bits for the beta welcome experience (the AI-led claim journey at
 * /beta/claim). Client- and server-safe — no `server-only` import.
 */

/** Cookie carrying the pre-auth "application" answers across sign-in so
 *  onboarding can resume from them. Set client-side before auth, read +
 *  cleared by /beta/claim/complete. Not security-sensitive. */
export const BETA_APPLICATION_COOKIE = 'fx-beta-application';

export interface BetaApplication {
  /** Display name the visitor typed. */
  name?: string;
  /** A `MemberType` value (validated server-side before use). */
  memberType?: string;
  /** One-line goal / what they want out of the program. */
  goal?: string;
}
